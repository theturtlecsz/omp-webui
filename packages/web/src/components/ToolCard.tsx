import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, CircleX, Copy, LoaderCircle, XCircle } from 'lucide-react';
import { resolveToolRenderer, type ToolRenderState } from '../tool-render/registry';
import type { GenericToolModel } from '../tool-render/generic-model';
import type { ToolCard as Card } from '../lib/types';

const toRendererState = (state: Card['state']): ToolRenderState => state === 'success' ? 'completed' : state === 'failure' ? 'error' : state;
const elapsed = (started?: number, ended?: number) => started ? `${(((ended ?? Date.now()) - started) / 1000).toFixed(1)} s` : '';

export function ToolCard({ card, onFilePath }: { card: Card; onFilePath?: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [copyNotice, setCopyNotice] = useState('');
  useEffect(() => {
    if (card.state !== 'running') return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [card.state]);

  const model = resolveToolRenderer(card.toolName)({
    toolCallId: card.toolCallId,
    toolName: card.toolName,
    args: card.args,
    state: toRendererState(card.state),
    partialResult: card.partialResult,
    result: card.result,
    isError: card.isError,
    startedAt: card.startedAt,
    endedAt: card.endedAt,
  }) as GenericToolModel;
  const status = card.state === 'running' ? 'Running' : card.state === 'success' ? 'Succeeded' : card.state === 'failure' ? 'Failed' : 'Cancelled';
  const Icon = card.state === 'running' ? LoaderCircle : card.state === 'success' ? CheckCircle2 : card.state === 'failure' ? CircleX : XCircle;
  const paths = Object.values((card.args && typeof card.args === 'object' ? card.args : {}) as Record<string, unknown>)
    .filter((value): value is string => typeof value === 'string' && (value.includes('/') || value.includes('\\')));
  const summary = model.errorText ?? (model.displayText.split('\n')[0] || 'No output reported.');

  return (
    <article className={`tool-card tool-card--${card.state}`} aria-labelledby={`tool-${card.toolCallId}`}>
      <div className="tool-card__header">
        <span className="tool-card__icon" aria-hidden="true"><Icon size={17} className={card.state === 'running' ? 'spin' : undefined} /></span>
        <div className="tool-card__title">
          <h3 id={`tool-${card.toolCallId}`}>{card.toolName}</h3>
          <span className="tool-card__status">{status}</span>
        </div>
        <span className="tool-card__elapsed u-tabular-nums">{elapsed(card.startedAt, card.endedAt ?? now)}</span>
        <button className="icon-button icon-button--small" aria-expanded={open} aria-controls={`tool-detail-${card.toolCallId}`} aria-label={`${open ? 'Collapse' : 'Expand'} ${card.toolName} details`} onClick={() => setOpen((expanded) => !expanded)}><ChevronDown size={16} /></button>
      </div>
      <p className="tool-card__summary">{summary}</p>
      {paths.length > 0 && (
        <div className="tool-card__paths" aria-label="Affected paths">
          {paths.map((path) => <button key={path} aria-label={`Open ${path} in Files panel`} onClick={() => onFilePath?.(path)}><code>{path}</code></button>)}
        </div>
      )}
      {open && (
        <div id={`tool-detail-${card.toolCallId}`} className="tool-card__details">
          <div className="tool-card__actions">
            <button onClick={() => { navigator.clipboard?.writeText(model.displayText); setCopyNotice('Tool output copied.'); }}><Copy size={14} /> Copy output</button>
          </div>
          <h4>Arguments</h4>
          <pre><code>{model.prettyArgs}</code></pre>
          <h4>{model.errorText ? 'Error output' : 'Output'}</h4>
          <pre><code>{model.displayText || model.errorText || 'No output.'}</code></pre>
          <details>
            <summary>Raw JSON</summary>
            <pre><code>{model.rawJson}</code></pre>
          </details>
        </div>
      )}
      <div className="u-sr-only" role="status" aria-live="polite" aria-atomic="true">{copyNotice}</div>
    </article>
  );
}
