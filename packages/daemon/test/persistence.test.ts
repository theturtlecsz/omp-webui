/**
 * Phase 2 gate: completed sessions survive browser refresh and daemon restart.
 * Live omp worker + stub LLM; skips cleanly when stub is unavailable.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { Daemon } from "../src/server.js";

const STUB_URL = "http://127.0.0.1:8788/v1/models";
async function stubAvailable(): Promise<boolean> {
  try { return (await fetch(STUB_URL, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}

interface Received { type: string; payload?: any; correlationId?: string; sessionId?: string; sequence?: number; error?: { message: string; code?: string } }

class TestClient {
  ws: WebSocket;
  received: Received[] = [];
  #waiters: { pred: (r: Received) => boolean; resolve: (r: Received) => void }[] = [];
  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { origin: `http://127.0.0.1:${port}` } });
    this.ws.on("message", (d) => {
      const msg = JSON.parse(String(d)) as Received;
      this.received.push(msg);
      this.#waiters = this.#waiters.filter((w) => (w.pred(msg) ? (w.resolve(msg), false) : true));
    });
  }
  async open() { await new Promise((res, rej) => { this.ws.once("open", res); this.ws.once("error", rej); }); }
  command(type: string, payload: unknown = {}, sessionId?: string): Promise<Received> {
    const id = `t_${Math.random().toString(36).slice(2)}`;
    const p = this.waitFor((r) => r.correlationId === id, 60_000);
    this.ws.send(JSON.stringify({ protocolVersion: 1, type, id, sessionId, payload }));
    return p;
  }
  waitFor(pred: (r: Received) => boolean, timeoutMs = 60_000): Promise<Received> {
    const existing = this.received.find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("waitFor timeout")), timeoutMs);
      this.#waiters.push({ pred, resolve: (r) => { clearTimeout(timer); resolve(r); } });
    });
  }
  close() { this.ws.close(); }
}

describe("phase 2 persistence", () => {
  let canRun = false;
  let workspaceDir = "";
  let dbPath = "";
  let sessionFile = "";
  let sessionId = "";

  beforeAll(async () => {
    canRun = await stubAvailable();
    workspaceDir = mkdtempSync(join(tmpdir(), "omp-webui-persist-ws-"));
    dbPath = join(mkdtempSync(join(tmpdir(), "omp-webui-db-")), "daemon.db");
  });

  it("session survives daemon restart; snapshot replays transcript", async () => {
    if (!canRun) { console.warn("SKIP: stub LLM unavailable"); return; }

    // --- Daemon instance 1 ---
    const d1 = new Daemon({ host: "127.0.0.1", port: 0, dbPath, approvalMode: "yolo" });
    await d1.start();
    const c1 = new TestClient(d1.port);
    await c1.open();
    await c1.waitFor((r) => r.type === "connection.ready");
    const wsRes = await c1.command("workspace.open", { root: workspaceDir });
    const workspaceId = (wsRes.payload as any).workspace.id as string;

    await c1.command("session.create", { workspaceId });
    await c1.waitFor((r) => r.type === "worker.ready", 30_000);
    await c1.command("prompt.submit", { message: "say hello" }, `new:${workspaceDir}`);
    await c1.waitFor((r) => r.type === "message.completed", 30_000);
    await c1.command("prompt.submit", { message: "please use a tool now" }, `new:${workspaceDir}`);
    await c1.waitFor((r) => r.type === "tool.completed", 30_000);

    const listed = await c1.command("session.list", { workspaceId });
    const sessions = (listed.payload as any).sessions as any[];
    expect(sessions.length).toBeGreaterThan(0);
    sessionId = sessions[0].sessionId;
    sessionFile = sessions[0].sessionFile;
    expect(sessionFile.endsWith(".jsonl")).toBe(true);
    c1.close();
    await d1.stop();

    // --- Daemon instance 2 (fresh process state, same DB) ---
    const d2 = new Daemon({ host: "127.0.0.1", port: 0, dbPath, approvalMode: "yolo" });
    await d2.start();
    const c2 = new TestClient(d2.port);
    await c2.open();
    await c2.waitFor((r) => r.type === "connection.ready");

    // session.list reflects the persisted index (no worker needed)
    const relisted = await c2.command("session.list", { workspaceId });
    const relistedSessions = (relisted.payload as any).sessions as any[];
    expect(relistedSessions.some((s) => s.sessionId === sessionId)).toBe(true);

    // resume: snapshot must contain both messages and the tool item
    await c2.command("connection.resume", { sessionId, afterSequence: 0 });
    const snapshot = await c2.waitFor((r) => r.type === "session.snapshot", 15_000);
    const items = (snapshot.payload as any).items as any[];
    const userMsgs = items.filter((i) => i.kind === "user");
    const assistantMsgs = items.filter((i) => i.kind === "assistant" && i.text?.length > 0);
    const toolItems = items.filter((i) => i.kind === "tool");
    expect(userMsgs.length).toBeGreaterThanOrEqual(2);
    expect(assistantMsgs.length).toBeGreaterThanOrEqual(1);
    expect(toolItems.some((t) => t.toolName === "bash")).toBe(true);
    await c2.waitFor((r) => r.type === "replay.completed", 15_000);

    // resume the same session in a live worker and continue prompting
    await c2.command("workspace.open", { root: workspaceDir });
    await c2.command("session.open", { workspaceId, sessionFile });
    await c2.waitFor((r) => r.type === "worker.ready", 30_000);
    await c2.command("prompt.submit", { message: "say hello again" }, sessionFile);
    const done = await c2.waitFor((r) => r.type === "message.completed", 30_000);
    expect(done.payload).toBeTruthy();

    c2.close();
    await d2.stop();
  }, 180_000);
});
