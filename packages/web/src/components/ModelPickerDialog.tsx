import { useEffect, useMemo, useRef, useState } from 'react';
import { Brain, Check, RefreshCw } from 'lucide-react';
import type { DaemonClient } from '../lib/client';
import { useFocusTrap } from './dialog-utils';

export type ModelInfo = {
  id: string;
  provider: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: unknown;
  cost?: { input?: number; output?: number };
};

/** Thinking levels omp's set_thinking_level accepts (pi-agent-core ThinkingLevel,
 *  minus "inherit" which is only meaningful inside agent config, not as a
 *  user-facing session override). Verified against omp 17.2.13 RPC. */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

type Props = {
  sessionId: string;
  client: DaemonClient;
  currentModel?: { provider: string; id: string };
  thinkingLevel?: string;
  onClose: () => void;
};

function fmtTokens(n?: number): string {
  if (!n) return '';
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/**
 * Model + thinking-level picker. Replaces the bare <select> pair with a
 * dialog that shows the metadata omp actually returns from
 * get_available_models (context window, reasoning support, cost) and the full
 * ThinkingLevel range. Cycle buttons mirror the pi TUI's cycle hotkeys.
 */
export function ModelPickerDialog({ sessionId, client, currentModel, thinkingLevel, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [error, setError] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let alive = true;
    client.command<{ models: ModelInfo[] }>('model.list', undefined, sessionId)
      .then(v => { if (alive) setModels(v.models ?? []); })
      .catch(e => { if (alive) { setModels([]); setError(e instanceof Error ? e.message : 'Could not load models'); } });
    return () => { alive = false; };
  }, [client, sessionId]);

  useFocusTrap(ref, onClose);

  const grouped = useMemo(() => {
    const byProvider = new Map<string, ModelInfo[]>();
    for (const m of models ?? []) {
      const list = byProvider.get(m.provider) ?? [];
      list.push(m);
      byProvider.set(m.provider, list);
    }
    return [...byProvider.entries()];
  }, [models]);

  const flat = useMemo(() => models ?? [], [models]);

  const selectModel = (m: ModelInfo) => {
    if (pending) return;
    setPending(true);
    client.command('model.set', { provider: m.provider, modelId: m.id }, sessionId)
      .catch(e => setError(e instanceof Error ? e.message : 'model.set failed'))
      .finally(() => setPending(false));
  };

  const setThinking = (level: string) => {
    if (pending) return;
    setPending(true);
    client.command('thinking.set', { level }, sessionId)
      .catch(e => setError(e instanceof Error ? e.message : 'thinking.set failed'))
      .finally(() => setPending(false));
  };

  const cycle = (kind: 'model.cycle' | 'thinking.cycle') => {
    if (pending) return;
    setPending(true);
    client.command(kind, undefined, sessionId)
      .catch(e => setError(e instanceof Error ? e.message : `${kind} failed`))
      .finally(() => setPending(false));
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (!flat.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => (i + 1) % flat.length); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => (i - 1 + flat.length) % flat.length); }
    if (e.key === 'Enter') { e.preventDefault(); selectModel(flat[activeIdx]); }
  };

  let rowIdx = -1;
  return <div className="modal-backdrop">
    <div className="modal model-picker" ref={ref} role="dialog" aria-modal="true" aria-labelledby="model-picker-title">
      <h2 id="model-picker-title">Model &amp; thinking</h2>
      {error && <p className="composer__warning composer__warning--error" role="alert">{error}</p>}

      <div className="model-picker__section">
        <div className="model-picker__section-head">
          <h3>Model</h3>
          <button type="button" className="button button--quiet" disabled={pending} onClick={() => cycle('model.cycle')} title="Cycle to next model (like the pi TUI hotkey)"><RefreshCw size={13} /> Cycle</button>
        </div>
        {models === null && <p role="status">Loading models…</p>}
        {models !== null && flat.length === 0 && !error && <p role="status">No models reported by omp.</p>}
        <div role="listbox" aria-label="Available models" aria-activedescendant="model-opt-active" tabIndex={0} onKeyDown={onListKey} className="model-picker__list">
          {grouped.map(([provider, list]) => (
            <div key={provider} className="model-picker__group">
              <div className="model-picker__provider">{provider}</div>
              {list.map(m => {
                rowIdx += 1;
                const idx = rowIdx;
                const current = currentModel?.provider === m.provider && currentModel?.id === m.id;
                return <div
                  key={`${m.provider}:${m.id}`}
                  id={idx === activeIdx ? 'model-opt-active' : undefined}
                  role="option"
                  aria-selected={current}
                  className={`model-picker__option${idx === activeIdx ? ' model-picker__option--active' : ''}${current ? ' model-picker__option--current' : ''}`}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => selectModel(m)}
                >
                  <span className="model-picker__name">{m.name ?? m.id}</span>
                  <span className="model-picker__meta">
                    {m.name && m.name !== m.id && <code>{m.id}</code>}
                    {m.contextWindow ? <span title="Context window">{fmtTokens(m.contextWindow)} ctx</span> : null}
                    {m.reasoning ? <span title="Supports reasoning"><Brain size={12} /></span> : null}
                    {m.cost && (m.cost.input || m.cost.output) ? <span title="Cost per 1M tokens (in/out)">${m.cost.input ?? 0}/${m.cost.output ?? 0}</span> : null}
                  </span>
                  {current && <Check size={14} aria-label="Current model" />}
                </div>;
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="model-picker__section">
        <div className="model-picker__section-head">
          <h3>Thinking level</h3>
          <button type="button" className="button button--quiet" disabled={pending} onClick={() => cycle('thinking.cycle')} title="Cycle thinking level (like the pi TUI hotkey)"><RefreshCw size={13} /> Cycle</button>
        </div>
        <div role="radiogroup" aria-label="Thinking level" className="model-picker__levels">
          {THINKING_LEVELS.map(level => {
            const active = (thinkingLevel ?? 'off') === level;
            return <button
              key={level}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={pending}
              className={`model-picker__level${active ? ' model-picker__level--active' : ''}`}
              onClick={() => setThinking(level)}
            >{level}</button>;
          })}
        </div>
      </div>

      <div className="modal__actions">
        <button type="button" className="button button--quiet" onClick={onClose}>Close</button>
      </div>
    </div>
  </div>;
}
