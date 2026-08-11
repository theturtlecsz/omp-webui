import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ModelPickerDialog, THINKING_LEVELS, type ModelInfo } from '../src/components/ModelPickerDialog';
import type { DaemonClient } from '../src/lib/client';

const MODELS: ModelInfo[] = [
  { id: 'stub-1', provider: 'teststub', name: 'Stub Model 1', contextWindow: 128000, reasoning: false, cost: { input: 0, output: 0 } },
  { id: 'claude-x', provider: 'anthropic', name: 'Claude X', contextWindow: 200000, reasoning: true, cost: { input: 3, output: 15 } },
  { id: 'gpt-y', provider: 'openai', name: 'GPT Y', contextWindow: 128000, reasoning: true },
];

function fakeClient(overrides: Record<string, unknown> = {}) {
  const calls: { type: string; payload: unknown; sessionId?: string }[] = [];
  const client = {
    command: vi.fn((type: string, payload?: unknown, sessionId?: string) => {
      calls.push({ type, payload, sessionId });
      if (overrides[type] instanceof Error) return Promise.reject(overrides[type]);
      if (type === 'model.list') return Promise.resolve({ models: MODELS });
      return Promise.resolve({ ok: true });
    }),
  } as unknown as DaemonClient;
  return { client, calls };
}

function renderDialog(client: DaemonClient, extra: Partial<Parameters<typeof ModelPickerDialog>[0]> = {}) {
  const onClose = vi.fn();
  render(<ModelPickerDialog sessionId="s1" client={client} currentModel={{ provider: 'teststub', id: 'stub-1' }} thinkingLevel="medium" onClose={onClose} {...extra} />);
  return { onClose };
}

describe('ModelPickerDialog', () => {
  it('loads and groups models by provider with metadata', async () => {
    const { client } = fakeClient();
    renderDialog(client);
    await waitFor(() => expect(screen.getByText('Claude X')).toBeTruthy());
    expect(screen.getByText('teststub')).toBeTruthy();
    expect(screen.getByText('anthropic')).toBeTruthy();
    expect(screen.getByText('openai')).toBeTruthy();
    expect(screen.getByText('200k ctx')).toBeTruthy();
    expect(screen.getByText('$3/$15')).toBeTruthy();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('marks the current model as selected', async () => {
    const { client } = fakeClient();
    renderDialog(client);
    await waitFor(() => screen.getByText('Stub Model 1'));
    const current = screen.getByRole('option', { name: /Stub Model 1/ });
    expect(current.getAttribute('aria-selected')).toBe('true');
    const other = screen.getByRole('option', { name: /Claude X/ });
    expect(other.getAttribute('aria-selected')).toBe('false');
  });

  it('selecting a model sends model.set with provider + modelId', async () => {
    const { client, calls } = fakeClient();
    renderDialog(client);
    await waitFor(() => screen.getByText('Claude X'));
    fireEvent.click(screen.getByRole('option', { name: /Claude X/ }));
    await waitFor(() => expect(calls.some(c => c.type === 'model.set')).toBe(true));
    const set = calls.find(c => c.type === 'model.set')!;
    expect(set.payload).toEqual({ provider: 'anthropic', modelId: 'claude-x' });
    expect(set.sessionId).toBe('s1');
  });

  it('arrow keys move the active option and Enter selects it', async () => {
    const { client, calls } = fakeClient();
    renderDialog(client);
    await waitFor(() => screen.getByText('Claude X'));
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' }); // activeIdx 0 -> 1 (Claude X)
    fireEvent.keyDown(listbox, { key: 'Enter' });
    await waitFor(() => expect(calls.some(c => c.type === 'model.set')).toBe(true));
    expect(calls.find(c => c.type === 'model.set')!.payload).toEqual({ provider: 'anthropic', modelId: 'claude-x' });
  });

  it('exposes the full omp thinking-level range including xhigh and max', () => {
    const { client } = fakeClient();
    renderDialog(client);
    const radios = screen.getAllByRole('radio').map(r => r.textContent);
    expect(radios).toEqual([...THINKING_LEVELS]);
    expect(THINKING_LEVELS).toContain('xhigh');
    expect(THINKING_LEVELS).toContain('max');
  });

  it('marks the active thinking level and sends thinking.set on click', async () => {
    const { client, calls } = fakeClient();
    renderDialog(client);
    const medium = screen.getByRole('radio', { name: 'medium' });
    expect(medium.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'max' }));
    await waitFor(() => expect(calls.some(c => c.type === 'thinking.set')).toBe(true));
    expect(calls.find(c => c.type === 'thinking.set')!.payload).toEqual({ level: 'max' });
  });

  it('cycle buttons send model.cycle / thinking.cycle', async () => {
    const { client, calls } = fakeClient();
    renderDialog(client);
    await waitFor(() => screen.getByText('Stub Model 1'));
    const cycles = screen.getAllByRole('button', { name: /Cycle/ });
    expect(cycles).toHaveLength(2);
    fireEvent.click(cycles[0]);
    // The pending guard blocks a second in-flight command; wait for the first
    // to settle before clicking the other cycle button.
    await waitFor(() => expect(calls.some(c => c.type === 'model.cycle')).toBe(true));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Cycle/ })[1]).not.toBeDisabled());
    fireEvent.click(screen.getAllByRole('button', { name: /Cycle/ })[1]);
    await waitFor(() => expect(calls.some(c => c.type === 'thinking.cycle')).toBe(true));
  });

  it('Escape closes the dialog', () => {
    const { client } = fakeClient();
    const { onClose } = renderDialog(client);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('surfaces model.list failures as an alert', async () => {
    const { client } = fakeClient({ 'model.list': new Error('daemon down') });
    renderDialog(client);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('daemon down'));
  });
});
