export const PROGRESS_CONTRACT_VERSION = 1;

export type SourceKind = 'live' | 'stale-live' | 'snapshot' | 'unavailable';

export interface SourceState {
  kind: SourceKind;
  observedAt: string | null;
  ageSeconds: number | null;
  errorClass: string | null;
}

export type RunStatus = 'running' | 'finished' | 'failed' | 'interrupted' | 'unknown';

export type Liveness = 'alive' | 'dead' | 'mismatch' | 'unknown';

export interface ProviderRow {
  id: string;
  provider: string;
  requestedModel: string;
  observedModel: string | null;
  role: string;
  title: string;
  status: RunStatus;
  liveness: Liveness;
  startedAt: string;
  finishedAt: string | null;
  elapsedSeconds: number | null;
  cost: {
    usd: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
  };
  reviewVerdict: 'accepted' | 'rejected' | 'pending' | 'unknown';
  /** Ledger key the run worked on, when the receipt recorded one. */
  workKey?: string | null;
  /** Sanitized process failure reason, when the receipt recorded one. */
  failureReason?: string | null;
  /** False when the receipt predates review verdicts (verdict is then 'unknown'). */
  reviewRecorded?: boolean;
}

/**
 * Per-run detail. Process outcome, checks, review, and ledger acceptance are
 * independent facts and must never be inferred from one another.
 */
export interface RunDetail {
  contractVersion: 1;
  generatedAt: string;
  run: ProviderRow;
  process: {
    outcome: RunStatus;
    liveness: Liveness;
    failureReason: string | null;
  };
  checks: {
    status: CheckRow['status'] | 'unknown';
    modules: CheckModule[];
  };
  review: {
    verdict: ProviderRow['reviewVerdict'];
    /** False = older receipt without a verdict field; verdict is explicitly unknown. */
    recorded: boolean;
  };
  ledger: {
    workKey: string | null;
    /** true = in accepted list, false = in remaining list, null = not tracked / no key. */
    accepted: boolean | null;
  };
}

export interface CoordinatorRow {
  label: string;
  model: string | null;
  nativeState: string | null;
  work: string | null;
  next: string | null;
  updatedAt: string | null;
  internalThreadCount: number | null;
  provenance?: SourceState | null;
  note: 'non-authoritative';
}

export interface CheckRow {
  id: string;
  status: 'PASS' | 'FAIL' | 'STALE' | 'UNVERIFIED' | 'UNBOUND' | 'UNAVAILABLE' | 'MALFORMED';
  hashState: 'match' | 'mismatch' | 'unbound' | 'missing';
  junit: {
    tests: number;
    skipped: number;
    failures: number;
    errors: number;
    executed: number;
  } | null;
  recordedExitCode: number | null;
}

export interface CheckModule {
  id: string;
  status: CheckRow['status'];
  scopeId: string | null;
  sourceBindings: {
    total: number;
    matched: number;
    state: 'all-match' | 'mismatch' | 'unbound';
  };
  reportAgeSeconds: number | null;
  checks: CheckRow[];
  currentEvidence: boolean;
  note: string | null;
}

export interface ProgressSnapshot {
  contractVersion: 1;
  generatedAt: string;
  scope: {
    scopeId: string | null;
    label: string | null;
    startedAt: string | null;
    explicit: boolean;
  };
  sources: {
    collector: SourceState;
    activity: SourceState;
  };
  coordinator: CoordinatorRow | null;
  providers: {
    current: ProviderRow[];
    history: ProviderRow[];
    truncated: boolean;
  };
  overall: {
    trackedKeys: string[];
    expectedCount: number;
    done: number;
    total: number;
    byState: Record<string, number>;
    unknown: number;
    doneStates: string[];
    lastLiveSuccessAt: string | null;
    ledgerSource: SourceState;
  } | null;
  checks: CheckModule[];
  summary: {
    accepted: string[];
    remaining: string[];
    blockers: string[];
  };
  control?: {
    source: SourceState;
    state: PublicControl | null;
  };
}

export type ControlErrorCode =
  | 'no_grant'
  | 'grant_mismatch'
  | 'not_active'
  | 'already_terminal'
  | 'stale_version'
  | 'judge_drift'
  | 'contract_mismatch'
  | 'unauthorized'
  | 'unavailable'
  | 'control-unavailable'
  | 'invalid_reason'
  | 'busy'
  | 'invalid_arguments';

export interface PublicControl {
  grantRef: string;
  state: 'active' | 'paused' | 'stopped' | 'completed' | 'canceled';
  grantVersion: number;
  mode: 'single' | 'queue';
  activeWorkKey: string | null;
  pausedAt: string | null;
  stoppedAt: string | null;
  expiresAt: string | null;
  terminalReason: string | null;
  canPause: boolean;
  canStop: boolean;
}

export interface ProgressControlState {
  source: SourceState;
  state: PublicControl | null;
}
