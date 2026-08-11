import { useEffect, useRef, useState } from 'react';
import type { PendingInteraction } from '../lib/types';
import { TimeoutCountdown, useFocusTrap } from './dialog-utils';

type Props = { interaction: PendingInteraction; onRespond: (value?: string, cancelled?: boolean) => void };

/**
 * Renders `extension_ui_request { method: "editor", title, prefill?, promptStyle? }`.
 *
 * Real omp schema (verified against @oh-my-pi/pi-coding-agent@17.2.12):
 *   - `prefill` seeds the textarea (previous QuestionDialog ignored it).
 *   - `promptStyle: true` means "treat like a prompt composer" (Enter to submit,
 *     Shift-Enter for newline). When absent/false it behaves like a plain
 *     multi-line editor: Ctrl/Cmd-Enter submits, Enter inserts a newline.
 */
export function EditorDialog({ interaction, onRespond }: Props) {
  const p = interaction.payload;
  const prefill = typeof p.prefill === 'string' ? (p.prefill as string) : '';
  const promptStyle = Boolean(p.promptStyle);
  const [value, setValue] = useState(prefill);
  const ref = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const submit = () => onRespond(value);
  useFocusTrap(ref, () => onRespond(undefined, true), submit);
  useEffect(() => {
    queueMicrotask(() => {
      const el = textRef.current;
      if (!el) return;
      el.focus();
      // Place caret at the end so the user can keep typing rather than overwrite prefill.
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (promptStyle) {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault(); submit();
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal modal--editor" ref={ref} role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <h2 id="editor-title">{String(p.title ?? 'OMP is asking you to edit text')}</h2>
        <TimeoutCountdown timeout={p.timeout} />
        <label className="u-sr-only" htmlFor="extension-editor">{String(p.title ?? 'Editor')}</label>
        <textarea
          id="extension-editor"
          ref={textRef}
          className="extension-editor__textarea"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          rows={12}
          spellCheck={false}
          aria-label={String(p.title ?? 'Editor')}
        />
        <small className="modal__hint">{promptStyle ? 'Enter to submit · Shift-Enter for newline · Esc to cancel' : 'Cmd/Ctrl-Enter to submit · Esc to cancel'}</small>
        <div className="modal__actions">
          <button className="button button--quiet" onClick={() => onRespond(undefined, true)}>Cancel</button>
          <button className="button button--primary" onClick={submit}>Submit</button>
        </div>
      </div>
    </div>
  );
}
