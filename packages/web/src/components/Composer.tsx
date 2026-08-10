import { useEffect, useRef, useState } from 'react';
import { Paperclip, Send, Square, Waypoints } from 'lucide-react';
import type { DaemonClient } from '../lib/client';
import { FileMention } from './FileMention';

type Session = { sessionId: string; sessionFile: string };
type Model = { id: string; provider: string; name?: string };
type Props = { session?: Session; workspaceId?: string; isStreaming: boolean; queuedPrompts: string[]; model?: Model; thinkingLevel?: string; contextPercent?: number; client: DaemonClient; onDraft: (file: string, value: string) => void };
export function Composer({ session, workspaceId, isStreaming, queuedPrompts, model, thinkingLevel, contextPercent, client, onDraft }: Props) {
  const key = session?.sessionFile;
  const [value, setValue] = useState(() => key ? localStorage.getItem(`omp-webui.draft.${key}`) ?? '' : '');
  const [mention, setMention] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setValue(key ? localStorage.getItem(`omp-webui.draft.${key}`) ?? '' : ''); }, [key]);
  useEffect(() => { if (session) client.command<{ models: Model[] }>('model.list', undefined, session.sessionId).then(v => setModels(v.models ?? [])).catch(() => setModels([])); }, [client, session]);
  const change = (next: string) => { setValue(next); if (key) { localStorage.setItem(`omp-webui.draft.${key}`, next); onDraft(key, next); } const at = next.slice(0, textRef.current?.selectionStart ?? next.length).match(/@([^\s@]*)$/); setMention(at?.[1] ?? ''); };
  const submit = (mode: 'prompt.submit' | 'prompt.queue' | 'prompt.steer' = 'prompt.submit') => { if (!session || !value.trim()) return; client.command(mode, { message: value }, session.sessionId).then(() => { if (mode === 'prompt.submit') change(''); }).catch(() => undefined); };
  const attach = async () => { if (!session || !workspaceId) return; const path = window.prompt('Path to attach'); if (!path) return; try { const file = await client.command<{ content?: string }>('file.read', { workspaceId, path }, session.sessionId); change(`${value}${value ? '\n\n' : ''}\`\`\`${path}\n${file.content ?? ''}\n\`\`\``); } catch { /* retained draft */ } };
  return <form className="composer" aria-label="Message composer" onSubmit={e => { e.preventDefault(); submit(); }}>
    <FileMention query={mention} workspaceId={workspaceId} client={client} onChoose={path => { const start = textRef.current?.selectionStart ?? value.length; change(`${value.slice(0, start).replace(/@[^\s@]*$/, '')}@${path}${value.slice(start)}`); setMention(''); textRef.current?.focus(); }} />
    <label className="u-sr-only" htmlFor="composer-input">Message OMP</label>
    <textarea id="composer-input" ref={textRef} value={value} disabled={!session} placeholder={session ? 'Ask OMP to work on your project…' : 'Open a session to start'} onChange={e => change(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
    {!session && <small className="composer__hint">Open a session to send a message.</small>}<div className="composer__bar"><button type="button" className="icon-button" aria-label="Attach file" disabled={!session} onClick={attach}><Paperclip size={17} /></button>
      <select aria-label="Model" disabled={!session} value={model ? `${model.provider}:${model.id}` : ''} onChange={e => { const [provider, modelId] = e.target.value.split(':'); if (session) client.command('model.set', { provider, modelId }, session.sessionId).catch(() => undefined); }}><option value="">{model?.name ?? model?.id ?? 'Model'}</option>{models.map(m => <option value={`${m.provider}:${m.id}`} key={`${m.provider}:${m.id}`}>{m.name ?? m.id}</option>)}</select>
      <select aria-label="Thinking level" disabled={!session} value={thinkingLevel ?? 'off'} onChange={e => { if (session) client.command('thinking.set', { level: e.target.value }, session.sessionId).catch(() => undefined); }}>{['off', 'minimal', 'low', 'medium', 'high'].map(v => <option key={v}>{v}</option>)}</select>
      {contextPercent !== undefined && <span className="context-meter" title={`${contextPercent}% context`}><i style={{ width: `${Math.min(100, contextPercent)}%` }} /> {contextPercent}%</span>}<span className="composer__spacer" />
      {isStreaming ? <><button type="button" className="button button--quiet" onClick={() => submit('prompt.steer')}>Steer</button><button type="button" className="button button--quiet" onClick={() => submit('prompt.queue')}><Waypoints size={15} /> Queue</button><button type="button" className="button button--danger" onClick={() => session && client.command('prompt.abort', undefined, session.sessionId)}><Square size={14} /> Abort</button></> : <button className="button button--primary" disabled={!session || !value.trim()}><Send size={15} /> Send</button>}
    </div>
    {queuedPrompts.length > 0 && <div className="queued-prompts">Queued: {queuedPrompts.map((p, i) => <span key={`${p}-${i}`}>{p}</span>)}</div>}
  </form>;
}
