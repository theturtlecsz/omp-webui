import { create } from 'zustand';
import type { SessionSummary } from '../../../daemon/src/protocol';
import { applyServerEvent, initialAppState } from './reducer';
import type { AppState, ConnectionState, ServerEnvelope, Workspace } from './types';
type Store = AppState & {
  setConnection: (connection: ConnectionState) => void;
  applyEvent: (event: ServerEnvelope) => void;
  setWorkspaces: (workspaces: Workspace[]) => void;
  setSessions: (sessions: SessionSummary[]) => void;
  setActiveSession: (session?: AppState['activeSession']) => void;
  setDraft: (file: string, value: string) => void;
  removeInteraction: (id: string) => void;
  dismissNotification: (id: string) => void;
  clearOpenUrl: () => void;
  clearEditorText: () => void;
  reset: () => void;
};
export const useAppStore = create<Store>((set) => ({
  ...initialAppState,
  setConnection: (connection) => set({ connection }),
  applyEvent: (event) => set((s) => applyServerEvent(s, event)),
  setWorkspaces: (workspaces) => set({ workspaces }),
  setSessions: (sessions) => set({ sessions }),
  setActiveSession: (activeSession) => set({ activeSession, transcript: [], toolCards: {}, pendingInteractions: [] }),
  setDraft: (file, value) => set((s) => ({ drafts: { ...s.drafts, [file]: value } })),
  removeInteraction: (id) => set((s) => ({ pendingInteractions: s.pendingInteractions.filter((x) => x.id !== id) })),
  dismissNotification: (id) => set((s) => ({
    sessionState: {
      ...s.sessionState,
      extensionNotifications: (s.sessionState.extensionNotifications ?? []).filter((toast) => toast.id !== id),
    },
  })),
  clearOpenUrl: () => set((s) => ({ sessionState: { ...s.sessionState, extensionOpenUrl: undefined } })),
  clearEditorText: () => set((s) => ({ sessionState: { ...s.sessionState, extensionEditorText: undefined } })),
  reset: () => set(initialAppState),
}));
