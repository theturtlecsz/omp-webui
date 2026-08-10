import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { Daemon } from "../src/server.js";
import { TerminalManager } from "../src/terminal-manager.js";
import { WorkspaceBoundary } from "../src/workspace.js";

class FakePty {
  killed = false;
  #data?: (data: string) => void;
  #exit?: (event: { exitCode: number }) => void;
  write(): void {}
  resize(): void {}
  kill(): void {
    this.killed = true;
    this.#exit?.({ exitCode: 0 });
  }
  onData(listener: (data: string) => void) {
    this.#data = listener;
    return { dispose: () => { this.#data = undefined; } };
  }
  onExit(listener: (event: { exitCode: number }) => void) {
    this.#exit = listener;
    return { dispose: () => { this.#exit = undefined; } };
  }
}

async function command(port: number, type: string, payload: unknown): Promise<{ error?: { code?: string; message: string } }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
  const response = await new Promise<{ error?: { code?: string; message: string } }>((resolve) => {
    ws.on("message", (raw) => {
      const frame = JSON.parse(String(raw)) as { correlationId?: string; error?: { code?: string; message: string } };
      if (frame.correlationId === "terminal-test") resolve(frame);
    });
    ws.send(JSON.stringify({ protocolVersion: 1, type, id: "terminal-test", payload }));
  });
  ws.close();
  return response;
}

describe("opt-in terminal guards", () => {
  let daemon: Daemon | undefined;
  afterEach(async () => { await daemon?.stop(); });

  it("rejects terminal commands when terminal support is disabled by default", async () => {
    daemon = new Daemon({ port: 0 });
    await daemon.start();
    const result = await command(daemon.port, "terminal.create", { workspaceId: "not-needed", cols: 80, rows: 24 });
    expect(result.error?.code).toBe("terminal_disabled");
  });

  it("rejects a terminal cwd that escapes the active workspace before loading node-pty", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "omp-webui-terminal-"));
    daemon = new Daemon({ port: 0, terminal: true });
    await daemon.start();
    const opened = await command(daemon.port, "workspace.open", { root: workspace });
    // Workspace IDs are opaque, so use a short direct connection for the boundary test.
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.port}/ws`);
    await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
    const workspaceId = await new Promise<string>((resolve) => {
      ws.on("message", (raw) => {
        const frame = JSON.parse(String(raw)) as { correlationId?: string; payload?: { workspace?: { id?: string } } };
        if (frame.correlationId === "open") resolve(frame.payload?.workspace?.id ?? "");
      });
      ws.send(JSON.stringify({ protocolVersion: 1, type: "workspace.open", id: "open", payload: { root: workspace } }));
    });
    expect(opened.error).toBeUndefined();
    const result = await new Promise<{ error?: { code?: string } }>((resolve) => {
      ws.on("message", (raw) => {
        const frame = JSON.parse(String(raw)) as { correlationId?: string; error?: { code?: string } };
        if (frame.correlationId === "escape") resolve(frame);
      });
      ws.send(JSON.stringify({ protocolVersion: 1, type: "terminal.create", id: "escape", payload: { workspaceId, cwd: "../../etc", cols: 80, rows: 24 } }));
    });
    expect(result.error?.code).toBe("path_escape");
    ws.close();
  });

  it("kills explicitly and reaps owned terminals on disconnect without node-pty", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "omp-webui-terminal-"));
    const boundary = new WorkspaceBoundary(workspace);
    const pty = new FakePty();
    const manager = new TerminalManager({
      enabled: true,
      loadPty: async () => ({ spawn: () => pty }),
    });
    const created = await manager.dispatch("client-a", "terminal.create", { workspaceId: "workspace-a", cols: 80, rows: 24 }, () => boundary, () => undefined) as { terminalId: string };
    expect(created.terminalId).toStartWith("term_");
    expect(manager.activeCount).toBe(1);
    await manager.dispatch("client-a", "terminal.kill", { workspaceId: "workspace-a", terminalId: created.terminalId }, () => boundary, () => undefined);
    expect(pty.killed).toBe(true);
    expect(manager.activeCount).toBe(0);

    const disconnectPty = new FakePty();
    const disconnectManager = new TerminalManager({
      enabled: true,
      loadPty: async () => ({ spawn: () => disconnectPty }),
    });
    await disconnectManager.dispatch("client-a", "terminal.create", { workspaceId: "workspace-a", cols: 80, rows: 24 }, () => boundary, () => undefined);
    expect(disconnectManager.activeCount).toBe(1);
    disconnectManager.disconnect("client-a");
    expect(disconnectPty.killed).toBe(true);
    expect(disconnectManager.activeCount).toBe(0);
  });
});
