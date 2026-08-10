import { useEffect, useRef, useState } from 'react';
import { Menu, PanelRightOpen, X } from 'lucide-react';
import type { SessionSummary } from '../../../daemon/src/protocol';
import { daemonClient } from '../lib/client';
import { useAppStore } from '../lib/store';
import { Sidebar } from './Sidebar';
import { Transcript } from './Transcript';
import { Composer } from './Composer';
import { GitPanel } from './GitPanel';
import { PlanPanel } from './PlanPanel';
import { StatusBar } from './StatusBar';
import { ApprovalDialog } from './ApprovalDialog';
import { QuestionDialog } from './QuestionDialog';
import { useOverlayFocus } from './dialog-utils';

function FilesPanel({ workspaceId, initialPath }: { workspaceId?: string; initialPath?: string }) {
  const [path, setPath] = useState(initialPath ?? '');
  const [content, setContent] = useState('');

  useEffect(() => setPath(initialPath ?? ''), [initialPath]);

  const read = () => workspaceId && daemonClient.command<{ content?: string }>('file.read', { workspaceId, path })
    .then((value) => setContent(value.content ?? ''))
    .catch(() => setContent('Could not read this file.'));

  return (
    <section className="panel" aria-label="Files">
      <header><h2>Files</h2></header>
      <div className="file-preview__input">
        <input aria-label="File path" value={path} onChange={(event) => setPath(event.target.value)} placeholder="src/app.ts" />
        <button className="button button--quiet" onClick={read}>Open</button>
      </div>
      {content ? <pre><code>{content}</code></pre> : <p className="empty-panel">Select a file to preview it.</p>}
    </section>
  );
}

export function AppShell() {
  const state = useAppStore();
  const { setConnection, applyEvent, setWorkspaces, setSessions, setActiveSession, setDraft, removeInteraction } = useAppStore();
  const [sidebar, setSidebar] = useState(() => typeof window === 'undefined' || window.innerWidth >= 900);
  const [drawer, setDrawer] = useState(false);
  const [tab, setTab] = useState<'files' | 'git' | 'plan'>('files');
  const [file, setFile] = useState('');
  const [announcement, setAnnouncement] = useState('');
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

  const openSession = (sessionFile: string, workspaceId = state.activeWorkspaceId) => {
    if (!workspaceId) return;
    daemonClient.command<{ sessionId: string; sessionFile: string }>('session.open', { workspaceId, sessionFile })
      .then((response) => {
        const session = { sessionId: response.sessionId, sessionFile: response.sessionFile };
        setActiveSession(session);
        localStorage.setItem('omp-webui.activeSession', JSON.stringify({ workspaceId, sessionFile: response.sessionFile }));
        void loadSessions(workspaceId);
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    let hydrated = false;
    const hydrate = () => {
      if (hydrated) return;
      hydrated = true;
      daemonClient.command<{ workspaces: typeof state.workspaces }>('workspace.list')
        .then((response) => {
          const workspaces = response.workspaces ?? [];
          setWorkspaces(workspaces);
          const saved = localStorage.getItem('omp-webui.activeSession');
          if (!saved) return;
          try {
            const { workspaceId, sessionFile } = JSON.parse(saved) as { workspaceId?: string; sessionFile?: string };
            if (workspaceId && sessionFile && workspaces.some((item) => item.id === workspaceId)) {
              useAppStore.setState({ activeWorkspaceId: workspaceId });
              void loadSessions(workspaceId);
              openSession(sessionFile, workspaceId);
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
        document.querySelector<HTMLInputElement>('[aria-label="Search sessions"]')?.focus();
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
          <button ref={drawerTrigger} className="icon-button" aria-label="Toggle workspace drawer" aria-expanded={drawer} onClick={() => setDrawer((open) => !open)}><PanelRightOpen size={19} /></button>
        </header>
        <div id="conversation" className="conversation">
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
          />
        </div>
        <StatusBar
          connection={state.connection}
          worker={state.sessionState.workerState}
          model={model?.id}
          thinking={state.sessionState.thinkingLevel}
          context={state.sessionState.contextUsage?.percent}
          tokensPerSecond={state.sessionState.tokensPerSecond}
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
          {tab === 'files' && <FilesPanel workspaceId={state.activeWorkspaceId} initialPath={file} />}
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
      {pending?.kind === 'question' && (
        <QuestionDialog
          interaction={pending}
          onRespond={(value, cancelled) => {
            daemonClient.command('question.respond', cancelled ? { interactionId: pending.id, cancelled: true } : { interactionId: pending.id, value }, active?.sessionId)
              .finally(() => removeInteraction(pending.id));
          }}
        />
      )}
    </div>
  );
}
