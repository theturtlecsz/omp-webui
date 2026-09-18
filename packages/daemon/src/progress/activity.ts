import * as fs from "node:fs/promises";
import { readBounded, sanitizePublicText } from "./collector.js";

export interface ActivityRun {
  id: string;
  provider: string;
  requestedModel: string;
  observedModel: string | null;
  role: string;
  title: string;
  startedAt: number;
  finishedAt: number | null;
  status: "running" | "finished" | "failed" | "interrupted" | "unknown";
  liveness: "alive" | "dead" | "mismatch" | "unknown";
  cost: {
    usd: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
  };
  reviewVerdict: "accepted" | "rejected" | "pending" | "unknown";
  reviewRecorded?: boolean;
  workKey?: string | null;
  failureReason?: string | null;
  pid: number | null;
  pidStartTicks: string | null;
  receiptPath: string | null;
}

export interface ActivityView {
  provenance: {
    kind: "live" | "stale-live" | "snapshot" | "unavailable";
    observedAt: string | null;
    ageSeconds: number | null;
    errorClass: string | null;
  };
  scopeId: string | null;
  scopeLabel: string | null;
  startedAt: string | null;
  current: ActivityRun[];
  history: ActivityRun[];
  limit: {
    maxRows: number;
    truncated: boolean;
  };
}

export const SAFE_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_MANIFEST_BYTES = 262144;
const MAX_PROC_STAT_BYTES = 8192;
const MAX_ROWS = 200;
const RECENT_WINDOW_MS = 15 * 60 * 1000;

function makeUnavailable(errorClass: string): ActivityView {
  return {
    provenance: {
      kind: "unavailable",
      observedAt: null,
      ageSeconds: null,
      errorClass,
    },
    scopeId: null,
    scopeLabel: null,
    startedAt: null,
    current: [],
    history: [],
    limit: { maxRows: MAX_ROWS, truncated: false },
  };
}

function parseValidIsoDate(val: unknown, now: number): number | null {
  if (typeof val !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(val)) {
    return null;
  }
  const ms = Date.parse(val);
  if (Number.isNaN(ms)) return null;
  if (ms > now + 5 * 60 * 1000) return null;
  if (ms < 1577836800000) return null;
  return ms;
}

