import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgressSnapshot } from '../../daemon/src/progress/contract';
import { PROGRESS_CONTRACT_VERSION } from '../../daemon/src/progress/contract';
import { ProgressPanel, useContainerCompact } from '../src/components/ProgressPanel';
import { useProgress } from '../src/lib/progress';
import React, { useRef } from 'react';

function createMockSnapshot(overrides: Partial<ProgressSnapshot> = {}): ProgressSnapshot {
  return {
    contractVersion: PROGRESS_CONTRACT_VERSION,
    generatedAt: '2026-09-13T05:00:00.000Z',
    scope: {
      scopeId: 'scope-mon1',
      label: 'MON-1 Progress',
      startedAt: '2026-09-13T04:00:00.000Z',
      explicit: true,
    },
    sources: {
      collector: {
        kind: 'live',
        observedAt: '2026-09-13T05:00:00.000Z',
        ageSeconds: 0,
        errorClass: null,
      },
      activity: {
        kind: 'snapshot',
        observedAt: '2026-09-13T04:30:00.000Z',
        ageSeconds: 60,
        errorClass: null,
      },
    },
    coordinator: {
      label: 'Coordinator',
      model: 'gpt-6-astra',
      nativeState: 'RUNNING',
      work: 'MON-1 layout repair',
      next: 'browser review',
      updatedAt: '2026-09-13T05:00:00.000Z',
      internalThreadCount: 2,
      provenance: null,
      note: 'non-authoritative',
    },
    providers: {
      current: [
        {
          id: 'run-1',
          provider: 'agy',
          requestedModel: 'gemini-3.8-flash-high',
          observedModel: 'gemini-3.8-flash-high',
          role: 'Implementation',
          title: 'Layout Fix',
          status: 'finished',
          liveness: 'unknown',
          startedAt: '2026-09-13T04:55:00.000Z',
          finishedAt: '2026-09-13T04:59:00.000Z',
          elapsedSeconds: 240,
          cost: {
            usd: null,
            inputTokens: null,
            outputTokens: null,
          },
          reviewVerdict: 'unknown',
        },
      ],
      history: [
        {
          id: 'run-0',
          provider: 'codex',
          requestedModel: 'gpt-5-codex',
          observedModel: null,
          role: 'Researcher',
          title: 'Initial Scoping',
          status: 'finished',
          liveness: 'dead',
          startedAt: '2026-09-13T04:00:00.000Z',
          finishedAt: '2026-09-13T04:10:00.000Z',
          elapsedSeconds: 600,
          cost: {
            usd: 0.042,
            inputTokens: 1200,
            outputTokens: 450,
          },
          reviewVerdict: 'accepted',
        },
      ],
      truncated: false,
    },
    overall: {
      trackedKeys: ['MON-1', 'EXEC-3'],
      expectedCount: 2,
      done: 1,
      total: 2,
      byState: { DONE: 1, ACTIVE: 1 },
      unknown: 0,
      doneStates: ['DONE'],
      lastLiveSuccessAt: '2026-09-13T05:00:00.000Z',
      ledgerSource: {
        kind: 'live',
        observedAt: '2026-09-13T05:00:00.000Z',
        ageSeconds: 0,
        errorClass: null,
      },
    },
    checks: [
      {
        id: 'web-tests',
        status: 'PASS',
        scopeId: 'scope-mon1',
        sourceBindings: { total: 1, matched: 1, state: 'all-match' },
        reportAgeSeconds: 0,
        currentEvidence: true,
        note: null,
        checks: [
          {
            id: 'vitest',
            status: 'PASS',
            hashState: 'match',
            junit: { tests: 100, skipped: 0, failures: 0, errors: 0, executed: 100 },
            recordedExitCode: 0,
          },
        ],
      },
      {
        id: 'legacy-checks',
        status: 'FAIL',
        scopeId: null,
        sourceBindings: { total: 1, matched: 0, state: 'mismatch' },
        reportAgeSeconds: 3600,
        currentEvidence: false,
        note: 'Legacy historical checks',
        checks: [
          {
            id: 'old-test',
            status: 'FAIL',
            hashState: 'mismatch',
            junit: null,
            recordedExitCode: 1,
          },
        ],
      },
    ],
    summary: {
      accepted: ['MON-1'],
      remaining: ['EXEC-3'],
      blockers: [],
    },
    ...overrides,
  };
}

