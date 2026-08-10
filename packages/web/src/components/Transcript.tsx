import { useEffect, useRef, useState } from 'react';
import { Copy, GitFork, LoaderCircle, WifiOff } from 'lucide-react';
import type { TranscriptItem } from '../../../daemon/src/protocol';
import type { ToolCard as Card, ConnectionState } from '../lib/types';
import type { DaemonClient } from '../lib/client';
import { ToolCard } from './ToolCard';

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
          ) : items.map((item) => {
            if (item.kind === 'tool' && item.toolCallId) {
              const card = cards[item.toolCallId];
              return card ? <li key={item.id}><ToolCard card={card} onFilePath={onFilePath} /></li> : null;
            }
            if (item.kind === 'assistant' && !item.text && !isStreaming) return null;
            const isUser = item.role === 'user';
            return (
              <li key={item.id}>
                <article className={`message message--${item.kind}`} aria-label={isUser ? 'You' : 'OMP'}>
                  <header>
                    <span className={`message__speaker ${isUser ? 'message__speaker--user' : ''}`}>{isUser ? 'You' : 'OMP'}</span>
                    {item.timestamp && <time dateTime={new Date(item.timestamp).toISOString()}>{new Date(item.timestamp).toLocaleTimeString()}</time>}
                    <span className="message__actions">
                      <button className="icon-button icon-button--small" aria-label={`Copy ${isUser ? 'your' : 'OMP'} message`} onClick={() => copyMessage(item.text)}><Copy size={14} /></button>
                      {session && <button className="icon-button icon-button--small" aria-label="Fork from message" onClick={() => client.command<{ sessionFile: string }>('session.fork', { sessionFile: session.sessionFile, entryId: item.id }, session.sessionId).then((response) => onFork?.(response.sessionFile)).catch(() => undefined)}><GitFork size={14} /></button>}
                    </span>
                  </header>
                  <div className="message__text">
                    {item.text || (item.kind === 'assistant' && isStreaming && <span className="streaming"><LoaderCircle size={14} className="spin" /> OMP is responding</span>)}
                  </div>
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
