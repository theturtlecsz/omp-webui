import type { ExtensionWidget as ExtensionWidgetPayload } from '../lib/types';

type Props = { widget?: ExtensionWidgetPayload };

/** Registry of known widgetKeys. omp emits opaque keys for the extension host;
 *  we render a small ambient badge for the widgets we recognize and a neutral
 *  fallback for unknowns so the user sees SOMETHING (rather than a silent no-op).
 *
 *  This is a first pass — real extension widgets can carry arbitrary payloads
 *  via subsequent `setWidgetProps` calls, which we don't yet forward. When we
 *  wire that through, this registry is where the richer renderers land.
 */
const REGISTRY: Record<string, { label: string; hint: string }> = {
  autoresearch: {
    label: 'Autoresearch',
    hint: 'omp autoresearch extension is active',
  },
};

export function ExtensionWidget({ widget }: Props) {
  if (!widget || widget.method !== 'setWidget') return null;
  const key = String(widget.widgetKey ?? '');
  const known = REGISTRY[key];
  const title = widget.title ? String(widget.title) : known?.label ?? key ?? 'Extension';
  const hint = known?.hint ?? (widget.text ? String(widget.text) : `Extension widget: ${key || 'unknown'}`);
  return (
    <div className="extension-widget" role="status" aria-label={`Extension widget ${title}`} data-widget-key={key}>
      <span className="extension-widget__dot" aria-hidden />
      <span className="extension-widget__title">{title}</span>
      <span className="extension-widget__hint">{hint}</span>
      {widget.url && (
        <a className="extension-widget__link" href={String(widget.url)} target="_blank" rel="noreferrer">Open</a>
      )}
    </div>
  );
}
