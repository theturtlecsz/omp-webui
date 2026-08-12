/**
 * Wire sound effects to store transitions:
 *   - question: pendingInteractions grew (new approval or question)
 *   - done    : isStreaming went true -> false, no failure recorded
 *   - error   : sessionState.extensionNotifications gained an entry with notifyType=error,
 *               OR streaming ended via message.failed (surfaced as isStreaming going
 *               false while lastEventType == 'message.failed').
 *   - start   : isStreaming went false -> true
 *
 * We deliberately observe the resolved store state (not raw events) so retries and
 * reconnects don't double-fire.
 */
import { useEffect, useRef } from 'react';
import { useAppStore } from './store';
import { play, primeAudio, type SoundSettings } from './sound';
import { useSoundSettings } from './settings';

type Prev = {
  interactionIds: string;
  isStreaming: boolean;
  notificationErrorIds: string;
  lastFailure: string | undefined;
};

function joinIds(ids: readonly { id: string }[]): string {
  return ids.map((entry) => entry.id).sort().join('|');
}

export function useSoundTriggers(): void {
  const [settings] = useSoundSettings();
  const settingsRef = useRef<SoundSettings>(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const prev = useRef<Prev | null>(null);

  useEffect(() => {
    // Prime AudioContext lazily on first user gesture anywhere on the page.
    if (typeof window === 'undefined') return;
    const prime = () => { void primeAudio(); };
    window.addEventListener('pointerdown', prime, { once: true });
    window.addEventListener('keydown', prime, { once: true });
    return () => {
      window.removeEventListener('pointerdown', prime);
      window.removeEventListener('keydown', prime);
    };
  }, []);

  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const interactionIds = joinIds(state.pendingInteractions ?? []);
      const isStreaming = state.sessionState?.isStreaming === true;
      const notifs = state.sessionState?.extensionNotifications ?? [];
      const errorIds = joinIds(notifs.filter((toast) => toast.notifyType === 'error'));
      // Track message.failed by watching for a transcript entry with status === 'failed'
      // arriving at the tail (the reducer sets isStreaming=false in that case).
      const tail = state.transcript?.[state.transcript.length - 1];
      const failureKey = tail && (tail as { status?: string }).status === 'failed' ? (tail as { id?: string }).id : undefined;

      const previous = prev.current;
      prev.current = { interactionIds, isStreaming, notificationErrorIds: errorIds, lastFailure: failureKey };
      if (!previous) return;

      const s = settingsRef.current;
      // question: any new pending interaction id
      if (interactionIds !== previous.interactionIds && interactionIds.length > previous.interactionIds.length) {
        play('question', s);
      }
      // error: new error notification, or a new failed transcript entry
      if (errorIds !== previous.notificationErrorIds && errorIds.length > previous.notificationErrorIds.length) {
        play('error', s);
      } else if (failureKey && failureKey !== previous.lastFailure) {
        play('error', s);
      }
      // start / done: streaming transitions
      if (isStreaming !== previous.isStreaming) {
        if (isStreaming) play('start', s);
        else if (!failureKey || failureKey === previous.lastFailure) play('done', s);
      }
    });
    return unsub;
  }, []);
}
