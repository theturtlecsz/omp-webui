/**
 * Opt-in user shell management. This deliberately does not share any of the
 * omp worker process machinery: terminal traffic is raw PTY data for the
 * authenticated browser client that created it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { WorkspaceBoundary } from "./workspace.js";

const MAX_TERMINALS_PER_WORKSPACE = 8;
const MAX_INPUT_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES_PER_SECOND = 1024 * 1024;
const MAX_COMMANDS = 100;
const MAX_COMMAND_BYTES = 8 * 1024;

interface PtyProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number }) => void): { dispose(): void };
}

interface PtyModule {
  spawn(file: string, args: string[], options: {
    name?: string;
    cols: number;
    rows: number;
    cwd: string;
    env: Record<string, string>;
  }): PtyProcess;
}

export interface ProjectCommand {
  id: string;
  name: string;
  command: string;
  cwd?: string;
}

interface ManagedTerminal {
  id: string;
  clientId: string;
  workspaceId: string;
  pty: PtyProcess;
  dataSubscription: { dispose(): void };
  exitSubscription: { dispose(): void };
  outputWindowStartedAt: number;
  outputBytes: number;
  outputDropNoticed: boolean;
}

export class TerminalError extends Error {
  constructor(message: string, readonly code: "terminal_disabled" | "terminal_unavailable" | "terminal_limit" | "terminal_not_found" | "terminal_input_too_large" | "terminal_invalid_command") {
    super(message);
  }
}

export interface TerminalManagerOptions {
  enabled?: boolean;
  loadPty?: () => Promise<PtyModule>;
}

export class TerminalManager {
  readonly enabled: boolean;
  #loadPty: () => Promise<PtyModule>;
  #terminals = new Map<string, ManagedTerminal>();
  #ptyModule?: Promise<PtyModule>;

  constructor(options: TerminalManagerOptions = {}) {
    this.enabled = options.enabled === true;
    this.#loadPty = options.loadPty ?? loadPtyViaHost;
  }

  #pty(): Promise<PtyModule> {
    // One PTY host process serves every terminal in the workspace set.
    this.#ptyModule ??= this.#loadPty();
    return this.#ptyModule;
  }

  async dispatch(
    clientId: string,
    type: string,
    payload: Record<string, unknown>,
    boundaryFor: (workspaceId: string) => WorkspaceBoundary,
    emit: (event: { type: "terminal.output" | "terminal.exit"; payload: { terminalId: string; data?: string; code?: number } }) => void,
  ): Promise<unknown> {
    if (!type.startsWith("terminal.")) return undefined;
    if (!this.enabled) throw new TerminalError("terminal support is disabled; restart the daemon with --terminal", "terminal_disabled");

    const workspaceId = stringValue(payload.workspaceId, "terminal commands require payload.workspaceId");
    const boundary = boundaryFor(workspaceId);
    if (type === "terminal.commands") return this.#commands(payload, boundary);
    if (type === "terminal.create") return this.#create(clientId, workspaceId, payload, boundary, emit);

    const terminal = this.#owned(clientId, stringValue(payload.terminalId, `${type} requires payload.terminalId`));
    if (type === "terminal.input") {
      const data = stringValue(payload.data, "terminal.input requires payload.data");
      if (Buffer.byteLength(data, "utf8") > MAX_INPUT_BYTES) {
        throw new TerminalError(`terminal input exceeds ${MAX_INPUT_BYTES} bytes`, "terminal_input_too_large");
      }
      terminal.pty.write(data);
      return { ok: true };
    }
    if (type === "terminal.resize") {
      terminal.pty.resize(boundedDimension(payload.cols, "cols"), boundedDimension(payload.rows, "rows"));
      return { ok: true };
    }
    if (type === "terminal.kill") {
      this.#kill(terminal, "SIGTERM");
      return { ok: true };
    }
    throw new TerminalError(`unknown terminal command: ${type}`, "terminal_invalid_command");
  }

  disconnect(clientId: string): void {
    for (const terminal of [...this.#terminals.values()]) {
      if (terminal.clientId === clientId) this.#kill(terminal, "SIGTERM");
    }
  }

  stop(): void {
    for (const terminal of [...this.#terminals.values()]) this.#kill(terminal, "SIGTERM");
    const modulePromise = this.#ptyModule;
    this.#ptyModule = undefined;
    void modulePromise?.then((mod) => (mod as { dispose?: () => void }).dispose?.()).catch(() => undefined);
  }

  /** Test hook; never exposes PTY data to callers. */
  get activeCount(): number {
    return this.#terminals.size;
  }

  async #create(
    clientId: string,
    workspaceId: string,
    payload: Record<string, unknown>,
    boundary: WorkspaceBoundary,
    emit: (event: { type: "terminal.output" | "terminal.exit"; payload: { terminalId: string; data?: string; code?: number } }) => void,
  ): Promise<{ terminalId: string }> {
    const activeForWorkspace = [...this.#terminals.values()].filter((item) => item.workspaceId === workspaceId).length;
    if (activeForWorkspace >= MAX_TERMINALS_PER_WORKSPACE) {
      throw new TerminalError(`at most ${MAX_TERMINALS_PER_WORKSPACE} terminals may run in one workspace`, "terminal_limit");
    }
    const cwd = boundary.resolveContained(typeof payload.cwd === "string" && payload.cwd ? payload.cwd : boundary.root);
    const cols = boundedDimension(payload.cols, "cols");
    const rows = boundedDimension(payload.rows, "rows");

    let ptyModule: PtyModule;
    try {
      ptyModule = await this.#pty();
    } catch {
      // Allow a later create to retry with a fresh host process.
      this.#ptyModule = undefined;
      throw new TerminalError("terminal support is unavailable because the node-pty host could not be started", "terminal_unavailable");
    }

    const id = `term_${randomUUID()}`;
    const shell = process.env.SHELL || "/bin/bash";
    const pty = ptyModule.spawn(shell, [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: safeTerminalEnv(shell),
    });
    const terminal: ManagedTerminal = {
      id,
      clientId,
      workspaceId,
      pty,
      dataSubscription: { dispose() {} },
      exitSubscription: { dispose() {} },
      outputWindowStartedAt: Date.now(),
      outputBytes: 0,
      outputDropNoticed: false,
    };
    terminal.dataSubscription = pty.onData((data) => this.#emitOutput(terminal, data, emit));
    terminal.exitSubscription = pty.onExit(({ exitCode }) => {
      this.#remove(terminal);
      emit({ type: "terminal.exit", payload: { terminalId: id, code: exitCode } });
    });
    this.#terminals.set(id, terminal);
    return { terminalId: id };
  }

  #emitOutput(terminal: ManagedTerminal, data: string, emit: (event: { type: "terminal.output"; payload: { terminalId: string; data: string } }) => void): void {
    const now = Date.now();
    if (now - terminal.outputWindowStartedAt >= 1_000) {
      terminal.outputWindowStartedAt = now;
      terminal.outputBytes = 0;
      terminal.outputDropNoticed = false;
    }
    const bytes = Buffer.byteLength(data, "utf8");
    if (terminal.outputBytes + bytes > MAX_OUTPUT_BYTES_PER_SECOND) {
      if (!terminal.outputDropNoticed) {
        terminal.outputDropNoticed = true;
        emit({ type: "terminal.output", payload: { terminalId: terminal.id, data: "\r\n[terminal output dropped: rate limit exceeded]\r\n" } });
      }
      return;
    }
    terminal.outputBytes += bytes;
    emit({ type: "terminal.output", payload: { terminalId: terminal.id, data } });
  }

  #owned(clientId: string, terminalId: string): ManagedTerminal {
    const terminal = this.#terminals.get(terminalId);
    if (!terminal || terminal.clientId !== clientId) throw new TerminalError("terminal not found", "terminal_not_found");
    return terminal;
  }

  #kill(terminal: ManagedTerminal, signal: string): void {
    try { terminal.pty.kill(signal); } catch { /* already reaped */ }
  }

  #remove(terminal: ManagedTerminal): void {
    if (!this.#terminals.delete(terminal.id)) return;
    terminal.dataSubscription.dispose();
    terminal.exitSubscription.dispose();
  }

  #commands(payload: Record<string, unknown>, boundary: WorkspaceBoundary): { commands: ProjectCommand[] } {
    const configPath = boundary.resolveContained(".omp/commands.json");
    if (Array.isArray(payload.commands)) {
      const commands = validateCommands(payload.commands);
      mkdirSync(dirname(configPath), { recursive: true });
      // Re-resolve after mkdir so a concurrent/symlinked .omp cannot escape.
      writeFileSync(boundary.resolveContained(".omp/commands.json"), `${JSON.stringify({ commands }, null, 2)}\n`, "utf8");
      return { commands };
    }
    if (!existsSync(configPath)) return { commands: [] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
      throw new TerminalError(".omp/commands.json is not valid JSON", "terminal_invalid_command");
    }
    const commands = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === "object" ? (parsed as { commands?: unknown }).commands : undefined);
    return { commands: validateCommands(commands) };
  }
}

