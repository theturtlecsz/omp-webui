/**
 * Fault-injection: worker crash recovery, malformed input resilience, auth/origin.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { Daemon } from "../src/server.js";

const STUB_URL = "http://127.0.0.1:8788/v1/models";
async function stubAvailable(): Promise<boolean> {
  try { return (await fetch(STUB_URL, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}

interface Received { type: string; payload?: any; correlationId?: string; sessionId?: string; error?: { message: string; code?: string } }

class TestClient {
  ws: WebSocket;
  received: Received[] = [];
  #waiters: { pred: (r: Received) => boolean; resolve: (r: Received) => void }[] = [];
  constructor(port: number, headers: Record<string, string> = { origin: "" }) {
    if (!headers.origin) headers.origin = `http://127.0.0.1:${port}`;
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
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
  sendRaw(data: string) { this.ws.send(data); }
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

describe("fault injection", () => {
  let canRun = false;
  beforeAll(async () => { canRun = await stubAvailable(); });

  it("malformed JSON and unknown commands are rejected without killing the connection", async () => {
    const d = new Daemon({ host: "127.0.0.1", port: 0 });
    await d.start();
    const c = new TestClient(d.port);
    await c.open();
    await c.waitFor((r) => r.type === "connection.ready");

    c.sendRaw("{not json");
    const err1 = await c.waitFor((r) => r.type === "connection.error");
    expect(err1.error?.message).toContain("malformed");

    c.sendRaw(JSON.stringify({ protocolVersion: 1, type: "nope.command", id: "x1", payload: {} }));
    const err2 = await c.waitFor((r) => r.correlationId === "x1" && !!r.error);
    expect(err2.error?.message).toContain("unknown command");

    // connection still alive: a normal command still works
    const ok = await c.command("workspace.list");
    expect(ok.error).toBeUndefined();
    c.close();
    await d.stop();
  });

  it("non-loopback bind without token is refused", () => {
    expect(() => new Daemon({ host: "0.0.0.0", port: 0 })).toThrow(/authToken/);
  });

  it("token auth enforced on WS and HTTP when configured", async () => {
    const d = new Daemon({ host: "0.0.0.0", port: 0, authToken: "secret-token" });
    await d.start();
    // WS without token -> closed 4401
    const bad = new WebSocket(`ws://127.0.0.1:${d.port}/ws`, { headers: { origin: `http://127.0.0.1:${d.port}` } });
    const code = await new Promise<number>((res) => bad.on("close", (c) => res(c)));
    expect(code).toBe(4401);
    // HTTP without token -> 401
    const res401 = await fetch(`http://127.0.0.1:${d.port}/api/health`);
    expect(res401.status).toBe(401);
    // HTTP with bearer -> 200
    const res200 = await fetch(`http://127.0.0.1:${d.port}/api/health`, { headers: { authorization: "Bearer secret-token" } });
    expect(res200.status).toBe(200);
    expect((await res200.json() as { version?: unknown }).version).toBe("0.1.0");
    await d.stop();
  });

  it("worker crash surfaces worker.crashed; session resumable from disk", async () => {
    if (!canRun) { console.warn("SKIP: stub LLM unavailable"); return; }
    const workspaceDir = mkdtempSync(join(tmpdir(), "omp-webui-fault-ws-"));
    const d = new Daemon({ host: "127.0.0.1", port: 0, approvalMode: "yolo" });
    await d.start();
    const c = new TestClient(d.port);
    await c.open();
    await c.waitFor((r) => r.type === "connection.ready");
    const wsRes = await c.command("workspace.open", { root: workspaceDir });
    const workspaceId = (wsRes.payload as any).workspace.id as string;
    await c.command("session.create", { workspaceId });
    await c.waitFor((r) => r.type === "worker.ready", 30_000);
    await c.command("prompt.submit", { message: "say hello" }, `new:${workspaceDir}`);
    await c.waitFor((r) => r.type === "message.completed", 30_000);
    // wait for the turn to fully end so omp flushes the session JSONL
    await c.waitFor((r) => r.type === "status.updated" && r.payload?.isStreaming === false, 30_000);

    // kill the worker process directly (simulates segfault/OOM)
    const anyRt = d.getRuntimeList()[0];
    expect(anyRt?.worker?.killNow).toBeTypeOf("function");
    anyRt!.worker!.killNow();
    const crash = await c.waitFor((r) => r.type === "worker.crashed" || r.type === "worker.stopped", 15_000);
    expect(crash).toBeTruthy();

    // session still listable + resumable from the authoritative JSONL
    // (brief grace: the JSONL writer may flush slightly after the completion event)
    await new Promise((r) => setTimeout(r, 1500));
    const listed = await c.command("session.list", { workspaceId });
    expect((listed.payload as any).sessions.length).toBeGreaterThan(0);
    const sessions = (listed.payload as any).sessions as any[];
    const withMessages = sessions.filter((s) => (s.messageCount ?? 0) > 0);
    expect(withMessages.length).toBeGreaterThan(0);
    const sessionFile = withMessages[0].sessionFile as string;
    await c.command("connection.resume", { sessionId: sessionFile, afterSequence: 0 });
    const snap = await c.waitFor((r) => r.type === "session.snapshot", 15_000);
    expect((snap.payload as any).items.length).toBeGreaterThan(0);

    // reopening starts a fresh worker and the conversation continues
    await c.command("session.open", { workspaceId, sessionFile });
    await c.waitFor((r) => r.type === "worker.ready", 30_000);
    await c.command("prompt.submit", { message: "say hello again" }, sessionFile);
    await c.waitFor((r) => r.type === "message.completed", 30_000);
    c.close();
    await d.stop();
  }, 120_000);
});
