#!/usr/bin/env bun
/**
 * Materializes an isolated OMP HOME for e2e runs.
 *
 * Rationale: e2e tests need a deterministic omp environment. Extensions installed
 * globally (e.g. session-system's linear-now.ts) inject synthetic messages into
 * every session, which changes the message stream the stub-llm sees and breaks
 * tests that key off substring matches ("use a tool", "markdown", image parts).
 *
 * This script builds a scratch OMP home that has:
 *   - the real models.yml (so the stub provider on :8788 is reachable)
 *   - empty extensions/ and rules/ (no third-party injections)
 *   - a scratch sessions/ + agent.db (isolated session state)
 *
 * Output path is printed to stdout. Callers should pass it as HOME= to the
 * omp/daemon child processes.
 */
import { mkdirSync, existsSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const scratchRoot = process.env.OMP_E2E_HOME ?? "/tmp/omp-webui-e2e-home";
const realHome = process.env.REAL_HOME ?? homedir();

// Start from a clean slate so no state leaks between runs.
if (existsSync(scratchRoot)) rmSync(scratchRoot, { recursive: true, force: true });

const scratchAgent = join(scratchRoot, ".omp", "agent");
mkdirSync(scratchAgent, { recursive: true });
mkdirSync(join(scratchAgent, "extensions"), { recursive: true });
mkdirSync(join(scratchAgent, "rules"), { recursive: true });
mkdirSync(join(scratchAgent, "sessions"), { recursive: true });
mkdirSync(join(scratchRoot, ".omp", "logs"), { recursive: true });
mkdirSync(join(scratchRoot, ".omp", "run"), { recursive: true });

// Copy the real models.yml so the stub provider config is present.
const realModels = join(realHome, ".omp", "agent", "models.yml");
const scratchModels = join(scratchAgent, "models.yml");
if (existsSync(realModels)) {
  cpSync(realModels, scratchModels);
} else {
  // Fallback: write a minimal stub provider config so tests still work on a
  // clean machine.
  writeFileSync(
    scratchModels,
    [
      "providers:",
      "  teststub:",
      "    baseUrl: http://127.0.0.1:8788/v1",
      "    api: openai-completions",
      "    apiKey: test-key",
      "    models:",
      "      - id: stub-1",
      "        name: Stub Model 1",
      "        contextWindow: 128000",
      "        maxTokens: 4096",
      "",
    ].join("\n"),
  );
}

console.log(scratchRoot);
