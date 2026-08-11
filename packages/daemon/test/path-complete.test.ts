/**
 * path.complete coverage — host-directory completion for the workspace picker.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { Daemon } from "../src/server.js";

interface Received { type: string; payload?: unknown; correlationId?: string; error?: { message: string } }

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

describe("path.complete", () => {
  let daemon: Daemon;
  let base: string;

  beforeAll(async () => {
    base = mkdtempSync(join(tmpdir(), "omp-webui-paths-"));
    mkdirSync(join(base, "alpha"));
    mkdirSync(join(base, "alpine"));
    mkdirSync(join(base, "beta"));
    mkdirSync(join(base, ".hidden"));
    writeFileSync(join(base, "a-file.txt"), "not a dir\n");
    daemon = new Daemon({ host: "127.0.0.1", port: 0, workerIdleMs: 60_000 });
    await daemon.start();
  }, 30_000);

  afterAll(async () => {
    if (daemon) await daemon.stop();
  });

  it("completes directory prefixes, excluding files and hidden dirs", async () => {
    const client = new TestClient(daemon.port);
    await client.open();
    const res = await client.command("path.complete", { prefix: join(base, "al") });
    expect(res.error).toBeUndefined();
    const dirs = (res.payload as { dirs: string[] }).dirs;
    expect(dirs).toEqual([join(base, "alpha") + "/", join(base, "alpine") + "/"]);
    client.close();
  });

  it("lists all visible subdirectories when the prefix ends in a separator", async () => {
    const client = new TestClient(daemon.port);
    await client.open();
    const res = await client.command("path.complete", { prefix: base + "/" });
    const dirs = (res.payload as { dirs: string[] }).dirs;
    expect(dirs).toContain(join(base, "alpha") + "/");
    expect(dirs).toContain(join(base, "beta") + "/");
    expect(dirs.some((d) => d.includes(".hidden"))).toBe(false);
    expect(dirs.some((d) => d.includes("a-file.txt"))).toBe(false);
    client.close();
  });

  it("returns empty for nonexistent parents and empty input", async () => {
    const client = new TestClient(daemon.port);
    await client.open();
    const missing = await client.command("path.complete", { prefix: join(base, "nope", "x") });
    expect((missing.payload as { dirs: string[] }).dirs).toEqual([]);
    const empty = await client.command("path.complete", { prefix: "" });
    expect((empty.payload as { dirs: string[] }).dirs).toEqual([]);
    client.close();
  });

  it("expands ~ to the home directory and round-trips ~ in results", async () => {
    const client = new TestClient(daemon.port);
    await client.open();
    const res = await client.command("path.complete", { prefix: "~/" });
    const dirs = (res.payload as { dirs: string[] }).dirs;
    expect(dirs.length).toBeGreaterThan(0);
    expect(dirs.every((d) => d.startsWith("~/"))).toBe(true);
    client.close();
  });
});
