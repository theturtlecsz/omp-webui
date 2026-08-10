/**
 * Phase 1 gate: live vertical slice against a REAL omp worker + stub LLM.
 * Requires: stub-llm on 127.0.0.1:8788 and omp on PATH (test skips with a
 * clear message when unavailable).
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { Daemon } from "../src/server.js";

const STUB_URL = "http://127.0.0.1:8788/v1/models";

async function stubAvailable(): Promise<boolean> {
  try {
    const r = await fetch(STUB_URL, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

interface Received {
  type: string;
  payload?: unknown;
  correlationId?: string;
  sessionId?: string;
  sequence?: number;
  error?: { message: string; code?: string };
}

class TestClient {
  ws: WebSocket;
  received: Received[] = [];
  #waiters: { pred: (r: Received) => boolean; resolve: (r: Received) => void }[] = [];

  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { origin: `http://127.0.0.1:${port}` } });
    this.ws.on("message", (d) => {
      const msg = JSON.parse(String(d)) as Received;
      this.received.push(msg);
      this.#waiters = this.#waiters.filter((w) => {
        if (w.pred(msg)) { w.resolve(msg); return false; }
        return true;
      });
    });
  }

  async open(): Promise<void> {
    await new Promise((res, rej) => { this.ws.once("open", res); this.ws.once("error", rej); });
  }

  command(type: string, payload: unknown = {}, sessionId?: string): Promise<Received> {
    const id = `test_${Math.random().toString(36).slice(2)}`;
    const promise = this.waitFor((r) => r.correlationId === id, 30_000);
    this.ws.send(JSON.stringify({ protocolVersion: 1, type, id, sessionId, payload }));
    return promise;
  }

  waitFor(pred: (r: Received) => boolean, timeoutMs = 30_000): Promise<Received> {
    const existing = this.received.find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("waitFor timeout")), timeoutMs);
      this.#waiters.push({ pred, resolve: (r) => { clearTimeout(timer); resolve(r); } });
    });
  }

  close(): void { this.ws.close(); }
}

describe("phase 1 vertical slice", () => {
  let daemon: Daemon;
  let workspaceDir: string;
  let canRun = false;

  beforeAll(async () => {
    canRun = await stubAvailable();
    if (!canRun) return;
    workspaceDir = mkdtempSync(join(tmpdir(), "omp-webui-ws-"));
    writeFileSync(join(workspaceDir, "hello.txt"), "hello workspace\n");
    daemon = new Daemon({ host: "127.0.0.1", port: 0, workerIdleMs: 60_000 });
    await daemon.start();
  }, 30_000);

  afterAll(async () => {
    if (daemon) await daemon.stop();
  });

  it("daemon starts, browser connects, worker streams, tool runs, abort works", async () => {
    if (!canRun) { console.warn("SKIP: stub LLM not running on 8788"); return; }
    const client = new TestClient(daemon.port);
    await client.open();
    await client.waitFor((r) => r.type === "connection.ready");

    // workspace
    const wsRes = await client.command("workspace.open", { root: workspaceDir });
    const workspace = (wsRes.payload as { workspace: { id: string } }).workspace;
    expect(workspace.id).toBeTruthy();

    // session create -> worker spawns
    const createRes = await client.command("session.create", { workspaceId: workspace.id });
    expect((createRes.payload as { sessionFile: string | null }).sessionFile !== undefined).toBe(true);
    await client.waitFor((r) => r.type === "worker.ready", 30_000);

    // plain streaming prompt
    await client.command("prompt.submit", { message: "say hello" }, "new:" + workspaceDir);
    const delta = await client.waitFor((r) => r.type === "message.delta", 30_000);
    expect(delta.payload).toBeTruthy();
    await client.waitFor((r) => r.type === "message.completed", 30_000);

    // tool-executing prompt — approval mode is "write" by default, so the exec
    // tool must raise a REAL approval dialog that round-trips before execution
    await client.command("prompt.submit", { message: "please use a tool now" }, "new:" + workspaceDir);
    const toolStart = await client.waitFor((r) => r.type === "tool.started", 30_000);
    expect((toolStart.payload as { toolName: string }).toolName).toBe("bash");
    const approval = await client.waitFor((r) => r.type === "approval.requested", 30_000);
    const interactionId = (approval.payload as { interactionId: string }).interactionId;
    expect(interactionId).toBeTruthy();
    const approvalResp = await client.command("approval.respond", { interactionId, confirmed: true }, (toolStart as { sessionId?: string }).sessionId);
    expect(approvalResp.error).toBeUndefined();
    const toolEnd = await client.waitFor((r) => r.type === "tool.completed", 30_000);
    expect(JSON.stringify(toolEnd.payload)).toContain("hello-from-omp-tool");

    // abort (no active stream — should still answer)
    const abortRes = await client.command("prompt.abort", {}, "new:" + workspaceDir);
    expect(abortRes.error).toBeUndefined();

    client.close();
  }, 120_000);

  it("rejects path escape and unknown commands", async () => {
    if (!canRun) return;
    const client = new TestClient(daemon.port);
    await client.open();
    await client.waitFor((r) => r.type === "connection.ready");
    const wsRes = await client.command("workspace.open", { root: workspaceDir });
    const workspace = (wsRes.payload as { workspace: { id: string } }).workspace;

    const escape = await client.command("file.read", { workspaceId: workspace.id, path: "../../etc/passwd" });
    expect(escape.error?.code).toBe("path_escape");

    const unknown = await client.command("definitely.unknown");
    expect(unknown.error?.message).toContain("unknown command");

    const file = await client.command("file.read", { workspaceId: workspace.id, path: "hello.txt" });
    expect((file.payload as { content: string }).content).toContain("hello workspace");
    client.close();
  }, 30_000);

  it("rejects foreign origins", async () => {
    if (!canRun) return;
    const bad = new WebSocket(`ws://127.0.0.1:${daemon.port}/ws`, { headers: { origin: "http://evil.example.com" } });
    const code = await new Promise<number>((res) => bad.on("close", (c) => res(c)));
    expect(code).toBe(4403);
  }, 15_000);
});
