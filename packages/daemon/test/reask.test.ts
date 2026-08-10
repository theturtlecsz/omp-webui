import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { buildSnapshot, Daemon } from "../src/server.js";

type Received = {
  type: string;
  correlationId?: string;
  sessionId?: string;
  payload?: unknown;
  error?: { message: string };
};

class Client {
  ws: WebSocket;
  received: Received[] = [];
  #waiters: Array<{ matches: (event: Received) => boolean; resolve: (event: Received) => void }> = [];

  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { origin: `http://127.0.0.1:${port}` } });
    this.ws.on("message", (data) => {
      const event = JSON.parse(String(data)) as Received;
      this.received.push(event);
      this.#waiters = this.#waiters.filter((waiter) => waiter.matches(event) ? (waiter.resolve(event), false) : true);
    });
  }

  async open(): Promise<void> {
    await new Promise<void>((resolvePromise, reject) => {
      this.ws.once("open", resolvePromise);
      this.ws.once("error", reject);
    });
  }

  command(type: string, payload: unknown = {}, sessionId?: string): Promise<Received> {
    const id = `reask_${Math.random().toString(36).slice(2)}`;
    const response = this.waitFor((event) => event.correlationId === id);
    this.ws.send(JSON.stringify({ protocolVersion: 1, type, id, sessionId, payload }));
    return response;
  }

  waitFor(matches: (event: Received) => boolean, timeout = 45_000): Promise<Received> {
    const existing = this.received.find(matches);
    if (existing) return Promise.resolve(existing);
    return new Promise<Received>((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for daemon event")), timeout);
      this.#waiters.push({
        matches,
        resolve: (event) => {
          clearTimeout(timer);
          resolvePromise(event);
        },
      });
    });
  }
}

describe("session.reask", () => {
  let daemon: Daemon;
  let client: Client;
  let workspaceId = "";
  let sourceSessionId = "";
  let sourceSessionFile = "";
  let canRun = false;

  beforeAll(async () => {
    canRun = await fetch("http://127.0.0.1:8788/v1/models").then((response) => response.ok).catch(() => false);
    if (!canRun) return;
    daemon = new Daemon({ host: "127.0.0.1", port: 0, approvalMode: "yolo" });
    await daemon.start();
    client = new Client(daemon.port);
    await client.open();
    await client.waitFor((event) => event.type === "connection.ready");
    const workspace = await client.command("workspace.open", { root: mkdtempSync(join(tmpdir(), "omp-webui-reask-")) });
    workspaceId = (workspace.payload as { workspace: { id: string } }).workspace.id;
    const created = await client.command("session.create", { workspaceId });
    sourceSessionId = String(created.sessionId);
    sourceSessionFile = String((created.payload as { sessionFile: string }).sessionFile);
    await client.waitFor((event) => event.type === "worker.ready");
  }, 45_000);

  afterAll(async () => {
    client?.ws.close();
    await daemon?.stop();
  });

  it("forks at the edited user entry, preserves the source, and submits the replacement prompt", async () => {
    if (!canRun) return;
    await client.command("prompt.submit", { message: "say hello" }, sourceSessionId);
    await client.waitFor((event) => event.type === "message.completed" && event.sessionId === sourceSessionId);
    const sourceList = await client.command("session.list", { workspaceId });
    const source = (sourceList.payload as { sessions: Array<{ sessionId: string; sessionFile: string }> }).sessions
      .find((session) => session.sessionId === sourceSessionId);
    if (!source) throw new Error("source session was not indexed");
    sourceSessionFile = source.sessionFile;
    for (let attempt = 0; attempt < 50 && !existsSync(sourceSessionFile); attempt++) await Bun.sleep(20);
    const sourceBefore = readFileSync(sourceSessionFile, "utf8");
    const sourceSnapshot = buildSnapshot(sourceSessionFile);
    const userEntry = (sourceSnapshot.items as Array<{ kind?: string; entryId?: string }>).find((item) => item.kind === "user");
    expect(userEntry?.entryId).toBeTruthy();

    const reasked = await client.command("session.reask", {
      sessionFile: sourceSessionFile,
      entryId: userEntry!.entryId,
      message: "say hello again",
    }, sourceSessionId);
    expect(reasked.error).toBeUndefined();
    const fork = reasked.payload as { accepted: boolean; sessionId: string; sessionFile: string; title: string };
    expect(fork.accepted).toBe(true);
    expect(fork.sessionFile).not.toBe(sourceSessionFile);
    expect(fork.title).toBe("Fork of (untitled session)");
    await client.waitFor((event) => event.type === "message.completed" && event.sessionId === fork.sessionId);

    expect(readFileSync(sourceSessionFile, "utf8")).toBe(sourceBefore);
    const forkSnapshot = buildSnapshot(fork.sessionFile);
    expect(forkSnapshot.title).toBe("Fork of (untitled session)");
    const forkText = (forkSnapshot.items as Array<{ kind?: string; text?: string }>).filter((item) => item.kind === "user").map((item) => item.text);
    expect(forkText).toEqual(["say hello", "say hello again"]);
    const sessions = await client.command("session.list", { workspaceId });
    const listed = (sessions.payload as { sessions: Array<{ sessionFile: string; title: string }> }).sessions;
    expect(listed).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionFile: sourceSessionFile }),
      expect.objectContaining({ sessionFile: fork.sessionFile, title: "Fork of (untitled session)" }),
    ]));
  }, 90_000);
});