export async function readProviderRuns(
  manifestPath: string | null,
  now: number
): Promise<ActivityView> {
  if (!manifestPath) {
    return makeUnavailable("not-found");
  }

  let fileMtimeMs: number | null = null;
  try {
    const fileStat = await fs.stat(manifestPath);
    if (!fileStat.isFile()) {
      return makeUnavailable("malformed");
    }
    fileMtimeMs = fileStat.mtimeMs;
  } catch (err: unknown) {
    const code = typeof err === "object" && err !== null && "code" in err ? (err as { code: unknown }).code : undefined;
    if (code === "ENOENT") return makeUnavailable("not-found");
    return makeUnavailable("malformed");
  }

  let raw: string;
  try {
    raw = await readBounded(manifestPath, MAX_MANIFEST_BYTES);
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === "not-found") return makeUnavailable("not-found");
      if (err.message === "too-large") return makeUnavailable("output-cap");
    }
    return makeUnavailable("malformed");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return makeUnavailable("malformed");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return makeUnavailable("malformed");
  }

  const manifest = parsed as Record<string, unknown>;
  if (manifest.version !== 1 || !Array.isArray(manifest.runs)) {
    return makeUnavailable("malformed");
  }

  let startedAtIso: string | null = null;
  if (typeof manifest.startedAt === "string") {
    const startedAtMs = parseValidIsoDate(manifest.startedAt, now);
    if (startedAtMs === null) {
      return makeUnavailable("malformed");
    }
    startedAtIso = new Date(startedAtMs).toISOString();
  } else {
    return makeUnavailable("malformed");
  }

  const observedAtIso = fileMtimeMs !== null ? new Date(fileMtimeMs).toISOString() : startedAtIso;
  const ageSeconds = fileMtimeMs !== null
    ? Math.max(0, Math.floor((now - fileMtimeMs) / 1000))
    : 0;

  let feedKind: "live" | "stale-live" | "snapshot" = ageSeconds > 60 ? "stale-live" : "live";
  if (typeof manifest.provenance === "object" && manifest.provenance !== null) {
    const rawProv = manifest.provenance as Record<string, unknown>;
    if (rawProv.kind === "snapshot") {
      feedKind = "snapshot";
    } else if (rawProv.kind === "live" || rawProv.kind === "stale-live") {
      feedKind = ageSeconds > 60 ? "stale-live" : "live";
    }
  }

  const provenance: ActivityView["provenance"] = {
    kind: feedKind,
    observedAt: observedAtIso,
    ageSeconds,
    errorClass: null,
  };

  const scopeId =
    typeof manifest.scopeId === "string" && SAFE_ID_RE.test(manifest.scopeId)
      ? manifest.scopeId
      : null;
  const scopeLabel =
    typeof manifest.scopeLabel === "string"
      ? sanitizePublicText(manifest.scopeLabel)
      : null;

  const rawRuns = manifest.runs;
  const truncated = rawRuns.length > MAX_ROWS;
  const runsSlice = rawRuns.slice(0, MAX_ROWS);

  const current: ActivityRun[] = [];
  const history: ActivityRun[] = [];

  for (const item of runsSlice) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue;
    }
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || !SAFE_ID_RE.test(r.id)) {
      continue;
    }

    const startedAt = parseValidIsoDate(r.startedAt, now);
    if (startedAt === null) {
      continue;
    }

    const finishedAt = r.finishedAt !== undefined && r.finishedAt !== null
      ? parseValidIsoDate(r.finishedAt, now)
      : null;

    const rawPid = r.pid;
    const pid = typeof rawPid === "number" && Number.isSafeInteger(rawPid) && rawPid > 0 ? rawPid : null;

    let suppliedTicks: string | null = null;
    if (typeof r.pidStartTicks === "number" && Number.isSafeInteger(r.pidStartTicks) && r.pidStartTicks >= 0) {
      suppliedTicks = String(r.pidStartTicks);
    } else if (typeof r.pidStartTicks === "string" && /^\d+$/.test(r.pidStartTicks.trim())) {
      suppliedTicks = r.pidStartTicks.trim();
    }

    const recordedStatus = typeof r.status === "string" ? r.status : "unknown";
    let liveness: "alive" | "dead" | "mismatch" | "unknown" = "unknown";
    let status: "running" | "finished" | "failed" | "interrupted" | "unknown" = "unknown";

    if (recordedStatus === "running") {
      if (pid !== null && suppliedTicks !== null) {
        try {
          const stat = await readBounded(`/proc/${pid}/stat`, MAX_PROC_STAT_BYTES);
          const lastParen = stat.lastIndexOf(")");
          if (lastParen === -1) {
            liveness = "unknown";
          } else {
            const fields = stat.slice(lastParen + 1).trim().split(/\s+/);
            const procState = fields[0];
            const procTicks = fields[19];
            if (procState === "Z" || procState === "X") {
              liveness = "dead";
            } else if (procTicks !== undefined && /^\d+$/.test(procTicks) && BigInt(procTicks) === BigInt(suppliedTicks)) {
              liveness = "alive";
            } else {
              liveness = "mismatch";
            }
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.message === "not-found") {
            liveness = "dead";
          } else {
            liveness = "unknown";
          }
        }
      } else {
        liveness = "unknown";
      }

      if (liveness === "alive") {
        status = "running";
      } else if (liveness === "dead" || liveness === "mismatch") {
        status = "interrupted";
      } else {
        status = "unknown";
      }
    } else if (recordedStatus === "finished" || recordedStatus === "failed" || recordedStatus === "interrupted") {
      status = recordedStatus;
      liveness = "unknown";
    } else {
      status = "unknown";
      liveness = "unknown";
    }

    let costUsd: number | null = null;
    let costInput: number | null = null;
    let costOutput: number | null = null;
    if (typeof r.cost === "object" && r.cost !== null && !Array.isArray(r.cost)) {
      const c = r.cost as Record<string, unknown>;
      if (typeof c.usd === "number" && Number.isFinite(c.usd) && c.usd >= 0) costUsd = c.usd;
      if (typeof c.inputTokens === "number" && Number.isSafeInteger(c.inputTokens) && c.inputTokens >= 0) costInput = c.inputTokens;
      if (typeof c.outputTokens === "number" && Number.isSafeInteger(c.outputTokens) && c.outputTokens >= 0) costOutput = c.outputTokens;
    }

    const reviewRecorded = r.reviewVerdict === "accepted" || r.reviewVerdict === "rejected" || r.reviewVerdict === "pending";

    const run: ActivityRun = {
      id: r.id,
      provider: typeof r.provider === "string" ? sanitizePublicText(r.provider) : "unknown",
      requestedModel: typeof r.requestedModel === "string" ? sanitizePublicText(r.requestedModel) : "unknown",
      observedModel: typeof r.observedModel === "string" ? sanitizePublicText(r.observedModel) : null,
      role: typeof r.role === "string" ? sanitizePublicText(r.role) : "unknown",
      title: typeof r.title === "string" ? sanitizePublicText(r.title) : "",
      startedAt,
      finishedAt,
      status,
      liveness,
      cost: {
        usd: costUsd,
        inputTokens: costInput,
        outputTokens: costOutput,
      },
      reviewVerdict: reviewRecorded ? (r.reviewVerdict as ActivityRun["reviewVerdict"]) : "unknown",
      reviewRecorded,
      workKey: typeof r.workKey === "string" && SAFE_ID_RE.test(r.workKey) ? r.workKey : null,
      failureReason: typeof r.failureReason === "string" && r.failureReason.trim() ? sanitizePublicText(r.failureReason) : null,
      pid,
      pidStartTicks: suppliedTicks,
      receiptPath: typeof r.receiptPath === "string" ? r.receiptPath : null,
    };

    const ts = finishedAt ?? startedAt;
    const isRecent = Math.abs(now - ts) <= RECENT_WINDOW_MS;
    const isLiveRunning = status === "running" && liveness === "alive";

    if (isLiveRunning || (status !== "unknown" && isRecent)) {
      current.push(run);
    } else {
      history.push(run);
    }
  }

  current.sort((a, b) => {
    const aLive = a.status === "running" && a.liveness === "alive" ? 1 : 0;
    const bLive = b.status === "running" && b.liveness === "alive" ? 1 : 0;
    if (aLive !== bLive) return bLive - aLive;
    return b.startedAt - a.startedAt;
  });

  history.sort((a, b) => {
    const aTs = a.finishedAt ?? a.startedAt;
    const bTs = b.finishedAt ?? b.startedAt;
    return bTs - aTs;
  });

  return {
    provenance,
    scopeId,
    scopeLabel,
    startedAt: startedAtIso,
    current,
    history,
    limit: {
      maxRows: MAX_ROWS,
      truncated,
    },
  };
}
