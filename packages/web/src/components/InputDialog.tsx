import { useEffect, useRef, useState } from 'react';
import type { PendingInteraction } from '../lib/types';
import { TimeoutCountdown, useFocusTrap } from './dialog-utils';

type Props = { interaction: PendingInteraction; onRespond: (value?: string, cancelled?: boolean) => void };

/**
 * Renders `extension_ui_request { method: "input", title, placeholder?, timeout? }`.
 * Single-line text field (submits on Enter, cancels on Escape).
 * Used for OAuth manual code entry, provider prompts, and similar.
 */
export function InputDialog({ interaction, onRespond }: Props) {
  const p = interaction.payload;
  const [value, setValue] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = () => onRespond(value);
  useFocusTrap(ref, () => onRespond(undefined, true), submit);
  useEffect(() => { queueMicrotask(() => inputRef.current?.focus()); }, []);

  return (
    <div className="modal-backdrop">
      <div className="modal" ref={ref} role="dialog" aria-modal="true" aria-labelledby="input-title">
        <h2 id="input-title">{String(p.title ?? 'OMP needs your input')}</h2>
        <TimeoutCountdown timeout={p.timeout} />
        <label className="u-sr-only" htmlFor="extension-input">{String(p.title ?? 'Answer')}</label>
        <input
          id="extension-input"
          ref={inputRef}
          type="text"
          className="input"
          value={value}
          placeholder={p.placeholder ? String(p.placeholder) : undefined}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submit(); } }}
          aria-label={String(p.title ?? 'Answer')}
        />
        <div className="modal__actions">
          <button className="button button--quiet" onClick={() => onRespond(undefined, true)}>Cancel</button>
          <button className="button button--primary" onClick={submit}>Submit</button>
        </div>
      </div>
    </div>
  );
}
