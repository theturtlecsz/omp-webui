/**
 * providers.ts — provider/model CRUD against omp's models.yml.
 *
 * Verified against the installed omp 17.2.13 schema
 * (@oh-my-pi/pi-coding-agent dist/types/config/models-config.d.ts):
 *   providers.<name>: { api?, apiKey?, auth?, authHeader?, baseUrl?,
 *     headers?, models?: [{ id, name?, contextWindow?, maxTokens?,
 *     reasoning?, input?, ... }] }
 *
 * omp loads models.yml at worker startup only — there is no file watcher
 * (verified against the 5 watch() call sites in dist/cli.js, none target
 * models.yml). After a write, callers must restart idle workers so the next
 * spawn picks up the new config; server.ts does exactly that.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";

/** omp-supported provider wire APIs (from models-config.d.ts). */
export const PROVIDER_APIS = [
  "anthropic-messages",
  "azure-openai-responses",
  "bedrock-converse-stream",
  "google-gemini-cli",
  "google-generative-ai",
  "google-vertex",
  "openai-codex-responses",
  "openai-completions",
  "openai-responses",
] as const;

export type ProviderApi = (typeof PROVIDER_APIS)[number];

export interface ModelConfigInput {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: string[]; // subset of ("text" | "image")[]
}

export interface ProviderConfigInput {
  id: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  /** Omitted = keep existing key (upsert) / none (create). Empty string clears. */
  apiKey?: string;
  authHeader?: boolean;
  headers?: Record<string, string>;
  models?: ModelConfigInput[];
}

/** What the WebUI receives. apiKey is never transmitted — only hasApiKey. */
export interface ProviderSummary {
  id: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  hasApiKey: boolean;
  authHeader: boolean;
  headers?: Record<string, string>;
  models: ModelConfigInput[];
}

type RawModel = Record<string, unknown>;
type RawProvider = Record<string, unknown> & { models?: unknown };

export class ProviderConfigError extends Error {
  readonly code = "provider_config_invalid";
}

const PROVIDER_ID_RE = /^[\w.-]+$/;

export function agentDirFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".omp", "agent");
}

export function modelsConfigPath(agentDir: string): string {
  return join(agentDir, "models.yml");
}

/** Read + parse models.yml. Missing file → empty config. */
export function readModelsConfig(agentDir: string): Record<string, RawProvider> {
  const path = modelsConfigPath(agentDir);
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  const parsed = parse(raw) as { providers?: Record<string, RawProvider> } | null;
  return parsed?.providers ?? {};
}

/** Atomic write (tmp + rename) preserving key order of the given map. */
export function writeModelsConfig(agentDir: string, providers: Record<string, RawProvider>): void {
  mkdirSync(agentDir, { recursive: true });
  const path = modelsConfigPath(agentDir);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, stringify({ providers }, { indent: 2 }), "utf8");
  renameSync(tmp, path);
}

function validateModel(m: ModelConfigInput, ctx: string): void {
  if (!m || typeof m.id !== "string" || !m.id.trim()) {
    throw new ProviderConfigError(`${ctx}: model requires a non-empty id`);
  }
  if (m.contextWindow !== undefined && (!Number.isInteger(m.contextWindow) || m.contextWindow <= 0)) {
    throw new ProviderConfigError(`${ctx}: contextWindow must be a positive integer`);
  }
  if (m.maxTokens !== undefined && (!Number.isInteger(m.maxTokens) || m.maxTokens <= 0)) {
    throw new ProviderConfigError(`${ctx}: maxTokens must be a positive integer`);
  }
  if (m.input !== undefined) {
    const bad = m.input.filter((v) => v !== "text" && v !== "image");
    if (!Array.isArray(m.input) || bad.length > 0) {
      throw new ProviderConfigError(`${ctx}: input entries must be "text" or "image"`);
    }
  }
}

function toRawModel(m: ModelConfigInput): RawModel {
  const out: RawModel = { id: m.id.trim() };
  if (m.name?.trim()) out.name = m.name.trim();
  if (m.contextWindow !== undefined) out.contextWindow = m.contextWindow;
  if (m.maxTokens !== undefined) out.maxTokens = m.maxTokens;
  if (m.reasoning) out.reasoning = true;
  if (m.input?.length) out.input = m.input;
  return out;
}

