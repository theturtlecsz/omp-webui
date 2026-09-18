import { describe, expect, it } from "bun:test";
import { projectControl, projectSnapshot } from "../src/progress/project.js";
import type { ActivityView } from "../src/progress/activity.js";
import type { CollectorSuccess } from "../src/progress/collector.js";

describe("projectSnapshot - ledger done-state normalization", () => {
  const now = Date.parse("2026-09-13T06:30:00.000Z");

  const baseActivity: ActivityView = {
    provenance: { kind: "snapshot", observedAt: "2026-09-13T06:29:00.000Z", ageSeconds: 60, errorClass: null },
    scopeId: "webui-progress-20260913",
    scopeLabel: "OMP WebUI Progress",
    startedAt: "2026-09-13T00:00:00.000Z",
    current: [],
    history: [],
    limit: { maxRows: 200, truncated: false },
  };

  it("accepts uppercase DONE items when collector emits lowercase doneStates: ['done'] (real live shape)", () => {
    const doneKeys = ["OMP-202", "OMP-203", "OMP-204", "OMP-205", "OMP-206", "OMP-207", "OMP-208", "OMP-214"];
    const backlogKeys = ["OMP-217", "OMP-219", "OMP-228", "OMP-230", "OMP-233"];
    const allKeys = [...doneKeys, ...backlogKeys];

    const collector: CollectorSuccess = {
      ok: true,
      observedAt: "2026-09-13T06:30:00.000Z",
      data: {
        trackedLedger: {
          trackedKeys: allKeys,
          expectedCount: allKeys.length,
          doneStates: ["done"], // real collector emits lowercase
          counts: { done: doneKeys.length, total: allKeys.length, unknown: 0, byState: { DONE: doneKeys.length, BACKLOG: backlogKeys.length } },
          items: [
            ...doneKeys.map((key) => ({ key, state: "DONE" })), // real items emit uppercase
            ...backlogKeys.map((key) => ({ key, state: "BACKLOG" })),
          ],
          provenance: { kind: "live", observedAt: now, ageSeconds: 0, errorClass: null },
        },
      },
    };

    const snapshot = projectSnapshot(collector, baseActivity, now);

    // Canonical doneStates preserved in overall
    expect(snapshot.overall?.doneStates).toEqual(["done"]);
    expect(snapshot.overall?.done).toBe(8);
    expect(snapshot.overall?.total).toBe(13);
    expect(snapshot.overall?.byState).toEqual({ DONE: 8, BACKLOG: 5 });

    // Accepted contains all 8 DONE keys
    expect(snapshot.summary.accepted).toHaveLength(8);
    for (const k of doneKeys) {
      expect(snapshot.summary.accepted).toContain(k);
    }

    // Remaining contains only the BACKLOG keys
    expect(snapshot.summary.remaining).toHaveLength(5);
    for (const k of backlogKeys) {
      expect(snapshot.summary.remaining).toContain(k);
      expect(snapshot.summary.accepted).not.toContain(k);
    }
  });

  it("handles case-insensitive variants without inventing success for active/unknown states", () => {
    const collector: CollectorSuccess = {
      ok: true,
      observedAt: "2026-09-13T06:30:00.000Z",
      data: {
        trackedLedger: {
          trackedKeys: ["ITEM-1", "ITEM-2", "ITEM-3", "ITEM-4", "ITEM-5", "ITEM-6"],
          expectedCount: 6,
          doneStates: ["Done", "ACCEPTED"],
          counts: { done: 3, total: 6, unknown: 1, byState: { done: 1, DONE: 1, accepted: 1, ACTIVE: 1, unknown: 1, "": 1 } },
          items: [
            { key: "ITEM-1", state: "done" },       // matches Done
            { key: "ITEM-2", state: "DONE" },       // matches Done
            { key: "ITEM-3", state: "accepted" },   // matches ACCEPTED
            { key: "ITEM-4", state: "ACTIVE" },     // non-done state -> remaining
            { key: "ITEM-5", state: "unknown" },    // unknown state -> remaining
            { key: "ITEM-6", state: "" },           // empty state -> remaining
          ],
          provenance: { kind: "live", observedAt: now, ageSeconds: 0, errorClass: null },
        },
      },
    };

    const snapshot = projectSnapshot(collector, baseActivity, now);

    expect(snapshot.summary.accepted).toEqual(["ITEM-1", "ITEM-2", "ITEM-3"]);
    expect(snapshot.summary.remaining).toEqual(["ITEM-4", "ITEM-5", "ITEM-6"]);
  });

  it("preserves privacy by stripping private fields from output snapshot", () => {
    const collector: CollectorSuccess = {
      ok: true,
      observedAt: "2026-09-13T06:30:00.000Z",
      data: {
        coordinator: { nativeState: "RUNNING", work: "OMP-249", next: "qualification" },
        agentTree: { rootThreadId: "root", agents: [{ threadId: "root", model: "gpt-6-astra" }] },
        trackedLedger: {
          trackedKeys: ["OMP-202"],
          doneStates: ["done"],
          items: [{ key: "OMP-202", state: "DONE" }],
        },
        private: "/home/thetu/private/raw-command",
        secret: "bearer-token-12345",
      },
    };

    const activity: ActivityView = {
      ...baseActivity,
      current: [
        {
          id: "run-1",
          provider: "agy-cli",
          requestedModel: "gemini-3.8-flash-high",
          observedModel: "gemini-3.8-flash-high",
          role: "Implementation",
          title: "test run",
          startedAt: now - 5000,
          finishedAt: now,
          status: "finished",
          liveness: "unknown",
          cost: { usd: null, inputTokens: null, outputTokens: null },
          reviewVerdict: "unknown",
          pid: 9999,
          pidStartTicks: "12345",
          receiptPath: "/home/thetu/private/receipt.json",
        },
      ],
    };

    const snapshot = projectSnapshot(collector, activity, now);
    const serialized = JSON.stringify(snapshot);

    expect(serialized).not.toContain("receiptPath");
    expect(serialized).not.toContain("pidStartTicks");
    expect(serialized).not.toContain("/home/thetu/private");
    expect(serialized).not.toContain("bearer-token-12345");
  });

  it("extracts model, thread count, and coordinator provenance from real collector data.agents shape", () => {
    const coordObservedAtMs = 1789240455344;
    const collector: CollectorSuccess = {
      ok: true,
      observedAt: "2026-09-13T06:30:00.000Z",
      data: {
        coordinator: {
          provenance: {
            kind: "snapshot",
            label: "coordinator snapshot",
            observedAt: coordObservedAtMs,
            errorClass: null,
            ageSeconds: 40188,
          },
          updatedAt: "2026-09-12T19:14:15.344265+00:00",
          work: "OMP-249",
          nativeState: "BACKLOG; deployment preparation; no execution grant",
          next: "Finish tiered controller qualification; then resume OMP-249 deployment",
          note: "non-authoritative",
        },
        agents: {
          rootThreadId: "01a095f1-cfcb-7c20-a49e-06d9f3128941",
          agents: [
            {
              threadId: "01a095f1-cfcb-7c20-a49e-06d9f3128941",
              parentThreadId: null,
              model: "gpt-6-astra",
              turn: { state: "active" },
            },
            {
              threadId: "01a095f2-aa2b-75a3-b3d6-64bfab04efcb",
              parentThreadId: "01a095f1-cfcb-7c20-a49e-06d9f3128941",
              model: "gpt-6-astra",
            },
            {
              threadId: "01a098c9-ded1-7e81-9f45-f3cf1d045c19",
              parentThreadId: "01a095f1-cfcb-7c20-a49e-06d9f3128941",
              model: "gpt-5.6-luna",
            },
          ],
          limit: { maxRows: 2000, truncated: false, scanned: 3 },
          provenance: { kind: "live", observedAt: 1789280644229, ageSeconds: 0, errorClass: null },
        },
      },
    };

    const snapshot = projectSnapshot(collector, baseActivity, now);

    expect(snapshot.coordinator).not.toBeNull();
    expect(snapshot.coordinator?.model).toBe("gpt-6-astra");
    expect(snapshot.coordinator?.internalThreadCount).toBe(3);
    expect(snapshot.coordinator?.work).toBe("OMP-249");
    expect(snapshot.coordinator?.nativeState).toBe("BACKLOG; deployment preparation; no execution grant");
    expect(snapshot.coordinator?.next).toBe("Finish tiered controller qualification; then resume OMP-249 deployment");
    expect(snapshot.coordinator?.note).toBe("non-authoritative");

    // Provenance truthful and preserved
    expect(snapshot.coordinator?.provenance).toEqual({
      kind: "snapshot",
      observedAt: new Date(coordObservedAtMs).toISOString(),
      ageSeconds: 40188,
      errorClass: null,
    });
  });

  it("supports backward-compatible agentTree fallback when agents is absent", () => {
    const collector: CollectorSuccess = {
      ok: true,
      observedAt: "2026-09-13T06:30:00.000Z",
      data: {
        coordinator: {
          nativeState: "IDLE",
          work: null,
          next: null,
        },
        agentTree: {
          rootThreadId: "legacy-root",
          agents: [
            { threadId: "legacy-root", model: "claude-fable-5-1" },
          ],
        },
      },
    };

    const snapshot = projectSnapshot(collector, baseActivity, now);

    expect(snapshot.coordinator?.model).toBe("claude-fable-5-1");
    expect(snapshot.coordinator?.internalThreadCount).toBe(1);
    expect(snapshot.coordinator?.provenance).toBeNull();
  });

  it("leaves summary.accepted and summary.remaining empty when rawLedger.items is absent while preserving overall counts", () => {
    const trackedKeys = ["OMP-202", "OMP-203", "OMP-204", "OMP-205", "OMP-206", "OMP-207", "OMP-208", "OMP-214"];
    const collector: CollectorSuccess = {
      ok: true,
      observedAt: "2026-09-13T06:30:00.000Z",
      data: {
        trackedLedger: {
          trackedKeys,
          expectedCount: trackedKeys.length,
          doneStates: ["done"],
          counts: { done: 8, total: 8, unknown: 0, byState: { DONE: 8 } },
          // items absent: key-level state unknown
          provenance: { kind: "live", observedAt: now, ageSeconds: 0, errorClass: null },
        },
      },
    };

    const snapshot = projectSnapshot(collector, baseActivity, now);

    // Overall done counts and metadata are preserved
    expect(snapshot.overall?.done).toBe(8);
    expect(snapshot.overall?.total).toBe(8);
    expect(snapshot.overall?.trackedKeys).toEqual(trackedKeys);
    expect(snapshot.overall?.byState).toEqual({ DONE: 8 });

    // Key-level state is unknown, so accepted and remaining are empty (no contradiction with done > 0)
    expect(snapshot.summary.accepted).toEqual([]);
    expect(snapshot.summary.remaining).toEqual([]);
  });

  it("attaches projected control state to snapshot when provided", () => {
    const collector: CollectorSuccess = {
      ok: true,
      observedAt: "2026-09-13T06:30:00.000Z",
      data: {
        coordinator: null,
        trackedLedger: null,
      },
    };
    const controlState = {
      source: { kind: "live" as const, observedAt: "2026-09-13T06:30:00.000Z", ageSeconds: 0, errorClass: null },
      state: {
        grantRef: "1234abcd",
        state: "active" as const,
        grantVersion: 1,
        mode: "single" as const,
        activeWorkKey: null,
        pausedAt: null,
        stoppedAt: null,
        expiresAt: null,
        terminalReason: null,
        canPause: true,
        canStop: true,
      },
    };
    const snapshot = projectSnapshot(collector, baseActivity, now, controlState);
    expect(snapshot.control).toBeDefined();
    expect(snapshot.control?.source.kind).toBe("live");
    expect(snapshot.control?.state?.grantRef).toBe("1234abcd");
  });
});

