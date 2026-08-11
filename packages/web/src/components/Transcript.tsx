import { useEffect, useRef, useState } from 'react';
import { Copy, GitFork, LoaderCircle, Pencil, WifiOff } from 'lucide-react';
import type { TranscriptItem } from '../../../daemon/src/protocol';
import type { ToolCard as Card, ConnectionState } from '../lib/types';
import type { DaemonClient } from '../lib/client';
import { collapseTranscriptItems } from '../lib/transcript-collapse';
import { ToolCard } from './ToolCard';
import { ReaskEditor } from './ReaskEditor';
import { MarkdownMessage } from './MarkdownMessage';

type Props = {
  items: TranscriptItem[];
  cards: Record<string, Card>;
  connection: ConnectionState;
  session?: { sessionId: string; sessionFile: string };
  client: DaemonClient;
  hasWorkspace: boolean;
  isStreaming: boolean;
  onFork?: (sessionFile: string) => void;
  onFilePath: (path: string) => void;
  onOpenWorkspace: () => void;
};

export function Transcript({ items, cards, connection, session, client, hasWorkspace, isStreaming, onFork, onFilePath, onOpenWorkspace }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [copyNotice, setCopyNotice] = useState('');
  const [editing, setEditing] = useState<string>();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (pinned) scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
    else setUnseen((count) => count + 1);
  }, [items.length, items.at(-1)?.text, pinned]);

  const onScroll = () => {
    const node = scroller.current;
    if (!node) return;
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
    setPinned(atBottom);
    if (atBottom) setUnseen(0);
  };
  const jump = () => {
    scroller.current?.scrollTo({ top: scroller.current?.scrollHeight, behavior: 'smooth' });
    setPinned(true);
    setUnseen(0);
  };
  const copyMessage = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopyNotice('Message copied.');
  };
  const attachmentCards = (text: string) => {
    const cards: Array<{ path: string; range?: string; inline?: string }> = [];
    for (const match of text.matchAll(/<file\s+path="([^"]+)"(?:\s+lines="([^"]+)")?>([\s\S]*?)<\/file>/g)) {
      cards.push({ path: match[1], range: match[2], inline: match[3] });
    }
    for (const match of text.matchAll(/^File attachment:\s+(.+?)(?:\s+\(lines\s+(\d+-\d+)\))?$/gm)) {
      if (!cards.some((card) => card.path === match[1])) cards.push({ path: match[1], range: match[2] });
    }
    return cards;
  };
  const displayMessageText = (text: string, isUser: boolean) => {
    if (!isUser) return text;
    // File blocks are prompt transport, not prose the sender typed. Keep their
    // content inside the matching expandable attachment card so a 12 KiB
    // inline file never floods the user's transcript turn.
    return text
      .replace(/<file\s+path="[^"]+"(?:\s+lines="[^"]+")?>[\s\S]*?<\/file>\s*/g, '')
      .replace(/^File attachment:\s+.+(?:\n|$)/gm, '')
      .trim();
  };

  if (connection === 'offline') {
    return (
      <main className="transcript-state" aria-label="Conversation">
        <WifiOff size={32} aria-hidden="true" />
        <h1>Local agent is unavailable</h1>
        <p>Your draft is kept on this device. Reconnect to continue.</p>
      </main>
    );
  }

  return (
    <main className="transcript" aria-label="Conversation">
      <div className="connection-banner" hidden={connection === 'online'} role="status">
        {connection === 'reconnecting' ? 'Reconnecting to local agent…' : 'Connecting to local agent…'}
      </div>
      <div className="transcript__scroll u-scrollbar-stable" ref={scroller} onScroll={onScroll}>
        <ol>
          {items.length === 0 ? (
            <li className="empty-state">
              {hasWorkspace ? (
                <>
                  <p className="eyebrow">Ready when you are</p>
                  <h1>Start a task</h1>
                  <p>Describe the outcome you want. OMP can inspect files, make a focused change, or explain your codebase.</p>
                  <div className="empty-state__examples" aria-label="Example tasks">
                    <span>“Explain this project”</span><span>“Find the failing test”</span><span>“Review my changes”</span>
                  </div>
                </>
              ) : (
                <>
                  <p className="eyebrow">First step</p>
                  <h1>Open a workspace</h1>
                  <p>Choose the local folder where you want OMP to work, then create a session to start a task.</p>
                  <button className="button button--primary empty-state__action" onClick={onOpenWorkspace}>Open workspace path</button>
                </>
              )}
            </li>
          ) : collapseTranscriptItems(items, expanded).map((row) => {
            if (row.type === 'summary') {
              const { item, role, preview, blockCount } = row;
              return <li key={item.id}><button className="transcript-summary" onClick={() => setExpanded((open) => new Set(open).add(item.id))}>
                <span>{role}</span>
                <strong>{preview}</strong><small>{blockCount} {blockCount === 1 ? 'block' : 'blocks'} · Expand</small>
              </button></li>;
            }
            const { item } = row;
            if (item.kind === 'tool' && item.toolCallId) {
              const card = cards[item.toolCallId];
              return card ? <li key={item.id}><ToolCard card={card} onFilePath={onFilePath} /></li> : null;
            }
            if (item.kind === 'assistant' && !item.text && !isStreaming) return null;
            const isUser = item.role === 'user';
            const cardsForMessage = isUser ? attachmentCards(item.text) : [];
            const visibleText = displayMessageText(item.text, isUser);
            // Only the live tail is plain text. Historical assistant turns keep
            // their completed Markdown rendering while a later turn streams.
            const streamingText = item.kind === 'assistant' && isStreaming && item.id === items.at(-1)?.id;
            return (
              <li key={item.id} id={`msg-${item.id}`} data-msg-id={item.id}>
                <article className={`message message--${item.kind}`} aria-label={isUser ? 'You' : 'OMP'}>
                  <header>
                    <span className={`message__speaker ${isUser ? 'message__speaker--user' : ''}`}>{isUser ? 'You' : 'OMP'}</span>
                    {item.timestamp && <time dateTime={new Date(item.timestamp).toISOString()}>{new Date(item.timestamp).toLocaleTimeString()}</time>}
                    <span className="message__actions">
                      <button className="icon-button icon-button--small" aria-label={`Copy ${isUser ? 'your' : 'OMP'} message`} onClick={() => copyMessage(item.text)}><Copy size={14} /></button>
                      {session && <button className="icon-button icon-button--small" aria-label="Fork from message" onClick={() => client.command<{ sessionFile: string }>('session.fork', { sessionFile: session.sessionFile, entryId: item.id }, session.sessionId).then((response) => onFork?.(response.sessionFile)).catch(() => undefined)}><GitFork size={14} /></button>}
                      {isUser && session && <button className="icon-button icon-button--small" aria-label="Edit and re-ask" onClick={() => setEditing(item.id)}><Pencil size={14} /></button>}
                    </span>
                  </header>
                  {editing === item.id && session
                    ? <ReaskEditor session={session} entryId={item.entryId ?? item.id} initialMessage={item.text} client={client} onCancel={() => setEditing(undefined)} onSubmitted={(sessionFile) => { setEditing(undefined); onFork?.(sessionFile); }} />
                    : <><div className="message__text">{visibleText ? (streamingText ? visibleText : <MarkdownMessage>{visibleText}</MarkdownMessage>) : (item.kind === 'assistant' && isStreaming && <span className="streaming"><LoaderCircle size={14} className="spin" /> OMP is responding</span>)}</div>
                      {cardsForMessage.length > 0 && <div className="sent-attachments" aria-label="Sent attachments">{cardsForMessage.map((card, index) => <details key={`${card.path}-${index}`}><summary>{card.path}{card.range ? ` — lines ${card.range}` : ''}</summary>{card.inline && <pre><code>{card.inline.trim()}</code></pre>}</details>)}</div>}
                    </>}
                  {item.isError && <small className="message__outcome u-text-danger">Response stopped — partial content shown.</small>}
                </article>
              </li>
            );
          })}
        </ol>
      </div>
      {!pinned && <button className="jump-latest" onClick={jump}>Jump to latest{unseen ? ` — ${unseen} updates` : ''}</button>}
      <div className="u-sr-only" role="status" aria-live="polite" aria-atomic="true">{copyNotice}</div>
    </main>
  );
}
