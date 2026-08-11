import { useEffect, useRef, useState } from 'react';
import { Paperclip, Send, Settings2, Square, Waypoints, X } from 'lucide-react';
import type { DaemonClient } from '../lib/client';
import { attachmentId, fileForUpload, hasKnownNoImageInput, imageForPrompt, type PendingAttachment } from '../lib/attachments';
import { FileMention } from './FileMention';
import { ModelPickerDialog } from './ModelPickerDialog';

type Session = { sessionId: string; sessionFile: string };
type Model = { id: string; provider: string; name?: string; capabilities?: unknown; input?: unknown };
type Props = {
  session?: Session;
  workspaceId?: string;
  isStreaming: boolean;
  queuedPrompts: string[];
  model?: Model;
  thinkingLevel?: string;
  contextPercent?: number;
  client: DaemonClient;
  onDraft: (file: string, value: string) => void;
  attachments?: PendingAttachment[];
  onAttachments?: (attachments: PendingAttachment[]) => void;
  onSlashTrigger?: (initialQuery: string) => void;
  hasCommands?: boolean;
};

export function Composer({ session, workspaceId, isStreaming, queuedPrompts, model, thinkingLevel, contextPercent, client, onDraft, attachments = [], onAttachments = () => undefined, onSlashTrigger, hasCommands }: Props) {
  const key = session?.sessionFile;
  const [value, setValue] = useState(() => key ? localStorage.getItem(`omp-webui.draft.${key}`) ?? '' : '');
  const [mention, setMention] = useState('');
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => { setValue(key ? localStorage.getItem(`omp-webui.draft.${key}`) ?? '' : ''); }, [key]);
  const change = (next: string) => {
    setValue(next);
    if (key) { localStorage.setItem(`omp-webui.draft.${key}`, next); onDraft(key, next); }
    const at = next.slice(0, textRef.current?.selectionStart ?? next.length).match(/@([^\s@]*)$/);
    setMention(at?.[1] ?? '');
  };

  // Open the slash-command palette when the user starts a line with '/'.
  // Uses onKeyDown (not onChange) so it fires on the actual keystroke and does
  // not race with textarea composition (Chinese/Japanese IME).
  const maybeOpenPalette = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!onSlashTrigger || !hasCommands || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key !== '/') return;
    const el = textRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    // Only trigger when '/' is at the very start of the textarea (matches pi-web-ui behavior).
    const beforeCursor = el.value.slice(0, start);
    if (beforeCursor.trim().length === 0) {
      event.preventDefault();
      onSlashTrigger('');
    }
  };
  const submit = (mode: 'prompt.submit' | 'prompt.queue' | 'prompt.steer' = 'prompt.submit') => {
    if (!session || (!value.trim() && attachments.length === 0)) return;
    client.command(mode, {
      message: value,
      workspaceId,
      attachments: attachments.map((attachment) => ({ path: attachment.path, ...(attachment.range ? attachment.range : {}) })),
      images: attachments.flatMap((attachment) => attachment.image ? [{ data: attachment.image.data, mimeType: attachment.image.mimeType }] : []),
    }, session.sessionId).then(() => {
      if (mode === 'prompt.submit') { change(''); onAttachments([]); }
    }).catch((error: Error) => setUploadError(error.message));
  };

  const uploadFiles = async (files: File[]) => {
    if (!session || !workspaceId || !files.length) return;
    setUploadError('');
    try {
      const next: PendingAttachment[] = [];
      for (const original of files) {
        const image = original.type.startsWith('image/') ? await imageForPrompt(original) : undefined;
        const upload = image
          ? { data: image.data, mimeType: image.mimeType, size: image.size }
          : await fileForUpload(original);
        if (upload.size > 20 * 1024 * 1024) throw new Error(`${original.name} exceeds the 20 MB attachment limit.`);
        const stored = await client.command<{ path: string; name: string; size: number }>('file.upload', { workspaceId, name: original.name, data: upload.data }, session.sessionId);
        next.push({
          id: attachmentId(),
          name: stored.name || original.name,
          path: stored.path,
          size: stored.size,
          mimeType: upload.mimeType,
          ...(image ? { image: { data: image.data, mimeType: image.mimeType } } : {}),
        });
      }
      onAttachments([...attachments, ...next]);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Could not attach the selected file.');
    }
  };

  const warning = attachments.some((attachment) => attachment.image) && hasKnownNoImageInput(model);
  return <form className="composer" aria-label="Message composer" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void uploadFiles([...event.dataTransfer.files]); }} onSubmit={e => { e.preventDefault(); submit(); }}>
    <FileMention query={mention} workspaceId={workspaceId} client={client} onChoose={path => { const start = textRef.current?.selectionStart ?? value.length; change(`${value.slice(0, start).replace(/@[^\s@]*$/, '')}@${path}${value.slice(start)}`); setMention(''); textRef.current?.focus(); }} />
    {attachments.length > 0 && <div className="attachment-chips" aria-label="Attachments">{attachments.map((attachment) => <span className="attachment-chip" key={attachment.id}><span>{attachment.image ? 'Image' : 'File'}: {attachment.name}</span>{attachment.range && <small>lines {attachment.range.start}–{attachment.range.end}</small>}<button type="button" aria-label={`Remove ${attachment.name}`} onClick={() => onAttachments(attachments.filter((item) => item.id !== attachment.id))}><X size={13} /></button></span>)}</div>}
    {warning && <p className="composer__warning" role="status">This model is marked as not supporting image input. Your image will still be sent.</p>}
    {uploadError && <p className="composer__warning composer__warning--error" role="status">{uploadError}</p>}
    <label className="u-sr-only" htmlFor="composer-input">Message OMP</label>
    <textarea id="composer-input" ref={textRef} value={value} disabled={!session} placeholder={session ? 'Ask OMP to work on your project…' : 'Open a session to start'} onChange={e => change(e.target.value)} onPaste={event => { const files = [...event.clipboardData.files]; if (files.length) { event.preventDefault(); void uploadFiles(files); } }} onKeyDown={e => { maybeOpenPalette(e); if (e.defaultPrevented) return; if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
    <input ref={picker} className="u-sr-only" type="file" multiple onChange={(event) => { void uploadFiles([...((event.target as HTMLInputElement).files ?? [])]); event.currentTarget.value = ''; }} />
    {!session && <small className="composer__hint">Open a session to send a message.</small>}
    <div className="composer__bar"><button type="button" className="icon-button" aria-label="Attach file" disabled={!session} onClick={() => picker.current?.click()}><Paperclip size={17} /></button>
      <button type="button" className="model-chip" aria-label="Model and thinking level" disabled={!session} onClick={() => setModelPickerOpen(true)} title="Choose model and thinking level"><Settings2 size={14} /> {model?.name ?? model?.id ?? 'Model'} · {thinkingLevel ?? 'off'}</button>
      {modelPickerOpen && session && <ModelPickerDialog sessionId={session.sessionId} client={client} currentModel={model} thinkingLevel={thinkingLevel} onClose={() => setModelPickerOpen(false)} />}
      {contextPercent !== undefined && <span className="context-meter" title={`${contextPercent}% context`}><i style={{ width: `${Math.min(100, contextPercent)}%` }} /> {contextPercent}%</span>}<span className="composer__spacer" />
      {isStreaming ? <><button type="button" className="button button--quiet" onClick={() => submit('prompt.steer')}>Steer</button><button type="button" className="button button--quiet" onClick={() => submit('prompt.queue')}><Waypoints size={15} /> Queue</button><button type="button" className="button button--danger" onClick={() => session && client.command('prompt.abort', undefined, session.sessionId)}><Square size={14} /> Abort</button></> : <button className="button button--primary" disabled={!session || (!value.trim() && attachments.length === 0)}><Send size={15} /> Send</button>}
    </div>
    {queuedPrompts.length > 0 && <div className="queued-prompts">Queued: {queuedPrompts.map((p, i) => <span key={`${p}-${i}`}>{p}</span>)}</div>}
  </form>;
}