/** Upsert a provider. Returns the updated provider map. */
export function upsertProvider(agentDir: string, cfg: ProviderConfigInput): Record<string, RawProvider> {
  const id = cfg.id?.trim();
  if (!id || !PROVIDER_ID_RE.test(id)) {
    throw new ProviderConfigError("provider id must be non-empty and contain only letters, digits, ., _, -");
  }
  if (cfg.api !== undefined && cfg.api !== "" && !PROVIDER_APIS.includes(cfg.api as ProviderApi)) {
    throw new ProviderConfigError(`api must be one of: ${PROVIDER_APIS.join(", ")}`);
  }
  const providers = readModelsConfig(agentDir);
  const existing = providers[id] ?? {};
  const models = (cfg.models ?? (existing.models as ModelConfigInput[] | undefined) ?? []);
  if (models.length === 0) {
    throw new ProviderConfigError("provider requires at least one model");
  }
  models.forEach((m) => validateModel(m, `provider ${id}`));
  const next: RawProvider = { ...existing };
  if (cfg.name !== undefined) { cfg.name.trim() ? (next.name = cfg.name.trim()) : delete next.name; }
  if (cfg.api !== undefined) { cfg.api ? (next.api = cfg.api) : delete next.api; }
  if (cfg.baseUrl !== undefined) { cfg.baseUrl.trim() ? (next.baseUrl = cfg.baseUrl.trim()) : delete next.baseUrl; }
  if (cfg.apiKey !== undefined) { cfg.apiKey ? (next.apiKey = cfg.apiKey) : delete next.apiKey; }
  if (cfg.authHeader !== undefined) { cfg.authHeader ? (next.authHeader = true) : delete next.authHeader; }
  if (cfg.headers !== undefined) {
    if (Object.keys(cfg.headers).length > 0) next.headers = cfg.headers;
    else delete next.headers;
  }
  if (cfg.models !== undefined || !existing.models) next.models = models.map(toRawModel);
  return { ...providers, [id]: next };
}

export function removeProvider(agentDir: string, id: string): Record<string, RawProvider> | null {
  const providers = readModelsConfig(agentDir);
  if (!(id in providers)) return null;
  const { [id]: _removed, ...rest } = providers;
  return rest;
}

/** Upsert one model within an existing provider. */
export function upsertModel(agentDir: string, providerId: string, m: ModelConfigInput): Record<string, RawProvider> {
  const providers = readModelsConfig(agentDir);
  const provider = providers[providerId];
  if (!provider) throw new ProviderConfigError(`provider ${providerId} does not exist`);
  validateModel(m, `provider ${providerId}`);
  const models = Array.isArray(provider.models) ? (provider.models as RawModel[]) : [];
  const idx = models.findIndex((x) => x && x.id === m.id.trim());
  const next = [...models];
  if (idx >= 0) next[idx] = { ...next[idx], ...toRawModel(m) };
  else next.push(toRawModel(m));
  return { ...providers, [providerId]: { ...provider, models: next } };
}

export function removeModel(agentDir: string, providerId: string, modelId: string): Record<string, RawProvider> | null {
  const providers = readModelsConfig(agentDir);
  const provider = providers[providerId];
  if (!provider) throw new ProviderConfigError(`provider ${providerId} does not exist`);
  const models = Array.isArray(provider.models) ? (provider.models as RawModel[]) : [];
  const next = models.filter((x) => x && x.id !== modelId);
  if (next.length === models.length) return null;
  if (next.length === 0) {
    throw new ProviderConfigError(`cannot remove the last model of provider ${providerId}; remove the provider instead`);
  }
  return { ...providers, [providerId]: { ...provider, models: next } };
}

/** Browser-safe listing: secrets masked, unknown extra fields dropped. */
export function listProviders(agentDir: string): ProviderSummary[] {
  const providers = readModelsConfig(agentDir);
  return Object.entries(providers).map(([id, p]) => {
    const models = Array.isArray(p.models) ? (p.models as RawModel[]) : [];
    return {
      id,
      ...(typeof p.name === "string" ? { name: p.name } : {}),
      ...(typeof p.api === "string" ? { api: p.api } : {}),
      ...(typeof p.baseUrl === "string" ? { baseUrl: p.baseUrl } : {}),
      hasApiKey: typeof p.apiKey === "string" && p.apiKey.length > 0,
      authHeader: p.authHeader === true,
      ...(p.headers && typeof p.headers === "object" ? { headers: p.headers as Record<string, string> } : {}),
      models: models.map((m) => ({
        id: String(m?.id ?? ""),
        ...(typeof m?.name === "string" ? { name: m.name } : {}),
        ...(typeof m?.contextWindow === "number" ? { contextWindow: m.contextWindow } : {}),
        ...(typeof m?.maxTokens === "number" ? { maxTokens: m.maxTokens } : {}),
        ...(m?.reasoning === true ? { reasoning: true } : {}),
        ...(Array.isArray(m?.input) ? { input: m.input as string[] } : {}),
      })).filter((m) => m.id),
    };
  });
}
