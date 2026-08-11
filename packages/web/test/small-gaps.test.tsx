import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Sidebar, recordRecentWorkspace } from '../src/components/Sidebar';
import { QuestionsPanel } from '../src/components/QuestionsPanel';
import type { DaemonClient } from '../src/lib/client';
import type { TranscriptItem } from '../../daemon/src/protocol';

function fakeClient(overrides: Record<string, unknown> = {}) {
  const calls: { type: string; payload: unknown }[] = [];
  const client = {
    command: vi.fn((type: string, payload?: unknown) => {
      calls.push({ type, payload });
      if (type === 'workspace.open') return Promise.resolve({ workspace: { id: 'ws-x', root: (payload as { root: string }).root } });
      if (type === 'path.complete') return Promise.resolve({ dirs: ['/tmp/alpha/', '/tmp/alpine/'] });
      if (overrides[type] !== undefined) return Promise.resolve(overrides[type]);
      return Promise.resolve({});
    }),
  } as unknown as DaemonClient;
  return { client, calls };
}

function renderSidebar(client: DaemonClient, extra: Record<string, unknown> = {}) {
  const onWorkspace = vi.fn();
  render(<Sidebar open workspaces={[]} sessions={[]} client={client}
    onWorkspace={onWorkspace} onSessions={vi.fn()} onOpen={vi.fn()} onClose={vi.fn()} {...extra} />);
  return { onWorkspace };
}

beforeEach(() => { localStorage.clear(); });

describe('path autocomplete (gap #9)', () => {
  it('debounced path.complete feeds a datalist for the open-path input', async () => {
    const { client, calls } = fakeClient();
    renderSidebar(client);
    fireEvent.change(screen.getByLabelText('Open workspace by path'), { target: { value: '/tmp/al' } });
    await waitFor(() => expect(calls.some((c) => c.type === 'path.complete')).toBe(true), { timeout: 1000 });
    expect(calls.find((c) => c.type === 'path.complete')!.payload).toEqual({ prefix: '/tmp/al' });
    await waitFor(() => {
      const list = document.getElementById('workspace-path-suggestions');
      expect(list?.querySelectorAll('option').length).toBe(2);
      expect(list?.innerHTML).toContain('/tmp/alpha/');
    });
  });

  it('does not query completion for empty input', async () => {
    const { client, calls } = fakeClient();
    renderSidebar(client);
    await new Promise((r) => setTimeout(r, 250));
    expect(calls.some((c) => c.type === 'path.complete')).toBe(false);
  });
});

describe('recent workspaces MRU (gap #8)', () => {
  it('records opened roots most-recent-first, deduped, capped at 8', () => {
    for (const r of ['/a', '/b', '/c']) recordRecentWorkspace(r);
    recordRecentWorkspace('/a'); // re-open moves to front
    expect(JSON.parse(localStorage.getItem('omp-webui.recentWorkspaces')!)).toEqual(['/a', '/c', '/b']);
    for (let i = 0; i < 10; i++) recordRecentWorkspace(`/ws/${i}`);
    expect(JSON.parse(localStorage.getItem('omp-webui.recentWorkspaces')!)).toHaveLength(8);
  });

  it('renders the MRU list and clicking an entry opens that workspace', async () => {
    recordRecentWorkspace('/home/me/project');
    const { client } = fakeClient();
    const { onWorkspace } = renderSidebar(client);
    await waitFor(() => screen.getByText('/home/me/project'));
    fireEvent.click(screen.getByText('/home/me/project'));
    await waitFor(() => expect(onWorkspace).toHaveBeenCalledWith({ id: 'ws-x', root: '/home/me/project' }));
  });

  it('hides the MRU section when empty', () => {
    const { client } = fakeClient();
    renderSidebar(client);
    expect(screen.queryByText('Recent')).toBeNull();
  });
});

describe('questions nav (gap #7)', () => {
  const items: TranscriptItem[] = [
    { id: 'u1', kind: 'user', text: 'first question about the repo' },
    { id: 'a1', kind: 'assistant', text: 'an answer' },
    { id: 'u2', kind: 'user', text: '<file path="x.ts">code</file>\nsecond question with attachment' },
    { id: 'u3', kind: 'user', text: '   ' }, // whitespace-only, excluded
  ];

  it('lists user messages with numbering, skipping blank ones', () => {
    render(<QuestionsPanel items={items} />);
    const entries = screen.getAllByRole('button');
    expect(entries).toHaveLength(2);
    expect(entries[0].textContent).toContain('first question about the repo');
    expect(entries[0].textContent).toContain('#1');
    expect(entries[1].textContent).toContain('second question with attachment');
    expect(entries[1].textContent).toContain('#2');
  });

  it('strips hidden <file> transport blocks from previews', () => {
    render(<QuestionsPanel items={items} />);
    expect(screen.queryByText(/code/)).toBeNull();
  });

  it('clicking an entry scrolls to the message anchor and flashes it', () => {
    const anchor = document.createElement('li');
    anchor.id = 'msg-u1';
    document.body.appendChild(anchor);
    const scroll = vi.fn();
    anchor.scrollIntoView = scroll;
    render(<QuestionsPanel items={items} />);
    fireEvent.click(screen.getByText('first question about the repo'));
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(anchor.classList.contains('msg-flash')).toBe(true);
    anchor.remove();
  });

  it('shows an empty state with no questions', () => {
    render(<QuestionsPanel items={[]} />);
    expect(screen.getByText(/No questions yet/)).toBeTruthy();
  });
});