/**
 * The daemon runs under Bun, whose native ABI (NODE_MODULE_VERSION 137)
 * differs from Node's (115), so node-pty cannot load in-process. Instead we
 * spawn pty-host.mjs under a real Node runtime and proxy PTY traffic over
 * newline-delimited JSON on stdio. The host is lazy: a normal daemon boot has
 * no native dependency and no child process.
 */
async function loadPtyViaHost(): Promise<PtyModule> {
  const hostPath = join(dirname(fileURLToPath(import.meta.url)), "pty-host.mjs");
  const nodeBin = process.env.OMP_PTY_HOST_NODE || "node";
  const proc = Bun.spawn([nodeBin, hostPath], {
    cwd: dirname(hostPath),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: process.env.HOME ?? "/tmp" },
  });

  const listeners = new Map<string, { data: Set<(data: string) => void>; exit: Set<(event: { exitCode: number }) => void> }>();
  const pendingSpawns = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  let buffer = "";
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  const pump = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          if (!line.trim()) continue;
          let message: Record<string, unknown>;
          try { message = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
          const id = typeof message.id === "string" ? message.id : "";
          switch (message.type) {
            case "ready": readyResolve(); break;
            case "load_error": readyReject(new Error(String(message.message ?? "node-pty failed to load"))); break;
            case "spawned": pendingSpawns.get(id)?.resolve(); pendingSpawns.delete(id); break;
            case "spawn_error": {
              pendingSpawns.get(id)?.reject(new Error(String(message.message ?? "spawn failed")));
              pendingSpawns.delete(id);
              const entry = listeners.get(id);
              if (entry) { for (const fn of entry.exit) fn({ exitCode: 1 }); listeners.delete(id); }
              break;
            }
            case "output": for (const fn of listeners.get(id)?.data ?? []) fn(String(message.data ?? "")); break;
            case "exit": {
              const code = typeof message.code === "number" ? message.code : 0;
              const entry = listeners.get(id);
              if (entry) { for (const fn of entry.exit) fn({ exitCode: code }); listeners.delete(id); }
              break;
            }
            default: break;
          }
        }
      }
    } finally {
      readyReject(new Error("pty host exited"));
      for (const pending of pendingSpawns.values()) pending.reject(new Error("pty host exited"));
      pendingSpawns.clear();
      for (const entry of listeners.values()) for (const fn of entry.exit) fn({ exitCode: 1 });
      listeners.clear();
    }
  })();
  void pump;

  const send = (message: Record<string, unknown>): void => {
    proc.stdin.write(`${JSON.stringify(message)}\n`);
    proc.stdin.flush();
  };

  await ready;

  const module: PtyModule & { dispose(): void } = {
    spawn(file, _args, options) {
      const id = randomUUID();
      listeners.set(id, { data: new Set(), exit: new Set() });
      const spawned = new Promise<void>((resolve, reject) => pendingSpawns.set(id, { resolve, reject }));
      send({ type: "spawn", id, cwd: options.cwd, shell: file, env: options.env, cols: options.cols, rows: options.rows });
      // The manager only wires listeners after spawn returns; the host echoes
      // no output before "spawned", and callers that need strict ordering can
      // await this promise. node-pty itself buffers nothing pre-spawn either.
      void spawned.catch(() => undefined);
      return {
        write(data) { send({ type: "input", id, data }); },
        resize(cols, rows) { send({ type: "resize", id, cols, rows }); },
        kill() { send({ type: "kill", id }); },
        onData(listener) {
          const entry = listeners.get(id);
          entry?.data.add(listener);
          return { dispose() { entry?.data.delete(listener); } };
        },
        onExit(listener) {
          const entry = listeners.get(id);
          entry?.exit.add(listener);
          return { dispose() { entry?.exit.delete(listener); } };
        },
      };
    },
    dispose() {
      try { proc.stdin.end(); } catch { /* already closed */ }
      try { proc.kill(); } catch { /* already reaped */ }
    },
  };
  return module;
}

