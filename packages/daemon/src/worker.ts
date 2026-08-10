/**
 * worker.ts — supervises one `omp --mode rpc` subprocess per active session.
 * Speaks newline-delimited JSON, negotiates protocol v2, reassembles rpc_chunk
 * frames, correlates command responses by id, and emits typed callbacks.
 * Logs go to stderr only; stdout is pure protocol.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

export interface WorkerOptions {
  cwd: string;
  sessionFile?: string; // resume this session file when set
  env?: NodeJS.ProcessEnv;
  ompBin?: string;
  extraArgs?: string[];
}

export type WorkerState = "starting" | "ready" | "stopped" | "crashed";

export interface WorkerEvents {
  onFrame(frame: Record<string, unknown>): void;
  onStateChange(state: WorkerState, detail?: string): void;
  onExit(code: number | null, signal: string | null): void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(err: Error): void;
  timer: NodeJS.Timeout;
}

const CHUNK_REASSEMBLY_LIMIT = 64 * 1024 * 1024; // advertised maxReassembledFrameBytes
const MAX_RAW_LINE_BYTES = 8 * 1024 * 1024; // any single stdout line beyond this is dropped
const MAX_CHUNK_COUNT = 8192; // per-message chunk bound
const MAX_CONCURRENT_CHUNK_IDS = 16; // in-flight assemblies
const CHUNK_ASSEMBLY_TTL_MS = 60_000; // incomplete assemblies expire

export class OmpWorker {
  readonly id = randomUUID();
  state: WorkerState = "starting";
  sessionId?: string;
  sessionFile?: string;

  #proc: ChildProcess | null = null;
  #pending = new Map<string, Pending>();
  #chunks = new Map<string, { count: number; byteLength: number; parts: Buffer[]; received: number; bytes: number; createdAt: number }>();
  #opts: WorkerOptions;
  #events: WorkerEvents;
  #protocolVersion = 1;
  #stderrBuf: string[] = [];
  #stoppedByUs = false;

  constructor(opts: WorkerOptions, events: WorkerEvents) {
    this.#opts = opts;
    this.#events = events;
  }

  start(): void {
    const args = ["--mode", "rpc", ...(this.#opts.sessionFile ? ["--session", this.#opts.sessionFile] : []), ...(this.#opts.extraArgs ?? [])];
    const bin = this.#opts.ompBin ?? "omp";
    this.#proc = spawn(bin, args, {
      cwd: this.#opts.cwd,
      env: { ...process.env, ...this.#opts.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#setState("starting");

    const rl = createInterface({ input: this.#proc.stdout!, crlfDelay: Infinity });
    rl.on("line", (line) => this.#onLine(line));

    this.#proc.stderr!.on("data", (d: Buffer) => {
      const s = d.toString("utf8");
      this.#stderrBuf.push(s);
      if (this.#stderrBuf.join("").length > 256 * 1024) this.#stderrBuf = [this.#stderrBuf.join("").slice(-128 * 1024)];
      for (const l of s.split("\n")) if (l.trim()) console.error(`[omp ${this.id.slice(0, 8)}] ${l}`);
    });

    this.#proc.on("error", (err) => {
      this.#setState("crashed", String(err));
    });
    this.#proc.on("exit", (code, signal) => {
      const wasReady = this.state === "ready" || this.state === "starting";
      this.#setState(this.#stoppedByUs ? "stopped" : code === 0 ? "stopped" : "crashed", `exit=${code} signal=${signal}`);
      for (const [, p] of this.#pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`worker exited (code=${code})`));
      }
      this.#pending.clear();
      if (wasReady) this.#events.onExit(code, signal);
    });
  }

  get stderrTail(): string {
    return this.#stderrBuf.join("").slice(-4096);
  }

  async command<T = unknown>(cmd: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
    if (!this.#proc?.stdin || this.state === "stopped" || this.state === "crashed") {
      throw new Error(`worker not running (state=${this.state})`);
    }
    const id = (cmd.id as string) ?? `cmd_${randomUUID()}`;
    const wire = { ...cmd, id };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`command ${String(cmd.type)} timed out`));
      }, timeoutMs);
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.#proc!.stdin!.write(JSON.stringify(wire) + "\n");
    });
  }

  /** Fire-and-forget send (for extension_ui_response etc.). */
  send(frame: Record<string, unknown>): void {
    if (this.#proc?.stdin && this.state !== "stopped" && this.state !== "crashed") {
      this.#proc.stdin.write(JSON.stringify(frame) + "\n");
    }
  }

  /** Test hook: hard-kill the subprocess (fault injection). */
  killNow(signal: NodeJS.Signals = "SIGKILL"): void {
    this.#proc?.kill(signal);
  }

  async stop(graceMs = 3000): Promise<void> {
    this.#stoppedByUs = true;
    const proc = this.#proc;
    if (!proc) return;
    try {
      proc.stdin?.end();
    } catch { /* already closed */ }
    await Promise.race([
      new Promise((r) => proc.once("exit", r)),
      new Promise((r) => setTimeout(r, graceMs)),
    ]);
    if (proc.exitCode === null && !proc.killed) proc.kill("SIGTERM");
  }

  #setState(state: WorkerState, detail?: string) {
    if (this.state === state) return;
    this.state = state;
    this.#events.onStateChange(state, detail);
  }

  /** Test hook: feed a raw stdout line through the hardened frame pipeline. */
  injectLine(line: string): void {
    this.#onLine(line);
  }

  #onLine(line: string): void {
    try {
      this.#onLineUnsafe(line);
    } catch (err) {
      // A hostile/malformed frame must never take down the daemon.
      console.error(`[worker ${this.id.slice(0, 8)}] frame handling error, dropping: ${String(err).slice(0, 200)}`);
    }
  }

  #onLineUnsafe(line: string): void {
    if (line.length > MAX_RAW_LINE_BYTES) {
      console.error(`[worker ${this.id.slice(0, 8)}] oversized line (${line.length} bytes), dropping`);
      return;
    }
    const trimmed = line.trim();
    if (!trimmed) return;
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(trimmed);
    } catch {
      console.error(`[worker ${this.id.slice(0, 8)}] unparsable frame (${trimmed.length} bytes), dropping`);
      return;
    }

    // v2 chunk reassembly
    if (frame.type === "rpc_chunk") {
      const assembled = this.#onChunk(frame);
      if (!assembled) return;
      frame = assembled;
    }

    if (frame.type === "ready") {
      this.#setState("ready");
      this.#events.onFrame(frame);
      // negotiate v2 for lossless oversized frames
      if (Array.isArray(frame.supportedProtocolVersions) && frame.supportedProtocolVersions.includes(2)) {
        this.command({ type: "negotiate_protocol", protocolVersion: 2 })
          .then(() => { this.#protocolVersion = 2; })
          .catch(() => { /* stay on v1 */ });
      }
      return;
    }

    if (frame.type === "response") {
      const id = frame.id as string | undefined;
      const p = id ? this.#pending.get(id) : undefined;
      if (p) {
        this.#pending.delete(id!);
        clearTimeout(p.timer);
        if (frame.success === false) {
          const err = new Error(String(frame.error ?? "command failed"));
          (err as Error & { code?: string }).code = frame.code as string | undefined;
          p.reject(err);
        } else {
          p.resolve(frame.data);
        }
        return;
      }
      // async late error for a prompt id, or unknown: forward as event
    }

    this.#events.onFrame(frame);
  }

  #onChunk(frame: Record<string, unknown>): Record<string, unknown> | null {
    const { chunkId, index, count, byteLength, data } = frame as {
      chunkId?: string; index?: number; count?: number; byteLength?: number; data?: string;
    };
    if (!chunkId || typeof index !== "number" || typeof count !== "number" || typeof byteLength !== "number" || typeof data !== "string") {
      console.error("[worker] malformed rpc_chunk, dropping");
      return null;
    }
    if (byteLength > CHUNK_REASSEMBLY_LIMIT || count <= 0 || count > MAX_CHUNK_COUNT) {
      console.error(`[worker] rpc_chunk over limit (bytes=${byteLength} count=${count}), dropping`);
      this.#chunks.delete(chunkId);
      return null;
    }
    this.#sweepStaleChunks();
    if (!this.#chunks.has(chunkId) && this.#chunks.size >= MAX_CONCURRENT_CHUNK_IDS) {
      console.error("[worker] too many concurrent chunk assemblies, dropping");
      return null;
    }
    let acc = this.#chunks.get(chunkId);
    if (!acc) {
      acc = { count, byteLength, parts: new Array(count), received: 0, bytes: 0, createdAt: Date.now() };
      this.#chunks.set(chunkId, acc);
    }
    if (acc.count !== count || acc.byteLength !== byteLength || index < 0 || index >= count || acc.parts[index]) {
      console.error("[worker] inconsistent rpc_chunk sequence, dropping message");
      this.#chunks.delete(chunkId);
      return null;
    }
    const part = Buffer.from(data, "base64");
    acc.parts[index] = part;
    acc.received++;
    acc.bytes += part.byteLength;
    if (acc.bytes > CHUNK_REASSEMBLY_LIMIT) {
      console.error("[worker] rpc_chunk aggregate bytes over limit, dropping");
      this.#chunks.delete(chunkId);
      return null;
    }
    if (acc.received < count) return null;
    this.#chunks.delete(chunkId);
    const buf = Buffer.concat(acc.parts);
    if (buf.byteLength !== byteLength) {
      console.error("[worker] rpc_chunk byteLength mismatch, dropping");
      return null;
    }
    try {
      return JSON.parse(buf.toString("utf8"));
    } catch {
      console.error("[worker] reassembled frame is not valid JSON");
      return null;
    }
  }

  /** Expire incomplete chunk assemblies so a noisy worker cannot leak memory. */
  #sweepStaleChunks(): void {
    const now = Date.now();
    for (const [id, acc] of this.#chunks) {
      if (now - acc.createdAt > CHUNK_ASSEMBLY_TTL_MS) this.#chunks.delete(id);
    }
  }
}
