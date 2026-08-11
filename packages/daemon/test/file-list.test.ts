/**
 * file.list + file.changed coverage. No omp worker needed — these commands are
 * workspace-scoped, so the harness is a bare Daemon + temp workspace.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { Daemon } from "../src/server.js";

interface Received {
  type: string;
  payload?: unknown;
  correlationId?: string;
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

  command(type: string, payload: unknown = {}): Promise<Received> {
    const id = `test_${Math.random().toString(36).slice(2)}`;
    const promise = this.waitFor((r) => r.correlationId === id, 15_000);
    this.ws.send(JSON.stringify({ protocolVersion: 1, type, id, payload }));
    return promise;
  }

  waitFor(pred: (r: Received) => boolean, timeoutMs = 15_000): Promise<Received> {
    const existing = this.received.find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("waitFor timeout")), timeoutMs);
      this.#waiters.push({ pred, resolve: (r) => { clearTimeout(timer); resolve(r); } });
    });
  }

  close(): void { this.ws.close(); }
}

interface Entry { name: string; path: string; kind: string; size: number }
interface Listing { path: string; entries: Entry[]; truncated: boolean }

describe("file.list / file.changed", () => {
  let daemon: Daemon;
  let workspaceDir: string;

  beforeAll(async () => {
    workspaceDir = mkdtempSync(join(tmpdir(), "omp-webui-files-"));
    mkdirSync(join(workspaceDir, "src"));
    mkdirSync(join(workspaceDir, "docs"));
    writeFileSync(join(workspaceDir, "README.md"), "hello\n");
    writeFileSync(join(workspaceDir, "src", "app.ts"), "export {}\n");
    daemon = new Daemon({ host: "127.0.0.1", port: 0, workerIdleMs: 60_000 });
    await daemon.start();
  }, 30_000);

  afterAll(async () => {
    if (daemon) await daemon.stop();
  });

  it("lists a directory with dirs-first ordering and file sizes", async () => {
    const client = new TestClient(daemon.port);
    await client.open();
    await client.waitFor((r) => r.type === "connection.ready");
    const wsRes = await client.command("workspace.open", { root: workspaceDir });
    const ws = (wsRes.payload as { workspace: { id: string } }).workspace;

    const res = await client.command("file.list", { workspaceId: ws.id });
    expect(res.error).toBeUndefined();
    const listing = res.payload as Listing;
    expect(listing.path).toBe("");
    const kinds = listing.entries.map((e) => e.kind);
    expect(kinds.slice(0, 2)).toEqual(["dir", "dir"]); // docs, src
    const readme = listing.entries.find((e) => e.name === "README.md");
    expect(readme?.kind).toBe("file");
    expect(readme?.size).toBeGreaterThan(0);

    const sub = await client.command("file.list", { workspaceId: ws.id, path: "src" });
    const subListing = sub.payload as Listing;
    expect(subListing.path).toBe("src");
    expect(subListing.entries.map((e) => e.name)).toEqual(["app.ts"]);
    expect(subListing.entries[0].path).toBe("src/app.ts");
    client.close();
  });

  it("rejects path escape outside the workspace boundary", async () => {
    const client = new TestClient(daemon.port);
    await client.open();
    await client.waitFor((r) => r.type === "connection.ready");
    const wsRes = await client.command("workspace.open", { root: workspaceDir });
    const ws = (wsRes.payload as { workspace: { id: string } }).workspace;
    const res = await client.command("file.list", { workspaceId: ws.id, path: "../.." });
    expect(res.error).toBeDefined();
    client.close();
  });

  it("pushes file.changed when the listed directory is written to", async () => {
    const client = new TestClient(daemon.port);
    await client.open();
    await client.waitFor((r) => r.type === "connection.ready");
    const wsRes = await client.command("workspace.open", { root: workspaceDir });
    const ws = (wsRes.payload as { workspace: { id: string } }).workspace;
    await client.command("file.list", { workspaceId: ws.id });

    const change = client.waitFor((r) => r.type === "file.changed", 10_000);
    writeFileSync(join(workspaceDir, "new-file.txt"), "fresh\n");
    const evt = await change;
    expect((evt.payload as { path: string }).path).toBe("");
    client.close();
  });
});
