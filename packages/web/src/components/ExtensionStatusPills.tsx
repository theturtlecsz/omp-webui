type Props = { statuses: Record<string, string> };

/**
 * Renders `extension_ui_request { method: "setStatus", statusKey, statusText }` from omp.
 * omp uses this for ambient reminders (e.g. "context 87% used", "@remembered-file").
 * Each key gets its own pill; empty statusText removes the key (handled in reducer).
 */
export function ExtensionStatusPills({ statuses }: Props) {
  const entries = Object.entries(statuses).filter(([, text]) => text.length > 0);
  if (!entries.length) return null;
  return (
    <div className="extension-status-pills" role="status" aria-label="OMP status">
      {entries.map(([key, text]) => (
        <span key={key} className="extension-status-pill" title={`${key}: ${text}`}>{text}</span>
      ))}
    </div>
  );
}
