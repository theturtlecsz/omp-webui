import { MessageSquareText } from 'lucide-react';
import type { TranscriptItem } from '../../../daemon/src/protocol';

function firstLine(text: string): string {
  // Strip the hidden <file> transport blocks before showing a preview.
  const visible = text.replace(/<file\b[^>]*>[\s\S]*?<\/file>/g, '').trim();
  const line = visible.split('\n').find((l) => l.trim()) ?? '';
  return line.length > 80 ? line.slice(0, 79) + '…' : line;
}

/** Lists every user message in the conversation with click-to-jump, mirroring
 * pi-web-ui's questions nav bar. Anchors are data-msg-id on transcript items. */
export function QuestionsPanel({ items }: { items: TranscriptItem[] }) {
  const questions = items.filter((i) => i.kind === 'user' && i.text.trim());

  const jump = (id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('msg-flash');
    // Force reflow so re-clicking the same question replays the animation.
    void (el as HTMLElement).offsetWidth;
    el.classList.add('msg-flash');
  };

  return (
    <section className="panel" aria-label="Questions">
      <header><h2>Questions</h2></header>
      {questions.length === 0 && <p className="empty-panel">No questions yet — your messages appear here for quick navigation.</p>}
      <ol className="questions-list">
        {questions.map((q, i) => (
          <li key={q.id}>
            <button className="questions-list__entry" onClick={() => jump(q.id)}>
              <MessageSquareText size={14} />
              <span className="u-truncate">{firstLine(q.text) || '(attachment)'}</span>
              <small>#{i + 1}</small>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
