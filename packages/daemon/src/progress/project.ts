import type {
  CheckModule,
  CheckRow,
  CoordinatorRow,
  ProgressControlState,
  ProgressSnapshot,
  ProviderRow,
  PublicControl,
  RunDetail,
  SourceKind,
  SourceState,
} from "./contract.js";
import { sanitizePublicText, type CollectorResult } from "./collector.js";
import type { ActivityRun, ActivityView } from "./activity.js";

function mapProviderRow(run: ActivityRun, nowMs: number): ProviderRow {
  const elapsedSeconds = run.finishedAt !== null
    ? Math.max(0, Math.floor((run.finishedAt - run.startedAt) / 1000))
    : Math.max(0, Math.floor((nowMs - run.startedAt) / 1000));

  return {
    id: run.id,
    provider: sanitizePublicText(run.provider),
    requestedModel: sanitizePublicText(run.requestedModel),
    observedModel: run.observedModel ? sanitizePublicText(run.observedModel) : null,
    role: sanitizePublicText(run.role),
    title: sanitizePublicText(run.title),
    status: run.status,
    liveness: run.liveness,
    startedAt: new Date(run.startedAt).toISOString(),
    finishedAt: run.finishedAt !== null ? new Date(run.finishedAt).toISOString() : null,
    elapsedSeconds,
    cost: {
      usd: run.cost.usd,
      inputTokens: run.cost.inputTokens,
      outputTokens: run.cost.outputTokens,
    },
    reviewVerdict: run.reviewVerdict,
    reviewRecorded: run.reviewRecorded ?? false,
    workKey: run.workKey ?? null,
    failureReason: run.failureReason ?? null,
  };
}

