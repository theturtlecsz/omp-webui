import { useEffect, useRef, useState } from 'react';
import type { CheckRow, ProviderRow, RunDetail, SourceState } from '../../../daemon/src/progress/contract';
import { fetchRunDetail, postControl, useProgress } from '../lib/progress';
import { useFocusTrap } from './dialog-utils';
import './ProgressPanel.css';

export function useContainerCompact(
  containerRef: React.RefObject<HTMLElement | null>,
  breakpoint = 900
): boolean {
  const [isCompact, setIsCompact] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const matchesMedia = typeof window.matchMedia === 'function' && window.matchMedia(`(max-width: ${breakpoint - 1}px)`).matches;
    const matchesWidth = typeof window.innerWidth === 'number' && window.innerWidth < breakpoint;
    return Boolean(matchesMedia || matchesWidth);
  });

  // The panel swaps its root <section> between loading/error/ready renders, so the
  // ref's node changes without the ref object changing. Track the mounted node
  // so the observer re-attaches to whatever is actually in the DOM.
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (containerRef.current !== el) setEl(containerRef.current);
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const check = () => {
      const el = containerRef.current;
      if (el) {
        const rectWidth = el.getBoundingClientRect().width;
        if (rectWidth > 0) {
          setIsCompact(rectWidth < breakpoint);
          return;
        }
        if (el.clientWidth > 0) {
          setIsCompact(el.clientWidth < breakpoint);
          return;
        }
      }
      const matchesMedia = typeof window.matchMedia === 'function' && window.matchMedia(`(max-width: ${breakpoint - 1}px)`).matches;
      const matchesWidth = typeof window.innerWidth === 'number' && window.innerWidth < breakpoint;
      setIsCompact(Boolean(matchesMedia || matchesWidth));
    };

    check();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && el) {
      ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const width = entry.contentRect?.width || (entry.target as HTMLElement).getBoundingClientRect().width;
          if (width > 0) {
            setIsCompact(width < breakpoint);
          }
        }
      });
      ro.observe(el);
    }

    const mq = typeof window.matchMedia === 'function' ? window.matchMedia(`(max-width: ${breakpoint - 1}px)`) : null;
    mq?.addEventListener?.('change', check);
    window.addEventListener('resize', check);

    return () => {
      ro?.disconnect();
      mq?.removeEventListener?.('change', check);
      window.removeEventListener('resize', check);
    };
  }, [containerRef, el, breakpoint]);

  return isCompact;
}

export function useIsMobile(): boolean {
  return useContainerCompact({ current: null }, 900);
}

function SourceBadge({ label, source }: { label: string; source: SourceState }) {
  const isStale = source.kind === 'stale-live' || (source.ageSeconds !== null && source.ageSeconds >= 300);
  const badgeClass = source.kind === 'unavailable'
    ? 'progress-badge--unavailable'
    : isStale
      ? 'progress-badge--stale'
      : 'progress-badge--live';

  return (
    <span className={`progress-badge ${badgeClass}`}>
      <strong>{label}:</strong> {source.kind}
      {isStale && <span className="progress-badge progress-badge--stale">stale</span>}
      {source.ageSeconds !== null && <span>({source.ageSeconds}s)</span>}
      {source.errorClass && (
        <span className="progress-error-class">{source.errorClass}</span>
      )}
    </span>
  );
}

function formatCost(cost: ProviderRow['cost']): string {
  if (cost.usd === null) return 'unknown';
  return `$${cost.usd.toFixed(4)}`;
}

function formatTokens(cost: ProviderRow['cost']): string {
  if (cost.inputTokens === null || cost.outputTokens === null) return 'unknown';
  return `${cost.inputTokens} in / ${cost.outputTokens} out`;
}

