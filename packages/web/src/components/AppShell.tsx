import { useEffect, useRef, useState } from 'react';
import { Menu, MessageSquareText, PanelRightOpen, Plus, SquareTerminal, X } from 'lucide-react';
import type { SessionSummary } from '../../../daemon/src/protocol';
import { daemonClient, daemonHealthUrl } from '../lib/client';
import { useAppStore } from '../lib/store';
import { Sidebar } from './Sidebar';
import { Transcript } from './Transcript';
import { Composer } from './Composer';
import { GitPanel } from './GitPanel';
import { PlanPanel } from './PlanPanel';
import { StatusBar } from './StatusBar';
import { ApprovalDialog } from './ApprovalDialog';
import { SelectDialog } from './SelectDialog';
import { InputDialog } from './InputDialog';
import { EditorDialog } from './EditorDialog';
import { useOverlayFocus } from './dialog-utils';
import { TerminalPane } from './TerminalPane';
import { attachmentId, type AttachmentRange, type PendingAttachment } from '../lib/attachments';
import { FilePreviewDialog } from './FilePreviewDialog';
import { SlashCommandPalette } from './SlashCommandPalette';
import { ExtensionWidget } from './ExtensionWidget';
import { NotifyToast } from './NotifyToast';
import { OpenUrlDialog } from './OpenUrlDialog';
import { ExtensionStatusPills } from './ExtensionStatusPills';

type FilePreview = { path: string; content: string; truncated?: boolean; binary?: boolean; lineCount?: number };

function readSavedWorkspace(): { root: string } | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem('omp-webui.lastWorkspace') ?? '{}') as { root?: unknown };
    return typeof saved.root === 'string' && saved.root ? { root: saved.root } : undefined;
  } catch {
    return undefined;
  }
}

function FilesPanel({ workspaceId, initialPath, onAdd }: { workspaceId?: string; initialPath?: string; onAdd: (path: string, range?: AttachmentRange) => void }) {
  const [path, setPath] = useState(initialPath ?? '');
  const [preview, setPreview] = useState<FilePreview>();
  const [matches, setMatches] = useState<string[]>([]);

  useEffect(() => setPath(initialPath ?? ''), [initialPath]);

  useEffect(() => {
    if (!workspaceId || !path.trim()) {
      setMatches([]);
      return;
    }
    let active = true;
    daemonClient.command<{ files: string[] }>('file.search', { workspaceId, query: path.trim() })
      .then((value) => { if (active) setMatches((value.files ?? []).slice(0, 20)); })
      .catch(() => { if (active) setMatches([]); });
    return () => { active = false; };
  }, [workspaceId, path]);

  const read = (target = path) => workspaceId && target.trim() && daemonClient.command<FilePreview>('file.read', { workspaceId, path: target })
    .then((value) => {
      setPath(target);
      setPreview(value);
    })
    .catch(() => setPreview({ path: target, content: 'Could not read this file.' }));

  return (
    <section className="panel" aria-label="Files">
      <header><h2>Files</h2></header>
      <div className="file-preview__input">
        <input aria-label="File path" value={path} onChange={(event) => setPath(event.target.value)} placeholder="src/app.ts" />
        <button className="button button--quiet" onClick={() => void read()}>Open</button>
      </div>
      {path && <div className="file-preview__row"><button className="file-preview__entry" onClick={() => read()}><code>{path}</code><span>Preview and choose lines</span></button><button type="button" className="icon-button" aria-label={`Add ${path} to conversation`} title="Add file to conversation" onClick={() => onAdd(path)}><Plus size={16} /></button></div>}
      {matches.length > 0 && <ul className="file-preview__matches" aria-label="Matching files">{matches.map((match) => <li key={match}><div className="file-preview__row"><button className="file-preview__entry" onClick={() => read(match)}><code>{match}</code><span>Preview and choose lines</span></button><button type="button" className="icon-button" aria-label={`Add ${match} to conversation`} title="Add file to conversation" onClick={() => onAdd(match)}><Plus size={16} /></button></div></li>)}</ul>}
      {!path && <p className="empty-panel">Enter a workspace path to preview it.</p>}
      {preview && <FilePreviewDialog preview={preview} onClose={() => setPreview(undefined)} onAdd={(range) => { onAdd(preview.path, range); setPreview(undefined); }} />}
    </section>
  );
}

