import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Pencil, Play, Plus, Save, SquareTerminal, Trash2, X } from 'lucide-react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import './TerminalPane.css';
import type { DaemonClient } from '../lib/client';

type ProjectCommand = { id: string; name: string; command: string; cwd?: string };
type Session = { localId: string; terminalId?: string; title: string; exited?: boolean };
type TerminalHandle = { terminal: XTerm; fit: FitAddon };

const localId = () => globalThis.crypto?.randomUUID?.() ?? `terminal-${Date.now()}-${Math.random()}`;

function terminalPayload(event: unknown): { terminalId?: string; data?: string; code?: number } {
  return (event && typeof event === 'object' ? (event as { payload?: unknown }).payload : undefined) as { terminalId?: string; data?: string; code?: number } ?? {};
}

function TerminalSurface({
  session,
  active,
  client,
  workspaceId,
  onStarted,
  onHandle,
}: {
  session: Session;
  active: boolean;
  client: DaemonClient;
  workspaceId?: string;
  onStarted: (localSessionId: string, terminalId: string) => void;
  onHandle: (terminalId: string, handle: TerminalHandle | undefined) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const created = useRef(false);
  const terminalId = useRef(session.terminalId);

  useEffect(() => {
    if (!element.current) return;
    const terminal = new XTerm({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      scrollback: 5_000,
      theme: { background: '#0b1220', foreground: '#d6e2f0', cursor: '#93c5fd' },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element.current);
    const resize = () => {
      try { fit.fit(); } catch { return; }
      if (terminalId.current) void client.command('terminal.resize', { workspaceId, terminalId: terminalId.current, cols: terminal.cols, rows: terminal.rows }).catch(() => undefined);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element.current);
    const input = terminal.onData((data) => {
      if (terminalId.current) void client.command('terminal.input', { workspaceId, terminalId: terminalId.current, data }).catch(() => undefined);
    });
    if (terminalId.current) {
      onHandle(terminalId.current, { terminal, fit });
      resize();
    } else if (workspaceId && !created.current) {
      created.current = true;
      void client.command<{ terminalId: string }>('terminal.create', { workspaceId, cols: terminal.cols, rows: terminal.rows })
        .then(({ terminalId: createdTerminalId }) => {
          terminalId.current = createdTerminalId;
          onHandle(createdTerminalId, { terminal, fit });
          onStarted(session.localId, createdTerminalId);
          void client.command('terminal.resize', { workspaceId, terminalId: createdTerminalId, cols: terminal.cols, rows: terminal.rows }).catch(() => undefined);
        })
        .catch((error) => terminal.writeln(`\r\nTerminal unavailable: ${error instanceof Error ? error.message : String(error)}`));
    } else if (!workspaceId) {
      terminal.writeln('\r\nOpen a workspace before starting a terminal.');
    }
    return () => {
      input.dispose();
      observer.disconnect();
      if (terminalId.current) onHandle(terminalId.current, undefined);
      terminal.dispose();
    };
  }, []);

  return <div className={`terminal-surface ${active ? 'is-active' : ''}`} aria-hidden={!active} ref={element} />;
}

function newCommand(): ProjectCommand {
  return { id: localId(), name: 'New command', command: '' };
}

export function TerminalPane({ workspaceId, workspaceRoot, client, visible = true }: { workspaceId?: string; workspaceRoot?: string; client: DaemonClient; visible?: boolean }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeLocalId, setActiveLocalId] = useState<string>();
  const [commands, setCommands] = useState<ProjectCommand[]>([]);
  const [editing, setEditing] = useState<ProjectCommand>();
  const [notice, setNotice] = useState('');
  const handles = useRef(new Map<string, TerminalHandle>());
  const active = sessions.find((session) => session.localId === activeLocalId);

  useEffect(() => {
    if (!visible || !workspaceId) { setCommands([]); return; }
    void client.command<{ commands?: ProjectCommand[] }>('terminal.commands', { workspaceId })
      .then(({ commands: loaded }) => setCommands(loaded ?? []))
      .catch((error) => setNotice(error instanceof Error ? error.message : 'Terminal commands are unavailable.'));
  }, [client, visible, workspaceId]);

  useEffect(() => {
    const off = client.onEvent((event) => {
      if (event.type !== 'terminal.output' && event.type !== 'terminal.exit') return;
      const payload = terminalPayload(event);
      if (!payload.terminalId) return;
      if (event.type === 'terminal.output' && typeof payload.data === 'string') handles.current.get(payload.terminalId)?.terminal.write(payload.data);
      if (event.type === 'terminal.exit') {
        handles.current.get(payload.terminalId)?.terminal.writeln(`\r\n[process exited${typeof payload.code === 'number' ? ` (${payload.code})` : ''}]`);
        setSessions((current) => current.map((session) => session.terminalId === payload.terminalId ? { ...session, exited: true } : session));
      }
    });
    return () => { off(); };
  }, [client]);

  const addShell = () => {
    const localSessionId = localId();
    setSessions((current) => [...current, { localId: localSessionId, title: `Shell ${current.length + 1}` }]);
    setActiveLocalId(localSessionId);
    setNotice('');
  };
  const onStarted = (localSessionId: string, terminalId: string) => {
    setSessions((current) => current.map((session) => session.localId === localSessionId ? { ...session, terminalId } : session));
  };
  const onHandle = (terminalId: string, handle: TerminalHandle | undefined) => {
    if (handle) handles.current.set(terminalId, handle);
    else handles.current.delete(terminalId);
  };
  const kill = (session: Session) => {
    if (session.terminalId) void client.command('terminal.kill', { workspaceId, terminalId: session.terminalId }).catch((error) => setNotice(error instanceof Error ? error.message : 'Could not close terminal.'));
    setSessions((current) => current.filter((item) => item.localId !== session.localId));
    if (activeLocalId === session.localId) setActiveLocalId(sessions.find((item) => item.localId !== session.localId)?.localId);
  };
  const persist = (next: ProjectCommand[]) => {
    if (!workspaceId) return;
    setCommands(next);
    void client.command<{ commands: ProjectCommand[] }>('terminal.commands', { workspaceId, commands: next })
      .then(({ commands: saved }) => setCommands(saved))
      .catch((error) => setNotice(error instanceof Error ? error.message : 'Could not save project commands.'));
  };
  const run = (command: ProjectCommand) => {
    if (!active?.terminalId) { setNotice('Open a shell before running a project command.'); return; }
    const text = command.command.replaceAll('${pwd}', workspaceRoot ?? '');
    void client.command('terminal.input', { workspaceId, terminalId: active.terminalId, data: `${text}\r` })
      .catch((error) => setNotice(error instanceof Error ? error.message : 'Could not run the command.'));
  };

  return (
    <section className={`terminal-pane ${visible ? '' : 'is-hidden'}`} aria-label="Terminal" aria-hidden={!visible}>
      <aside className="terminal-commands">
        <header><SquareTerminal size={17} /><strong>Project commands</strong><button className="icon-button icon-button--small" aria-label="Add project command" onClick={() => setEditing(newCommand())}><Plus size={16} /></button></header>
        {commands.length === 0 ? <p>No commands configured.</p> : <ul>
          {commands.map((command) => <li key={command.id}>
            <button className="terminal-command__run" onClick={() => run(command)} title={command.command}><Play size={14} />{command.name}</button>
            <button className="icon-button icon-button--small" aria-label={`Edit ${command.name}`} onClick={() => setEditing(command)}><Pencil size={14} /></button>
            <button className="icon-button icon-button--small" aria-label={`Delete ${command.name}`} onClick={() => persist(commands.filter((item) => item.id !== command.id))}><Trash2 size={14} /></button>
          </li>)}
        </ul>}
        {editing && <form className="terminal-command-editor" onSubmit={(event) => {
          event.preventDefault();
          const next = commands.some((command) => command.id === editing.id)
            ? commands.map((command) => command.id === editing.id ? editing : command)
            : [...commands, editing];
          persist(next);
          setEditing(undefined);
        }}>
          <input aria-label="Command name" value={editing.name} placeholder="Name" onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
          <textarea aria-label="Command text" value={editing.command} placeholder="npm test" onChange={(event) => setEditing({ ...editing, command: event.target.value })} />
          <div><button className="button button--quiet" type="button" onClick={() => setEditing(undefined)}>Cancel</button><button className="button button--primary" type="submit"><Save size={14} />Save</button></div>
        </form>}
        <p className="terminal-commands__hint">${'${pwd}'} expands to the workspace root.</p>
      </aside>
      <main className="terminal-workspace">
        {sessions.length === 0 && <div className="terminal-empty"><SquareTerminal size={28} /><h1>Open a terminal</h1><p>Shells are opt-in and run only inside the active workspace.</p><button className="button button--primary" disabled={!workspaceId} onClick={addShell}>Open shell</button></div>}
        {sessions.map((session) => <TerminalSurface key={session.localId} session={session} active={session.localId === activeLocalId} client={client} workspaceId={workspaceId} onStarted={onStarted} onHandle={onHandle} />)}
        {notice && <p className="terminal-notice" role="status">{notice}</p>}
      </main>
      <nav className="terminal-tabs" aria-label="Terminal tabs">
        <button className="icon-button icon-button--small" aria-label="New shell" disabled={!workspaceId} onClick={addShell}><Plus size={17} /></button>
        {sessions.map((session, index) => <div className={`terminal-tab ${session.localId === activeLocalId ? 'is-active' : ''}`} key={session.localId}>
          <button aria-label={`Open ${session.title}`} onClick={() => setActiveLocalId(session.localId)}><ChevronDown size={14} /><span>{index + 1}</span></button>
          <button aria-label={`Close ${session.title}`} onClick={() => kill(session)}><X size={14} /></button>
        </div>)}
      </nav>
    </section>
  );
}
