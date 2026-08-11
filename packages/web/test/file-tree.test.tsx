import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { commandMock, handlers } = vi.hoisted(() => {
  const handlers = new Set<(e: { type: string; payload?: unknown }) => void>();
  return { commandMock: vi.fn(), handlers };
});

vi.mock('../src/lib/client', () => ({
  daemonClient: {
    command: commandMock,
    onEvent: (h: (e: { type: string; payload?: unknown }) => void) => {
      handlers.add(h);
      return () => handlers.delete(h);
    },
  },
}));

import { FileTreePanel } from '../src/components/FileTreePanel';

const ROOT_LISTING = {
  path: '',
  entries: [
    { name: 'src', path: 'src', kind: 'dir', size: 0, modifiedMs: 1 },
    { name: 'docs', path: 'docs', kind: 'dir', size: 0, modifiedMs: 1 },
    { name: 'README.md', path: 'README.md', kind: 'file', size: 2048, modifiedMs: 1 },
  ],
  truncated: false,
};

const SRC_LISTING = {
  path: 'src',
  entries: [{ name: 'app.ts', path: 'src/app.ts', kind: 'file', size: 10, modifiedMs: 1 }],
  truncated: false,
};

function emit(e: { type: string; payload?: unknown }) {
  act(() => { handlers.forEach((h) => h(e)); });
}

beforeEach(() => {
  commandMock.mockReset();
  handlers.clear();
  commandMock.mockImplementation((type: string, payload: { path?: string }) => {
    if (type === 'file.list') return Promise.resolve(payload.path === 'src' ? SRC_LISTING : ROOT_LISTING);
    if (type === 'file.read') return Promise.resolve({ path: payload.path, content: 'body' });
    return Promise.resolve({});
  });
});

describe('FileTreePanel', () => {
  it('lists root with dirs first and formatted file size', async () => {
    render(<FileTreePanel workspaceId="ws1" onAdd={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('README.md')).toBeTruthy());
    const names = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(names[0]).toContain('src');
    expect(names[1]).toContain('docs');
    expect(names[2]).toContain('README.md');
    expect(names[2]).toContain('2.0 kB');
  });

  it('navigates into a dir and back up', async () => {
    render(<FileTreePanel workspaceId="ws1" onAdd={vi.fn()} />);
    await waitFor(() => screen.getByText('src'));
    fireEvent.click(screen.getByRole('button', { name: /src Open folder/ }));
    await waitFor(() => expect(screen.getByText('app.ts')).toBeTruthy());
    expect(screen.getByLabelText('Directory path').textContent).toBe('src');
    fireEvent.click(screen.getByLabelText('Go to parent directory'));
    await waitFor(() => expect(screen.getByText('README.md')).toBeTruthy());
    expect(screen.getByLabelText('Directory path').textContent).toBe('/');
  });

  it('re-lists when the daemon pushes file.changed for the visible dir', async () => {
    render(<FileTreePanel workspaceId="ws1" onAdd={vi.fn()} />);
    await waitFor(() => screen.getByText('README.md'));
    const before = commandMock.mock.calls.filter(([t]) => t === 'file.list').length;
    emit({ type: 'file.changed', payload: { workspaceId: 'ws1', path: '' } });
    await waitFor(() => {
      expect(commandMock.mock.calls.filter(([t]) => t === 'file.list').length).toBeGreaterThan(before);
    });
  });

  it('ignores file.changed for other workspaces or dirs', async () => {
    render(<FileTreePanel workspaceId="ws1" onAdd={vi.fn()} />);
    await waitFor(() => screen.getByText('README.md'));
    const before = commandMock.mock.calls.filter(([t]) => t === 'file.list').length;
    emit({ type: 'file.changed', payload: { workspaceId: 'other', path: '' } });
    emit({ type: 'file.changed', payload: { workspaceId: 'ws1', path: 'elsewhere' } });
    await new Promise((r) => setTimeout(r, 50));
    expect(commandMock.mock.calls.filter(([t]) => t === 'file.list').length).toBe(before);
  });

  it('opens a preview dialog for files and forwards add-to-conversation', async () => {
    const onAdd = vi.fn();
    render(<FileTreePanel workspaceId="ws1" onAdd={onAdd} />);
    await waitFor(() => screen.getByText('README.md'));
    fireEvent.click(screen.getByRole('button', { name: /README\.md 2\.0 kB/ }));
    await waitFor(() => expect(commandMock.mock.calls.some(([t]) => t === 'file.read')).toBe(true));
    fireEvent.click(screen.getByLabelText('Add README.md to conversation'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toBe('README.md');
  });

  it('surfaces file.list errors', async () => {
    commandMock.mockRejectedValueOnce(new Error('not a directory'));
    render(<FileTreePanel workspaceId="ws1" onAdd={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('not a directory'));
  });

  it('shows an empty state with no workspace', () => {
    render(<FileTreePanel onAdd={vi.fn()} />);
    expect(screen.getByText(/Open a workspace/)).toBeTruthy();
  });
});
