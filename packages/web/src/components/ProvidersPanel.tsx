import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { DaemonClient } from '../lib/client';

export interface ModelConfig {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: string[];
}

export interface ProviderSummary {
  id: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  hasApiKey: boolean;
  authHeader: boolean;
  models: ModelConfig[];
}

const APIS = [
  'openai-completions',
  'openai-responses',
  'openai-codex-responses',
  'anthropic-messages',
  'azure-openai-responses',
  'google-generative-ai',
  'google-gemini-cli',
  'google-vertex',
  'bedrock-converse-stream',
] as const;

interface Draft {
  id: string;
  api: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  modelName: string;
}

const emptyDraft: Draft = { id: '', api: 'openai-completions', baseUrl: '', apiKey: '', modelId: '', modelName: '' };

/** Provider/model CRUD against omp's models.yml (gap #5). The daemon owns the
 * file writes and restarts idle workers so the next spawn picks up changes. */
export function ProvidersPanel({ client }: { client: DaemonClient }) {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});

  const refresh = useCallback(() => {
    client
      .command<{ providers: ProviderSummary[] }>('provider.list')
      .then((r) => { setProviders(r.providers); setError(''); })
      .catch((e: Error) => setError(e.message));
  }, [client]);

  useEffect(() => {
    refresh();
    const off = client.onEvent((e) => {
      if (e.type === 'providers.changed') {
        setProviders((e.payload as { providers: ProviderSummary[] }).providers);
      }
    });
    return () => { off(); };
  }, [refresh, client]);

  const submit = async (cmd: string, payload: unknown) => {
    try {
      const r = await client.command<{ providers: ProviderSummary[] }>(cmd as never, payload);
      setProviders(r.providers);
      setError('');
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  const addProvider = async () => {
    const ok = await submit('provider.add', {
      id: draft.id.trim(),
      api: draft.api,
      ...(draft.baseUrl.trim() ? { baseUrl: draft.baseUrl.trim() } : {}),
      ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
      models: [{ id: draft.modelId.trim(), ...(draft.modelName.trim() ? { name: draft.modelName.trim() } : {}) }],
    });
    if (ok) { setAdding(false); setDraft(emptyDraft); }
  };

  const addModel = async (providerId: string) => {
    const id = (modelDrafts[providerId] ?? '').trim();
    if (!id) return;
    const ok = await submit('model.add', { providerId, model: { id } });
    if (ok) setModelDrafts((d) => ({ ...d, [providerId]: '' }));
  };

  return (
    <section className="panel" aria-label="Providers">
      <header>
        <h2>Providers</h2>
        <button className="icon-button" aria-label="Refresh providers" onClick={refresh}><RefreshCw size={16} /></button>
      </header>
      <p className="panel-note">Edits write omp's models.yml. Idle sessions restart to pick up changes; a streaming session keeps its model until the next prompt.</p>
      {error && <p className="panel-error" role="alert">{error}</p>}
      {providers.length === 0 && !adding && (
        <p className="empty-panel">No custom providers — omp's built-in catalog still applies.</p>
      )}
      <ul className="provider-list">
        {providers.map((p) => (
          <li key={p.id} className="provider-card">
            <div className="provider-card__head">
              <strong>{p.name ?? p.id}</strong>
              <code>{p.id}</code>
              <button className="icon-button" aria-label={`Remove provider ${p.id}`} onClick={() => void submit('provider.remove', { id: p.id })}><Trash2 size={15} /></button>
            </div>
            <dl className="provider-card__meta">
              {p.api && <><dt>API</dt><dd>{p.api}</dd></>}
              {p.baseUrl && <><dt>Base URL</dt><dd className="u-truncate">{p.baseUrl}</dd></>}
              <dt>Key</dt><dd>{p.hasApiKey ? 'set' : '—'}</dd>
            </dl>
            <ul className="provider-card__models">
              {p.models.map((m) => (
                <li key={m.id}>
                  <span className="u-truncate">{m.name ?? m.id}</span>
                  <code>{m.id}</code>
                  <button className="icon-button" aria-label={`Remove model ${m.id}`} onClick={() => void submit('model.remove', { providerId: p.id, modelId: m.id })}><Trash2 size={14} /></button>
                </li>
              ))}
            </ul>
            <div className="provider-card__add-model">
              <input
                aria-label={`New model id for ${p.id}`}
                placeholder="model id"
                value={modelDrafts[p.id] ?? ''}
                onChange={(e) => setModelDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') void addModel(p.id); }}
              />
              <button className="icon-button" aria-label={`Add model to ${p.id}`} disabled={!(modelDrafts[p.id] ?? '').trim()} onClick={() => void addModel(p.id)}><Plus size={15} /></button>
            </div>
          </li>
        ))}
      </ul>
      {adding ? (
        <form className="provider-form" onSubmit={(e) => { e.preventDefault(); void addProvider(); }}>
          <label>Provider id<input required pattern="[\w.\-]+" value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} placeholder="my-provider" /></label>
          <label>Wire API
            <select value={draft.api} onChange={(e) => setDraft({ ...draft, api: e.target.value })}>
              {APIS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label>Base URL<input value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} placeholder="https://…/v1" /></label>
          <label>API key<input type="password" value={draft.apiKey} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} placeholder="stored in models.yml" /></label>
          <label>First model id<input required value={draft.modelId} onChange={(e) => setDraft({ ...draft, modelId: e.target.value })} placeholder="gpt-5.2" /></label>
          <label>Model name (optional)<input value={draft.modelName} onChange={(e) => setDraft({ ...draft, modelName: e.target.value })} /></label>
          <div className="provider-form__actions">
            <button type="submit">Save provider</button>
            <button type="button" onClick={() => { setAdding(false); setDraft(emptyDraft); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="provider-add" onClick={() => setAdding(true)}><Plus size={15} /> Add provider</button>
      )}
    </section>
  );
}
