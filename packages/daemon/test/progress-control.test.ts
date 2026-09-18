import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Daemon } from "../src/server.js";
import type { ProgressSnapshot } from "../src/progress/contract.js";

describe("progress execution control endpoints", () => {
  let testDir: string;
  let mockBin: string;
  let daemon: Daemon;
  let baseUrl: string;

  beforeAll(async () => {
    testDir = join(tmpdir(), `omp-control-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    mockBin = join(testDir, "mock-control.sh");
    const script = `#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
echo "$@" >> "$DIR/argv.log"

if [ -f "$DIR/custom_output" ]; then
  cat "$DIR/custom_output"
  exit 0
fi

if [ -f "$DIR/sleep" ]; then
  sleep 3
fi

if [ -f "$DIR/exit_code" ]; then
  exit $(cat "$DIR/exit_code")
fi

if [ "$1" = "inspect" ]; then
  echo '{"ok":true,"control":{"grantRef":"1234abcd","state":"active","grantVersion":1,"mode":"single","activeWorkKey":"EXEC-1","pausedAt":null,"stoppedAt":null,"expiresAt":null,"terminalReason":null}}'
  exit 0
elif [ "$1" = "pause" ]; then
  if [ -f "$DIR/conflict" ]; then
    echo '{"ok":false,"code":"stale_version","control":{"grantRef":"1234abcd","state":"active","grantVersion":2,"mode":"single","activeWorkKey":"EXEC-1","pausedAt":null,"stoppedAt":null,"expiresAt":null,"terminalReason":null}}'
    exit 0
  fi
  echo '{"ok":true,"control":{"grantRef":"1234abcd","state":"paused","grantVersion":2,"mode":"single","activeWorkKey":"EXEC-1","pausedAt":"2026-09-18T10:00:00.000Z","stoppedAt":null,"expiresAt":null,"terminalReason":null}}'
  exit 0
elif [ "$1" = "stop" ]; then
  REASON="stopped"
  while [[ $# -gt 0 ]]; do
    if [ "$1" = "--reason" ]; then
      REASON="$2"
      shift 2
    else
      shift
    fi
  done
  echo "{\\"ok\\":true,\\"control\\":{\\"grantRef\\":\\"1234abcd\\",\\"state\\":\\"stopped\\",\\"grantVersion\\":3,\\"mode\\":\\"single\\",\\"activeWorkKey\\":null,\\"pausedAt\\":null,\\"stoppedAt\\":\\"2026-09-18T10:05:00.000Z\\",\\"expiresAt\\":null,\\"terminalReason\\":\\"webui_stop: $REASON\\"}}"
  exit 0
else
  echo '{"ok":false,"code":"invalid_command"}'
  exit 0
fi
`;
    writeFileSync(mockBin, script, { encoding: "utf-8" });
    chmodSync(mockBin, 0o755);

    daemon = new Daemon({
      host: "127.0.0.1",
      port: 0,
      progress: {
        controlBin: mockBin,
      },
    });
    await daemon.start();
    baseUrl = `http://127.0.0.1:${daemon.port}`;
  });

  afterAll(async () => {
    await daemon.stop();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  const validHeaders = {
    "content-type": "application/json",
    "x-omp-webui-control": "1",
  };

  it("rejects non-POST HTTP methods with 405 Method Not Allowed", async () => {
    const resPause = await fetch(`${baseUrl}/api/progress/control/pause`, {
      method: "GET",
      headers: validHeaders,
    });
    expect(resPause.status).toBe(405);
    expect(resPause.headers.get("allow")).toContain("POST");

    const resStop = await fetch(`${baseUrl}/api/progress/control/stop`, {
      method: "GET",
      headers: validHeaders,
    });
    expect(resStop.status).toBe(405);
    expect(resStop.headers.get("allow")).toContain("POST");
  });

  it("rejects cross-site or foreign origin requests with 403 Forbidden", async () => {
    const resCrossSite = await fetch(`${baseUrl}/api/progress/control/pause`, {
      method: "POST",
      headers: {
        ...validHeaders,
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ grantRef: "1234abcd", expectedVersion: 1 }),
    });
    expect(resCrossSite.status).toBe(403);

    const resForeignOrigin = await fetch(`${baseUrl}/api/progress/control/pause`, {
      method: "POST",
      headers: {
        ...validHeaders,
        origin: "http://malicious.example.com",
      },
      body: JSON.stringify({ grantRef: "1234abcd", expectedVersion: 1 }),
    });
    expect(resForeignOrigin.status).toBe(403);
  });

  it("rejects requests missing x-omp-webui-control header with 403 Forbidden", async () => {
    const res = await fetch(`${baseUrl}/api/progress/control/pause`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ grantRef: "1234abcd", expectedVersion: 1 }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean; code: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("forbidden");
  });

  it("rejects requests missing application/json content-type with 400 Bad Request", async () => {
    const res = await fetch(`${baseUrl}/api/progress/control/pause`, {
      method: "POST",
      headers: {
        "x-omp-webui-control": "1",
        "content-type": "text/plain",
      },
      body: JSON.stringify({ grantRef: "1234abcd", expectedVersion: 1 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("invalid_content_type");
  });

  it("enforces authentication when daemon is configured with authToken", async () => {
    const authDaemon = new Daemon({
      host: "127.0.0.1",
      port: 0,
      authToken: "secret-test-token",
      progress: {
        controlBin: mockBin,
      },
    });
    await authDaemon.start();
    const authUrl = `http://127.0.0.1:${authDaemon.port}`;

    try {
      // Without token -> 401
      const resUnauth = await fetch(`${authUrl}/api/progress/control/pause`, {
        method: "POST",
        headers: validHeaders,
        body: JSON.stringify({ grantRef: "1234abcd", expectedVersion: 1 }),
      });
      expect(resUnauth.status).toBe(401);

      // With token -> 200
      const resAuth = await fetch(`${authUrl}/api/progress/control/pause`, {
        method: "POST",
        headers: {
          ...validHeaders,
          authorization: "Bearer secret-test-token",
        },
        body: JSON.stringify({ grantRef: "1234abcd", expectedVersion: 1 }),
      });
      expect(resAuth.status).toBe(200);
    } finally {
      await authDaemon.stop();
    }
  });

  it("rejects request bodies larger than 4 KiB with 413 Payload Too Large", async () => {
    const hugeReason = "x".repeat(5000);
    const res = await fetch(`${baseUrl}/api/progress/control/stop`, {
      method: "POST",
      headers: validHeaders,
      body: JSON.stringify({ grantRef: "1234abcd", expectedVersion: 1, reason: hugeReason }),
    });
    expect(res.status).toBe(413);
  });

  it("rejects invalid JSON with 400 Bad Request", async () => {
    const res = await fetch(`${baseUrl}/api/progress/control/pause`, {
      method: "POST",
      headers: validHeaders,
      body: "{invalid json",
    });
    expect(res.status).toBe(400);
  });

  it("rejects invalid or missing grantRef with 400 Bad Request", async () => {
    for (const invalidGrantRef of ["", "not-hex!", "1234", "123456789", 12345678]) {
      const res = await fetch(`${baseUrl}/api/progress/control/pause`, {
        method: "POST",
        headers: validHeaders,
        body: JSON.stringify({ grantRef: invalidGrantRef, expectedVersion: 1 }),
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as { ok: boolean; code: string };
      expect(data.code).toBe("invalid_arguments");
    }
  });

  it("rejects invalid expectedVersion with 400 Bad Request", async () => {
    for (const invalidVersion of [-1, 1.5, "1", null, undefined]) {
      const res = await fetch(`${baseUrl}/api/progress/control/pause`, {
        method: "POST",
        headers: validHeaders,
        body: JSON.stringify({ grantRef: "1234abcd", expectedVersion: invalidVersion }),
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as { ok: boolean; code: string };
      expect(data.code).toBe("invalid_arguments");
    }
  });

  it("rejects invalid reason on stop with 400 invalid_reason", async () => {
    // Missing reason
    const resEmpty = await fetch(`${baseUrl}/api/progress/control/stop`, {
      method: "POST",
      headers: validHeaders,
      body: JSON.stringify({ grantRef: "1234abcd", expectedVersion: 1 }),
    });
    expect(resEmpty.status).toBe(400);
    expect(((await resEmpty.json()) as { code: string }).code).toBe("invalid_reason");

    // Whitespace-only reason
    const resBlank = await fetch(`${baseUrl}/api/progress/control/stop`, {
      method: "POST",
      headers: validHeaders,
      body: JSON.stringify({ grantRef: "1234abcd", expectedVersion: 1, reason: "   \n\t  " }),
    });
    expect(resBlank.status).toBe(400);
    expect(((await resBlank.json()) as { code: string }).code).toBe("invalid_reason");

    // Over 200 chars reason
    const resOverlong = await fetch(`${baseUrl}/api/progress/control/stop`, {
      method: "POST",
      headers: validHeaders,
      body: JSON.stringify({ grantRef: "1234abcd", expectedVersion: 1, reason: "a".repeat(201) }),
    });
    expect(resOverlong.status).toBe(400);
    expect(((await resOverlong.json()) as { code: string }).code).toBe("invalid_reason");
  });

  it("successfully pauses and passes exact argv without exposing raw diagnostics", async () => {
    const argvLog = join(testDir, "argv.log");
    try { rmSync(argvLog); } catch {}

    const res = await fetch(`${baseUrl}/api/progress/control/pause`, {
      method: "POST",
      headers: validHeaders,
      body: JSON.stringify({ grantRef: "1234abcd", expectedVersion: 1 }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; control?: any };
    expect(data.ok).toBe(true);
    expect(data.control?.state).toBe("paused");
    expect(data.control?.canPause).toBe(false);
    expect(data.control?.canStop).toBe(true);
    // Response never echoes argv or private fields
    expect((data as any).argv).toBeUndefined();
    expect((data as any).grant_id).toBeUndefined();
    expect((data as any).judge_sha256).toBeUndefined();

    // Verify argv passed to binary
    const logged = await Bun.file(argvLog).text();
    expect(logged).toContain("pause --json --grant-ref 1234abcd --expected-version 1");
  });

  it("successfully stops with bounded reason and sanitizes input", async () => {
    const argvLog = join(testDir, "argv.log");
    try { rmSync(argvLog); } catch {}

    const res = await fetch(`${baseUrl}/api/progress/control/stop`, {
      method: "POST",
      headers: validHeaders,
      body: JSON.stringify({
        grantRef: "1234abcd",
        expectedVersion: 2,
        reason: "Operator requested halt\x00\x07",
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; control?: any };
    expect(data.ok).toBe(true);
    expect(data.control?.state).toBe("stopped");
    expect(data.control?.terminalReason).toContain("webui_stop: Operator requested halt");
    expect(data.control?.terminalReason).not.toContain("\x00");

    const logged = await Bun.file(argvLog).text();
    expect(logged).toContain("stop --json --grant-ref 1234abcd --expected-version 2 --reason Operator requested halt");
  });

  it("passes through 409 conflict with fresh control projection and clears progress cache", async () => {
    const conflictFlag = join(testDir, "conflict");
    writeFileSync(conflictFlag, "1");

    try {
      const res = await fetch(`${baseUrl}/api/progress/control/pause`, {
        method: "POST",
        headers: validHeaders,
        body: JSON.stringify({ grantRef: "1234abcd", expectedVersion: 1 }),
      });

      expect(res.status).toBe(409);
      const data = (await res.json()) as { ok: boolean; code: string; control?: any };
      expect(data.ok).toBe(false);
      expect(data.code).toBe("stale_version");
      expect(data.control).toBeDefined();
      expect(data.control?.grantVersion).toBe(2);
      expect(data.control?.state).toBe("active");
    } finally {
      try { rmSync(conflictFlag); } catch {}
    }
  });

  it("returns 503 control-unavailable when control binary is absent", async () => {
    const brokenDaemon = new Daemon({
      host: "127.0.0.1",
      port: 0,
      progress: {
        controlBin: "/nonexistent/binary/path",
      },
    });
    await brokenDaemon.start();
    try {
      const res = await fetch(`http://127.0.0.1:${brokenDaemon.port}/api/progress/control/pause`, {
        method: "POST",
        headers: validHeaders,
        body: JSON.stringify({ grantRef: "1234abcd", expectedVersion: 1 }),
      });
      expect(res.status).toBe(503);
      const data = (await res.json()) as { ok: boolean; code: string };
      expect(data.ok).toBe(false);
      expect(data.code).toBe("control-unavailable");
    } finally {
      await brokenDaemon.stop();
    }
  });

  it("maps a control-operation timeout to 503 unavailable", async () => {
    const sleepFlag = join(testDir, "sleep");
    writeFileSync(sleepFlag, "1");
    const timeoutDaemon = new Daemon({
      host: "127.0.0.1",
      port: 0,
      progress: { controlBin: mockBin, controlTimeoutMs: 25 },
    });
    await timeoutDaemon.start();
    try {
      const res = await fetch(`http://127.0.0.1:${timeoutDaemon.port}/api/progress/control/pause`, {
        method: "POST",
        headers: validHeaders,
        body: JSON.stringify({ grantRef: "1234abcd", expectedVersion: 1 }),
      });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, code: "unavailable" });
    } finally {
      await timeoutDaemon.stop();
      try { rmSync(sleepFlag); } catch {}
    }
  });

  it("observably invalidates the progress cache after a stale-version conflict", async () => {
    let loads = 0;
    const snapshot = (): ProgressSnapshot => ({
      contractVersion: 1,
      generatedAt: new Date(1_700_000_000_000 + loads).toISOString(),
      scope: { scopeId: null, label: null, startedAt: null, explicit: false },
      sources: {
        collector: { kind: "snapshot", observedAt: null, ageSeconds: null, errorClass: null },
        activity: { kind: "snapshot", observedAt: null, ageSeconds: null, errorClass: null },
      },
      coordinator: null,
      providers: { current: [], history: [], truncated: false },
      overall: null,
      checks: [],
      summary: { accepted: [], remaining: [], blockers: [] },
    });
    const cacheDaemon = new Daemon({
      host: "127.0.0.1",
      port: 0,
      progress: {
        controlBin: mockBin,
        loader: async () => {
          loads += 1;
          return snapshot();
        },
      },
    });
    await cacheDaemon.start();
    const conflictFlag = join(testDir, "conflict");
    try {
      const before = await fetch(`http://127.0.0.1:${cacheDaemon.port}/api/progress`);
      expect(before.status).toBe(200);
      expect(loads).toBe(1);
      const cached = await fetch(`http://127.0.0.1:${cacheDaemon.port}/api/progress`);
      expect(cached.status).toBe(200);
      expect(loads).toBe(1);

      writeFileSync(conflictFlag, "1");
      const conflict = await fetch(`http://127.0.0.1:${cacheDaemon.port}/api/progress/control/pause`, {
        method: "POST",
        headers: validHeaders,
        body: JSON.stringify({ grantRef: "1234abcd", expectedVersion: 1 }),
      });
      expect(conflict.status).toBe(409);

      const refreshed = await fetch(`http://127.0.0.1:${cacheDaemon.port}/api/progress`);
      expect(refreshed.status).toBe(200);
      expect(loads).toBe(2);
    } finally {
      try { rmSync(conflictFlag); } catch {}
      await cacheDaemon.stop();
    }
  });

  it("enforces single-flight execution and returns 429 busy on concurrent requests", async () => {
    const sleepFlag = join(testDir, "sleep");
    writeFileSync(sleepFlag, "1");

    try {
      // Launch first request (which will take ~3 seconds)
      const p1 = fetch(`${baseUrl}/api/progress/control/pause`, {
        method: "POST",
        headers: validHeaders,
        body: JSON.stringify({ grantRef: "1234abcd", expectedVersion: 1 }),
      });

      // Brief delay to ensure first request is in-flight
      await new Promise((r) => setTimeout(r, 100));

      // Second request while first is in-flight
      const res2 = await fetch(`${baseUrl}/api/progress/control/pause`, {
        method: "POST",
        headers: validHeaders,
        body: JSON.stringify({ grantRef: "1234abcd", expectedVersion: 1 }),
      });

      expect(res2.status).toBe(429);
      const data2 = (await res2.json()) as { ok: boolean; code: string };
      expect(data2.ok).toBe(false);
      expect(data2.code).toBe("busy");

      const res1 = await p1;
      expect(res1.status).toBe(200);
    } finally {
      try { rmSync(sleepFlag); } catch {}
    }
  });

  it("rejects hostile Origin matching Host header on loopback (DNS rebinding protection)", async () => {
    // Attempt DNS rebinding where attacker sets both Host and Origin to their hostile domain
    const hostileDomain = "attacker.rebinding.example.com";
    const res = await fetch(`${baseUrl}/api/progress/control/pause`, {
      method: "POST",
      headers: {
        ...validHeaders,
        host: `${hostileDomain}:${daemon.port}`,
        origin: `http://${hostileDomain}:${daemon.port}`,
      },
      body: JSON.stringify({ grantRef: "1234abcd", expectedVersion: 1 }),
    });
    expect(res.status).toBe(403);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("origin not allowed");
  });

  it("never leaks raw data.control or sentinels when projection fails; returns 503 control-unavailable", async () => {
    const customFile = join(testDir, "custom_output");
    const sentinelSecret = "SUPER_SECRET_INTERNAL_TOKEN_XYZ_12345";
    // Mock emits ok: true but invalid control projection (bad grantRef and secret fields)
    const payload = {
      ok: true,
      control: {
        grantRef: "not-8-hex-invalid",
        secret_bearer: sentinelSecret,
        grant_id: "private-grant-id",
      },
    };
    writeFileSync(customFile, JSON.stringify(payload));

    try {
      const res = await fetch(`${baseUrl}/api/progress/control/pause`, {
        method: "POST",
        headers: validHeaders,
        body: JSON.stringify({ grantRef: "1234abcd", expectedVersion: 1 }),
      });
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).not.toContain(sentinelSecret);
      expect(text).not.toContain("private-grant-id");
      const json = JSON.parse(text) as { ok: boolean; code: string };
      expect(json.ok).toBe(false);
      expect(json.code).toBe("control-unavailable");
    } finally {
      try { rmSync(customFile); } catch {}
    }
  });

  it("whitelists emitted ControlErrorCode values and maps unknown CLI codes to control-unavailable without leaking sentinels", async () => {
    const customFile = join(testDir, "custom_output");
    const sentinelLeakCode = "LEAK_SECRET_UNKNOWN_CODE_987654321";
    const payload = {
      ok: false,
      code: sentinelLeakCode,
      diagnostics: "internal stack trace containing confidential data",
    };
    writeFileSync(customFile, JSON.stringify(payload));

    try {
      const res = await fetch(`${baseUrl}/api/progress/control/pause`, {
        method: "POST",
        headers: validHeaders,
        body: JSON.stringify({ grantRef: "1234abcd", expectedVersion: 1 }),
      });
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).not.toContain(sentinelLeakCode);
      expect(text).not.toContain("internal stack trace");
      const json = JSON.parse(text) as { ok: boolean; code: string };
      expect(json.ok).toBe(false);
      expect(json.code).toBe("control-unavailable");
    } finally {
      try { rmSync(customFile); } catch {}
    }
  });

  it("enforces single-flight before body read: concurrent slow-body request receives 429 busy", async () => {
    const argvLog = join(testDir, "argv.log");
    try { rmSync(argvLog); } catch {}

    // Client A opens request and writes initial chunk, but does NOT end the request yet
    const clientReq = http.request({
      hostname: "127.0.0.1",
      port: daemon.port,
      path: "/api/progress/control/pause",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-omp-webui-control": "1",
      },
    });

    clientReq.write('{"grantRef":"1234abcd"');

    // Small delay to ensure Client A's headers and first chunk were received by daemon and lock acquired
    await new Promise((r) => setTimeout(r, 100));

    // Client B sends request while Client A is still slowly streaming body
    const resB = await fetch(`${baseUrl}/api/progress/control/pause`, {
      method: "POST",
      headers: validHeaders,
      body: JSON.stringify({ grantRef: "1234abcd", expectedVersion: 1 }),
    });

    // Client B must immediately receive 429 busy
    expect(resB.status).toBe(429);
    const bodyB = (await resB.json()) as { ok: boolean; code: string };
    expect(bodyB.ok).toBe(false);
    expect(bodyB.code).toBe("busy");

    // Client A now finishes sending body
    const clientAPromise = new Promise<{ status: number; body: string }>((resolve, reject) => {
      clientReq.on("response", (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      });
      clientReq.on("error", reject);
    });

    clientReq.write(', "expectedVersion": 1}');
    clientReq.end();

    const resA = await clientAPromise;
    expect(resA.status).toBe(200);

    // Exactly one operation executed in the backend
    const logged = await Bun.file(argvLog).text();
    const pauseInvocations = logged.trim().split("\n").filter((line) => line.includes("pause --json"));
    expect(pauseInvocations).toHaveLength(1);
  });
});
