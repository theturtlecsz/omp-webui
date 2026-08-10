import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { AttachmentRange } from '../lib/attachments';
import { useFocusTrap } from './dialog-utils';

type Preview = { path: string; content: string; truncated?: boolean; binary?: boolean; lineCount?: number };

export function FilePreviewDialog({
  preview,
  onClose,
  onAdd,
}: {
  preview: Preview;
  onClose: () => void;
  onAdd: (range?: AttachmentRange) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<AttachmentRange>();
  const anchor = useRef<number | undefined>(undefined);
  const dragging = useRef(false);
  const lines = preview.content.split('\n');
  useFocusTrap(ref, onClose);

  useEffect(() => {
    const up = () => { dragging.current = false; };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const select = (line: number, extend = false) => {
    const start = extend ? (anchor.current ?? range?.start ?? line) : line;
    anchor.current = start;
    setRange({ start: Math.min(start, line), end: Math.max(start, line) });
  };

  if (preview.binary) {
    return (
      <div className="modal-backdrop">
        <div className="modal" ref={ref} role="dialog" aria-modal="true" aria-labelledby="file-preview-title">
          <header className="file-modal__header"><h2 id="file-preview-title">{preview.path}</h2><button className="icon-button" aria-label="Close file preview" onClick={onClose}><X size={18} /></button></header>
          <p>This binary file cannot be previewed. You can still attach its path.</p>
          <div className="modal__actions"><button className="button button--quiet" onClick={onClose}>Cancel</button><button className="button button--primary" onClick={() => onAdd()}>Add to conversation</button></div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop">
      <div className="modal file-preview-modal" ref={ref} role="dialog" aria-modal="true" aria-labelledby="file-preview-title">
        <header className="file-modal__header"><div><h2 id="file-preview-title">{preview.path}</h2><p>{preview.truncated ? 'Preview limited to 512 KB.' : `${preview.lineCount ?? lines.length} lines`}</p></div><button className="icon-button" aria-label="Close file preview" onClick={onClose}><X size={18} /></button></header>
        <p id="file-preview-help" className="file-preview-modal__help">Click and drag to select lines. Shift-click extends the selection.</p>
        <div className="file-lines" role="listbox" aria-label={`${preview.path} lines`} aria-describedby="file-preview-help">
          {lines.map((text, index) => {
            const number = index + 1;
            const selected = Boolean(range && number >= range.start && number <= range.end);
            return <button
              type="button"
              key={number}
              role="option"
              aria-selected={selected}
              className={selected ? 'is-selected' : undefined}
              onMouseDown={(event) => { event.preventDefault(); dragging.current = true; select(number, event.shiftKey); }}
              onMouseEnter={() => { if (dragging.current) select(number, true); }}
              onClick={(event) => select(number, event.shiftKey)}
            ><span aria-hidden="true">{number}</span><code>{text || ' '}</code></button>;
          })}
        </div>
        <div className="modal__actions"><button className="button button--quiet" onClick={onClose}>Cancel</button><button className="button button--primary" onClick={() => onAdd(range)}>Add to conversation{range ? ` (lines ${range.start}–${range.end})` : ''}</button></div>
      </div>
    </div>
  );
}
