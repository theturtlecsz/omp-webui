/** OMP-492: oversight routes against a Bun.serve fake of the OMP client contract. */
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { oversightClientFromEnv } from "../src/oversight.js";
import { Daemon } from "../src/server.js";

const WORKSPACE = "00000000-0000-0000-0000-000000000001";
const P1 = "00000000-0000-0000-0000-0000000000f1";
const M1 = "00000000-0000-0000-0000-0000000000d1";
const D1 = "00000000-0000-0000-0000-0000000000c1";
const TOKEN = "fake-client-token";

const envelope = (operation: string, result: Record<string, unknown>) => ({
  outcome: "read", state: null, evidence: [], blockers: [], decisions: [], artifacts: [],
  operation, contract: "client.omp.dev/v1", result, detail: null,
});

let tmp: string;
let ledger: ReturnType<typeof Bun.serve>;
let daemons: Daemon[] = [];
let calls: { method: string; path: string }[] = [];
let decisionStatus = "pending";

function startLedger() {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      calls.push({ method: req.method, path: url.pathname });
      if (req.headers.get("authorization") !== `Bearer ${TOKEN}`) return new Response("unauthorized", { status: 401 });
      const p = url.pathname;
      if (p.endsWith("/client/stop")) {
        return Response.json(req.method === "POST"
          ? { ...envelope("stop.engage", { type: "engage_stop", stopped: true, reason: "hold" }), outcome: "applied" }
          : envelope("stop.status", { workspace_id: WORKSPACE, stopped: false, reason: null, changed_at: null }));
      }
      if (p.endsWith("/client/projects")) return Response.json(envelope("project.list", { projects: [{ project_id: P1, key: "alpha", name: "Alpha" }] }));
      if (p.endsWith(`/${P1}/status`)) return Response.json(envelope("project.status", { mission_progress: [{ mission_id: M1, objective: "ship", status: "running", revision: 1, updated_at: "2026-10-01T00:00:00Z" }] }));
      if (p.endsWith(`/${P1}/decisions`)) return Response.json(envelope("project.decisions", { decisions: [{ decision_id: D1, project_id: P1, mission_id: M1, status: decisionStatus, question: "Adopt?", why_it_matters: "gate", options: ["yes", "no"], default_if_any: "yes", evidence_refs: [] }] }));
      if (p.endsWith(`/${M1}`)) return Response.json(envelope("mission.status", { transitions: [{ at: "2026-10-01T00:00:00Z" }], links: [], drawn: { usd: "1.00", wall_clock_seconds: 5 } }));
      return new Response("not found", { status: 404 });
    },
  });
}

/** A fresh Daemon each call models a restart: no state carries over. */
async function startDaemon(): Promise<string> {
  const client = oversightClientFromEnv({
    OMP_WORK_BASE_URL: `http://127.0.0.1:${ledger.port}`,
    OMP_WORK_WORKSPACE_ID: WORKSPACE,
    OMP_WORK_CAPABILITY_FILE: join(tmp, "client.json"),
  });
  const daemon = new Daemon({ host: "127.0.0.1", port: 0, oversightClient: client });
  await daemon.start();
  daemons.push(daemon);
  return `http://127.0.0.1:${daemon.port}`;
}

const pending = async (base: string) =>
  ((await (await fetch(`${base}/api/oversight`)).json()) as { projects: { pendingDecisions: { decision_id: string }[] }[] })
    .projects.flatMap((p) => p.pendingDecisions.map((d) => d.decision_id));

afterEach(async () => {
  for (const d of daemons) await d.stop();
  daemons = [];
  ledger?.stop(true);
  rmSync(tmp, { recursive: true, force: true });
  calls = [];
  decisionStatus = "pending";
});

async function setup() {
  tmp = mkdtempSync(join(tmpdir(), "ompd-oversight-"));
  writeFileSync(join(tmp, "client.json"), JSON.stringify({ actor_kind: "client", token: TOKEN }), { mode: 0o600 });
  ledger = startLedger();
}

test("a pending decision is listed before and after a daemon restart", async () => {
  await setup();
  const first = await startDaemon();
  expect(await pending(first)).toEqual([D1]);
  await daemons[0]!.stop();
  const second = await startDaemon();
  expect(await pending(second)).toEqual([D1]);
  decisionStatus = "answered";
  expect(await pending(second)).toEqual([]);
});

test("stop makes exactly one POST client/stop and no mission request", async () => {
  await setup();
  const base = await startDaemon();
  const res = await fetch(`${base}/api/oversight/stop`, { method: "POST", body: JSON.stringify({ reason: "hold" }) });
  expect(await res.json()).toEqual({ stopped: true });
  expect(calls).toEqual([{ method: "POST", path: `/v1/workspaces/${WORKSPACE}/client/stop` }]);
});

test("unconfigured daemon answers 503, stop with empty reason answers 400", async () => {
  await setup();
  const bare = new Daemon({ host: "127.0.0.1", port: 0 });
  await bare.start();
  daemons.push(bare);
  expect((await fetch(`http://127.0.0.1:${bare.port}/api/oversight`)).status).toBe(503);
  const base = await startDaemon();
  const res = await fetch(`${base}/api/oversight/stop`, { method: "POST", body: JSON.stringify({ reason: " " }) });
  expect(res.status).toBe(400);
  expect(calls.length).toBe(0);
});
