/**
 * Security regression suite for the independent review's critical findings:
 * foreign session-file paths must never be readable/openable/forkable, artifact
 * symlinks must never escape the artifact dir, protocol versions are enforced,
 * hostile chunk reassembly cannot exhaust memory or crash the daemon, and idle
 * workers are actually reaped.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Daemon } from "../src/server.js";
import { sessionDirForCwd } from "../src/session-files.js";

const WS_PORT = 7811;
let tmp: string;
let daemon: Daemon;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "ompd-contain-"));
  daemon = new Daemon({ host: "127.0.0.1", port: WS_PORT, webDistDir: undefined, workerIdleMs: 250, approvalMode: "yolo" });
  await daemon.start();
});

afterEach(async () => {
  await daemon.stop();
  rmSync(tmp, { recursive: true, force: true });
});

class Client {
  ws!: WebSocket;
  inbox: Record<string, unknown>[] = [];
  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}/ws`);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e as unknown as Error);
      this.ws.onmessage = (e) => this.inbox.push(JSON.parse(String(e.data)));
    });
  }
  sendRaw(s: string) { this.ws.send(s); }
  command(type: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = `c_${Math.random().toString(36).slice(2)}`;
    this.ws.send(JSON.stringify({ protocolVersion: 1, type, id, payload }));
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        const r = this.inbox.find((m) => (m as { correlationId?: string }).correlationId === id);
        if (r) return resolve(r as Record<string, unknown>);
        if (Date.now() - t0 > 8000) return reject(new Error(`timeout ${type}`));
        setTimeout(tick, 10);
      };
      tick();
    });
  }
  close() { this.ws.close(); }
}

async function waitFor(predicate: () => boolean, ms = 8000): Promise<void> {
  const t0 = Date.now();
  while (!predicate()) {
    if (Date.now() - t0 > ms) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("session/artifact containment", () => {
  test("connection.resume rejects a foreign session file outside any workspace", async () => {
    const c = new Client(); await c.connect();
    const foreign = join(tmp, "foreign-secret.jsonl");
    writeFileSync(foreign, JSON.stringify({ type: "session", id: "foreign", timestamp: "2026-08-10T00:00:00Z", cwd: "/etc" }) + "\n" +
      JSON.stringify({ type: "message", id: "m1", timestamp: "2026-08-10T00:00:01Z", message: { role: "user", content: [{ type: "text", text: "INTEGRATION_REVIEW_SECRET" }] } }) + "\n");
    const res = await c.command("connection.resume", { sessionId: foreign, afterSequence: 0 });
    expect((res.error as { code?: string })?.code).toBe("session_not_found");
    expect(c.inbox.some((m) => JSON.stringify(m).includes("INTEGRATION_REVIEW_SECRET"))).toBe(false);
    c.close();
  });

  test("session.fork rejects a foreign session file", async () => {
    const c = new Client(); await c.connect();
    const foreign = join(tmp, "foreign.jsonl");
    writeFileSync(foreign, JSON.stringify({ type: "session", id: "f", timestamp: "2026-08-10T00:00:00Z", cwd: "/etc" }) + "\n");
    const res = await c.command("session.fork", { sessionFile: foreign });
    expect(res.error).toBeTruthy();
    c.close();
  });

  test("session.open rejects a session file outside the workspace session dir", async () => {
    const c = new Client(); await c.connect();
    const ws = await c.command("workspace.open", { root: tmp });
    const workspaceId = (ws.payload as { workspace: { id: string } }).workspace.id;
    const foreign = join(tmp, "..", `foreign-${Date.now()}.jsonl`);
    writeFileSync(foreign, JSON.stringify({ type: "session", id: "f2", timestamp: "2026-08-10T00:00:00Z", cwd: tmp }) + "\n");
    const res = await c.command("session.open", { workspaceId, sessionFile: foreign });
    expect(res.error).toBeTruthy();
    c.close();
  });

  test("artifact endpoint rejects foreign session files and escaping symlinks", async () => {
    const c = new Client(); await c.connect();
    await c.command("workspace.open", { root: tmp });
    // legit session file inside the workspace session dir
    const dir = sessionDirForCwd(tmp);
    mkdirSync(dir, { recursive: true });
    const sf = join(dir, "sess.jsonl");
    writeFileSync(sf, JSON.stringify({ type: "session", id: "s", timestamp: "2026-08-10T00:00:00Z", cwd: tmp }) + "\n");
    const artDir = join(dir, "sess-artifacts");
    mkdirSync(artDir, { recursive: true });
    const secret = join(tmp, "secret.txt");
    writeFileSync(secret, "TOPSECRET");
    symlinkSync(secret, join(artDir, "leak"));
    writeFileSync(join(artDir, "ok.txt"), "fine");

    // foreign sessionFile param → 403
    let r = await fetch(`http://127.0.0.1:${WS_PORT}/api/artifact?sessionFile=${encodeURIComponent(join(tmp, "nope.jsonl"))}&name=ok.txt`);
    expect(r.status).toBe(403);
    // symlink escape inside a VALID artifact dir → 403, no content leak
    r = await fetch(`http://127.0.0.1:${WS_PORT}/api/artifact?sessionFile=${encodeURIComponent(sf)}&name=leak`);
    expect(r.status).toBe(403);
    expect(await r.text()).not.toContain("TOPSECRET");
    // real artifact still served
    r = await fetch(`http://127.0.0.1:${WS_PORT}/api/artifact?sessionFile=${encodeURIComponent(sf)}&name=ok.txt`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("fine");
    c.close();
  });
});

describe("protocol version enforcement", () => {
  test("unsupported protocolVersion is rejected with connection.error", async () => {
    const c = new Client(); await c.connect();
    c.sendRaw(JSON.stringify({ protocolVersion: 0, type: "workspace.list", id: "v0", payload: {} }));
    await waitFor(() => c.inbox.some((m) => (m as { type?: string }).type === "connection.error"));
    const err = c.inbox.find((m) => (m as { type?: string }).type === "connection.error") as { error: { code?: string }; correlationId?: string };
    expect(err.error.code).toBe("protocol_version");
    expect(err.correlationId).toBe("v0");
    c.close();
  });
});

describe("hostile worker output", () => {
  test("huge chunk counts, incomplete assemblies, and oversized lines are dropped without crashing", async () => {
    const c = new Client(); await c.connect();
    const ws = await c.command("workspace.open", { root: tmp });
    const workspaceId = (ws.payload as { workspace: { id: string } }).workspace.id;
    const sess = await c.command("session.create", { workspaceId });
    const sessionId = (sess.payload as { sessionId: string }).sessionId;
    await c.command("session.open", { workspaceId, sessionFile: (sess.payload as { sessionFile: string }).sessionFile });

    const hook = daemon as unknown as { injectWorkerLine(sid: string, line: string): void };
    expect(daemon.getRuntimeList().some((r) => r.sessionId === sessionId && r.worker?.state === "ready")).toBe(true);

    // huge count, oversized line, many incomplete ids, bad base64 — all must be swallowed
    hook.injectWorkerLine(sessionId, JSON.stringify({ type: "rpc_chunk", chunkId: "a", index: 0, count: 2_000_000_000, byteLength: 10, data: "eA==" }));
    hook.injectWorkerLine(sessionId, "x".repeat(16 * 1024 * 1024));
    for (let i = 0; i < 64; i++) hook.injectWorkerLine(sessionId, JSON.stringify({ type: "rpc_chunk", chunkId: `incomplete-${i}`, index: 0, count: 2, byteLength: 8, data: "eA==" }));
    hook.injectWorkerLine(sessionId, JSON.stringify({ type: "rpc_chunk", chunkId: "b", index: 0, count: 1, byteLength: 100, data: "not-valid-base64!!!" }));

    // daemon still fully functional afterwards
    const list = await c.command("session.list", { workspaceId });
    expect(list.error).toBeUndefined();
    expect(Array.isArray((list.payload as { sessions: unknown[] }).sessions)).toBe(true);
    c.close();
  });
});

describe("idle worker reaping", () => {
  test("idle worker is stopped after workerIdleMs", async () => {
    const c = new Client(); await c.connect();
    const ws = await c.command("workspace.open", { root: tmp });
    const workspaceId = (ws.payload as { workspace: { id: string } }).workspace.id;
    await c.command("session.create", { workspaceId });
    await waitFor(() => daemon.getRuntimeList().some((r) => r.worker?.state === "ready"));
    daemon.reapNow(); // before idle: preserved
    expect(daemon.getRuntimeList().length).toBe(1);
    await new Promise((r) => setTimeout(r, 400)); // exceed 250ms idle window
    daemon.reapNow();
    await waitFor(() => daemon.getRuntimeList().length === 0);
    c.close();
  });
});
