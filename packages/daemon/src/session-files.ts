/**
 * session-files.ts — read-only access to omp's on-disk session JSONL.
 * Mirrors computeDefaultSessionDir in oh-my-pi (session-paths.ts:185-196):
 * home-relative paths encode as `-<path-with-dashes>`.
 * omp session files remain the authoritative transcript; we never write them.
 */
import { readdirSync, readFileSync, statSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve, isAbsolute } from "node:path";

export interface SessionFileEntry {
  type: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  [k: string]: unknown;
}

export interface SessionFileInfo {
  sessionFile: string;
  sessionId: string;
  cwd: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export function sessionsRoot(agentDir = join(homedir(), ".omp", "agent")): string {
  return join(agentDir, "sessions");
}

/** Encode a cwd the same way omp does (home-relative, `-` joined). */
export function encodeSessionDirName(cwd: string): string {
  const resolved = resolve(cwd);
  let canonical = resolved;
  try { canonical = realpathSync(resolved); } catch { /* keep resolved */ }
  const home = homedir();
  const homeRel = relative(home, canonical);
  const tmpRel = relative(tmpdir(), canonical);
  const enc = (prefix: string, rel: string) => {
    const encoded = rel.replace(/[/\\:]/g, "-");
    return encoded ? `${prefix}-${encoded}` : prefix;
  };
  if (homeRel === "" || (!homeRel.startsWith("..") && !isAbsolute(homeRel))) return enc("-", homeRel);
  if (tmpRel === "" || (!tmpRel.startsWith("..") && !isAbsolute(tmpRel))) return enc("-tmp", tmpRel);
  return canonical.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-");
}

export function sessionDirForCwd(cwd: string, agentDir?: string): string {
  return join(sessionsRoot(agentDir), encodeSessionDirName(cwd));
}

function parseSessionFile(file: string): SessionFileInfo | null {
  try {
    const raw = readFileSync(file, "utf8");
    let sessionId = "";
    let cwd = "";
    let title = "";
    let createdAt = "";
    let messageCount = 0;
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let entry: SessionFileEntry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry.type === "session") {
        sessionId = String(entry.id ?? "");
        cwd = String(entry.cwd ?? "");
        createdAt = String(entry.timestamp ?? "");
      } else if (entry.type === "title" && typeof entry.title === "string" && entry.title) {
        title = entry.title;
      } else if (entry.type === "message") {
        messageCount++;
      }
    }
    if (!sessionId) return null;
    const stat = statSync(file);
    return {
      sessionFile: file,
      sessionId,
      cwd,
      title: title || "(untitled session)",
      createdAt: createdAt || stat.birthtime.toISOString(),
      updatedAt: stat.mtime.toISOString(),
      messageCount,
    };
  } catch {
    return null;
  }
}

/** List omp sessions for a workspace cwd directly from disk (no worker needed). */
export function listSessionFiles(cwd: string, agentDir?: string): SessionFileInfo[] {
  const dir = sessionDirForCwd(cwd, agentDir);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
  return files
    .map((f) => parseSessionFile(join(dir, f)))
    .filter((s): s is SessionFileInfo => s !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Read all parseable entries of a session file (for snapshot reconstruction). */
export function readSessionEntries(sessionFile: string): SessionFileEntry[] {
  const out: SessionFileEntry[] = [];
  try {
    for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch { /* skip corrupt lines */ }
    }
  } catch { /* missing file */ }
  return out;
}
