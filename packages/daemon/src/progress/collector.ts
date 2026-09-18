import * as fs from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { Subprocess } from "bun";

export interface CollectorSuccess {
  ok: true;
  data: Record<string, unknown>;
  observedAt: string;
}

export interface CollectorFailure {
  ok: false;
  errorClass: "not-found" | "timeout" | "output-cap" | "malformed" | "exit-nonzero" | "spawn-failed";
}

export type CollectorResult = CollectorSuccess | CollectorFailure;

const activeCollectorChildren = new Set<Subprocess>();

export function killActiveCollectorProcesses(): void {
  for (const child of activeCollectorChildren) {
    try {
      child.kill(9);
    } catch {}
  }
  activeCollectorChildren.clear();
}

export function sanitizePublicText(text: string, max = 240): string {
  let clean = Bun.stripANSI(text);
  clean = clean.replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
  clean = clean.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "");
  clean = clean.replace(/\s+/g, " ").trim();

  const lower = clean.toLowerCase();
  if (
    /(?:authorization|bearer|token|password|secret|api_key|api-key|api key|apikey)/.test(lower)
  ) {
    return "[sensitive public update omitted]";
  }
  clean = clean.replace(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+/g, "[url]");
  clean = clean.replace(/(?:(?:\/|\b)(?:home|Users)|~)\/\S+/g, "[path]");
  clean = clean.replace(/[a-zA-Z0-9_-]{33,}/g, "[key]");

  if (max <= 0) return clean;
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let clipped = "";
  let count = 0;
  for (const { segment } of segmenter.segment(clean)) {
    if (count >= max) break;
    clipped += segment;
    count++;
  }
  return clipped;
}

export async function readBounded(filePath: string, maxBytes = 8 * 1024 * 1024): Promise<string> {
  let st;
  try {
    st = await fs.lstat(filePath);
  } catch (err: unknown) {
    const code = typeof err === "object" && err !== null && "code" in err ? (err as { code: unknown }).code : undefined;
    if (code === "ENOENT") throw new Error("not-found");
    throw new Error("unreadable");
  }
  if (!st.isFile()) throw new Error("unreadable");
  if (st.size > maxBytes) throw new Error("too-large");

  try {
    const file = Bun.file(filePath);
    const buf = await file.arrayBuffer();
    if (buf.byteLength > maxBytes) throw new Error("too-large");
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch (err: unknown) {
    if (err instanceof Error && (err.message === "not-found" || err.message === "too-large" || err.message === "unreadable")) {
      throw err;
    }
    throw new Error("malformed");
  }
}

export async function runCollector(
  bin: string,
  timeoutMs = 8000,
  maxStdoutBytes = 2 * 1024 * 1024,
  args: string[] = ["--json"]
): Promise<CollectorResult> {
  if (!isAbsolute(bin)) {
    return { ok: false, errorClass: "not-found" };
  }
  try {
    const st = await fs.lstat(bin);
    if (!st.isFile()) {
      return { ok: false, errorClass: "not-found" };
    }
  } catch {
    return { ok: false, errorClass: "not-found" };
  }

  let proc: Subprocess;
  try {
    proc = Bun.spawn([bin, ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
      },
    });
    activeCollectorChildren.add(proc);
  } catch {
    return { ok: false, errorClass: "spawn-failed" };
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill(9);
    } catch {}
  }, timeoutMs);

  if (proc.stderr && typeof proc.stderr === "object" && "getReader" in proc.stderr) {
    const errReader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
    (async () => {
      try {
        while (true) {
          const { done } = await errReader.read();
          if (done) break;
        }
      } catch {}
    })();
  }

  let overflow = false;
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  if (proc.stdout && typeof proc.stdout === "object" && "getReader" in proc.stdout) {
    const outReader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    try {
      while (true) {
        const { done, value } = await outReader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxStdoutBytes) {
            overflow = true;
            try {
              await outReader.cancel();
            } catch {}
            try {
              proc.kill(9);
            } catch {}
            break;
          }
          chunks.push(value);
        }
      }
    } catch {}
  }

  let exitCode: number | null = null;
  try {
    exitCode = await proc.exited;
  } catch {
    exitCode = null;
  } finally {
    clearTimeout(timer);
    activeCollectorChildren.delete(proc);
  }

  if (timedOut) {
    return { ok: false, errorClass: "timeout" };
  }
  if (overflow) {
    return { ok: false, errorClass: "output-cap" };
  }
  if (exitCode !== 0) {
    return { ok: false, errorClass: "exit-nonzero" };
  }

  const raw = Buffer.concat(chunks).toString("utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, errorClass: "malformed" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, errorClass: "malformed" };
  }

  return {
    ok: true,
    data: parsed as Record<string, unknown>,
    observedAt: new Date().toISOString(),
  };
}

export class SingleFlightCache<T> {
  private inFlight: Promise<T> | null = null;
  private cachedValue: T | null = null;
  private expiresAt = 0;
  private readonly ttlMs: number;
  private readonly loader: () => Promise<T>;

  constructor(ttlMs = 4000, loader: () => Promise<T>) {
    this.ttlMs = ttlMs;
    this.loader = loader;
  }

  async get(): Promise<T> {
    const now = Date.now();
    if (this.cachedValue !== null && now < this.expiresAt) {
      return this.cachedValue;
    }
    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = (async () => {
      try {
        const val = await this.loader();
        this.cachedValue = val;
        this.expiresAt = Date.now() + this.ttlMs;
        return val;
      } catch (err) {
        this.expiresAt = Date.now() + 1000;
        throw err;
      } finally {
        this.inFlight = null;
      }
    })();

    return this.inFlight;
  }

  clear(): void {
    this.cachedValue = null;
    this.expiresAt = 0;
    this.inFlight = null;
  }
}