/** Pure per-run projection over an already-built snapshot. Null when the id is not in it. */
export function projectRunDetail(snapshot: ProgressSnapshot, id: string, nowMs = Date.now()): RunDetail | null {
  const run = [...snapshot.providers.current, ...snapshot.providers.history].find((r) => r.id === id);
  if (!run) return null;

  const modules = snapshot.checks.filter((m) => m.currentEvidence);
  const checkStatus: RunDetail["checks"]["status"] = modules.length === 0
    ? "unknown"
    : modules.some((m) => m.status === "FAIL")
      ? "FAIL"
      : modules.every((m) => m.status === "PASS")
        ? "PASS"
        : "UNVERIFIED";

  const workKey = run.workKey ?? null;
  const accepted = workKey === null
    ? null
    : snapshot.summary.accepted.includes(workKey)
      ? true
      : snapshot.summary.remaining.includes(workKey)
        ? false
        : null;

  return {
    contractVersion: 1,
    generatedAt: new Date(nowMs).toISOString(),
    run,
    process: { outcome: run.status, liveness: run.liveness, failureReason: run.failureReason ?? null },
    checks: { status: checkStatus, modules },
    review: { verdict: run.reviewVerdict, recorded: run.reviewRecorded ?? false },
    ledger: { workKey, accepted },
  };
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

export function projectControl(result: unknown): PublicControl | null {
  if (!result || typeof result !== "object") return null;

  let raw: Record<string, unknown> | null = null;
  const obj = result as Record<string, unknown>;

  if ("ok" in obj && obj.ok === true && "data" in obj && typeof obj.data === "object" && obj.data !== null) {
    const data = obj.data as Record<string, unknown>;
    if ("ok" in data && data.ok === true && "control" in data && typeof data.control === "object" && data.control !== null) {
      raw = data.control as Record<string, unknown>;
    } else if ("control" in data && typeof data.control === "object" && data.control !== null) {
      raw = data.control as Record<string, unknown>;
    } else {
      raw = data;
    }
  } else if ("ok" in obj && obj.ok === true && "control" in obj && typeof obj.control === "object" && obj.control !== null) {
    raw = obj.control as Record<string, unknown>;
  } else if ("control" in obj && typeof obj.control === "object" && obj.control !== null) {
    raw = obj.control as Record<string, unknown>;
  } else {
    raw = obj;
  }

  if (!raw || typeof raw !== "object") return null;

  const grantRef = typeof raw.grantRef === "string" ? raw.grantRef : null;
  if (!grantRef || !/^[0-9a-f]{8}$/i.test(grantRef)) return null;

  const validStates = new Set(["active", "paused", "stopped", "completed", "canceled"]);
  if (typeof raw.state !== "string" || !validStates.has(raw.state)) return null;
  const state = raw.state as PublicControl["state"];

  if (typeof raw.grantVersion !== "number" || !Number.isInteger(raw.grantVersion) || raw.grantVersion < 0) return null;
  const grantVersion = raw.grantVersion;

  if (raw.mode !== "single" && raw.mode !== "queue") return null;
  const mode = raw.mode as PublicControl["mode"];

  const activeWorkKey = typeof raw.activeWorkKey === "string" ? sanitizePublicText(raw.activeWorkKey, 60) : null;
  const pausedAt = normalizeTimestamp(raw.pausedAt);
  const stoppedAt = normalizeTimestamp(raw.stoppedAt);
  const expiresAt = normalizeTimestamp(raw.expiresAt);

  let terminalReason: string | null = null;
  if (typeof raw.terminalReason === "string") {
    terminalReason = sanitizePublicText(raw.terminalReason, 120);
  }

  const canPause = state === "active";
  const canStop = state === "active" || state === "paused";

  return {
    grantRef,
    state,
    grantVersion,
    mode,
    activeWorkKey,
    pausedAt,
    stoppedAt,
    expiresAt,
    terminalReason,
    canPause,
    canStop,
  };
}

export function projectSnapshot(
  collector: CollectorResult,
  activity: ActivityView,
  nowMsOrControl?: number | ProgressControlState | CollectorResult,
  controlParam?: ProgressControlState | CollectorResult,
): ProgressSnapshot {
  let nowMs = Date.now();
  let controlInput: ProgressControlState | CollectorResult | undefined;

  if (typeof nowMsOrControl === "number") {
    nowMs = nowMsOrControl;
    controlInput = controlParam;
  } else if (typeof nowMsOrControl === "object" && nowMsOrControl !== null) {
    controlInput = nowMsOrControl;
  }
  const generatedAt = new Date(nowMs).toISOString();

  let collectorSource: SourceState;
  if (!collector.ok) {
    collectorSource = {
      kind: "unavailable",
      observedAt: null,
      ageSeconds: null,
      errorClass: collector.errorClass,
    };
  } else {
    const obsMs = Date.parse(collector.observedAt);
    const ageSeconds = Number.isNaN(obsMs) ? 0 : Math.max(0, Math.floor((nowMs - obsMs) / 1000));
    collectorSource = {
      kind: ageSeconds > 60 ? "stale-live" : "live",
      observedAt: collector.observedAt,
      ageSeconds,
      errorClass: null,
    };
  }

  const activitySource: SourceState = {
    kind: activity.provenance.kind,
    observedAt: activity.provenance.observedAt,
    ageSeconds: activity.provenance.ageSeconds,
    errorClass: activity.provenance.errorClass,
  };

  const scope = {
    scopeId: activity.scopeId,
    label: activity.scopeLabel,
    startedAt: activity.startedAt,
    explicit: activity.scopeId !== null && activity.scopeId !== "",
  };

  let coordinator: CoordinatorRow | null = null;
  if (collector.ok && collector.data && typeof collector.data.coordinator === "object" && collector.data.coordinator !== null) {
    const rawCoord = collector.data.coordinator as Record<string, unknown>;
    let rootModel: string | null = null;
    let threadCount: number | null = null;

    const rawAgents = (collector.data.agents ?? collector.data.agentTree) as Record<string, unknown> | undefined;
    if (typeof rawAgents === "object" && rawAgents !== null) {
      if (Array.isArray(rawAgents.agents)) {
        threadCount = rawAgents.agents.length;
        const rootId = typeof rawAgents.rootThreadId === "string" ? rawAgents.rootThreadId : null;
        for (const ag of rawAgents.agents) {
          if (typeof ag === "object" && ag !== null) {
            const agRec = ag as Record<string, unknown>;
            if (rootId && agRec.threadId === rootId && typeof agRec.model === "string") {
              rootModel = sanitizePublicText(agRec.model);
              break;
            }
          }
        }
      }
    }

    if (rootModel === null && typeof rawCoord.model === "string") {
      rootModel = sanitizePublicText(rawCoord.model);
    }

    let coordinatorProvenance: SourceState | null = null;
    if (typeof rawCoord.provenance === "object" && rawCoord.provenance !== null) {
      const p = rawCoord.provenance as Record<string, unknown>;
      const provKind: SourceKind =
        p.kind === "live" || p.kind === "stale-live" || p.kind === "snapshot" || p.kind === "unavailable"
          ? p.kind
          : "snapshot";
      const obsAt = typeof p.observedAt === "number"
        ? new Date(p.observedAt).toISOString()
        : typeof p.observedAt === "string"
          ? p.observedAt
          : null;
      const ageSec = typeof p.ageSeconds === "number" && Number.isFinite(p.ageSeconds)
        ? Math.max(0, Math.floor(p.ageSeconds))
        : null;
      const errClass = typeof p.errorClass === "string" ? sanitizePublicText(p.errorClass) : null;
      coordinatorProvenance = {
        kind: provKind,
        observedAt: obsAt,
        ageSeconds: ageSec,
        errorClass: errClass,
      };
    }

    coordinator = {
      label: "Coordinator",
      model: rootModel,
      nativeState: typeof rawCoord.nativeState === "string" ? sanitizePublicText(rawCoord.nativeState) : null,
      work: typeof rawCoord.work === "string" ? sanitizePublicText(rawCoord.work) : null,
      next: typeof rawCoord.next === "string" ? sanitizePublicText(rawCoord.next) : null,
      updatedAt: typeof rawCoord.updatedAt === "string" ? rawCoord.updatedAt : null,
      internalThreadCount: threadCount,
      provenance: coordinatorProvenance,
      note: "non-authoritative",
    };
  }

  const currentProviders = activity.current.map((r) => mapProviderRow(r, nowMs));
  const historyProviders = activity.history.map((r) => mapProviderRow(r, nowMs));

  let overall: ProgressSnapshot["overall"] = null;
  const accepted: string[] = [];
  const remaining: string[] = [];

  if (collector.ok && collector.data) {
    const rawLedger = (collector.data.trackedLedger ?? collector.data.ledger) as Record<string, unknown> | undefined;
    if (typeof rawLedger === "object" && rawLedger !== null) {
      const rawCounts = (typeof rawLedger.counts === "object" && rawLedger.counts !== null ? rawLedger.counts : {}) as Record<string, unknown>;
      const rawByState = (typeof rawCounts.byState === "object" && rawCounts.byState !== null ? rawCounts.byState : {}) as Record<string, number>;
      const cleanByState: Record<string, number> = {};
      for (const [k, v] of Object.entries(rawByState)) {
        if (typeof v === "number" && Number.isFinite(v)) {
          cleanByState[sanitizePublicText(k)] = v;
        }
      }

      const trackedKeys = Array.isArray(rawLedger.trackedKeys)
        ? rawLedger.trackedKeys.filter((k): k is string => typeof k === "string").map((k) => sanitizePublicText(k))
        : [];

      const doneStates = Array.isArray(rawLedger.doneStates)
        ? rawLedger.doneStates.filter((s): s is string => typeof s === "string").map((s) => sanitizePublicText(s))
        : ["DONE", "ACCEPTED"];

      const rawProv = (typeof rawLedger.provenance === "object" && rawLedger.provenance !== null ? rawLedger.provenance : {}) as Record<string, unknown>;
      const provKind = typeof rawProv.kind === "string" && (rawProv.kind === "live" || rawProv.kind === "stale-live" || rawProv.kind === "snapshot" || rawProv.kind === "unavailable")
        ? rawProv.kind
        : "snapshot";

      const lastSuccess = typeof rawLedger.lastLiveSuccessAt === "number"
        ? new Date(rawLedger.lastLiveSuccessAt).toISOString()
        : typeof rawLedger.lastLiveSuccessAt === "string"
          ? rawLedger.lastLiveSuccessAt
          : null;

      overall = {
        trackedKeys,
        expectedCount: typeof rawLedger.expectedCount === "number" ? rawLedger.expectedCount : trackedKeys.length,
        done: typeof rawCounts.done === "number" ? rawCounts.done : 0,
        total: typeof rawCounts.total === "number" ? rawCounts.total : trackedKeys.length,
        byState: cleanByState,
        unknown: typeof rawCounts.unknown === "number" ? rawCounts.unknown : 0,
        doneStates,
        lastLiveSuccessAt: lastSuccess,
        ledgerSource: {
          kind: provKind,
          observedAt: typeof rawProv.observedAt === "number" ? new Date(rawProv.observedAt).toISOString() : null,
          ageSeconds: typeof rawProv.ageSeconds === "number" ? rawProv.ageSeconds : null,
          errorClass: typeof rawProv.errorClass === "string" ? sanitizePublicText(rawProv.errorClass) : null,
        },
      };

      const normalizedDoneStates = new Set(
        doneStates
          .map((s) => s.trim().toUpperCase())
          .filter((s) => s.length > 0)
      );

      if (Array.isArray(rawLedger.items)) {
        for (const it of rawLedger.items) {
          if (typeof it === "object" && it !== null) {
            const itRec = it as Record<string, unknown>;
            if (typeof itRec.key === "string") {
              const cleanKey = sanitizePublicText(itRec.key);
              const state = typeof itRec.state === "string" ? itRec.state.trim() : "";
              if (state.length > 0 && normalizedDoneStates.has(state.toUpperCase())) {
                accepted.push(cleanKey);
              } else {
                remaining.push(cleanKey);
              }
            }
          }
        }
      }
    }
  }

  const checks: CheckModule[] = [];
  if (collector.ok && collector.data) {
    const rawEvidence = (collector.data.evidence ?? collector.data.checks) as Record<string, unknown> | undefined;
    const rawModules = Array.isArray(rawEvidence?.modules)
      ? rawEvidence.modules
      : Array.isArray(rawEvidence)
        ? rawEvidence
        : [];

    for (const m of rawModules) {
      if (typeof m !== "object" || m === null || Array.isArray(m)) continue;
      const modRec = m as Record<string, unknown>;
      const modId = typeof modRec.id === "string" ? sanitizePublicText(modRec.id) : "unknown";
      const modScopeId = typeof modRec.scopeId === "string" ? modRec.scopeId : null;

      const rawBindings = Array.isArray(modRec.sourceBindings) ? modRec.sourceBindings : [];
      let matchedCount = 0;
      for (const b of rawBindings) {
        if (typeof b === "object" && b !== null && (b as Record<string, unknown>).match === true) {
          matchedCount++;
        }
      }

      let bindingState: "all-match" | "mismatch" | "unbound" = "unbound";
      if (rawBindings.length > 0) {
        bindingState = matchedCount === rawBindings.length ? "all-match" : "mismatch";
      }

      const rawChecks = Array.isArray(modRec.checks) ? modRec.checks : [];
      const checkRows: CheckRow[] = [];

      for (const c of rawChecks) {
        if (typeof c !== "object" || c === null || Array.isArray(c)) continue;
        const cRec = c as Record<string, unknown>;
        const checkId = typeof cRec.id === "string" ? sanitizePublicText(cRec.id) : "unknown";
        const rawHashState = typeof cRec.hashState === "string" ? cRec.hashState : "missing";
        const hashState: CheckRow["hashState"] =
          rawHashState === "match" || rawHashState === "mismatch" || rawHashState === "unbound"
            ? rawHashState
            : "missing";

        let junit: CheckRow["junit"] = null;
        if (typeof cRec.junit === "object" && cRec.junit !== null && !Array.isArray(cRec.junit)) {
          const j = cRec.junit as Record<string, unknown>;
          const tests = typeof j.tests === "number" && Number.isSafeInteger(j.tests) && j.tests >= 0 ? j.tests : 0;
          const skipped = typeof j.skipped === "number" && Number.isSafeInteger(j.skipped) && j.skipped >= 0 ? j.skipped : 0;
          const failures = typeof j.failures === "number" && Number.isSafeInteger(j.failures) && j.failures >= 0 ? j.failures : 0;
          const errors = typeof j.errors === "number" && Number.isSafeInteger(j.errors) && j.errors >= 0 ? j.errors : 0;
          const executed = typeof j.executed === "number" && Number.isSafeInteger(j.executed) && j.executed >= 0 ? j.executed : tests - skipped;
          junit = { tests, skipped, failures, errors, executed };
        }

        const rawExit = cRec.recordedExitCode;
        const recordedExitCode = typeof rawExit === "number" && Number.isSafeInteger(rawExit) ? rawExit : null;

        let status: CheckRow["status"] = "UNVERIFIED";
        if (bindingState === "mismatch") {
          status = "UNBOUND";
        } else if (hashState !== "match") {
          status = hashState === "mismatch" ? "UNVERIFIED" : "UNBOUND";
        } else if (recordedExitCode !== null && recordedExitCode !== 0) {
          status = "FAIL";
        } else if (junit && (junit.failures > 0 || junit.errors > 0)) {
          status = "FAIL";
        } else if (
          bindingState === "all-match" &&
          hashState === "match" &&
          junit !== null &&
          junit.executed > 0 &&
          junit.failures === 0 &&
          junit.errors === 0 &&
          recordedExitCode === 0
        ) {
          status = "PASS";
        } else {
          status = "UNVERIFIED";
        }

        checkRows.push({
          id: checkId,
          status,
          hashState,
          junit,
          recordedExitCode,
        });
      }

      const scopeMatches = activity.scopeId !== null ? modScopeId === activity.scopeId : true;

      let modStatus: CheckRow["status"] = "UNVERIFIED";
      let currentEvidence = false;
      let note: string | null = null;

      if (!scopeMatches) {
        modStatus = checkRows.some((cr) => cr.status === "FAIL") ? "FAIL" : "UNVERIFIED";
        currentEvidence = false;
        note = "Historical check outside current workflow scope";
      } else if (checkRows.some((cr) => cr.status === "FAIL")) {
        modStatus = "FAIL";
        currentEvidence = bindingState === "all-match";
        note = null;
      } else if (
        bindingState === "all-match" &&
        checkRows.length > 0 &&
        checkRows.every((cr) => cr.status === "PASS")
      ) {
        modStatus = "PASS";
        currentEvidence = true;
        note = null;
      } else {
        modStatus = bindingState === "mismatch" ? "UNBOUND" : "UNVERIFIED";
        currentEvidence = false;
        note = "No current source-bound test result";
      }

      let reportAgeSeconds: number | null = null;
      if (typeof modRec.reportMtime === "number") {
        reportAgeSeconds = Math.max(0, Math.floor((nowMs - modRec.reportMtime) / 1000));
      }

      checks.push({
        id: modId,
        status: modStatus,
        scopeId: modScopeId,
        sourceBindings: {
          total: rawBindings.length,
          matched: matchedCount,
          state: bindingState,
        },
        reportAgeSeconds,
        checks: checkRows,
        currentEvidence,
        note,
      });
    }
  }

  const blockers: string[] = [];
  if (collectorSource.kind === "unavailable") {
    blockers.push(`Collector source unavailable: ${collectorSource.errorClass ?? "unknown"}`);
  }
  if (activitySource.kind === "unavailable") {
    blockers.push(`Activity source unavailable: ${activitySource.errorClass ?? "unknown"}`);
  }
  for (const chk of checks) {
    if (chk.status === "FAIL") {
      blockers.push(`Check failure: ${chk.id}`);
    }
  }
  for (const prov of currentProviders) {
    if (prov.status === "interrupted") {
      blockers.push(`Interrupted provider run: ${prov.id}`);
    }
  }

  let controlState: ProgressControlState | undefined;
  if (controlInput) {
    if ("source" in controlInput && "state" in controlInput) {
      controlState = controlInput as ProgressControlState;
    } else if ("ok" in controlInput) {
      const col = controlInput as CollectorResult;
      if (!col.ok) {
        controlState = {
          source: {
            kind: "unavailable",
            observedAt: null,
            ageSeconds: null,
            errorClass: col.errorClass,
          },
          state: null,
        };
      } else {
        const obsMs = Date.parse(col.observedAt);
        const ageSeconds = Number.isNaN(obsMs) ? 0 : Math.max(0, Math.floor((nowMs - obsMs) / 1000));
        const proj = projectControl(col);
        const isNoGrant = col.data && typeof col.data === "object" && (col.data as Record<string, unknown>).code === "no_grant";
        const isError = col.data && typeof col.data === "object" && (col.data as Record<string, unknown>).ok === false && !isNoGrant;

        controlState = {
          source: {
            kind: isError ? "unavailable" : ageSeconds > 60 ? "stale-live" : "live",
            observedAt: col.observedAt,
            ageSeconds,
            errorClass: isError ? String((col.data as Record<string, unknown>).code ?? "control-error") : null,
          },
          state: proj,
        };
      }
    }
  }

  return {
    contractVersion: 1,
    generatedAt,
    scope,
    sources: {
      collector: collectorSource,
      activity: activitySource,
    },
    coordinator,
    providers: {
      current: currentProviders,
      history: historyProviders,
      truncated: activity.limit.truncated,
    },
    overall,
    checks,
    summary: {
      accepted,
      remaining,
      blockers,
    },
    ...(controlState ? { control: controlState } : {}),
  };
}