export function AppShell() {
  const state = useAppStore();
  const { setConnection, applyEvent, setWorkspaces, setSessions, setActiveSession, setDraft, removeInteraction, dismissNotification, clearOpenUrl, clearEditorText } = useAppStore();
  const [sidebar, setSidebar] = useState(() => typeof window === 'undefined' || window.innerWidth >= 900);
  const [drawer, setDrawer] = useState(false);
  const [tab, setTab] = useState<'files' | 'git' | 'plan'>('files');
  const [file, setFile] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [daemonVersion, setDaemonVersion] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [surface, setSurface] = useState<'chat' | 'terminal'>('chat');
  const [palette, setPalette] = useState<{ open: boolean; query: string }>({ open: false, query: '' });
  const drawerTrigger = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const wasStreaming = useRef(false);
  const workspace = state.workspaces.find((item) => item.id === state.activeWorkspaceId);
  const active = state.activeSession;
  const pending = state.pendingInteractions[0];
  const model = state.sessionState.model;
  const loadSessions = (workspaceId?: string) => daemonClient.command<{ sessions: SessionSummary[] }>('session.list', { workspaceId })
    .then((response) => setSessions(response.sessions ?? []))
    .catch(() => setSessions([]));

  const openSession = (sessionFile: string, workspaceId?: string) => {
    // Workspace selection and "New session" can occur in the same React event
    // turn. Read the store for the default so this call cannot retain the
    // previous render's workspace id and silently leave the new session inactive.
    const activeWorkspaceId = workspaceId ?? useAppStore.getState().activeWorkspaceId;
    if (!activeWorkspaceId) return;
    daemonClient.command<{ sessionId: string; sessionFile: string }>('session.open', { workspaceId: activeWorkspaceId, sessionFile })
        .then(async (response) => {
        const session = { sessionId: response.sessionId, sessionFile: response.sessionFile };
        setActiveSession(session);
        localStorage.setItem('omp-webui.activeSession', JSON.stringify({ workspaceId: activeWorkspaceId, sessionFile: response.sessionFile }));
        const selectedWorkspace = useAppStore.getState().workspaces.find((item) => item.id === activeWorkspaceId);
        if (selectedWorkspace) localStorage.setItem('omp-webui.lastWorkspace', JSON.stringify({ root: selectedWorkspace.root }));
        void loadSessions(activeWorkspaceId);
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    let hydrated = false;
    const hydrate = () => {
      if (hydrated) return;
      hydrated = true;
      daemonClient.command<{ workspaces: typeof state.workspaces }>('workspace.list')
        .then(async (response) => {
          const workspaces = response.workspaces ?? [];
          let availableWorkspaces = workspaces;
          const savedWorkspace = readSavedWorkspace();
          let restoredWorkspace = savedWorkspace && availableWorkspaces.find((item) => item.root === savedWorkspace.root);
          if (!restoredWorkspace && savedWorkspace?.root) {
            try {
              const restored = await daemonClient.command<{ workspace: typeof state.workspaces[number] }>('workspace.open', { root: savedWorkspace.root });
              restoredWorkspace = restored.workspace;
              availableWorkspaces = [restored.workspace, ...availableWorkspaces.filter((item) => item.id !== restored.workspace.id)];
            } catch {
              // The remembered directory may no longer exist or be permitted.
            }
          }
          setWorkspaces(availableWorkspaces);
          if (restoredWorkspace) {
            useAppStore.setState({ activeWorkspaceId: restoredWorkspace.id });
            void loadSessions(restoredWorkspace.id);
          }
          const saved = localStorage.getItem('omp-webui.activeSession');
          if (!saved) return;
          try {
            const { workspaceId, sessionFile } = JSON.parse(saved) as { workspaceId?: string; sessionFile?: string };
            const matchingWorkspace = availableWorkspaces.find((item) => item.id === workspaceId)
              ?? restoredWorkspace;
            if (sessionFile && matchingWorkspace) {
              useAppStore.setState({ activeWorkspaceId: matchingWorkspace.id });
              void loadSessions(matchingWorkspace.id);
              openSession(sessionFile, matchingWorkspace.id);
            }
          } catch {
            // Ignore a malformed local preference.
          }
        })
        .catch(() => { hydrated = false; });
    };
    const offEvent = daemonClient.onEvent((event) => applyEvent(event as never));
    const offState = daemonClient.onState((connection) => {
      setConnection(connection);
      if (connection === 'online') hydrate();
    });
    daemonClient.connect();
    if (daemonClient.connectionState === 'online') hydrate();
    return () => {
      offEvent();
      offState();
      daemonClient.disconnect();
    };
  }, []);

  useEffect(() => {
    if (state.connection !== 'online') return;
    let activeRequest = true;
    fetch(daemonHealthUrl()).then((response) => response.ok ? response.json() as Promise<{ version?: unknown }> : null)
      .then((health) => { if (activeRequest && typeof health?.version === 'string') setDaemonVersion(health.version); })
      .catch(() => undefined);
    return () => { activeRequest = false; };
  }, [state.connection]);

  useEffect(() => {
    if (!state.activeSession) return;
    daemonClient.setActiveSession(state.activeSession);
    daemonClient.command('connection.resume', {
      sessionId: state.activeSession.sessionId,
      afterSequence: state.lastSequences[state.activeSession.sessionId] ?? 0,
    }, state.activeSession.sessionId).catch(() => undefined);
  }, [state.activeSession?.sessionId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setSidebar((open) => !open);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        // With an active session and a command catalog, cmd/ctrl-K opens the slash palette.
        // Without either, fall back to the sidebar session search — preserves prior behavior.
        const store = useAppStore.getState();
        if (store.activeSession && (store.sessionState.availableCommands?.length ?? 0) > 0) {
          setPalette({ open: true, query: '' });
        } else {
          document.querySelector<HTMLInputElement>('[aria-label="Search sessions"]')?.focus();
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        document.querySelector<HTMLButtonElement>('.sidebar__new')?.click();
      }
      if (event.key === 'Escape' && !pending) {
        setDrawer(false);
        setSidebar(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending]);

  useEffect(() => {
    if (state.sessionState.isStreaming && !wasStreaming.current) setAnnouncement('OMP is responding.');
    if (!state.sessionState.isStreaming && wasStreaming.current) setAnnouncement('Response complete.');
    wasStreaming.current = state.sessionState.isStreaming;
  }, [state.sessionState.isStreaming]);

  // Reflect omp setTitle into the browser tab title. Only fires when omp is
  // started with PI_RPC_EMIT_TITLE set (real behavior gated in cli.js).
  useEffect(() => {
    const title = state.sessionState.extensionTitle;
    if (typeof title !== 'string' || !title) return;
    const previous = document.title;
    document.title = `${title} — OMP WebUI`;
    return () => { document.title = previous; };
  }, [state.sessionState.extensionTitle]);

  // Apply omp set_editor_text into the composer textarea. omp uses this for
  // things like the "/edit last" flow. Fires the same input event as the slash
  // palette so React state stays in sync, then clears the one-shot request.
  useEffect(() => {
    const text = state.sessionState.extensionEditorText;
    if (typeof text !== 'string') return;
    const el = document.getElementById('composer-input') as HTMLTextAreaElement | null;
    if (el) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.focus();
      el.setSelectionRange(text.length, text.length);
    }
    clearEditorText();
  }, [state.sessionState.extensionEditorText, clearEditorText]);

  const closeDrawer = () => {
    setDrawer(false);
    if (window.innerWidth < 1280) requestAnimationFrame(() => drawerTrigger.current?.focus());
  };
  useOverlayFocus(drawerRef, drawer && !pending, closeDrawer);

  const changeWorkspace = (nextWorkspace: (typeof state.workspaces)[number]) => {
    const current = useAppStore.getState().workspaces;
    useAppStore.setState({
      activeWorkspaceId: nextWorkspace.id,
      workspaces: current.some((item) => item.id === nextWorkspace.id) ? current : [nextWorkspace, ...current],
    });
    localStorage.setItem('omp-webui.lastWorkspace', JSON.stringify({ root: nextWorkspace.root }));
    void loadSessions(nextWorkspace.id);
  };

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs: Array<'files' | 'git' | 'plan'> = ['files', 'git', 'plan'];
    const currentIndex = tabs.indexOf(tab);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    setTab(next);
    document.getElementById(`workspace-tab-${next}`)?.focus();
  };

  return (
    <div className={`app-shell ${sidebar ? 'sidebar-open' : ''} ${drawer ? 'drawer-open' : ''}`}>
      <a className="u-sr-only u-sr-only-focusable" href="#conversation">Skip to conversation</a>
      <Sidebar
        open={sidebar}
        workspaces={state.workspaces}
        sessions={state.sessions}
        activeSessionId={active?.sessionId}
        workspaceId={state.activeWorkspaceId}
        client={daemonClient}
        onWorkspace={changeWorkspace}
        onSessions={setSessions}
        onOpen={(session) => openSession(session.sessionFile)}
        onClose={() => setSidebar(false)}
      />
      <section className="main-column">
        <header className="main-header">
          <button className="icon-button" aria-label="Toggle sessions" onClick={() => setSidebar((open) => !open)}><Menu size={19} /></button>
          <div>
            <strong>{state.sessions.find((item) => item.sessionId === active?.sessionId)?.title ?? 'OMP'}</strong>
            <span>{workspace?.root ?? 'Open a workspace to begin'}</span>
          </div>
          <div className="surface-toggle" role="group" aria-label="Main view">
            <button className={surface === 'chat' ? 'is-active' : ''} aria-pressed={surface === 'chat'} onClick={() => setSurface('chat')}><MessageSquareText size={15} />Chat</button>
            <button className={surface === 'terminal' ? 'is-active' : ''} aria-pressed={surface === 'terminal'} onClick={() => setSurface('terminal')}><SquareTerminal size={16} />Terminal</button>
          </div>
          <button ref={drawerTrigger} className="icon-button" aria-label="Toggle workspace drawer" aria-expanded={drawer} onClick={() => setDrawer((open) => !open)}><PanelRightOpen size={19} /></button>
        </header>
        <div className="main-surface">
          <TerminalPane workspaceId={state.activeWorkspaceId} workspaceRoot={workspace?.root} client={daemonClient} visible={surface === 'terminal'} />
          <div id="conversation" className={`conversation ${surface === 'chat' ? '' : 'is-hidden'}`}>
          <ExtensionStatusPills statuses={state.sessionState.extensionStatus ?? {}} />
          <ExtensionWidget widget={state.sessionState.extensionUI} />
          <Transcript
            items={state.transcript}
            cards={state.toolCards}
            connection={state.connection}
            session={active}
            client={daemonClient}
            hasWorkspace={Boolean(workspace)}
            isStreaming={state.sessionState.isStreaming}
            onFork={(sessionFile) => openSession(sessionFile)}
            onOpenWorkspace={() => {
              setSidebar(true);
              requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="Open workspace by path"]')?.focus());
            }}
            onFilePath={(path) => {
              setFile(path);
              setTab('files');
              setDrawer(true);
            }}
          />
          <Composer
            session={active}
            workspaceId={state.activeWorkspaceId}
            isStreaming={state.sessionState.isStreaming}
            queuedPrompts={state.queuedPrompts}
            model={model}
            thinkingLevel={state.sessionState.thinkingLevel}
            contextPercent={state.sessionState.contextUsage?.percent}
            client={daemonClient}
            onDraft={setDraft}
            attachments={attachments}
            onAttachments={setAttachments}
            onSlashTrigger={(query) => setPalette({ open: true, query })}
            hasCommands={(state.sessionState.availableCommands?.length ?? 0) > 0}
          />
          </div>
        </div>
        <StatusBar
          connection={state.connection}
          worker={state.sessionState.workerState}
          model={model?.id}
          thinking={state.sessionState.thinkingLevel}
          context={state.sessionState.contextUsage?.percent}
          tokensPerSecond={state.sessionState.tokensPerSecond}
          version={daemonVersion}
        />
      </section>
      <aside
        className="drawer"
        ref={drawerRef}
        aria-label="Workspace"
        aria-modal={drawer && window.innerWidth < 1280 ? true : undefined}
        role={drawer && window.innerWidth < 1280 ? 'dialog' : undefined}
        inert={!drawer && window.innerWidth < 1280 ? true : undefined}
      >
        <header>
          <div role="tablist" aria-label="Workspace panels" onKeyDown={onTabKeyDown}>
            {(['files', 'git', 'plan'] as const).map((item) => (
              <button
                id={`workspace-tab-${item}`}
                key={item}
                role="tab"
                aria-selected={tab === item}
                aria-controls={`workspace-panel-${item}`}
                tabIndex={tab === item ? 0 : -1}
                onClick={() => setTab(item)}
              >
                {item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
          <button className="icon-button" aria-label="Close workspace drawer" onClick={closeDrawer}><X size={18} /></button>
        </header>
        <div id={`workspace-panel-${tab}`} role="tabpanel" aria-labelledby={`workspace-tab-${tab}`}>
          {tab === 'files' && <FilesPanel workspaceId={state.activeWorkspaceId} initialPath={file} onAdd={(path, range) => setAttachments((current) => [...current, { id: attachmentId(), name: path.split('/').at(-1) ?? path, path, range }])} />}
          {tab === 'git' && <GitPanel workspaceId={state.activeWorkspaceId} client={daemonClient} />}
          {tab === 'plan' && <PlanPanel todos={state.sessionState.todos} />}
        </div>
      </aside>
      <div className="screen-reader-live u-sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
      {pending?.kind === 'approval' && (
        <ApprovalDialog
          interaction={pending}
          onRespond={(confirmed) => {
            daemonClient.command('approval.respond', { interactionId: pending.id, confirmed }, active?.sessionId)
              .finally(() => removeInteraction(pending.id));
          }}
        />
      )}
      <SlashCommandPalette
        open={palette.open}
        commands={state.sessionState.availableCommands ?? []}
        initialQuery={palette.query}
        onClose={() => setPalette({ open: false, query: '' })}
        onSelect={(text) => {
          setPalette({ open: false, query: '' });
          // Insert selected command into the composer textarea and focus it so the
          // user can add arguments (if any) or hit Enter to submit.
          const el = document.getElementById('composer-input') as HTMLTextAreaElement | null;
          if (!el) return;
          const prev = el.value ?? '';
          const next = prev.trimStart().startsWith('/') ? text + prev.slice(prev.indexOf(' ') >= 0 ? prev.indexOf(' ') : prev.length) : `${text} `;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          setter?.call(el, next);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.focus();
          el.setSelectionRange(next.length, next.length);
        }}
      />
      {pending?.kind === 'question' && pending.method === 'select' && (
        <SelectDialog
          interaction={pending}
          onRespond={(value, cancelled) => {
            daemonClient.command('question.respond', cancelled ? { interactionId: pending.id, cancelled: true } : { interactionId: pending.id, value }, active?.sessionId)
              .finally(() => removeInteraction(pending.id));
          }}
        />
      )}
      {pending?.kind === 'question' && pending.method === 'input' && (
        <InputDialog
          interaction={pending}
          onRespond={(value, cancelled) => {
            daemonClient.command('question.respond', cancelled ? { interactionId: pending.id, cancelled: true } : { interactionId: pending.id, value }, active?.sessionId)
              .finally(() => removeInteraction(pending.id));
          }}
        />
      )}
      {pending?.kind === 'question' && pending.method === 'editor' && (
        <EditorDialog
          interaction={pending}
          onRespond={(value, cancelled) => {
            daemonClient.command('question.respond', cancelled ? { interactionId: pending.id, cancelled: true } : { interactionId: pending.id, value }, active?.sessionId)
              .finally(() => removeInteraction(pending.id));
          }}
        />
      )}
      {state.sessionState.extensionOpenUrl && (
        <OpenUrlDialog request={state.sessionState.extensionOpenUrl} onDismiss={clearOpenUrl} />
      )}
      <NotifyToast notifications={state.sessionState.extensionNotifications ?? []} onDismiss={dismissNotification} />
    </div>
  );
}
