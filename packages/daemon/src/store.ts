/**
 * store.ts — SQLite-backed daemon metadata + per-session event journal.
 * Runs on Bun's built-in SQLite (bun:sqlite). omp session JSONL remains the
 * authoritative transcript; this store indexes sessions/workspaces and
 * provides replay cursors for the browser protocol.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

export interface WorkspaceRow {
  id: string;
  root: string;
  name: string;
  createdAt: string;
  lastOpenedAt: string;
}

export interface SessionMetaRow {
  sessionId: string;
  sessionFile: string;
  workspaceId: string;
  title: string;
  archived: number;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface JournalEvent {
  sequence: number;
  sessionId: string;
  eventId: string;
  type: string;
  payload: string;
  createdAt: string;
}

const JOURNAL_KEEP = 10_000; // per-session retention bound

export class Store {
  readonly db: Database;

  constructor(dbPath?: string) {
    const path = dbPath ?? join(homedir(), ".omp", "webui", "daemon.db");
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        root TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        lastOpenedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        sessionId TEXT PRIMARY KEY,
        sessionFile TEXT NOT NULL UNIQUE,
        workspaceId TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        archived INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        messageCount INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspaceId, archived, updatedAt DESC);
      CREATE TABLE IF NOT EXISTS event_journal (
        sessionId TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        eventId TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        PRIMARY KEY (sessionId, sequence)
      );
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  upsertWorkspace(root: string, name?: string): WorkspaceRow {
    const now = new Date().toISOString();
    const existing = this.db.prepare("SELECT * FROM workspaces WHERE root = ?").get(root) as WorkspaceRow | undefined;
    if (existing) {
      this.db.prepare("UPDATE workspaces SET lastOpenedAt = ? WHERE id = ?").run(now, existing.id);
      return { ...existing, lastOpenedAt: now };
    }
    const row: WorkspaceRow = {
      id: randomUUID(),
      root,
      name: name ?? root.split("/").filter(Boolean).pop() ?? root,
      createdAt: now,
      lastOpenedAt: now,
    };
    this.db.prepare("INSERT INTO workspaces (id, root, name, createdAt, lastOpenedAt) VALUES (?, ?, ?, ?, ?)")
      .run(row.id, row.root, row.name, row.createdAt, row.lastOpenedAt);
    return row;
  }

  listWorkspaces(): WorkspaceRow[] {
    return this.db.prepare("SELECT * FROM workspaces ORDER BY lastOpenedAt DESC").all() as WorkspaceRow[];
  }

  upsertSession(meta: Omit<SessionMetaRow, "archived" | "messageCount"> & { archived?: number; messageCount?: number }): void {
    this.db.prepare(`
      INSERT INTO sessions (sessionId, sessionFile, workspaceId, title, archived, createdAt, updatedAt, messageCount)
      VALUES ($sessionId, $sessionFile, $workspaceId, $title, $archived, $createdAt, $updatedAt, $messageCount)
      ON CONFLICT(sessionId) DO UPDATE SET
        title = excluded.title,
        updatedAt = excluded.updatedAt,
        messageCount = excluded.messageCount,
        sessionFile = excluded.sessionFile
    `).run({
      $sessionId: meta.sessionId,
      $sessionFile: meta.sessionFile,
      $workspaceId: meta.workspaceId,
      $title: meta.title,
      $archived: meta.archived ?? 0,
      $createdAt: meta.createdAt,
      $updatedAt: meta.updatedAt,
      $messageCount: meta.messageCount ?? 0,
    });
  }

  getSessionByFile(sessionFile: string): SessionMetaRow | undefined {
    return this.db.prepare("SELECT * FROM sessions WHERE sessionFile = ?").get(sessionFile) as SessionMetaRow | undefined;
  }

  listSessions(workspaceId?: string, includeArchived = false): SessionMetaRow[] {
    if (workspaceId) {
      return includeArchived
        ? this.db.prepare("SELECT * FROM sessions WHERE workspaceId = ? ORDER BY updatedAt DESC").all(workspaceId) as SessionMetaRow[]
        : this.db.prepare("SELECT * FROM sessions WHERE workspaceId = ? AND archived = 0 ORDER BY updatedAt DESC").all(workspaceId) as SessionMetaRow[];
    }
    return includeArchived
      ? this.db.prepare("SELECT * FROM sessions ORDER BY updatedAt DESC").all() as SessionMetaRow[]
      : this.db.prepare("SELECT * FROM sessions WHERE archived = 0 ORDER BY updatedAt DESC").all() as SessionMetaRow[];
  }

  setArchived(sessionId: string, archived: boolean): void {
    this.db.prepare("UPDATE sessions SET archived = ? WHERE sessionId = ?").run(archived ? 1 : 0, sessionId);
  }

  searchSessions(query: string, workspaceId?: string): SessionMetaRow[] {
    if (workspaceId) {
      return this.db.prepare("SELECT * FROM sessions WHERE title LIKE ? AND workspaceId = ? ORDER BY updatedAt DESC LIMIT 100")
        .all(`%${query}%`, workspaceId) as SessionMetaRow[];
    }
    return this.db.prepare("SELECT * FROM sessions WHERE title LIKE ? ORDER BY updatedAt DESC LIMIT 100")
      .all(`%${query}%`) as SessionMetaRow[];
  }

  nextSequence(sessionId: string): number {
    const row = this.db.prepare("SELECT MAX(sequence) AS maxSeq FROM event_journal WHERE sessionId = ?").get(sessionId) as { maxSeq: number | null };
    return (row.maxSeq ?? 0) + 1;
  }

  appendEvent(sessionId: string, eventId: string, type: string, payload: unknown): JournalEvent {
    const sequence = this.nextSequence(sessionId);
    const createdAt = new Date().toISOString();
    const payloadJson = JSON.stringify(payload ?? null);
    this.db.prepare("INSERT INTO event_journal (sessionId, sequence, eventId, type, payload, createdAt) VALUES (?, ?, ?, ?, ?, ?)")
      .run(sessionId, sequence, eventId, type, payloadJson, createdAt);
    this.db.prepare(
      "DELETE FROM event_journal WHERE sessionId = ? AND sequence <= (SELECT MAX(sequence) FROM event_journal WHERE sessionId = ?) - ?",
    ).run(sessionId, sessionId, JOURNAL_KEEP);
    return { sequence, sessionId, eventId, type, payload: payloadJson, createdAt };
  }

  replaySince(sessionId: string, afterSequence: number, limit = 5000): JournalEvent[] {
    return this.db.prepare(
      "SELECT * FROM event_journal WHERE sessionId = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?",
    ).all(sessionId, afterSequence, limit) as JournalEvent[];
  }

  lastSequence(sessionId: string): number {
    const row = this.db.prepare("SELECT MAX(sequence) AS maxSeq FROM event_journal WHERE sessionId = ?").get(sessionId) as { maxSeq: number | null };
    return row.maxSeq ?? 0;
  }

  close(): void {
    this.db.close();
  }
}
