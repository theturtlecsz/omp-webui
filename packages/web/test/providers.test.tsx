import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProvidersPanel, type ProviderSummary } from '../src/components/ProvidersPanel';
import type { DaemonClient } from '../src/lib/client';

const stub: ProviderSummary = {
  id: 'teststub',
  api: 'openai-completions',
  baseUrl: 'http://127.0.0.1:8788/v1',
  hasApiKey: true,
  authHeader: false,
  models: [{ id: 'stub-1', name: 'Stub Model 1', contextWindow: 128000 }],
};

type EventHandler = (e: { type: string; payload?: unknown }) => void;

function fakeClient(overrides: Record<string, unknown> = {}) {
  const calls: { type: string; payload: unknown }[] = [];
  const handlers = new Set<EventHandler>();
  const client = {
    command: vi.fn((type: string, payload?: unknown) => {
      calls.push({ type, payload });
      if (type === 'provider.list') return Promise.resolve({ providers: [stub] });
      if (overrides[type] !== undefined) {
        const v = overrides[type];
        return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
      }
      return Promise.resolve({ providers: [stub] });
    }),
    onEvent: vi.fn((h: EventHandler) => { handlers.add(h); return () => handlers.delete(h); }),
    emit: (e: { type: string; payload?: unknown }) => handlers.forEach((h) => h(e)),
  } as unknown as DaemonClient & { emit: (e: { type: string; payload?: unknown }) => void };
  return { client, calls };
}

describe('ProvidersPanel (gap #5)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists providers with masked keys on mount', async () => {
    fakeClient();
    const { client } = fakeClient();
    render(<ProvidersPanel client={client} />);
    await screen.findByText('Stub Model 1');
    expect(screen.getAllByText('teststub').length).toBeGreaterThan(0);
    expect(screen.getByText('set')).toBeInTheDocument(); // hasApiKey → "set", never the key
    expect(screen.getByText('openai-completions')).toBeInTheDocument();
  });

  it('add provider submits provider.add with a first model', async () => {
    const { client, calls } = fakeClient();
    render(<ProvidersPanel client={client} />);
    await screen.findByText('Stub Model 1');
    fireEvent.click(screen.getByRole('button', { name: /add provider/i }));
    fireEvent.change(screen.getByLabelText('Provider id'), { target: { value: 'acme' } });
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'http://x/v1' } });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-1' } });
    fireEvent.change(screen.getByLabelText('First model id'), { target: { value: 'm-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save provider' }));
    await waitFor(() => expect(calls.some((c) => c.type === 'provider.add')).toBe(true));
    expect(calls.find((c) => c.type === 'provider.add')!.payload).toEqual({
      id: 'acme', api: 'openai-completions', baseUrl: 'http://x/v1', apiKey: 'sk-1',
      models: [{ id: 'm-1' }],
    });
  });

  it('omits empty optional fields from provider.add payload', async () => {
    const { client, calls } = fakeClient();
    render(<ProvidersPanel client={client} />);
    await screen.findByText('Stub Model 1');
    fireEvent.click(screen.getByRole('button', { name: /add provider/i }));
    fireEvent.change(screen.getByLabelText('Provider id'), { target: { value: 'acme' } });
    fireEvent.change(screen.getByLabelText('First model id'), { target: { value: 'm-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save provider' }));
    await waitFor(() => expect(calls.some((c) => c.type === 'provider.add')).toBe(true));
    const payload = calls.find((c) => c.type === 'provider.add')!.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty('baseUrl');
    expect(payload).not.toHaveProperty('apiKey');
  });

  it('add model sends model.add and clears the draft', async () => {
    const { client, calls } = fakeClient();
    render(<ProvidersPanel client={client} />);
    await screen.findByText('Stub Model 1');
    fireEvent.change(screen.getByLabelText('New model id for teststub'), { target: { value: 'stub-2' } });
    fireEvent.click(screen.getByLabelText('Add model to teststub'));
    await waitFor(() => expect(calls.some((c) => c.type === 'model.add')).toBe(true));
    expect(calls.find((c) => c.type === 'model.add')!.payload).toEqual({ providerId: 'teststub', model: { id: 'stub-2' } });
    expect((screen.getByLabelText('New model id for teststub') as HTMLInputElement).value).toBe('');
  });

  it('remove buttons send model.remove / provider.remove', async () => {
    const { client, calls } = fakeClient();
    render(<ProvidersPanel client={client} />);
    await screen.findByText('Stub Model 1');
    fireEvent.click(screen.getByLabelText('Remove model stub-1'));
    await waitFor(() => expect(calls.some((c) => c.type === 'model.remove')).toBe(true));
    expect(calls.find((c) => c.type === 'model.remove')!.payload).toEqual({ providerId: 'teststub', modelId: 'stub-1' });
    fireEvent.click(screen.getByLabelText('Remove provider teststub'));
    await waitFor(() => expect(calls.some((c) => c.type === 'provider.remove')).toBe(true));
  });

  it('surfaces daemon validation errors', async () => {
    const { client } = fakeClient({ 'provider.add': new Error('provider requires at least one model') });
    render(<ProvidersPanel client={client} />);
    await screen.findByText('Stub Model 1');
    fireEvent.click(screen.getByRole('button', { name: /add provider/i }));
    fireEvent.change(screen.getByLabelText('Provider id'), { target: { value: 'acme' } });
    fireEvent.change(screen.getByLabelText('First model id'), { target: { value: 'm-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save provider' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('at least one model');
  });

  it('applies providers.changed broadcasts from other clients', async () => {
    const { client } = fakeClient();
    render(<ProvidersPanel client={client} />);
    await screen.findByText('Stub Model 1');
    const updated: ProviderSummary = { ...stub, id: 'other', hasApiKey: false, models: [{ id: 'other-model' }] };
    client.emit({ type: 'providers.changed', payload: { providers: [updated] } });
    await waitFor(() => expect(screen.getAllByText('other-model').length).toBeGreaterThan(0));
    expect(screen.queryByText('Stub Model 1')).not.toBeInTheDocument();
  });
});
