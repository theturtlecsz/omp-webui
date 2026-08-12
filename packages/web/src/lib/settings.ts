/**
 * Small settings hooks — sound + attachment reference-mode.
 * Kept separate from lib/store.ts (which drives session/transcript state) because
 * these settings are UI-only and persist through localStorage instead of the daemon.
 */
import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type SoundSettings } from './sound';

const ATTACHMENT_STORAGE_KEY = 'omp-webui.attachments';

export type AttachmentSettings = {
  /** When true, new attachments default to reference mode (path only). */
  referenceMode: boolean;
};

const DEFAULT_ATTACHMENT_SETTINGS: AttachmentSettings = { referenceMode: false };

function loadAttachmentSettings(): AttachmentSettings {
  try {
    const raw = globalThis.localStorage?.getItem(ATTACHMENT_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ATTACHMENT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AttachmentSettings>;
    return {
      referenceMode: typeof parsed.referenceMode === 'boolean' ? parsed.referenceMode : DEFAULT_ATTACHMENT_SETTINGS.referenceMode,
    };
  } catch {
    return { ...DEFAULT_ATTACHMENT_SETTINGS };
  }
}

function saveAttachmentSettings(settings: AttachmentSettings): void {
  try {
    globalThis.localStorage?.setItem(ATTACHMENT_STORAGE_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}

// Custom same-tab broadcast event names; storage events only fire cross-tab so
// hook instances mounted in the same tab (SettingsDialog + AppShell) would
// otherwise drift out of sync until reload.
const SOUND_EVENT = 'omp-webui:sound-settings-changed';
const ATTACHMENT_EVENT = 'omp-webui:attachment-settings-changed';

function broadcast(eventName: string, detail: unknown) {
  try { globalThis.dispatchEvent?.(new CustomEvent(eventName, { detail })); } catch { /* ignore */ }
}

export function useSoundSettings(): [SoundSettings, (next: SoundSettings) => void] {
  const [settings, setSettings] = useState<SoundSettings>(() => loadSettings());
  useEffect(() => { saveSettings(settings); broadcast(SOUND_EVENT, settings); }, [settings]);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<SoundSettings>).detail;
      if (detail) setSettings(detail); else setSettings(loadSettings());
    };
    globalThis.addEventListener?.(SOUND_EVENT, handler);
    return () => globalThis.removeEventListener?.(SOUND_EVENT, handler);
  }, []);
  return [settings, setSettings];
}

export function useAttachmentSettings(): [AttachmentSettings, (next: AttachmentSettings) => void] {
  const [settings, setSettings] = useState<AttachmentSettings>(() => loadAttachmentSettings());
  useEffect(() => { saveAttachmentSettings(settings); broadcast(ATTACHMENT_EVENT, settings); }, [settings]);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<AttachmentSettings>).detail;
      if (detail) setSettings(detail); else setSettings(loadAttachmentSettings());
    };
    globalThis.addEventListener?.(ATTACHMENT_EVENT, handler);
    return () => globalThis.removeEventListener?.(ATTACHMENT_EVENT, handler);
  }, []);
  return [settings, setSettings];
}

export const __DEFAULT_SOUND_SETTINGS = DEFAULT_SETTINGS;
export const __DEFAULT_ATTACHMENT_SETTINGS = DEFAULT_ATTACHMENT_SETTINGS;
