import type { TranscriptItem } from '../../../daemon/src/protocol';

export type TranscriptRenderRow =
  | { type: 'full'; item: TranscriptItem }
  | { type: 'summary'; item: TranscriptItem; role: string; preview: string; blockCount: number };

function summaryFor(item: TranscriptItem): Extract<TranscriptRenderRow, { type: 'summary' }> {
  const textBlocks = item.text.split(/\n\s*\n/).filter(Boolean).length;
  const blockCount = item.kind === 'tool'
    ? Math.max(1, Number(item.toolArgs !== undefined) + Number(item.toolResult !== undefined))
    : Math.max(1, textBlocks);
  return {
    type: 'summary',
    item,
    role: item.role === 'user' ? 'You' : item.kind === 'assistant' ? 'OMP' : item.toolName ?? 'Tool',
    preview: item.text.split(/\r?\n/, 1)[0] || (item.kind === 'tool' ? item.toolName ?? 'Tool activity' : 'No text'),
    blockCount,
  };
}

/**
 * This is a render selector, not transcript state: snapshots and replay retain every item.
 * Once a transcript has more than 30 messages, the latest 15 messages stay fully visible.
 */
export function collapseTranscriptItems(items: TranscriptItem[], expanded: ReadonlySet<string>): TranscriptRenderRow[] {
  const messages = items.filter((item) => item.kind !== 'tool');
  if (messages.length <= 30) return items.map((item) => ({ type: 'full', item }));
  const firstRetained = messages[messages.length - 15];
  const cutoff = items.indexOf(firstRetained);
  return items.map((item, index) =>
    index < cutoff && !expanded.has(item.id) ? summaryFor(item) : { type: 'full', item },
  );
}
