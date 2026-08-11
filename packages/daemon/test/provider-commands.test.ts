/**
 * provider.* / model.* WS command coverage — round-trips against a real Daemon
 * with PI_CODING_AGENT_DIR pointed at a tmp agent dir (no omp needed).
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { WebSocket } from "ws";
import { Daemon } from "../src/server.js";

interface Received { type: string; payload?: unknown; correlationId?: string; error?: { message: string; code?: string } }

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

  command(type: string, payload: unknown = {}): Promise<Received> {
    const id = `test_${Math.random().toString(36).slice(2)}`;
    const promise = this.waitFor((r) => r.correlationId === id, 10_000);
    this.ws.send(JSON.stringify({ protocolVersion: 1, type, id, payload }));
    return promise;
  }

  waitFor(pred: (r: Received) => boolean, timeoutMs = 10_000): Promise<Received> {
    const existing = this.received.find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("waitFor timeout")), timeoutMs);
      this.#waiters.push({ pred, resolve: (r) => { clearTimeout(timer); resolve(r); } });
    });
  }

  close(): void { this.ws.close(); }
}

interface ProviderSummary {
  id: string;
  api?: string;
  baseUrl?: string;
  hasApiKey: boolean;
  models: { id: string; name?: string }[];
}

describe("provider/model CRUD commands", () => {
  let daemon: Daemon;
  let agentDir: string;
  let client: TestClient;

  beforeAll(async () => {
    agentDir = mkdtempSync(join(tmpdir(), "omp-webui-agent-"));
    daemon = new Daemon({
      host: "127.0.0.1",
      port: 0,
      workerIdleMs: 60_000,
      workerEnv: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
    });
    await daemon.start();
    client = new TestClient(daemon.port);
    await client.open();
  }, 30_000);

  afterAll(async () => {
    client?.close();
    if (daemon) await daemon.stop();
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("provider.list starts empty", async () => {
    const res = await client.command("provider.list");
    expect(res.error).toBeUndefined();
    expect((res.payload as { providers: ProviderSummary[] }).providers).toEqual([]);
  });

  it("provider.add writes models.yml and returns the masked list", async () => {
    const res = await client.command("provider.add", {
      id: "teststub",
      api: "openai-completions",
      baseUrl: "http://127.0.0.1:8788/v1",
      apiKey: "test-key",
      models: [{ id: "stub-1", name: "Stub 1", contextWindow: 128000, maxTokens: 4096 }],
    });
    expect(res.error).toBeUndefined();
    const providers = (res.payload as { providers: ProviderSummary[] }).providers;
    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatchObject({ id: "teststub", hasApiKey: true });
    expect(JSON.stringify(providers)).not.toContain("test-key");
    // On-disk file is valid YAML in omp's schema
    const onDisk = parse(readFileSync(join(agentDir, "models.yml"), "utf8")) as { providers: Record<string, { apiKey: string }> };
    expect(onDisk.providers.teststub.apiKey).toBe("test-key");
  });

  it("a second client receives providers.changed on add", async () => {
    const observer = new TestClient(daemon.port);
    await observer.open();
    const changed = observer.waitFor((r) => r.type === "providers.changed", 5_000);
    await client.command("provider.add", {
      id: "second",
      api: "openai-completions",
      baseUrl: "http://127.0.0.1:8788/v1",
      models: [{ id: "stub-2" }],
    });
    const ev = await changed;
    const ids = (ev.payload as { providers: ProviderSummary[] }).providers.map((p) => p.id);
    expect(ids).toEqual(["teststub", "second"]);
    observer.close();
  });

  it("model.add appends; model.remove deletes; last-model removal errors", async () => {
    let res = await client.command("model.add", { providerId: "second", model: { id: "stub-3", reasoning: true } });
    expect(res.error).toBeUndefined();
    let providers = (res.payload as { providers: ProviderSummary[] }).providers;
    expect(providers.find((p) => p.id === "second")!.models.map((m) => m.id)).toEqual(["stub-2", "stub-3"]);

    res = await client.command("model.remove", { providerId: "second", modelId: "stub-2" });
    providers = (res.payload as { providers: ProviderSummary[] }).providers;
    expect(providers.find((p) => p.id === "second")!.models.map((m) => m.id)).toEqual(["stub-3"]);

    res = await client.command("model.remove", { providerId: "second", modelId: "stub-3" });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe("provider_config_invalid");
  });

  it("provider.add validation errors surface as command errors", async () => {
    const res = await client.command("provider.add", { id: "bad id!", models: [{ id: "x" }] });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe("provider_config_invalid");
  });

  it("provider.remove deletes and reports missing providers", async () => {
    let res = await client.command("provider.remove", { id: "second" });
    expect(res.error).toBeUndefined();
    expect((res.payload as { providers: ProviderSummary[] }).providers.map((p) => p.id)).toEqual(["teststub"]);
    res = await client.command("provider.remove", { id: "second" });
    expect(res.error).toBeDefined();
  });
});