describe("projectControl", () => {
  it("projects valid control object with derived canPause and canStop", () => {
    const raw = {
      grantRef: "1234abcd",
      state: "active",
      grantVersion: 3,
      mode: "single",
      activeWorkKey: "EXEC-42",
      pausedAt: null,
      stoppedAt: null,
      expiresAt: "2026-09-18T12:00:00.000Z",
      terminalReason: null,
    };
    const ctrl = projectControl(raw);
    expect(ctrl).not.toBeNull();
    expect(ctrl?.grantRef).toBe("1234abcd");
    expect(ctrl?.state).toBe("active");
    expect(ctrl?.grantVersion).toBe(3);
    expect(ctrl?.mode).toBe("single");
    expect(ctrl?.activeWorkKey).toBe("EXEC-42");
    expect(ctrl?.canPause).toBe(true);
    expect(ctrl?.canStop).toBe(true);
  });

  it("handles paused state with canPause=false and canStop=true", () => {
    const raw = {
      grantRef: "abcdef01",
      state: "paused",
      grantVersion: 4,
      mode: "queue",
      activeWorkKey: "EXEC-43",
      pausedAt: "2026-09-18T10:00:00.000Z",
      stoppedAt: null,
      expiresAt: null,
      terminalReason: null,
    };
    const ctrl = projectControl(raw);
    expect(ctrl).not.toBeNull();
    expect(ctrl?.canPause).toBe(false);
    expect(ctrl?.canStop).toBe(true);
  });

  it("handles terminal states with canPause=false and canStop=false", () => {
    for (const st of ["stopped", "completed", "canceled"] as const) {
      const raw = {
        grantRef: "abcdef02",
        state: st,
        grantVersion: 5,
        mode: "single",
        activeWorkKey: null,
        pausedAt: null,
        stoppedAt: "2026-09-18T11:00:00.000Z",
        expiresAt: null,
        terminalReason: "finished",
      };
      const ctrl = projectControl(raw);
      expect(ctrl?.canPause).toBe(false);
      expect(ctrl?.canStop).toBe(false);
    }
  });

  it("strips private and unknown keys from control projection", () => {
    const rawWithPrivates = {
      grantRef: "1234abcd",
      state: "active",
      grantVersion: 1,
      mode: "single",
      activeWorkKey: "EXEC-1",
      pausedAt: null,
      stoppedAt: null,
      expiresAt: null,
      terminalReason: null,
      // Private fields that must NEVER leak through
      grant_id: "1234abcd-secret-full-uuid",
      judge_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      bearer: "sec_bearer_token_12345",
      owner_id: "user-thetu",
      authorization_hash: "deadbeefcafebabe",
      repository: "/home/thetu/repo",
      remote_ref: "refs/heads/main",
    };
    const ctrl = projectControl(rawWithPrivates) as any;
    expect(ctrl).not.toBeNull();
    expect(ctrl.grantRef).toBe("1234abcd");
    expect(ctrl.grant_id).toBeUndefined();
    expect(ctrl.judge_sha256).toBeUndefined();
    expect(ctrl.bearer).toBeUndefined();
    expect(ctrl.owner_id).toBeUndefined();
    expect(ctrl.authorization_hash).toBeUndefined();
    expect(ctrl.repository).toBeUndefined();
    expect(ctrl.remote_ref).toBeUndefined();
  });

  it("sanitizes text fields and strips control characters", () => {
    const raw = {
      grantRef: "1234abcd",
      state: "stopped",
      grantVersion: 2,
      mode: "single",
      activeWorkKey: "EXEC-1\x00\x1b[31m",
      pausedAt: null,
      stoppedAt: "2026-09-18T10:00:00.000Z",
      expiresAt: null,
      terminalReason: "Stopped by user\x07\x08 with alerts",
    };
    const ctrl = projectControl(raw);
    expect(ctrl).not.toBeNull();
    expect(ctrl?.activeWorkKey).not.toContain("\x00");
    expect(ctrl?.terminalReason).not.toContain("\x07");
    expect(ctrl?.terminalReason).toContain("Stopped by user");
  });

  it("returns null for invalid or corrupt control inputs", () => {
    // Non-8hex grantRef
    expect(projectControl({ grantRef: "not-hex!", state: "active", grantVersion: 1, mode: "single" })).toBeNull();
    expect(projectControl({ grantRef: "1234", state: "active", grantVersion: 1, mode: "single" })).toBeNull();
    // Invalid state
    expect(projectControl({ grantRef: "1234abcd", state: "bogus", grantVersion: 1, mode: "single" })).toBeNull();
    // Negative or non-integer version
    expect(projectControl({ grantRef: "1234abcd", state: "active", grantVersion: -1, mode: "single" })).toBeNull();
    expect(projectControl({ grantRef: "1234abcd", state: "active", grantVersion: 1.5, mode: "single" })).toBeNull();
    // Invalid mode
    expect(projectControl({ grantRef: "1234abcd", state: "active", grantVersion: 1, mode: "multi" })).toBeNull();
    // Null / non-object
    expect(projectControl(null)).toBeNull();
    expect(projectControl("foo")).toBeNull();
  });

  it("unwraps CLI output shapes: { ok: true, control: { ... } }", () => {
    const cliOutput = {
      ok: true,
      control: {
        grantRef: "1234abcd",
        state: "active",
        grantVersion: 1,
        mode: "single",
        activeWorkKey: null,
        pausedAt: null,
        stoppedAt: null,
        expiresAt: null,
        terminalReason: null,
      },
    };
    const ctrl = projectControl(cliOutput);
    expect(ctrl).not.toBeNull();
    expect(ctrl?.grantRef).toBe("1234abcd");
  });

  it("normalizes valid timestamp strings and returns null for invalid strings containing sentinels", () => {
    const rawWithSentinel = {
      grantRef: "1234abcd",
      state: "paused",
      grantVersion: 2,
      mode: "single",
      activeWorkKey: null,
      pausedAt: "SENTINEL_BEARER_TOKEN_LEAK",
      stoppedAt: "not-a-date",
      expiresAt: "2026-09-18T15:30:00Z",
      terminalReason: null,
    };
    const ctrl = projectControl(rawWithSentinel);
    expect(ctrl).not.toBeNull();
    // Invalid/sentinel strings return null
    expect(ctrl?.pausedAt).toBeNull();
    expect(ctrl?.stoppedAt).toBeNull();
    // Valid timestamp normalized to ISO string
    expect(ctrl?.expiresAt).toBe("2026-09-18T15:30:00.000Z");
  });
});
