/**
 * oversight.ts — OMP-492: Work Ledger oversight over the OMP client contract.
 * The daemon keeps no decision or mission state; every request reads the ledger.
 */
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { engageOversightStop, readOversight, WorkClient } from "@oh-my-pi/pi-work-client";

const DEFAULT_BASE_URL = "http://127.0.0.1:54322";

/** Build the client principal from OMP_WORK_* env; throws with the exact missing piece. */
export function oversightClientFromEnv(env: NodeJS.ProcessEnv = process.env): WorkClient | undefined {
  const workspaceId = env.OMP_WORK_WORKSPACE_ID;
  const capabilityFile = env.OMP_WORK_CAPABILITY_FILE;
  if (!workspaceId && !capabilityFile) return undefined;
  if (!workspaceId) throw new Error("OMP_WORK_WORKSPACE_ID is required when OMP_WORK_CAPABILITY_FILE is set");
  if (!capabilityFile) throw new Error("OMP_WORK_CAPABILITY_FILE is required when OMP_WORK_WORKSPACE_ID is set");
  const capability = JSON.parse(readFileSync(capabilityFile, "utf8")) as { token?: unknown; actor_kind?: unknown };
  if (capability.actor_kind !== "client") throw new Error(`${capabilityFile}: actor_kind must be "client"`);
  if (typeof capability.token !== "string" || !capability.token) throw new Error(`${capabilityFile}: missing token`);
  const token = capability.token;
  return new WorkClient(env.OMP_WORK_BASE_URL ?? DEFAULT_BASE_URL, workspaceId, () => token);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 16 * 1024) throw new Error("request body too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

/** Handle /api/oversight routes. Returns false when the path is not an oversight route. */
export async function handleOversight(
  client: WorkClient | undefined,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  const isRead = pathname === "/api/oversight" && req.method === "GET";
  const isStop = pathname === "/api/oversight/stop" && req.method === "POST";
  if (!isRead && !isStop) return false;
  if (!client) {
    send(res, 503, { error: "oversight is not configured: set OMP_WORK_WORKSPACE_ID and OMP_WORK_CAPABILITY_FILE" });
    return true;
  }
  try {
    if (isRead) return send(res, 200, await readOversight(client)), true;
    const body = (await readJson(req)) as { reason?: unknown };
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 1 || reason.length > 500) {
      send(res, 400, { error: "reason must be 1-500 characters" });
      return true;
    }
    send(res, 200, await engageOversightStop(client, reason));
  } catch (error) {
    send(res, 502, { error: error instanceof Error ? error.message : String(error) });
  }
  return true;
}
