import { useRef, useState } from 'react';
import type { PendingInteraction } from '../lib/types';
import { TimeoutCountdown, useFocusTrap } from './dialog-utils';

type Props = { interaction: PendingInteraction; onRespond: (value?: string, cancelled?: boolean) => void };

/**
 * Renders `extension_ui_request { method: "select", title, options[] }`.
 *
 * Real omp schema (verified against @oh-my-pi/pi-coding-agent@17.2.12):
 *   `options` is a plain `string[]`.
 * Prior implementation (QuestionDialog) also rendered a textarea alongside the
 * options, which was wrong for pure select (the user should only pick, not type
 * a free-form answer). This variant renders one button per option and cancel.
 */
export function SelectDialog({ interaction, onRespond }: Props) {
  const p = interaction.payload;
  const ref = useRef<HTMLDivElement>(null);
  const rawOptions: unknown[] = Array.isArray(p.options) ? (p.options as unknown[]) : [];
  const options = rawOptions.map((item) => {
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      const value = String(record.value ?? record.label ?? '');
      const label = String(record.label ?? record.value ?? value);
      return { value, label };
    }
    const stringified = String(item);
    return { value: stringified, label: stringified };
  }).filter((option) => option.value !== '');

  // Track a keyboard cursor so ArrowUp/ArrowDown navigate; Enter selects.
  const [cursor, setCursor] = useState(0);
  useFocusTrap(ref, () => onRespond(undefined, true), () => { const choice = options[cursor]; if (choice) onRespond(choice.value); });

  return (
    <div className="modal-backdrop">
      <div className="modal" ref={ref} role="dialog" aria-modal="true" aria-labelledby="select-title" onKeyDown={(event) => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setCursor((c) => Math.min(options.length - 1, c + 1)); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
      }}>
        <h2 id="select-title">{String(p.title ?? 'OMP needs a choice')}</h2>
        <TimeoutCountdown timeout={p.timeout} />
        <div className="question-options" role="listbox" aria-label="Choices">
          {options.map((option, index) => (
            <button
              key={option.value}
              role="option"
              aria-selected={index === cursor}
              className={`button ${index === cursor ? 'button--primary' : 'button--quiet'}`}
              onMouseEnter={() => setCursor(index)}
              onClick={() => onRespond(option.value)}
            >{option.label}</button>
          ))}
        </div>
        <div className="modal__actions">
          <button className="button button--quiet" onClick={() => onRespond(undefined, true)}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
