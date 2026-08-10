import { useEffect, useRef, useState } from 'react';
import { Send, X } from 'lucide-react';
import type { DaemonClient } from '../lib/client';

type Props = {
  session: { sessionId: string; sessionFile: string };
  entryId: string;
  initialMessage: string;
  client: DaemonClient;
  onCancel: () => void;
  onSubmitted: (sessionFile: string) => void;
};

export function ReaskEditor({ session, entryId, initialMessage, client, onCancel, onSubmitted }: Props) {
  const [message, setMessage] = useState(initialMessage);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => input.current?.focus(), []);

  const submit = async () => {
    if (!message.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await client.command<{ sessionFile: string }>('session.reask', {
        sessionFile: session.sessionFile, entryId, message,
      }, session.sessionId);
      onSubmitted(response.sessionFile);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create a fork.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="reask-editor" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label className="u-sr-only" htmlFor={`reask-${entryId}`}>Edit your message</label>
      <textarea
        ref={input}
        id={`reask-${entryId}`}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(); }
        }}
        disabled={submitting}
      />
      <div className="reask-editor__actions">
        <button type="button" className="button button--quiet" onClick={onCancel} disabled={submitting}><X size={14} /> Cancel</button>
        <button type="submit" className="button button--primary" disabled={!message.trim() || submitting}><Send size={14} /> {submitting ? 'Forking…' : 'Re-ask'}</button>
      </div>
      {error && <small className="message__outcome u-text-danger" role="alert">{error}</small>}
    </form>
  );
}
