/**
 * Model/thinking command coverage against a REAL omp worker + stub LLM.
 * Verifies the daemon's model.list/model.set/model.cycle/thinking.set/
 * thinking.cycle passthroughs round-trip through omp's RPC surface
 * (cycle_model, cycle_thinking_level, get_available_models, set_model,
 * set_thinking_level) and that refreshState re-emits context.updated with
 * the new values.
 *
 * Requires: stub-llm on 127.0.0.1:8788 and omp on PATH (skips otherwise).
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync } from "node:fs";
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
  error?: { message: string };
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

describe("model/thinking commands (real omp)", () => {
  let daemon: Daemon;
  let workspaceDir: string;
  let canRun = false;

  beforeAll(async () => {
    canRun = await stubAvailable();
    if (!canRun) return;
    workspaceDir = mkdtempSync(join(tmpdir(), "omp-webui-model-"));
    daemon = new Daemon({ host: "127.0.0.1", port: 0, workerIdleMs: 60_000 });
    await daemon.start();
  }, 30_000);

  afterAll(async () => {
    if (daemon) await daemon.stop();
  });

  it("lists models, sets thinking level, cycles both, and reflects state via context.updated", async () => {
    if (!canRun) { console.warn("SKIP: stub LLM not running on 8788"); return; }
    const client = new TestClient(daemon.port);
    await client.open();
    await client.waitFor((r) => r.type === "connection.ready");

    const wsRes = await client.command("workspace.open", { root: workspaceDir });
    const workspace = (wsRes.payload as { workspace: { id: string } }).workspace;
    await client.command("session.create", { workspaceId: workspace.id });
    await client.waitFor((r) => r.type === "worker.ready", 30_000);
    const sessionKey = "new:" + workspaceDir;

    // model.list returns the stub provider's catalog from get_available_models
    const listRes = await client.command("model.list", {}, sessionKey);
    expect(listRes.error).toBeUndefined();
    const models = (listRes.payload as { models: { id: string; provider: string }[] }).models;
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    const stub = models.find((m) => m.provider === "teststub");
    expect(stub?.id).toBe("stub-1");

    // thinking.set round-trips and refreshState emits context.updated
    const setRes = await client.command("thinking.set", { level: "high" }, sessionKey);
    expect(setRes.error).toBeUndefined();
    const ctx = await client.waitFor((r) => r.type === "context.updated"
      && (r.payload as { thinkingLevel?: string }).thinkingLevel === "high", 10_000);
    expect(ctx).toBeTruthy();

    // thinking.cycle moves to a valid level (omp cycle_thinking_level)
    const cycleTh = await client.command("thinking.cycle", {}, sessionKey);
    expect(cycleTh.error).toBeUndefined();
    const ctx2 = await client.waitFor((r) => r.type === "context.updated"
      && typeof (r.payload as { thinkingLevel?: string }).thinkingLevel === "string", 10_000);
    const level = (ctx2.payload as { thinkingLevel: string }).thinkingLevel;
    expect(["off", "minimal", "low", "medium", "high", "xhigh", "max", "inherit"]).toContain(level);

    // model.set to the same stub model succeeds
    const setModel = await client.command("model.set", { provider: "teststub", modelId: "stub-1" }, sessionKey);
    expect(setModel.error).toBeUndefined();
    const ctx3 = await client.waitFor((r) => r.type === "context.updated"
      && (r.payload as { model?: { id?: string } }).model?.id === "stub-1", 10_000);
    expect(ctx3).toBeTruthy();

    // model.cycle answers without error (single-model catalog may return null result)
    const cycleModel = await client.command("model.cycle", {}, sessionKey);
    expect(cycleModel.error).toBeUndefined();

    client.close();
  }, 90_000);

  it("model/thinking commands on an inactive session produce a clean error", async () => {
    if (!canRun) { console.warn("SKIP: stub LLM not running on 8788"); return; }
    const client = new TestClient(daemon.port);
    await client.open();
    await client.waitFor((r) => r.type === "connection.ready");
    const res = await client.command("model.cycle", {}, "no-such-session");
    expect(res.error?.message).toContain("not active");
    const res2 = await client.command("thinking.cycle", {}, "no-such-session");
    expect(res2.error?.message).toContain("not active");
    client.close();
  }, 30_000);
});
