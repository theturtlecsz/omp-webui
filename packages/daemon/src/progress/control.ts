import type { IncomingMessage, ServerResponse } from "node:http";
import { runCollector } from "./collector.js";
import { projectControl } from "./project.js";

const CONFLICT_CODES = new Set([
  "no_grant",
  "grant_mismatch",
  "not_active",
  "already_terminal",
  "stale_version",
  "judge_drift",
]);

const UNAVAILABLE_CODES = new Set([
  "contract_mismatch",
  "unauthorized",
  "unavailable",
  "control-unavailable",
]);

export interface HandleControlOptions {
  req: IncomingMessage;
  res: ServerResponse;
  verb: "pause" | "stop";
  controlBin: string;
  timeoutMs?: number;
  clearCache: () => void;
}

export async function handleControlRequest(options: HandleControlOptions): Promise<void> {
  const { req, res, verb, controlBin, clearCache, timeoutMs = 30_000 } = options;

  // 1. Method guard should already be verified by #progressGuard, but double check
  if ((req.method ?? "GET").toUpperCase() !== "POST") {
    res.writeHead(405, { allow: "POST", "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, code: "method_not_allowed", error: "method not allowed" }));
    return;
  }

  // 2. Custom header requirement
  if (req.headers["x-omp-webui-control"] !== "1") {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, code: "forbidden", error: "missing x-omp-webui-control header" }));
    return;
  }

  // 3. Content-Type requirement
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, code: "invalid_content_type", error: "content-type must be application/json" }));
    return;
  }

  // 4. Read body with 4 KiB ceiling
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.length;
      if (totalBytes > 4096) {
        res.writeHead(413, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, code: "payload_too_large", error: "request body exceeds 4 KiB" }));
        return;
      }
      chunks.push(buf);
    }
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, code: "read_error", error: "failed to read request body" }));
    return;
  }

  const rawBody = Buffer.concat(chunks).toString("utf-8");
  let body: Record<string, unknown>;
  try {
    body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, code: "invalid_json", error: "invalid JSON body" }));
    return;
  }

  // 5. Validate parameters
  const grantRef = typeof body.grantRef === "string" ? body.grantRef.trim() : "";
  if (!grantRef || !/^[0-9a-f]{8}$/i.test(grantRef)) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, code: "invalid_arguments", error: "grantRef must be 8 hex characters" }));
    return;
  }

  const expectedVersion = typeof body.expectedVersion === "number" && Number.isInteger(body.expectedVersion) && body.expectedVersion >= 0
    ? body.expectedVersion
    : undefined;
  if (expectedVersion === undefined) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, code: "invalid_arguments", error: "expectedVersion must be a non-negative integer" }));
    return;
  }

  let cleanReason: string | undefined;
  if (verb === "stop") {
    const rawReason = typeof body.reason === "string" ? body.reason : "";
    cleanReason = rawReason.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").trim();
    if (cleanReason.length < 1 || cleanReason.length > 200) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, code: "invalid_reason", error: "reason must be between 1 and 200 characters" }));
      return;
    }
  }

  const flags = verb === "stop"
    ? [verb, "--json", "--grant-ref", grantRef, "--expected-version", String(expectedVersion), "--reason", cleanReason!]
    : [verb, "--json", "--grant-ref", grantRef, "--expected-version", String(expectedVersion)];

  const result = await runCollector(controlBin, timeoutMs, 64 * 1024, flags);

  if (!result.ok) {
    const code = result.errorClass === "timeout" ? "unavailable" : "control-unavailable";
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, code }));
    return;
  }

  const data = result.data as { ok?: boolean; code?: string; control?: unknown };

  if (data.ok === true) {
    const projected = projectControl(data.control);
    if (!projected) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, code: "control-unavailable" }));
      return;
    }
    clearCache();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, control: projected }));
    return;
  }

  const rawCode = typeof data.code === "string" ? data.code : "";
  if (CONFLICT_CODES.has(rawCode)) {
    clearCache();
    const projected = data.control ? projectControl(data.control) : null;
    res.writeHead(409, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, code: rawCode, ...(projected ? { control: projected } : {}) }));
    return;
  }

  const code = UNAVAILABLE_CODES.has(rawCode) ? rawCode : "control-unavailable";
  res.writeHead(503, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, code }));
}
