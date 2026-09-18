import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProgressSnapshot, PublicControl, RunDetail } from '../../../daemon/src/progress/contract';
import { PROGRESS_CONTRACT_VERSION } from '../../../daemon/src/progress/contract';
import { daemonHealthUrl, daemonUrl } from './client';

export function progressUrl(): string {
  return progressApiUrl('/api/progress');
}

export function runDetailUrl(id: string): string {
  return progressApiUrl(`/api/progress/runs/${encodeURIComponent(id)}`);
}

/** One-shot detail fetch. Deliberately not polled: the list poll already refreshes the snapshot. */
export async function fetchRunDetail(id: string, signal?: AbortSignal): Promise<RunDetail> {
  const res = await fetch(runDetailUrl(id), { credentials: 'same-origin', signal });
  if (!res.ok) {
    let errText = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (body && typeof body.error === 'string') errText = body.error;
    } catch {
      // Keep status text.
    }
    throw new Error(errText);
  }
  const data = (await res.json()) as RunDetail;
  if (!data || typeof data !== 'object' || data.contractVersion !== PROGRESS_CONTRACT_VERSION) {
    throw new Error('Invalid run detail contract version');
  }
  return data;
}

export interface ControlResponseBody {
  ok: boolean;
  code?: string;
  error?: string;
  control?: PublicControl;
}

export async function postControl(
  verb: 'pause' | 'stop',
  body: { grantRef: string; expectedVersion: number; reason?: string },
  signal?: AbortSignal,
): Promise<ControlResponseBody> {
  const url = progressApiUrl(`/api/progress/control/${verb}`);
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-OMP-WebUI-Control': '1',
    },
    body: JSON.stringify(body),
    signal,
  });

  let data: ControlResponseBody;
  try {
    data = (await res.json()) as ControlResponseBody;
  } catch {
    data = { ok: false, code: 'invalid_response' };
  }
  if (!res.ok && data.ok !== false) {
    data = { ok: false, code: `http_${res.status}` };
  }
  return data;
}

function progressApiUrl(pathname: string): string {
  const base = new URL(daemonHealthUrl());
  base.pathname = pathname;
  let token: string | null = null;
  try {
    if (typeof window !== 'undefined' && window.location) {
      const loc = new URL(window.location.href);
      token = loc.searchParams.get('token');
    }
  } catch {
    // Ignore URL parse failures.
  }
  if (!token) {
    try {
      const d = new URL(daemonUrl());
      token = d.searchParams.get('token');
    } catch {
      // Ignore daemon URL parse failures.
    }
  }
  base.search = token ? `?token=${encodeURIComponent(token)}` : '';
  return base.toString();
}

export interface UseProgressResult {
  snapshot: ProgressSnapshot | null;
  loading: boolean;
  error: string | null;
  lastFetchedAt: string | null;
  refresh: () => Promise<void>;
}

export function useProgress(enabled: boolean): UseProgressResult {
  const [snapshot, setSnapshot] = useState<ProgressSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);

  const activeRef = useRef(false);
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchSnapshot = useCallback(async () => {
    if (!activeRef.current || inFlightRef.current) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }

    inFlightRef.current = true;
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const url = progressUrl();
      const res = await fetch(url, {
        credentials: 'same-origin',
        signal: controller.signal,
      });

      if (!res.ok) {
        let errText = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: unknown };
          if (body && typeof body.error === 'string') {
            errText = body.error;
          }
        } catch {
          // Ignore json parse error and keep status text.
        }
        throw new Error(errText);
      }

      const data = (await res.json()) as ProgressSnapshot;
      if (!data || typeof data !== 'object' || data.contractVersion !== PROGRESS_CONTRACT_VERSION) {
        throw new Error('Invalid progress contract version');
      }

      if (activeRef.current) {
        setSnapshot(data);
        setError(null);
        setLastFetchedAt(new Date().toISOString());
      }
    } catch (err: unknown) {
      if (!activeRef.current) return;
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlightRef.current = false;
      if (activeRef.current) {
        setLoading(false);
        scheduleNext();
      }
    }
  }, []);

  const scheduleNext = useCallback(() => {
    if (!activeRef.current) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }
    timerRef.current = setTimeout(() => {
      void fetchSnapshot();
    }, 5000);
  }, [fetchSnapshot]);

  const refresh = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setLoading(true);
    await fetchSnapshot();
  }, [fetchSnapshot]);

  useEffect(() => {
    if (!enabled) {
      activeRef.current = false;
      setLoading(false);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      return;
    }

    activeRef.current = true;
    setLoading(true);

    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void fetchSnapshot();
      } else {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    void fetchSnapshot();

    return () => {
      activeRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [enabled, fetchSnapshot]);

  return { snapshot, loading, error, lastFetchedAt, refresh };
}
