/**
 * Independent Phase 6 security-review regression probes. These use a real
 * Daemon on an ephemeral port and a minimal RPC worker; no production source
 * is mocked.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { Daemon } from "../src/server.js";
import { sessionDirForCwd } from "../src/session-files.js";
import { TerminalManager } from "../src/terminal-manager.js";
import { PathEscapeError, WorkspaceBoundary } from "../src/workspace.js";

type Frame = { type: string; correlationId?: string; payload?: unknown; error?: { message: string; code?: string } };

class Client {
  readonly ws: WebSocket;
  readonly frames: Frame[] = [];
  #waiters: Array<{ matches: (frame: Frame) => boolean; resolve: (frame: Frame) => void }> = [];

  constructor(port: number, extra: { token?: string; origin?: string } = {}) {
    const token = extra.token ? `?token=${encodeURIComponent(extra.token)}` : "";
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws${token}`, {
      headers: extra.origin === undefined ? {} : { origin: extra.origin },
    });
    this.ws.on("message", (raw) => {
      const frame = JSON.parse(String(raw)) as Frame;
      this.frames.push(frame);
      this.#waiters = this.#waiters.filter((waiter) => waiter.matches(frame) ? (waiter.resolve(frame), false) : true);
    });
  }

  async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });
  }

  async command(type: string, payload: unknown = {}, sessionId?: string, protocolVersion = 1): Promise<Frame> {
    const id = `review_${Math.random().toString(36).slice(2)}`;
    const response = this.waitFor((frame) => frame.correlationId === id);
    this.ws.send(JSON.stringify({ protocolVersion, type, id, sessionId, payload }));
    return response;
  }

  waitFor(matches: (frame: Frame) => boolean, timeout = 8_000): Promise<Frame> {
    const previous = this.frames.find(matches);
    if (previous) return Promise.resolve(previous);
    return new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for frame")), timeout);
      this.#waiters.push({
        matches,
        resolve: (frame) => {
          clearTimeout(timer);
          resolve(frame);
        },
      });
    });
  }

  close(): void { this.ws.close(); }
}

class ProbePty {
  options?: { cwd: string; env: Record<string, string> };
  #data?: (data: string) => void;
  #exit?: (event: { exitCode: number }) => void;
  write(): void {}
  resize(): void {}
  kill(): void { this.#exit?.({ exitCode: 0 }); }
  onData(listener: (data: string) => void) {
    this.#data = listener;
    return { dispose: () => { this.#data = undefined; } };
  }
  onExit(listener: (event: { exitCode: number }) => void) {
    this.#exit = listener;
    return { dispose: () => { this.#exit = undefined; } };
  }
  emit(data: string): void { this.#data?.(data); }
}

const root = mkdtempSync(join(tmpdir(), "omp-phase6-review-"));
const workspace = join(root, "workspace");
const outside = join(root, "outside");
const workerLog = join(root, "worker-prompts.jsonl");
const fakeOmp = join(root, "fake-omp.mjs");
let daemon: Daemon;
let client: Client;
let workspaceId = "";

beforeAll(async () => {
  mkdirSync(workspace);
  mkdirSync(outside);
  writeFileSync(fakeOmp, `#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const args = process.argv.slice(2);
const sessionIndex = args.indexOf("--session");
const session = (sessionIndex >= 0 ? args[sessionIndex + 1] : undefined) || process.env.FAKE_SESSION_FILE;
if (session && !existsSync(session)) {
  mkdirSync(dirname(session), { recursive: true });
  writeFileSync(session, JSON.stringify({ type: "session", id: "fake-session", cwd: process.cwd(), timestamp: new Date().toISOString() }) + "\\n");
}
console.log(JSON.stringify({ type: "ready" }));
let input = "";
process.stdin.on("data", (chunk) => {
  input += chunk;
  let newline;
  while ((newline = input.indexOf("\\n")) !== -1) {
    const line = input.slice(0, newline); input = input.slice(newline + 1);
    let frame; try { frame = JSON.parse(line); } catch { continue; }
    if (frame.type === "get_state") {
      console.log(JSON.stringify({ type: "response", id: frame.id, success: true, data: { sessionId: "fake-session", sessionFile: session, isStreaming: false, messageCount: 1 } }));
    } else if (frame.type === "prompt") {
      appendFileSync(process.env.FAKE_WORKER_LOG, JSON.stringify({ message: frame.message }) + "\\n");
      console.log(JSON.stringify({ type: "response", id: frame.id, success: true, data: { ok: true } }));
    } else {
      console.log(JSON.stringify({ type: "response", id: frame.id, success: true, data: { ok: true } }));
    }
  }
});
`);
  chmodSync(fakeOmp, 0o755);
  const sourceFile = join(sessionDirForCwd(workspace), "source.jsonl");
  mkdirSync(sessionDirForCwd(workspace), { recursive: true });
  writeFileSync(sourceFile, [
    JSON.stringify({ type: "session", id: "source-session", cwd: workspace, timestamp: "2026-01-01T00:00:00.000Z" }),
    JSON.stringify({ type: "message", id: "entry-user", message: { role: "user", timestamp: 1, content: [{ type: "text", text: "source" }] } }),
  ].join("\n") + "\n");
  daemon = new Daemon({
    host: "127.0.0.1",
    port: 0,
    authToken: "review-token",
    ompBin: fakeOmp,
    workerEnv: { FAKE_WORKER_LOG: workerLog, FAKE_SESSION_FILE: join(sessionDirForCwd(workspace), "fresh.jsonl") },
  });
  await daemon.start();
  client = new Client(daemon.port, { token: "review-token", origin: `http://127.0.0.1:${daemon.port}` });
  await client.open();
  await client.waitFor((frame) => frame.type === "connection.ready");
  const opened = await client.command("workspace.open", { root: workspace });
  workspaceId = (opened.payload as { workspace: { id: string } }).workspace.id;
  await client.command("session.list", { workspaceId });
}, 20_000);

afterAll(async () => {
  client?.close();
  await daemon?.stop();
  if (workspaceId) rmSync(join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".omp-webui", "uploads", workspaceId), { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

describe("Phase 6 daemon adversarial review", () => {
  it("rejects malformed, oversize, and traversal upload payloads before writing files", async () => {
    const paths = ["../../etc/x", "/etc/x", "dir/../x", "dir\\x", "\u202Etxt.exe", "x".repeat(4_000)];
    for (const name of paths) {
      const result = await client.command("file.upload", { workspaceId, name, data: "c2FmZQ==" });
      expect(result.error).toBeUndefined();
      const upload = result.payload as { path: string; name: string; size: number };
      expect(upload.path).toContain(`.omp-webui/uploads/${workspaceId}/`);
      expect(upload.name).not.toMatch(/[\\/]/);
      expect(statSync(upload.path).mode & 0o777).toBe(0o600);
      expect(readFileSync(upload.path, "utf8")).toBe("safe");
    }
    for (const payload of [
      { workspaceId, name: "x", data: "!!!not-base64!!!" },
      [],
      { workspaceId: "../../wrong", name: "x", data: "c2FmZQ==" },
    ]) {
      const result = await client.command("file.upload", payload);
      expect(result.error).toBeTruthy();
    }
  }, 20_000);

  it("contains attachment paths, symlink escapes, and respects the 12 KiB inline threshold", async () => {
    writeFileSync(join(workspace, "small.txt"), "small attachment");
    writeFileSync(join(workspace, "large.txt"), "x".repeat(12 * 1024 + 1));
    writeFileSync(join(outside, "secret.txt"), "outside secret");
    symlinkSync(join(outside, "secret.txt"), join(workspace, "escape.txt"));
    const create = await client.command("session.create", { workspaceId });
    const sessionId = String((create.payload as { sessionId: string }).sessionId);
    const attack = await client.command("prompt.submit", { message: "x", workspaceId, attachments: [{ path: "escape.txt" }] }, sessionId);
    expect(attack.error).toBeTruthy();
    await client.command("prompt.submit", {
      message: "attachments",
      workspaceId,
      attachments: [{ path: "small.txt" }, { path: "large.txt" }, { name: "../../hostile.txt", data: "c2FmZQ==" }],
    }, sessionId);
    await Bun.sleep(100);
    const prompt = JSON.parse(readFileSync(workerLog, "utf8").trim().split("\n").at(-1)!) as { message: string };
    expect(prompt.message).toContain('<file path="small.txt">');
    expect(prompt.message).toContain("small attachment");
    expect(prompt.message).toContain("File attachment: large.txt");
    expect(prompt.message).not.toContain("x".repeat(1_000));
    expect(prompt.message).toContain("hostile.txt");
    expect(prompt.message).not.toContain("../../hostile.txt");
  }, 20_000);

  it("honours asReference=true by sending path-only regardless of size (reference-mode attachments)", async () => {
    writeFileSync(join(workspace, "tiny.txt"), "one tiny line here");
    const create = await client.command("session.create", { workspaceId });
    const sessionId = String((create.payload as { sessionId: string }).sessionId);
    await client.command("prompt.submit", {
      message: "ref",
      workspaceId,
      attachments: [{ path: "tiny.txt", asReference: true }],
    }, sessionId);
    await Bun.sleep(100);
    const prompt = JSON.parse(readFileSync(workerLog, "utf8").trim().split("\n").at(-1)!) as { message: string };
    expect(prompt.message).toContain("File attachment: tiny.txt");
    // The tiny.txt contents must NOT be inlined — that's the whole point of reference mode.
    expect(prompt.message).not.toContain("one tiny line here");
    expect(prompt.message).not.toContain('<file path="tiny.txt">');
    // Ranges combine with reference-mode without inlining.
    await client.command("prompt.submit", {
      message: "ref-range",
      workspaceId,
      attachments: [{ path: "tiny.txt", asReference: true, start: 1, end: 1 }],
    }, sessionId);
    await Bun.sleep(100);
    const rangePrompt = JSON.parse(readFileSync(workerLog, "utf8").trim().split("\n").at(-1)!) as { message: string };
    expect(rangePrompt.message).toContain("File attachment: tiny.txt (lines 1-1)");
    expect(rangePrompt.message).not.toContain("one tiny line here");
  }, 20_000);

  it("keeps file.read range output bounded for hostile numeric inputs", async () => {
    writeFileSync(join(workspace, "lines.txt"), Array.from({ length: 20_000 }, (_, index) => `line-${index + 1}`).join("\n"));
    for (const [start, end] of [[10, 1], [-5, 10], [1, 1_000_000_000], [1.5, 3.5], ["2", "4"]] as Array<[unknown, unknown]>) {
      const result = await client.command("file.read", { workspaceId, path: "lines.txt", start, end });
      expect(result.error).toBeUndefined();
      expect(Buffer.byteLength((result.payload as { content: string }).content, "utf8")).toBeLessThanOrEqual(512 * 1024);
    }
  });

  it("rejects forged re-ask entries and foreign session files", async () => {
    for (const payload of [
      { sessionFile: join(sessionDirForCwd(workspace), "source.jsonl"), entryId: "does-not-exist", message: "replacement" },
      { sessionFile: join(outside, "foreign.jsonl"), entryId: "entry-user", message: "replacement" },
      { sessionFile: join(sessionDirForCwd(workspace), "source.jsonl"), entryId: "entry-user", message: "" },
    ]) {
      const result = await client.command("session.reask", payload);
      expect(result.error).toBeTruthy();
    }
  });

  it("enforces protocol version and token/origin checks before every Phase 6 command", async () => {
    const badVersion = await client.command("file.upload", { workspaceId, name: "x", data: "eA==" }, undefined, 999);
    expect(badVersion.type).toBe("connection.error");
    expect(badVersion.error?.code).toBe("protocol_version");

    const foreign = new WebSocket(`ws://127.0.0.1:${daemon.port}/ws?token=review-token`, { headers: { origin: "https://evil.example" } });
    expect(await new Promise<number>((resolve) => foreign.once("close", resolve))).toBe(4403);
    const noToken = new WebSocket(`ws://127.0.0.1:${daemon.port}/ws`, { headers: { origin: `http://127.0.0.1:${daemon.port}` } });
    expect(await new Promise<number>((resolve) => noToken.once("close", resolve))).toBe(4401);
  });

  it("rejects terminal symlink and absolute cwd escapes, strips credentials, and rate-limits many small chunks", async () => {
    const terminalRoot = join(root, "terminal-root");
    const terminalOutside = join(root, "terminal-outside");
    mkdirSync(terminalRoot);
    mkdirSync(terminalOutside);
    symlinkSync(terminalOutside, join(terminalRoot, "escape"));
    const boundary = new WorkspaceBoundary(terminalRoot);
    const pty = new ProbePty();
    const manager = new TerminalManager({ enabled: true, loadPty: async () => ({
      spawn: (_shell, _args, options) => {
        pty.options = { cwd: options.cwd, env: options.env };
        return pty;
      },
    }) });
    const emit = () => undefined;
    await expect(manager.dispatch("client", "terminal.create", {
      workspaceId: "workspace", cwd: "escape", cols: 80, rows: 24,
    }, () => boundary, emit)).rejects.toBeInstanceOf(PathEscapeError);
    await expect(manager.dispatch("client", "terminal.create", {
      workspaceId: "workspace", cwd: terminalOutside, cols: 80, rows: 24,
    }, () => boundary, emit)).rejects.toBeInstanceOf(PathEscapeError);
    const created = await manager.dispatch("client", "terminal.create", {
      workspaceId: "workspace", cols: 80, rows: 24,
    }, () => boundary, emit) as { terminalId: string };
    await expect(manager.dispatch("client", "terminal.input", {
      workspaceId: "workspace", terminalId: `${created.terminalId}\n{"type":"spawn"}`, data: "x",
    }, () => boundary, emit)).rejects.toMatchObject({ code: "terminal_not_found" });
    expect(Object.keys(pty.options!.env).sort()).toEqual(expect.arrayContaining(["PATH", "HOME", "LANG", "TERM", "SHELL"]));
    expect(Object.keys(pty.options!.env)).not.toEqual(expect.arrayContaining(["AWS_SECRET_ACCESS_KEY", "GITHUB_TOKEN", "OPENAI_API_KEY"]));

    const output: string[] = [];
    const ratePty = new ProbePty();
    const rateManager = new TerminalManager({ enabled: true, loadPty: async () => ({
      spawn: () => ratePty,
    }) });
    await rateManager.dispatch("client", "terminal.create", { workspaceId: "workspace", cols: 80, rows: 24 }, () => boundary, (event) => output.push(event.payload.data ?? ""));
    for (let index = 0; index < 1025; index++) ratePty.emit("x".repeat(1024));
    expect(output.filter((data) => data.includes("rate limit exceeded"))).toHaveLength(1);
    expect(output.filter((data) => data === "x".repeat(1024))).toHaveLength(1024);
    manager.disconnect("client");
    rateManager.disconnect("client");
    expect(manager.activeCount).toBe(0);
    expect(rateManager.activeCount).toBe(0);
    expect(created.terminalId).toMatch(/^term_/);
  });
});
