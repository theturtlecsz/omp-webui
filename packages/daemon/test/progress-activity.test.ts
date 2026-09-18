import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProviderRuns } from "../src/progress/activity.js";
import { Daemon } from "../src/server.js";

describe("readProviderRuns - activity freshness, liveness, and error boundaries", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "activity-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("derives age from feed file mtime and classifies live vs stale-live while preserving manifest startedAt", async () => {
    const feedPath = join(tmpDir, "activity.json");
    const manifestScopeStart = "2026-09-13T00:00:00.000Z";
    const manifest = {
      version: 1,
      scopeId: "webui-progress-20260913",
      scopeLabel: "OMP WebUI Progress",
      startedAt: manifestScopeStart,
      runs: [],
    };
    writeFileSync(feedPath, JSON.stringify(manifest), "utf-8");

    // 1. Fresh file test (mtime 10s ago)
    const now = Date.now();
    const tenSecAgo = new Date(now - 10000);
    utimesSync(feedPath, tenSecAgo, tenSecAgo);

    const freshResult = await readProviderRuns(feedPath, now);

    expect(freshResult.provenance.kind).toBe("live");
    expect(freshResult.provenance.ageSeconds).toBeGreaterThanOrEqual(9);
    expect(freshResult.provenance.ageSeconds).toBeLessThanOrEqual(15);
    expect(freshResult.provenance.errorClass).toBeNull();
    // Manifest scope startedAt preserved separately
    expect(freshResult.startedAt).toBe(manifestScopeStart);

    // 2. Stale file test (mtime 300s ago)
    const fiveMinAgo = new Date(now - 300000);
    utimesSync(feedPath, fiveMinAgo, fiveMinAgo);

    const staleResult = await readProviderRuns(feedPath, now);

    expect(staleResult.provenance.kind).toBe("stale-live");
    expect(staleResult.provenance.ageSeconds).toBeGreaterThanOrEqual(295);
    expect(staleResult.provenance.errorClass).toBeNull();
    expect(staleResult.startedAt).toBe(manifestScopeStart);

    // 3. Explicit snapshot kind in manifest provenance preserved
    const snapshotManifest = {
      ...manifest,
      provenance: { kind: "snapshot" },
    };
    writeFileSync(feedPath, JSON.stringify(snapshotManifest), "utf-8");
    utimesSync(feedPath, tenSecAgo, tenSecAgo);

    const snapshotResult = await readProviderRuns(feedPath, now);
    expect(snapshotResult.provenance.kind).toBe("snapshot");
  });

  it("verifies liveness with real live pid/start ticks, dead pid, and mismatched ticks", async () => {
    // Obtain real start ticks for current process from /proc/self/stat
    const procStat = await Bun.file("/proc/self/stat").text();
    const lastParen = procStat.lastIndexOf(")");
    const fields = procStat.slice(lastParen + 1).trim().split(/\s+/);
    const selfTicks = fields[19];

    const feedPath = join(tmpDir, "activity.json");
    const now = Date.now();

    const manifest = {
      version: 1,
      scopeId: "scope-liveness",
      startedAt: new Date(now - 60000).toISOString(),
      runs: [
        {
          id: "run-alive",
          provider: "agy-cli",
          requestedModel: "gemini-3.8-flash-high",
          role: "Implementation",
          title: "Live running job",
          status: "running",
          startedAt: new Date(now - 5000).toISOString(),
          pid: process.pid,
          pidStartTicks: selfTicks,
        },
        {
          id: "run-dead",
          provider: "agy-cli",
          requestedModel: "gemini-3.8-flash-high",
          role: "Implementation",
          title: "Dead running job",
          status: "running",
          startedAt: new Date(now - 10000).toISOString(),
          pid: 99999999, // guaranteed non-existent pid
          pidStartTicks: "12345",
        },
        {
          id: "run-mismatch",
          provider: "agy-cli",
          requestedModel: "gemini-3.8-flash-high",
          role: "Implementation",
          title: "Mismatched ticks job",
          status: "running",
          startedAt: new Date(now - 15000).toISOString(),
          pid: process.pid,
          pidStartTicks: "9999999999", // wrong ticks for current pid
        },
      ],
    };

    writeFileSync(feedPath, JSON.stringify(manifest), "utf-8");

    const result = await readProviderRuns(feedPath, now);

    const aliveRun = result.current.find((r) => r.id === "run-alive");
    expect(aliveRun).toBeDefined();
    expect(aliveRun?.liveness).toBe("alive");
    expect(aliveRun?.status).toBe("running");

    const deadRun = result.current.find((r) => r.id === "run-dead");
    expect(deadRun).toBeDefined();
    expect(deadRun?.liveness).toBe("dead");
    expect(deadRun?.status).toBe("interrupted");

    const mismatchRun = result.current.find((r) => r.id === "run-mismatch");
    expect(mismatchRun).toBeDefined();
    expect(mismatchRun?.liveness).toBe("mismatch");
    expect(mismatchRun?.status).toBe("interrupted");
  });

  it("handles malformed feeds and non-existent paths gracefully without throwing", async () => {
    const now = Date.now();

    // 1. Not found
    const missingResult = await readProviderRuns(join(tmpDir, "does-not-exist.json"), now);
    expect(missingResult.provenance.kind).toBe("unavailable");
    expect(missingResult.provenance.errorClass).toBe("not-found");

    // 2. Corrupted JSON
    const corruptedPath = join(tmpDir, "corrupted.json");
    writeFileSync(corruptedPath, "{ invalid json", "utf-8");
    const corruptedResult = await readProviderRuns(corruptedPath, now);
    expect(corruptedResult.provenance.kind).toBe("unavailable");
    expect(corruptedResult.provenance.errorClass).toBe("malformed");

    // 3. Invalid schema version
    const badVersionPath = join(tmpDir, "bad-version.json");
    writeFileSync(badVersionPath, JSON.stringify({ version: 99, runs: [] }), "utf-8");
    const badVersionResult = await readProviderRuns(badVersionPath, now);
    expect(badVersionResult.provenance.kind).toBe("unavailable");
    expect(badVersionResult.provenance.errorClass).toBe("malformed");

    // 4. Invalid startedAt date
    const badDatePath = join(tmpDir, "bad-date.json");
    writeFileSync(badDatePath, JSON.stringify({ version: 1, startedAt: "not-a-date", runs: [] }), "utf-8");
    const badDateResult = await readProviderRuns(badDatePath, now);
    expect(badDateResult.provenance.kind).toBe("unavailable");
    expect(badDateResult.provenance.errorClass).toBe("malformed");
  });
});

describe("server #serveProgress - projection failure error semantics", () => {
  let tmpDir: string;
  let daemon: Daemon;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "server-progress-test-"));
  });

  afterEach(async () => {
    if (daemon) await daemon.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns HTTP 500 with errorClass projection-error on projection failure without invented source state", async () => {
    daemon = new Daemon({
      host: "127.0.0.1",
      port: 0,
      dbPath: ":memory:",
      progress: {
        bin: "/non-existent/bin",
        manifest: "/non-existent/manifest",
        loader: () => Promise.reject(new Error("Unexpected projection explosion")),
      },
    });
    await daemon.start();

    const res = await fetch(`http://127.0.0.1:${daemon.port}/api/progress`, {
      headers: { host: `127.0.0.1:${daemon.port}` },
    });

    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("projection-error");
    expect(body.errorClass).toBe("projection-error");
    expect(body.message).toBe("Unexpected projection explosion");

    // Must NOT contain fabricated snapshot sources
    expect(body.sources).toBeUndefined();
    expect(body.contractVersion).toBeUndefined();
  });
});
