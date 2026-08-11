import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import {
  listProviders,
  modelsConfigPath,
  readModelsConfig,
  removeModel,
  removeProvider,
  upsertModel,
  upsertProvider,
  writeModelsConfig,
  ProviderConfigError,
} from "../src/providers.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "providers-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const stubProvider = {
  id: "teststub",
  api: "openai-completions",
  baseUrl: "http://127.0.0.1:8788/v1",
  apiKey: "test-key",
  models: [{ id: "stub-1", name: "Stub Model 1", contextWindow: 128000, maxTokens: 4096 }],
};

describe("read/write round-trip", () => {
  test("missing file yields empty config", () => {
    expect(readModelsConfig(dir)).toEqual({});
  });

  test("write is parseable YAML in omp's schema shape", () => {
    writeModelsConfig(dir, upsertProvider(dir, stubProvider));
    const raw = readFileSync(modelsConfigPath(dir), "utf8");
    const parsed = parse(raw) as { providers: Record<string, { models: { id: string }[] }> };
    expect(parsed.providers.teststub.models[0].id).toBe("stub-1");
    // omp's own file: comments preserved? No — we rewrite. Verify required keys survive.
    expect(parsed.providers.teststub).toMatchObject({ api: "openai-completions", baseUrl: "http://127.0.0.1:8788/v1" });
  });

  test("preserves pre-existing providers and unknown fields", () => {
    writeFileSync(
      modelsConfigPath(dir),
      "# a comment\nproviders:\n  other:\n    api: anthropic-messages\n    compat:\n      supportsReasoningEffort: true\n    models:\n      - id: claude-x\n",
    );
    writeModelsConfig(dir, upsertProvider(dir, stubProvider));
    const providers = readModelsConfig(dir);
    expect(Object.keys(providers).sort()).toEqual(["other", "teststub"]);
    expect((providers.other as { compat?: unknown }).compat).toEqual({ supportsReasoningEffort: true });
  });
});

describe("upsertProvider", () => {
  test("rejects invalid ids", () => {
    expect(() => upsertProvider(dir, { ...stubProvider, id: "bad id!" })).toThrow(ProviderConfigError);
    expect(() => upsertProvider(dir, { ...stubProvider, id: "" })).toThrow(ProviderConfigError);
  });

  test("rejects unknown api values", () => {
    expect(() => upsertProvider(dir, { ...stubProvider, api: "not-a-real-api" })).toThrow(ProviderConfigError);
  });

  test("rejects a provider with no models", () => {
    expect(() => upsertProvider(dir, { ...stubProvider, models: [] })).toThrow(ProviderConfigError);
  });

  test("omitted apiKey keeps existing; empty string clears it", () => {
    writeModelsConfig(dir, upsertProvider(dir, stubProvider));
    // update baseUrl without touching the key
    writeModelsConfig(dir, upsertProvider(dir, { id: "teststub", baseUrl: "http://127.0.0.1:9999/v1" }));
    let providers = readModelsConfig(dir);
    expect(providers.teststub).toMatchObject({ apiKey: "test-key", baseUrl: "http://127.0.0.1:9999/v1" });
    // explicit empty string clears
    writeModelsConfig(dir, upsertProvider(dir, { id: "teststub", apiKey: "" }));
    providers = readModelsConfig(dir);
    expect("apiKey" in providers.teststub).toBe(false);
  });
});

describe("model add/remove", () => {
  beforeEach(() => {
    writeModelsConfig(dir, upsertProvider(dir, stubProvider));
  });

  test("upsertModel appends then updates in place", () => {
    writeModelsConfig(dir, upsertModel(dir, "teststub", { id: "stub-2", reasoning: true, input: ["text", "image"] }));
    let providers = readModelsConfig(dir);
    expect((providers.teststub.models as { id: string }[]).map((m) => m.id)).toEqual(["stub-1", "stub-2"]);
    writeModelsConfig(dir, upsertModel(dir, "teststub", { id: "stub-2", name: "Renamed" }));
    providers = readModelsConfig(dir);
    const models = providers.teststub.models as { id: string; name?: string; reasoning?: boolean }[];
    expect(models).toHaveLength(2);
    expect(models[1]).toMatchObject({ id: "stub-2", name: "Renamed", reasoning: true });
  });

  test("upsertModel on missing provider throws", () => {
    expect(() => upsertModel(dir, "nope", { id: "x" })).toThrow(ProviderConfigError);
  });

  test("removeModel removes; last model is refused", () => {
    writeModelsConfig(dir, upsertModel(dir, "teststub", { id: "stub-2" }));
    writeModelsConfig(dir, removeModel(dir, "teststub", "stub-1")!);
    let providers = readModelsConfig(dir);
    expect((providers.teststub.models as { id: string }[]).map((m) => m.id)).toEqual(["stub-2"]);
    expect(() => removeModel(dir, "teststub", "stub-2")).toThrow(ProviderConfigError);
    expect(removeModel(dir, "teststub", "ghost")).toBeNull();
  });

  test("removeProvider removes and reports missing", () => {
    const next = removeProvider(dir, "teststub");
    expect(next).not.toBeNull();
    writeModelsConfig(dir, next!);
    expect(readModelsConfig(dir)).toEqual({});
    expect(removeProvider(dir, "teststub")).toBeNull();
  });
});

describe("listProviders", () => {
  test("masks apiKey and drops unknown fields", () => {
    writeFileSync(
      modelsConfigPath(dir),
      "providers:\n  teststub:\n    api: openai-completions\n    apiKey: super-secret\n    authHeader: true\n    discovery:\n      type: ollama\n    models:\n      - id: stub-1\n        name: One\n        reasoning: true\n        input: [text, image]\n",
    );
    const list = listProviders(dir);
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      id: "teststub",
      api: "openai-completions",
      hasApiKey: true,
      authHeader: true,
      models: [{ id: "stub-1", name: "One", reasoning: true, input: ["text", "image"] }],
    });
    expect(JSON.stringify(list)).not.toContain("super-secret");
    expect(JSON.stringify(list)).not.toContain("discovery");
  });

  test("empty agent dir yields empty list", () => {
    expect(listProviders(dir)).toEqual([]);
    expect(existsSync(modelsConfigPath(dir))).toBe(false);
  });
});