function safeTerminalEnv(shell: string): Record<string, string> {
  const allowlist = ["PATH", "HOME", "LANG", "TERM", "SHELL", "USER", "COLORTERM"] as const;
  const env: Record<string, string> = {};
  for (const key of allowlist) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  env.PATH ||= "/usr/local/bin:/usr/bin:/bin";
  env.HOME ||= process.cwd();
  env.LANG ||= "C.UTF-8";
  env.TERM = "xterm-256color";
  env.SHELL = shell;
  return env;
}

function boundedDimension(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 2 || parsed > 1_000) throw new TerminalError(`terminal ${label} must be an integer from 2 to 1000`, "terminal_invalid_command");
  return parsed;
}

function stringValue(value: unknown, error: string): string {
  if (typeof value !== "string" || !value) throw new TerminalError(error, "terminal_invalid_command");
  return value;
}

function validateCommands(value: unknown): ProjectCommand[] {
  if (!Array.isArray(value) || value.length > MAX_COMMANDS) throw new TerminalError(`commands must be an array of at most ${MAX_COMMANDS} items`, "terminal_invalid_command");
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new TerminalError(`command ${index + 1} must be an object`, "terminal_invalid_command");
    const command = entry as Record<string, unknown>;
    const id = stringValue(command.id, `command ${index + 1} requires id`);
    const name = stringValue(command.name, `command ${index + 1} requires name`);
    const text = stringValue(command.command, `command ${index + 1} requires command`);
    if (id.length > 80 || name.length > 120 || Buffer.byteLength(text, "utf8") > MAX_COMMAND_BYTES || seen.has(id)) {
      throw new TerminalError(`command ${index + 1} is invalid or duplicates another id`, "terminal_invalid_command");
    }
    if (command.cwd !== undefined && typeof command.cwd !== "string") throw new TerminalError(`command ${index + 1} cwd must be a string`, "terminal_invalid_command");
    seen.add(id);
    return { id, name, command: text, ...(typeof command.cwd === "string" && command.cwd ? { cwd: command.cwd } : {}) };
  });
}