function formatElapsed(elapsedSeconds: number | null): string {
  if (elapsedSeconds === null) return '-';
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`;
  const m = Math.floor(elapsedSeconds / 60);
  const s = elapsedSeconds % 60;
  return `${m}m ${s}s`;
}

function RunDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const [state, setState] = useState<{ detail: RunDetail | null; error: string | null }>({ detail: null, error: null });

  useEffect(() => {
    const controller = new AbortController();
    setState({ detail: null, error: null });
    fetchRunDetail(id, controller.signal)
      .then((detail) => setState({ detail, error: null }))
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setState({ detail: null, error: err instanceof Error ? err.message : String(err) });
      });
    return () => controller.abort();
  }, [id]);

  const { detail, error } = state;
  const run = detail?.run;

  return (
    <div className="progress-detail">
      <div className="progress-detail-head">
        <button type="button" className="button button--quiet" onClick={onBack}>Back to runs</button>
        <h3>{run ? (run.title || run.id) : `Run ${id}`}</h3>
      </div>
      {!detail && !error && <p className="spin">Loading run...</p>}
      {error && <p className="panel-error">Failed to load run: {error}</p>}
      {detail && run && (
        <>
          <dl className="progress-detail-grid">
            <dt>Phase</dt><dd>{run.role || '-'}</dd>
            <dt>Provider</dt><dd>{run.provider}</dd>
            <dt>Requested model</dt><dd><code>{run.requestedModel}</code></dd>
            <dt>Observed model</dt><dd>{run.observedModel ? <code>{run.observedModel}</code> : 'not observed'}</dd>
            <dt>Started</dt><dd>{run.startedAt}</dd>
            <dt>Finished</dt><dd>{run.finishedAt ?? 'not finished'}</dd>
            <dt>Elapsed</dt><dd>{formatElapsed(run.elapsedSeconds)}</dd>
            <dt>Budget</dt><dd>{formatCost(run.cost)} | {formatTokens(run.cost)}</dd>
          </dl>

          <div className="progress-detail-section">
            <h4>Process</h4>
            <div>
              <span className={`progress-badge progress-badge--${detail.process.outcome}`}>
                {detail.process.outcome} ({detail.process.liveness})
              </span>
            </div>
            {detail.process.failureReason
              ? <div><strong>Failure reason:</strong> {detail.process.failureReason}</div>
              : <div className="progress-empty">No failure reason recorded</div>}
          </div>

          <div className="progress-detail-section">
            <h4>Checks</h4>
            <div>
              <span className={`progress-badge progress-badge--${detail.checks.status === 'PASS' ? 'live' : detail.checks.status === 'FAIL' ? 'unavailable' : 'stale'}`}>
                {detail.checks.status}
              </span>
            </div>
            {detail.checks.modules.length === 0
              ? <div className="progress-empty">No current source-bound test result</div>
              : detail.checks.modules.map((m) => (
                <div key={m.id}><code>{m.id}</code>: {m.status} ({m.sourceBindings.matched}/{m.sourceBindings.total} bindings)</div>
              ))}
          </div>

          <div className="progress-detail-section">
            <h4>Review</h4>
            <div><strong>Verdict:</strong> {detail.review.verdict}</div>
            {!detail.review.recorded && (
              <div className="progress-empty">Unknown: this receipt predates review verdicts and recorded none.</div>
            )}
          </div>

          <div className="progress-detail-section">
            <h4>Ledger</h4>
            <div><strong>Work key:</strong> {detail.ledger.workKey ? <code>{detail.ledger.workKey}</code> : 'none recorded'}</div>
            <div>
              <strong>Accepted:</strong>{' '}
              {detail.ledger.accepted === true ? 'yes' : detail.ledger.accepted === false ? 'no (remaining)' : 'unknown (not in tracked ledger)'}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface StopDialogProps {
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  inFlight: boolean;
}

function StopDialog({ onCancel, onConfirm, inFlight }: StopDialogProps) {
  const [reason, setReason] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = reason.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= 200 && !inFlight;

  const handleConfirm = () => {
    if (canSubmit) {
      onConfirm(trimmed);
    }
  };

  useFocusTrap(ref, onCancel, handleConfirm);

  useEffect(() => {
    queueMicrotask(() => textRef.current?.focus());
  }, []);

  return (
    <div className="modal-backdrop">
      <div
        className="modal progress-stop-dialog"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stop-dialog-title"
      >
        <h2 id="stop-dialog-title">Stop Execution</h2>
        <p>Stopping this execution is permanent. Please provide a reason (up to 200 characters):</p>
        <div className="progress-dialog-body">
          <label className="u-sr-only" htmlFor="stop-reason-input">Stop reason</label>
          <textarea
            id="stop-reason-input"
            ref={textRef}
            className="progress-stop-reason"
            aria-label="Stop reason"
            placeholder="Enter reason for stopping execution..."
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
            disabled={inFlight}
            rows={3}
          />
          <div className="progress-char-counter" aria-live="polite">
            {reason.length}/200
          </div>
        </div>
        <div className="modal__actions">
          <button
            type="button"
            className="button button--quiet"
            onClick={onCancel}
            disabled={inFlight}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={handleConfirm}
            disabled={!canSubmit}
          >
            {inFlight ? 'Stopping...' : 'Confirm Stop'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProgressPanel({ enabled }: { enabled: boolean }) {
  const containerRef = useRef<HTMLElement | null>(null);
  const { snapshot, loading, error, refresh } = useProgress(enabled);
  const [view, setView] = useState<'current' | 'history'>('current');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [controlInFlight, setControlInFlight] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const [showStopDialog, setShowStopDialog] = useState(false);
  const listScrollTop = useRef(0);
  const isCompact = useContainerCompact(containerRef, 900);

  const openRun = (id: string) => {
    listScrollTop.current = containerRef.current?.scrollTop ?? 0;
    setSelectedId(id);
  };
  const closeRun = () => setSelectedId(null);

  const liveControl = (snapshot?.control?.source.kind === 'live' && snapshot.control.state) ? snapshot.control.state : null;

  const handlePause = async () => {
    if (!liveControl || controlInFlight) return;
    setControlInFlight(true);
    setControlError(null);
    try {
      const res = await postControl('pause', {
        grantRef: liveControl.grantRef,
        expectedVersion: liveControl.grantVersion,
      });
      if (!res.ok) {
        setControlError(res.code || 'pause_failed');
      }
      await refresh();
    } catch (err: unknown) {
      setControlError(err instanceof Error ? err.message : String(err));
      await refresh();
    } finally {
      setControlInFlight(false);
    }
  };

  const handleStop = async (reason: string) => {
    if (!liveControl || controlInFlight) return;
    setControlInFlight(true);
    setControlError(null);
    try {
      const res = await postControl('stop', {
        grantRef: liveControl.grantRef,
        expectedVersion: liveControl.grantVersion,
        reason,
      });
      if (!res.ok) {
        setControlError(res.code || 'stop_failed');
      }
      setShowStopDialog(false);
      await refresh();
    } catch (err: unknown) {
      setControlError(err instanceof Error ? err.message : String(err));
      setShowStopDialog(false);
      await refresh();
    } finally {
      setControlInFlight(false);
    }
  };

  // The panel section is the single scroll owner for both list and detail.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    node.scrollTop = selectedId ? 0 : listScrollTop.current;
  }, [selectedId]);

  if (loading && !snapshot) {
    return (
      <section className="progress-panel progress-panel--loading" aria-label="Progress" ref={containerRef}>
        <p className="spin">Loading progress...</p>
      </section>
    );
  }

  if (error && !snapshot) {
    return (
      <section className="progress-panel progress-panel--error" aria-label="Progress" ref={containerRef}>
        <p className="panel-error">Failed to load progress: {error}</p>
        <button type="button" className="button button--quiet" onClick={() => void refresh()}>
          Retry
        </button>
      </section>
    );
  }

  if (!snapshot) {
    return (
      <section className="progress-panel" aria-label="Progress" ref={containerRef}>
        <p className="progress-empty">No progress snapshot available.</p>
      </section>
    );
  }

  const rows = view === 'current' ? snapshot.providers.current : snapshot.providers.history;
  const displayChecks = view === 'current'
    ? snapshot.checks.filter((m) => m.currentEvidence)
    : snapshot.checks;

  if (selectedId) {
    return (
      <section className="progress-panel" aria-label="Progress" ref={containerRef}>
        <RunDetailView id={selectedId} onBack={closeRun} />
      </section>
    );
  }

  return (
    <section className="progress-panel" aria-label="Progress" ref={containerRef}>
      {/* 1. Freshness strip */}
      <div className="progress-freshness" aria-live="polite" aria-atomic="true">
        <SourceBadge label="Collector" source={snapshot.sources.collector} />
        <SourceBadge label="Activity" source={snapshot.sources.activity} />
        {snapshot.sources.collector.kind === 'unavailable' && snapshot.sources.collector.errorClass && (
          <span className="progress-error-class">
            Collector error: {snapshot.sources.collector.errorClass}
          </span>
        )}
      </div>

      {/* 2. Scope line */}
      <div className="progress-scope">
        {snapshot.scope.explicit && snapshot.scope.scopeId ? (
          <>
            <span>Scope: <strong>{snapshot.scope.label || snapshot.scope.scopeId}</strong></span>
            {snapshot.scope.startedAt && <small>Started: {snapshot.scope.startedAt}</small>}
          </>
        ) : (
          <span className="progress-scope--empty">Scope not selected</span>
        )}
      </div>

      {/* 3. Coordinator card */}
      <div className="progress-coordinator-card">
        <div className="progress-coordinator-head">
          <h3>{snapshot.coordinator ? snapshot.coordinator.label : 'Coordinator'}</h3>
          {snapshot.coordinator?.provenance && (
            <SourceBadge label="Coordinator" source={snapshot.coordinator.provenance} />
          )}
          {snapshot.coordinator?.model && (
            <span className="progress-model-badge">Model: {snapshot.coordinator.model}</span>
          )}
          {snapshot.coordinator && (
            <span className="progress-note-badge">{snapshot.coordinator.note}</span>
          )}
        </div>
        {snapshot.coordinator ? (
          <div className="progress-coordinator-body">
            {snapshot.coordinator.nativeState && (
              <div><strong>State:</strong> {snapshot.coordinator.nativeState}</div>
            )}
            {snapshot.coordinator.work && (
              <div><strong>Work:</strong> {snapshot.coordinator.work}</div>
            )}
            {snapshot.coordinator.next && (
              <div><strong>Next:</strong> {snapshot.coordinator.next}</div>
            )}
            {snapshot.coordinator.internalThreadCount !== null && (
              <div><strong>Internal threads:</strong> {snapshot.coordinator.internalThreadCount}</div>
            )}
            {snapshot.coordinator.updatedAt && (
              <div><small>Updated: {snapshot.coordinator.updatedAt}</small></div>
            )}
          </div>
        ) : (
          <p className="empty-panel">No coordinator activity recorded.</p>
        )}
      </div>

      {/* Control strip under coordinator card */}
      {liveControl && (
        <div className="progress-control-strip">
          <div className="progress-control-actions">
            <button
              type="button"
              className="button button--quiet progress-control-btn progress-control-btn--pause"
              disabled={!liveControl.canPause || controlInFlight}
              onClick={() => void handlePause()}
            >
              Pause
            </button>
            <button
              type="button"
              className="button button--quiet progress-control-btn progress-control-btn--stop"
              disabled={!liveControl.canStop || controlInFlight}
              onClick={() => setShowStopDialog(true)}
            >
              Stop
            </button>
          </div>
          {liveControl.state === 'paused' && (
            <div className="progress-resume-notice">
              paused — resume from omp with <code>/execute resume {liveControl.activeWorkKey || '<key>'}</code>
            </div>
          )}
          {controlError && (
            <p className="progress-control-error" role="alert">
              Control error: {controlError}
            </p>
          )}
        </div>
      )}
      {showStopDialog && liveControl && (
        <StopDialog
          onCancel={() => setShowStopDialog(false)}
          onConfirm={(reason) => void handleStop(reason)}
          inFlight={controlInFlight}
        />
      )}

      {/* 4. Provider table with Current / History toggle */}
      <div className="progress-providers-section">
        <div className="progress-providers-header">
          <h3>External Provider Runs</h3>
          <div className="progress-toggle-group" role="group" aria-label="Provider history filter">
            <button
              type="button"
              className={`button ${view === 'current' ? 'button--primary is-active' : 'button--quiet'}`}
              aria-pressed={view === 'current'}
              onClick={() => setView('current')}
            >
              Current ({snapshot.providers.current.length})
            </button>
            <button
              type="button"
              className={`button ${view === 'history' ? 'button--primary is-active' : 'button--quiet'}`}
              aria-pressed={view === 'history'}
              onClick={() => setView('history')}
            >
              History ({snapshot.providers.history.length})
            </button>
          </div>
        </div>

        {snapshot.providers.truncated && (
          <p className="progress-truncated-notice">Provider list truncated (maximum row limit reached)</p>
        )}

        {rows.length === 0 ? (
          <p className="progress-empty">
            {view === 'current'
              ? 'No external provider activity in the current scope'
              : 'No historical provider activity'}
          </p>
        ) : isCompact ? (
          <div className="progress-cards progress-cards--stacked">
            {rows.map((row) => (
              <article key={row.id} className="progress-card" onClick={() => openRun(row.id)}>
                <div className="progress-card-head">
                  <button type="button" className="progress-row-action" aria-label={`Open run ${row.title || row.id}`}>
                    <strong>{row.provider}</strong>
                  </button>
                  <span className={`progress-badge progress-badge--${row.status}`}>
                    {row.status} ({row.liveness})
                  </span>
                </div>
                <div className="progress-card-meta">
                  <div><span>Role: </span>{row.role || row.title || row.id}</div>
                  <div>
                    <span>Requested model: </span><code>{row.requestedModel}</code>
                    {row.observedModel && (
                      <span> / Observed model: <code>{row.observedModel}</code></span>
                    )}
                  </div>
                  <div><span>Elapsed: </span>{formatElapsed(row.elapsedSeconds)}</div>
                  <div><span>Cost: </span>{formatCost(row.cost)} | <span>Tokens: </span>{formatTokens(row.cost)}</div>
                  <div><span>Review verdict: </span>{row.reviewVerdict}</div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="progress-table-wrap">
            <table className="progress-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Role / Title</th>
                  <th>Requested model</th>
                  <th>Observed model</th>
                  <th>Status</th>
                  <th>Liveness</th>
                  <th>Elapsed</th>
                  <th>Cost</th>
                  <th>Tokens</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} onClick={() => openRun(row.id)}>
                    <td>
                      <button type="button" className="progress-row-action" aria-label={`Open run ${row.title || row.id}`}>
                        <strong>{row.provider}</strong>
                      </button>
                    </td>
                    <td>{row.role || row.title || row.id}</td>
                    <td><code>{row.requestedModel}</code></td>
                    <td><code>{row.observedModel ?? '-'}</code></td>
                    <td>{row.status}</td>
                    <td>{row.liveness}</td>
                    <td>{formatElapsed(row.elapsedSeconds)}</td>
                    <td>{formatCost(row.cost)}</td>
                    <td>{formatTokens(row.cost)}</td>
                    <td>{row.reviewVerdict}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. Overall ledger counts */}
      <div className="progress-ledger">
        <h3>Tracked OMP ledger</h3>
        {snapshot.overall ? (
          <div className="progress-ledger-content">
            <div className="progress-ledger-stats">
              <span>Done: <strong>{snapshot.overall.done} / {snapshot.overall.total}</strong></span>
              <span>Expected: <strong>{snapshot.overall.expectedCount}</strong></span>
              {snapshot.overall.unknown > 0 && (
                <span>Unknown: <strong>{snapshot.overall.unknown}</strong></span>
              )}
              {snapshot.overall.lastLiveSuccessAt && (
                <small>Last success: {snapshot.overall.lastLiveSuccessAt}</small>
              )}
            </div>
            {snapshot.overall.byState && Object.keys(snapshot.overall.byState).length > 0 && (
              <div className="progress-ledger-states">
                {Object.entries(snapshot.overall.byState).map(([st, count]) => (
                  <span key={st} className="progress-state-pill">{st}: {count}</span>
                ))}
              </div>
            )}
            <div className="progress-ledger-source">
              <small>
                Source: {snapshot.overall.ledgerSource.kind}
                {snapshot.overall.ledgerSource.ageSeconds !== null && ` (${snapshot.overall.ledgerSource.ageSeconds}s)`}
              </small>
            </div>
          </div>
        ) : (
          <p className="empty-panel">Tracked OMP ledger unavailable</p>
        )}
      </div>

      {/* 6. Checks list */}
      <div className="progress-checks">
        <h3>Acceptance Checks ({view === 'current' ? 'Current' : 'All'})</h3>
        {displayChecks.length === 0 ? (
          <p className="progress-empty">
            {view === 'current'
              ? 'No current source-bound test result. Legacy checks are available under History.'
              : 'No check modules available.'}
          </p>
        ) : (
          displayChecks.map((module) => (
            <div key={module.id} className="progress-check-module">
              <div className="progress-check-head">
                <strong>{module.id}</strong>
                <span className={`progress-badge progress-badge--${module.status === 'PASS' ? 'live' : 'unavailable'}`}>
                  {module.status}
                </span>
                <span>Bindings: {module.sourceBindings.matched}/{module.sourceBindings.total} ({module.sourceBindings.state})</span>
                {module.reportAgeSeconds !== null && <span>Age: {module.reportAgeSeconds}s</span>}
                {module.note && <small>({module.note})</small>}
              </div>
              <details className="progress-check-details">
                <summary>Details ({module.checks.length} checks)</summary>
                {isCompact ? (
                  <div className="progress-check-cards">
                    {module.checks.map((check: CheckRow) => (
                      <article key={check.id} className="progress-check-card">
                        <div className="progress-check-card-head">
                          <code>{check.id}</code>
                          <span className={`progress-badge progress-badge--${check.status === 'PASS' ? 'live' : 'unavailable'}`}>
                            {check.status}
                          </span>
                        </div>
                        <div className="progress-check-card-meta">
                          <div><span>Hash state: </span>{check.hashState}</div>
                          <div><span>Exit code: </span>{check.recordedExitCode !== null ? check.recordedExitCode : '-'}</div>
                          <div><span>Executed tests: </span>{check.junit ? check.junit.executed : '-'}</div>
                          <div><span>Failures / Errors: </span>{check.junit ? `${check.junit.failures} / ${check.junit.errors}` : '-'}</div>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="progress-check-table-wrap">
                    <table className="progress-check-table">
                      <thead>
                        <tr>
                          <th>Check ID</th>
                          <th>Status</th>
                          <th>Hash state</th>
                          <th>Exit code</th>
                          <th>Executed tests</th>
                          <th>Failures / Errors</th>
                        </tr>
                      </thead>
                      <tbody>
                        {module.checks.map((check: CheckRow) => (
                          <tr key={check.id}>
                            <td><code>{check.id}</code></td>
                            <td>{check.status}</td>
                            <td>{check.hashState}</td>
                            <td>{check.recordedExitCode !== null ? check.recordedExitCode : '-'}</td>
                            <td>{check.junit ? check.junit.executed : '-'}</td>
                            <td>{check.junit ? `${check.junit.failures} / ${check.junit.errors}` : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </details>
            </div>
          ))
        )}
      </div>

      {/* 7. Summary */}
      <div className="progress-summary">
        <h3>Summary</h3>
        <div className="progress-summary-grid">
          <div className="progress-summary-col">
            <h4>Accepted ({snapshot.summary.accepted.length})</h4>
            {snapshot.summary.accepted.length > 0 ? (
              <ul>
                {snapshot.summary.accepted.map((item, idx) => (
                  <li key={idx}><code>{item}</code></li>
                ))}
              </ul>
            ) : (
              <p className="empty-panel">None</p>
            )}
          </div>
          <div className="progress-summary-col">
            <h4>Remaining ({snapshot.summary.remaining.length})</h4>
            {snapshot.summary.remaining.length > 0 ? (
              <ul>
                {snapshot.summary.remaining.map((item, idx) => (
                  <li key={idx}><code>{item}</code></li>
                ))}
              </ul>
            ) : (
              <p className="empty-panel">None</p>
            )}
          </div>
          <div className="progress-summary-col">
            <h4>Blockers ({snapshot.summary.blockers.length})</h4>
            {snapshot.summary.blockers.length > 0 ? (
              <ul>
                {snapshot.summary.blockers.map((item, idx) => (
                  <li key={idx}><strong>{item}</strong></li>
                ))}
              </ul>
            ) : (
              <p className="empty-panel">No blockers</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