describe('ProgressPanel and container-width responsiveness', () => {
  let originalInnerWidth: number;
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalInnerWidth = window.innerWidth;
    originalMatchMedia = window.matchMedia;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.innerWidth = originalInnerWidth;
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  function setupFetchMock(snapshot: ProgressSnapshot | null, delayMs = 0, status = 200) {
    const fetchMock = vi.fn().mockImplementation(async () => {
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      if (status !== 200) {
        return {
          ok: false,
          status,
          json: async () => ({ error: `Server error ${status}` }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => snapshot,
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('renders loading state initially before snapshot arrives', () => {
    setupFetchMock(null, 1000);
    render(<ProgressPanel enabled={true} />);
    expect(screen.getByText('Loading progress...')).toBeInTheDocument();
  });

  it('renders error state when fetch fails and allows retry', async () => {
    setupFetchMock(null, 0, 500);
    render(<ProgressPanel enabled={true} />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load progress/)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('renders empty message when current provider runs are empty', async () => {
    const snapshot = createMockSnapshot({
      providers: { current: [], history: [], truncated: false },
    });
    setupFetchMock(snapshot);
    render(<ProgressPanel enabled={true} />);
    await waitFor(() => {
      expect(screen.getByText('No external provider activity in the current scope')).toBeInTheDocument();
    });
  });

  it('renders freshness strip, stale badges, and unavailable error classes', async () => {
    const snapshot = createMockSnapshot({
      sources: {
        collector: {
          kind: 'unavailable',
          observedAt: null,
          ageSeconds: null,
          errorClass: 'spawn-failed',
        },
        activity: {
          kind: 'snapshot',
          observedAt: '2026-09-13T04:00:00.000Z',
          ageSeconds: 900,
          errorClass: null,
        },
      },
    });
    setupFetchMock(snapshot);
    render(<ProgressPanel enabled={true} />);

    await waitFor(() => {
      expect(screen.getByText(/Collector error: spawn-failed/)).toBeInTheDocument();
    });
    expect(screen.getByText(/stale/)).toBeInTheDocument();
  });

  it('renders coordinator card before external provider section', async () => {
    const snapshot = createMockSnapshot({
      coordinator: {
        label: 'Coordinator',
        model: 'gpt-6-astra',
        nativeState: 'RUNNING',
        work: 'MON-1 layout repair',
        next: 'browser review',
        updatedAt: '2026-09-13T05:00:00.000Z',
        internalThreadCount: 2,
        provenance: {
          kind: 'snapshot',
          observedAt: '2026-09-13T04:30:00.000Z',
          ageSeconds: 1800,
          errorClass: null,
        },
        note: 'non-authoritative',
      },
    });
    setupFetchMock(snapshot);
    const { container } = render(<ProgressPanel enabled={true} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Coordinator' })).toBeInTheDocument();
    });

    const coordinator = container.querySelector('.progress-coordinator-card');
    const providers = container.querySelector('.progress-providers-section');
    expect(coordinator).not.toBeNull();
    expect(providers).not.toBeNull();
    // Verify document order: coordinator precedes providers
    expect(coordinator!.compareDocumentPosition(providers!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Model: gpt-6-astra')).toBeInTheDocument();
    expect(screen.getByText('MON-1 layout repair')).toBeInTheDocument();
    expect(screen.getByText('Coordinator:')).toBeInTheDocument();
  });

  it('toggles between Current and History rows and is keyboard reachable', async () => {
    const snapshot = createMockSnapshot();
    setupFetchMock(snapshot);
    render(<ProgressPanel enabled={true} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Current (1)' })).toBeInTheDocument();
    });

    const currentBtn = screen.getByRole('button', { name: 'Current (1)' });
    const historyBtn = screen.getByRole('button', { name: 'History (1)' });

    expect(currentBtn).toHaveAttribute('aria-pressed', 'true');
    expect(historyBtn).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Implementation')).toBeInTheDocument();

    // Click History
    fireEvent.click(historyBtn);
    expect(historyBtn).toHaveAttribute('aria-pressed', 'true');
    expect(currentBtn).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Researcher')).toBeInTheDocument();

    // Keyboard focus & Space
    currentBtn.focus();
    expect(document.activeElement).toBe(currentBtn);
    fireEvent.click(currentBtn);
    expect(currentBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Implementation')).toBeInTheDocument();
  });

  it('filters currentEvidence checks under Current view and displays all under History', async () => {
    const snapshot = createMockSnapshot();
    setupFetchMock(snapshot);
    render(<ProgressPanel enabled={true} />);

    await waitFor(() => {
      expect(screen.getByText('web-tests')).toBeInTheDocument();
    });

    // In current view, legacy-checks (currentEvidence = false) is hidden
    expect(screen.queryByText('legacy-checks')).toBeNull();

    // Toggle to history view
    fireEvent.click(screen.getByRole('button', { name: 'History (1)' }));
    expect(screen.getByText('web-tests')).toBeInTheDocument();
    expect(screen.getByText('legacy-checks')).toBeInTheDocument();
  });

  it('renders both requestedModel and observedModel when observedModel differs or is present', async () => {
    const snapshot = createMockSnapshot();
    setupFetchMock(snapshot);
    render(<ProgressPanel enabled={true} />);

    await waitFor(() => {
      expect(screen.getAllByText('gemini-3.8-flash-high').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Container-width responsiveness (MON-1 desktop drawer-clipping regression)', () => {
    it('renders table layout when container width is >= 900px', async () => {
      const snapshot = createMockSnapshot();
      setupFetchMock(snapshot);

      // Simulate a wide desktop container (e.g. 1000px with drawers closed)
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        width: 1000,
        height: 800,
        top: 0,
        left: 0,
        bottom: 800,
        right: 1000,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      render(<ProgressPanel enabled={true} />);

      await waitFor(() => {
        expect(screen.getByRole('columnheader', { name: 'Requested model' })).toBeInTheDocument();
      });

      // Assert table headers exist and are readable
      expect(screen.getByRole('columnheader', { name: 'Provider' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Role / Title' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Requested model' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Observed model' })).toBeInTheDocument();
      expect(screen.getAllByRole('columnheader', { name: 'Status' }).length).toBe(2);
      expect(screen.getByRole('columnheader', { name: 'Liveness' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Elapsed' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Cost' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Tokens' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Review' })).toBeInTheDocument();
    });

    it('renders stacked card layout without table when container width is < 900px (e.g. 616px desktop with drawers open)', async () => {
      const snapshot = createMockSnapshot();
      setupFetchMock(snapshot);

      // Simulate desktop resolution 1280x900 where viewport >= 900 but container is only 616px
      window.innerWidth = 1280;
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        width: 616,
        height: 800,
        top: 0,
        left: 280,
        bottom: 800,
        right: 896,
        x: 280,
        y: 0,
        toJSON: () => {},
      });

      const { container } = render(<ProgressPanel enabled={true} />);

      await waitFor(() => {
        expect(screen.getByText('Implementation')).toBeInTheDocument();
      });

      // Provider table must NOT be rendered (avoids horizontal blowout under right drawer)
      expect(screen.queryByRole('columnheader', { name: 'Requested model' })).toBeNull();

      // Stacked cards are rendered and all provider information remains readable
      const providerCard = container.querySelector('.progress-card');
      expect(providerCard).not.toBeNull();

      // Check all required provider fields are present and readable within the card
      expect(screen.getByText('agy')).toBeInTheDocument();
      expect(screen.getByText(/finished \(unknown\)/)).toBeInTheDocument();
      expect(screen.getByText(/Role:/)).toBeInTheDocument();
      expect(screen.getByText('Implementation')).toBeInTheDocument();
      expect(screen.getByText(/Requested model:/)).toBeInTheDocument();
      expect(screen.getByText(/Observed model:/)).toBeInTheDocument();
      expect(screen.getByText(/Elapsed:/)).toBeInTheDocument();
      expect(screen.getByText('4m 0s')).toBeInTheDocument();
      expect(screen.getByText(/Cost:/)).toBeInTheDocument();
      expect(screen.getByText(/Tokens:/)).toBeInTheDocument();
      expect(screen.getByText(/Review verdict:/)).toBeInTheDocument();

      // Acceptance check details also render stacked check cards instead of table
      const checkCard = container.querySelector('.progress-check-card');
      expect(checkCard).not.toBeNull();
      expect(container.querySelector('.progress-check-table')).toBeNull();
    });

    it('dynamically adapts when container resizes via ResizeObserver', async () => {
      type ResizeCallback = (entries: ResizeObserverEntry[]) => void;
      let roCallback: ResizeCallback | null = null;

      class MockResizeObserver {
        constructor(cb: ResizeCallback) {
          roCallback = cb;
        }
        observe() {}
        unobserve() {}
        disconnect() {
          roCallback = null;
        }
      }

      vi.stubGlobal('ResizeObserver', MockResizeObserver);

      const snapshot = createMockSnapshot();
      setupFetchMock(snapshot);

      // Start with wide container (1000px)
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        width: 1000,
        height: 800,
        top: 0,
        left: 0,
        bottom: 800,
        right: 1000,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      const { container } = render(<ProgressPanel enabled={true} />);

      await waitFor(() => {
        expect(screen.getByRole('columnheader', { name: 'Requested model' })).toBeInTheDocument();
      });

      // Now simulate opening the Workspace drawer: container shrinks to 616px
      act(() => {
        if (roCallback) {
          roCallback([
            {
              contentRect: { width: 616, height: 800, x: 0, y: 0, top: 0, left: 0, bottom: 800, right: 616, toJSON: () => {} },
              target: document.createElement('div'),
            } as unknown as ResizeObserverEntry,
          ]);
        }
      });

      // Layout should react and collapse table to stacked cards
      expect(screen.queryByRole('columnheader', { name: 'Requested model' })).toBeNull();
      expect(container.querySelector('.progress-card')).not.toBeNull();
      expect(container.querySelector('.progress-check-card')).not.toBeNull();

      // Simulate closing the Workspace drawer: container expands back to 1000px
      act(() => {
        if (roCallback) {
          roCallback([
            {
              contentRect: { width: 1000, height: 800, x: 0, y: 0, top: 0, left: 0, bottom: 800, right: 1000, toJSON: () => {} },
              target: document.createElement('div'),
            } as unknown as ResizeObserverEntry,
          ]);
        }
      });

      // Table layout is restored
      expect(screen.getByRole('columnheader', { name: 'Requested model' })).toBeInTheDocument();
    });

    it('renders stacked cards, responsive toggle group, and card-based check details on mobile viewport (390x844)', async () => {
      const snapshot = createMockSnapshot();
      setupFetchMock(snapshot);

      window.innerWidth = 390;
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('899px') || query.includes('540px'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        width: 358,
        height: 600,
        top: 0,
        left: 16,
        bottom: 600,
        right: 374,
        x: 16,
        y: 0,
        toJSON: () => {},
      });

      const { container } = render(<ProgressPanel enabled={true} />);

      await waitFor(() => {
        expect(container.querySelector('.progress-card')).not.toBeNull();
      });
      expect(screen.queryByRole('columnheader', { name: 'Requested model' })).toBeNull();
      expect(screen.getByText('Implementation')).toBeInTheDocument();

      // Provider history toggle buttons must be rendered and accessible
      const currentBtn = screen.getByRole('button', { name: 'Current (1)' });
      const historyBtn = screen.getByRole('button', { name: 'History (1)' });
      expect(currentBtn).toHaveAttribute('aria-pressed', 'true');
      expect(historyBtn).toHaveAttribute('aria-pressed', 'false');

      // Acceptance check details: no table element in compact mode
      expect(screen.queryByRole('table')).toBeNull();
      expect(container.querySelector('.progress-check-table')).toBeNull();

      // Check card is rendered with all metadata fields preserved
      const checkCard = container.querySelector('.progress-check-card');
      expect(checkCard).not.toBeNull();
      expect(checkCard).toHaveTextContent('vitest');
      expect(checkCard).toHaveTextContent(/Hash state:\s*match/);
      expect(checkCard).toHaveTextContent(/Exit code:\s*0/);
      expect(checkCard).toHaveTextContent(/Executed tests:\s*100/);
      expect(checkCard).toHaveTextContent(/Failures \/ Errors:\s*0 \/ 0/);
    });
  });

  describe('useProgress hook behavior', () => {
    function HookTester({ enabled }: { enabled: boolean }) {
      const result = useProgress(enabled);
      return (
        <div>
          <span data-testid="loading">{String(result.loading)}</span>
          <span data-testid="error">{result.error ?? 'none'}</span>
          <span data-testid="scope">{result.snapshot?.scope.label ?? 'none'}</span>
        </div>
      );
    }

    it('cancels polling when unmounted', async () => {
      const snapshot = createMockSnapshot();
      const fetchMock = setupFetchMock(snapshot);

      const { unmount } = render(<HookTester enabled={true} />);

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });
      const initialCalls = fetchMock.mock.calls.length;

      unmount();

      // Wait a bit to ensure no further scheduled polls occur after unmount
      await new Promise((r) => setTimeout(r, 100));
      expect(fetchMock.mock.calls.length).toBe(initialCalls);
    });

    it('stops polling when document is hidden', async () => {
      const snapshot = createMockSnapshot();
      const fetchMock = setupFetchMock(snapshot);

      render(<HookTester enabled={true} />);
      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });

      // Simulate visibility change to hidden
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      fireEvent(document, new Event('visibilitychange'));

      const callsAfterHide = fetchMock.mock.calls.length;
      await new Promise((r) => setTimeout(r, 100));
      expect(fetchMock.mock.calls.length).toBe(callsAfterHide);

      // Restore visibility
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    });
  });

  describe('execution control actions', () => {
    function createSnapshotWithControl(controlOverrides: Partial<NonNullable<ProgressSnapshot['control']>> = {}): ProgressSnapshot {
      return createMockSnapshot({
        control: {
          source: {
            kind: 'live',
            observedAt: '2026-09-13T05:00:00.000Z',
            ageSeconds: 0,
            errorClass: null,
          },
          state: {
            grantRef: '1234abcd',
            state: 'active',
            grantVersion: 1,
            mode: 'single',
            activeWorkKey: 'EXEC-1',
            pausedAt: null,
            stoppedAt: null,
            expiresAt: null,
            terminalReason: null,
            canPause: true,
            canStop: true,
          },
          ...controlOverrides,
        },
      });
    }

    it('Pause posts once and disables', async () => {
      const snapshot = createSnapshotWithControl();
      let pauseCalls = 0;
      let pauseHeaders: any = null;
      let pauseBody: any = null;

      const fetchMock = vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
        const urlStr = String(url);
        if (urlStr.includes('/api/progress/control/pause')) {
          pauseCalls++;
          pauseHeaders = init?.headers;
          pauseBody = init?.body ? JSON.parse(String(init.body)) : null;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              control: {
                ...snapshot.control!.state,
                state: 'paused',
                grantVersion: 2,
                canPause: false,
                canStop: true,
              },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => snapshot,
        };
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<ProgressPanel enabled={true} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
      });

      const pauseBtn = screen.getByRole('button', { name: 'Pause' });
      expect(pauseBtn).not.toBeDisabled();

      fireEvent.click(pauseBtn);

      await waitFor(() => {
        expect(pauseCalls).toBe(1);
      });

      expect(pauseHeaders?.['X-OMP-WebUI-Control']).toBe('1');
      expect(pauseBody).toEqual({ grantRef: '1234abcd', expectedVersion: 1 });
    });

    it('Stop modal requires non-blank reason and posts stop mutation', async () => {
      const snapshot = createSnapshotWithControl();
      let stopCalls = 0;
      let stopBody: any = null;

      const fetchMock = vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
        const urlStr = String(url);
        if (urlStr.includes('/api/progress/control/stop')) {
          stopCalls++;
          stopBody = init?.body ? JSON.parse(String(init.body)) : null;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              control: {
                ...snapshot.control!.state,
                state: 'stopped',
                grantVersion: 2,
                terminalReason: `webui_stop: ${stopBody?.reason}`,
                canPause: false,
                canStop: false,
              },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => snapshot,
        };
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<ProgressPanel enabled={true} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
      });

      // Click Stop to open modal
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

      // Modal dialog is displayed
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const confirmBtn = screen.getByRole('button', { name: 'Confirm Stop' });
      const textarea = screen.getByLabelText('Stop reason');

      // Disabled while blank
      expect(confirmBtn).toBeDisabled();

      // Typing whitespace only keeps confirm disabled
      fireEvent.change(textarea, { target: { value: '   ' } });
      expect(confirmBtn).toBeDisabled();

      // Typing valid reason enables confirm
      fireEvent.change(textarea, { target: { value: 'Blocked on external API outage' } });
      expect(confirmBtn).not.toBeDisabled();
      expect(screen.getByText('30/200')).toBeInTheDocument();

      // Confirm click fires stop mutation
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(stopCalls).toBe(1);
      });

      expect(stopBody).toEqual({
        grantRef: '1234abcd',
        expectedVersion: 1,
        reason: 'Blocked on external API outage',
      });

      // Modal is closed after completion
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
    });

    it('shows typed error code and refreshes snapshot on 409 conflict', async () => {
      const snapshot = createSnapshotWithControl();
      let refreshCalls = 0;

      const fetchMock = vi.fn().mockImplementation(async (url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/api/progress/control/pause')) {
          return {
            ok: false,
            status: 409,
            json: async () => ({
              ok: false,
              code: 'stale_version',
              control: {
                ...snapshot.control!.state,
                grantVersion: 2,
              },
            }),
          };
        }
        refreshCalls++;
        return {
          ok: true,
          status: 200,
          json: async () => snapshot,
        };
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<ProgressPanel enabled={true} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

      // Error code displayed in UI
      await waitFor(() => {
        expect(screen.getByText(/Control error:\s*stale_version/)).toBeInTheDocument();
      });

      // Refresh was called
      expect(refreshCalls).toBeGreaterThanOrEqual(2);
    });

    it('hides control buttons when control source is unavailable or non-live', async () => {
      const unavailableSnapshot = createMockSnapshot({
        control: {
          source: {
            kind: 'unavailable',
            observedAt: null,
            ageSeconds: null,
            errorClass: 'control-unavailable',
          },
          state: null,
        },
      });
      setupFetchMock(unavailableSnapshot);

      render(<ProgressPanel enabled={true} />);

      await waitFor(() => {
        expect(screen.getByText('Coordinator')).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
      expect(screen.queryByText(/Control error:/)).toBeNull();
    });

    it('displays paused resume instruction when state is paused', async () => {
      const pausedSnapshot = createSnapshotWithControl({
        state: {
          grantRef: '1234abcd',
          state: 'paused',
          grantVersion: 2,
          mode: 'single',
          activeWorkKey: 'EXEC-1',
          pausedAt: '2026-09-13T05:01:00.000Z',
          stoppedAt: null,
          expiresAt: null,
          terminalReason: null,
          canPause: false,
          canStop: true,
        },
      });
      setupFetchMock(pausedSnapshot);

      render(<ProgressPanel enabled={true} />);

      await waitFor(() => {
        expect(screen.getByText(/paused — resume from omp with/)).toBeInTheDocument();
      });

      expect(screen.getByText(/execute resume EXEC-1/)).toBeInTheDocument();
      // Pause button is disabled when already paused
      expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
      // Stop button remains available
      expect(screen.getByRole('button', { name: 'Stop' })).not.toBeDisabled();
    });
  });
});
