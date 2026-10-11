import { useCallback, useEffect, useState } from 'react';
import { OctagonX, RefreshCw } from 'lucide-react';
import { daemonApiUrl } from '../lib/client';

type Decision = { decision_id: string; question: string; why_it_matters: string; options: string[]; default_if_any: string | null; evidence_refs: string[] };
type Mission = { mission_id: string; objective: string; status: string; revision: number; linkedWork: number; drawn: { usd: string; wall_clock_seconds: number } };
type Project = { projectId: string; key: string | null; name: string; missions: Mission[]; pendingDecisions: Decision[] };
export type OversightSnapshot = { stop: { stopped: boolean; reason: string | null; changedAt: string | null }; projects: Project[] };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(daemonApiUrl(path), init);
  const body = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `${path} failed with ${res.status}`);
  return body;
}

export function OversightPanel() {
  const [snapshot, setSnapshot] = useState<OversightSnapshot>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => call<OversightSnapshot>('/api/oversight').then((s) => { setSnapshot(s); setError(undefined); }).catch((e: Error) => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);

  const stop = async () => {
    // A stop halts every agent in the workspace, so confirm first.
    if (!window.confirm('Stop halts every agent in this workspace. Engage the stop?')) return;
    const reason = window.prompt('Reason for the stop (1-500 characters)')?.trim();
    if (!reason) return;
    try {
      await call('/api/oversight/stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason }) });
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  return <section className="panel" aria-label="Oversight">
    <header>
      <h2>Oversight</h2>
      <button className="icon-button" aria-label="Refresh oversight" onClick={() => void load()}><RefreshCw size={16} /></button>
      <button aria-label="Stop workspace" onClick={() => void stop()}><OctagonX size={16} /> Stop</button>
    </header>
    {error && <p role="alert" className="empty-panel">{error}</p>}
    {snapshot?.stop.stopped && <p role="status"><strong>Stopped</strong>: {snapshot.stop.reason} ({snapshot.stop.changedAt})</p>}
    {!snapshot && !error && <p className="empty-panel">Loading</p>}
    {snapshot?.projects.map((p) => <article key={p.projectId} aria-label={p.name}>
      <h3>{p.name}{p.key && <small> {p.key}</small>}</h3>
      <h4>Pending decisions</h4>
      {p.pendingDecisions.length === 0 ? <p className="empty-panel">None</p> : <ul>{p.pendingDecisions.map((d) => <li key={d.decision_id}>
        <strong>{d.question}</strong>
        <p>{d.why_it_matters}</p>
        <p>Options: {d.options.join(', ')}{d.default_if_any && <> (default {d.default_if_any})</>}</p>
        {d.evidence_refs.length > 0 && <p>Evidence: {d.evidence_refs.join(', ')}</p>}
      </li>)}</ul>}
      <h4>Missions</h4>
      {p.missions.length === 0 ? <p className="empty-panel">None</p> : <ul>{p.missions.map((m) => <li key={m.mission_id}>
        <strong>{m.objective}</strong> <small>{m.status} r{m.revision} · {m.linkedWork} linked · ${m.drawn.usd} / {m.drawn.wall_clock_seconds}s</small>
      </li>)}</ul>}
    </article>)}
  </section>;
}
