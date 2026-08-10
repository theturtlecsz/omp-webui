/**
 * server.ts — HTTP + WebSocket daemon. Loopback-only by default.
 * Owns workspace/session registries, worker lifecycle, event journal + replay.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto"; 
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve, relative } from "node:path";
import { Store } from "./store.js";
import { OmpWorker } from "./worker.js";
import { SessionRuntime, normalizeMessage } from "./session-runtime.js";
import { WorkspaceBoundary, PathEscapeError, readWorkspaceFile, searchWorkspaceFiles, gitStatus, gitDiff } from "./workspace.js";
import { listSessionFiles, readSessionEntries } from "./session-files.js";
import { PROTOCOL_VERSION, type ClientCommand, type Envelope } from "./protocol.js";

export interface DaemonOptions {
  host?: string;
  port?: number;
  authToken?: string; // required when host is not loopback
  allowedOrigins?: string[];
  webDistDir?: string;
  ompBin?: string;
  workerEnv?: NodeJS.ProcessEnv;
  workerIdleMs?: number;
  dbPath?: string;
  /** omp --approval-mode value for spawned workers (default "write": exec tools prompt). */
  approvalMode?: string;
}

interface Client {
  id: string;
  ws: WebSocket;
  lastSeen: Map<string, number>; // sessionId -> last acked sequence
  alive: boolean;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

export class Daemon {
  readonly store: Store;
  readonly opts: Required<Omit<DaemonOptions, "authToken" | "allowedOrigins" | "webDistDir">> & Pick<DaemonOptions, "authToken" | "allowedOrigins" | "webDistDir">;
  #clients = new Set<Client>();
  #runtimes = new Map<string, SessionRuntime>(); // sessionFile -> runtime
  #boundaries = new Map<string, WorkspaceBoundary>(); // workspaceId -> boundary
  #http: ReturnType<typeof createServer> | null = null;
  #wss: WebSocketServer | null = null;
  #idleTimer: NodeJS.Timeout | null = null;

  constructor(opts: DaemonOptions = {}) {
    const host = opts.host ?? "127.0.0.1";
    const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
    if (!isLoopback && !opts.authToken) {
      throw new Error("refusing to bind non-loopback without an authToken (SECURITY.md)");
    }
    this.opts = {
      host,
      port: opts.port ?? 0,
      authToken: opts.authToken,
      allowedOrigins: opts.allowedOrigins,
      webDistDir: opts.webDistDir,
      ompBin: opts.ompBin ?? "omp",
      workerEnv: opts.workerEnv ?? {},
      workerIdleMs: opts.workerIdleMs ?? 10 * 60 * 1000,
      approvalMode: opts.approvalMode ?? "write",
    };
    this.store = new Store(opts.dbPath);
  }

  get port(): number {
    const addr = this.#http?.address();
    return typeof addr === "object" && addr ? addr.port : this.opts.port;
  }

  async start(): Promise<void> {
    this.#http = createServer((req, res) => this.#onHttp(req, res));
    this.#wss = new WebSocketServer({ server: this.#http, path: "/ws" });
    this.#wss.on("connection", (ws, req) => this.#onConnection(ws, req));
    await new Promise<void>((resolvePromise, reject) => {
      this.#http!.once("error", reject);
      this.#http!.listen(this.opts.port, this.opts.host, () => resolvePromise());
    });
    this.#idleTimer = setInterval(() => this.#reapIdleWorkers(), 30_000);
  }

  async stop(): Promise<void> {
    if (this.#idleTimer) clearInterval(this.#idleTimer);
    for (const rt of this.#runtimes.values()) {
      if (rt.worker) await rt.worker.stop().catch(() => {});
      rt.dispose();
    }
    for (const c of this.#clients) {
      try { c.ws.terminate(); } catch { /* already closed */ }
    }
    this.#clients.clear();
    this.#wss?.close();
    await Promise.race([
      new Promise((r) => (this.#http ? this.#http.close(r) : r(null))),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
    this.store.close();
  }

  // ------------------------------------------------------------------ HTTP

  #onHttp(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (!this.#checkAuth(req, res)) return;

    if (url.pathname === "/api/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, protocolVersion: PROTOCOL_VERSION, pid: process.pid }));
      return;
    }
    if (url.pathname === "/api/artifact") {
      this.#serveArtifact(url, res);
      return;
    }
    // static web app
    if (this.opts.webDistDir) {
      this.#serveStatic(url.pathname, res);
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  }

  #checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
    if (!this.opts.authToken) return true;
    const header = req.headers.authorization ?? "";
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const token = header.replace(/^Bearer\s+/i, "") || url.searchParams.get("token") || "";
    if (token !== this.opts.authToken) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return false;
    }
    return true;
  }

  #serveStatic(pathname: string, res: ServerResponse): void {
    const root = resolve(this.opts.webDistDir!);
    let p = resolve(join(root, pathname === "/" ? "index.html" : pathname));
    if (relative(root, p).startsWith("..")) {
      res.writeHead(403).end("forbidden");
      return;
    }
    if (!existsSync(p) || !statSync(p).isFile()) {
      // SPA fallback
      p = join(root, "index.html");
      if (!existsSync(p)) { res.writeHead(404).end("web app not built"); return; }
    }
    res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
    res.end(readFileSync(p));
  }

  #serveArtifact(url: URL, res: ServerResponse): void {
    const sessionFile = url.searchParams.get("sessionFile");
    const name = url.searchParams.get("name");
    if (!sessionFile || !name || name.includes("..") || name.includes("/")) {
      res.writeHead(400).end("bad request");
      return;
    }
    const artDir = sessionFile.replace(/\.jsonl$/, "") + "-artifacts";
    const full = resolve(join(artDir, name));
    if (relative(resolve(artDir), full).startsWith("..") || !existsSync(full)) {
      res.writeHead(404).end("not found");
      return;
    }
    const stat = statSync(full);
    if (stat.size > 32 * 1024 * 1024) { res.writeHead(413).end("artifact too large"); return; }
    res.writeHead(200, { "content-type": MIME[extname(full)] ?? "application/octet-stream" });
    res.end(readFileSync(full));
  }

  // -------------------------------------------------------------- WebSocket

  #onConnection(ws: WebSocket, req: IncomingMessage): void {
    // Origin validation
    const origin = req.headers.origin;
    if (origin && !this.#originAllowed(origin)) {
      ws.close(4403, "origin not allowed");
      return;
    }
    if (this.opts.authToken) {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const token = url.searchParams.get("token") ?? "";
      if (token !== this.opts.authToken) {
        ws.close(4401, "unauthorized");
        return;
      }
    }
    const client: Client = { id: randomUUID(), ws, lastSeen: new Map(), alive: true };
    this.#clients.add(client);
    ws.on("pong", () => { client.alive = true; });
    ws.on("message", (data) => this.#onClientMessage(client, data));
    ws.on("close", () => { this.#clients.delete(client); });
    this.#send(client, {
      type: "connection.ready",
      payload: { clientId: client.id, protocolVersion: PROTOCOL_VERSION },
    });
  }

  #originAllowed(origin: string): boolean {
    if (this.opts.allowedOrigins?.length) return this.opts.allowedOrigins.includes(origin);
    try {
      const u = new URL(origin);
      return u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "::1";
    } catch {
      return false;
    }
  }

  async #onClientMessage(client: Client, data: unknown): Promise<void> {
    let cmd: ClientCommand;
    try {
      cmd = JSON.parse(String(data));
    } catch {
      this.#send(client, { type: "connection.error", error: { message: "malformed JSON" } });
      return;
    }
    if (typeof cmd?.type !== "string" || typeof cmd?.id !== "string") {
      this.#send(client, { type: "connection.error", error: { message: "missing type/id" }, correlationId: cmd?.id });
      return;
    }
    try {
      await this.#dispatch(client, cmd);
    } catch (err) {
      const code = err instanceof PathEscapeError ? "path_escape" : (err as Error & { code?: string }).code;
      this.#send(client, {
        type: "response",
        correlationId: cmd.id,
        error: { message: String((err as Error).message ?? err), code },
      });
    }
  }

  async #dispatch(client: Client, cmd: ClientCommand): Promise<void> {
    const p = (cmd.payload ?? {}) as Record<string, unknown>;
    switch (cmd.type) {
      case "connection.resume": {
        const sessionId = String(p.sessionId ?? "");
        const after = Number(p.afterSequence ?? client.lastSeen.get(sessionId) ?? 0);
        await this.#resumeSession(client, sessionId, after, cmd.id);
        return;
      }
      case "workspace.list": {
        this.#send(client, { type: "response", correlationId: cmd.id, payload: { workspaces: this.store.listWorkspaces() } });
        return;
      }
      case "workspace.open": {
        const root = String(p.root ?? "");
        if (!root) throw new Error("workspace.open requires payload.root");
        const wsRow = this.store.upsertWorkspace(root);
        this.#boundaries.set(wsRow.id, new WorkspaceBoundary(root));
        this.#send(client, { type: "response", correlationId: cmd.id, payload: { workspace: wsRow } });
        return;
      }
      case "session.list": {
        const workspaceId = p.workspaceId ? String(p.workspaceId) : undefined;
        const query = p.query ? String(p.query) : undefined;
        const includeArchived = p.includeArchived === true;
        const sessions = await this.#listSessions(workspaceId, query, includeArchived);
        this.#send(client, { type: "response", correlationId: cmd.id, payload: { sessions } });
        return;
      }
      case "session.create": {
        const workspaceId = String(p.workspaceId ?? "");
        const boundary = this.#requireBoundary(workspaceId);
        const rt = await this.#ensureRuntime(boundary, undefined, workspaceId);
        this.#send(client, { type: "response", correlationId: cmd.id, sessionId: rt.sessionId || undefined, payload: { sessionFile: rt.sessionFile ?? null, sessionId: rt.sessionId || null } });
        return;
      }
      case "session.open": {
        const sessionFile = String(p.sessionFile ?? "");
        const workspaceId = String(p.workspaceId ?? "");
        const boundary = this.#requireBoundary(workspaceId);
        const rt = await this.#ensureRuntime(boundary, sessionFile, workspaceId);
        this.#send(client, { type: "response", correlationId: cmd.id, sessionId: rt.sessionId || undefined, payload: { sessionFile: rt.sessionFile, sessionId: rt.sessionId || null } });
        return;
      }
      case "session.archive": {
        this.store.setArchived(String(p.sessionId ?? ""), p.archived !== false);
        this.#broadcast({ type: "session.archived", sessionId: String(p.sessionId ?? ""), payload: { archived: p.archived !== false } });
        this.#send(client, { type: "response", correlationId: cmd.id, payload: { ok: true } });
        return;
      }
      case "session.fork": {
        const sessionFile = String(p.sessionFile ?? "");
        const entries = readSessionEntries(sessionFile);
        const upToEntryId = p.entryId ? String(p.entryId) : undefined;
        const newFile = forkSessionFile(sessionFile, entries, upToEntryId);
        this.#send(client, { type: "response", correlationId: cmd.id, payload: { sessionFile: newFile } });
        this.#broadcast({ type: "session.forked", payload: { from: sessionFile, to: newFile } });
        return;
      }
      case "prompt.submit":
      case "prompt.queue":
      case "prompt.steer": {
        const rt = this.#requireRuntime(cmd);
        const message = String(p.message ?? "");
        if (!message.trim()) throw new Error("empty prompt");
        const streamingBehavior = cmd.type === "prompt.steer" ? "steer" : cmd.type === "prompt.queue" ? "followUp" : (p.streamingBehavior as string | undefined);
        void rt.worker!.command({ type: "prompt", message, ...(streamingBehavior ? { streamingBehavior } : {}) }, 120_000)
          .then(() => rt.refreshState())
          .catch((err) => this.#broadcast({ type: "message.failed", sessionId: rt.sessionId || undefined, payload: { error: String(err.message ?? err) } }));
        this.#send(client, { type: "response", correlationId: cmd.id, payload: { accepted: true } });
        return;
      }
      case "prompt.abort": {
        const rt = this.#requireRuntime(cmd);
        const result = await rt.worker!.command({ type: "abort" }, 10_000).catch((e) => ({ error: String(e) }));
        this.#send(client, { type: "response", correlationId: cmd.id, payload: result ?? { ok: true } });
        return;
      }
      case "approval.respond": {
        const rt = this.#requireRuntime(cmd);
        const ok = rt.respondToInteraction(String(p.interactionId ?? ""), { confirmed: p.confirmed === true });
        this.#send(client, { type: "response", correlationId: cmd.id, payload: { ok } });
        return;
      }
      case "question.respond": {
        const rt = this.#requireRuntime(cmd);
        const response = p.cancelled === true ? { cancelled: true } : { value: String(p.value ?? "") };
        const ok = rt.respondToInteraction(String(p.interactionId ?? ""), response);
        this.#send(client, { type: "response", correlationId: cmd.id, payload: { ok } });
        return;
      }
      case "file.search": {
        const boundary = this.#requireBoundary(String(p.workspaceId ?? ""));
        const files = searchWorkspaceFiles(boundary, String(p.query ?? ""));
        this.#send(client, { type: "response", correlationId: cmd.id, payload: { files } });
        return;
      }
      case "file.read": {
        const boundary = this.#requireBoundary(String(p.workspaceId ?? ""));
        this.#send(client, { type: "response", correlationId: cmd.id, payload: readWorkspaceFile(boundary, String(p.path ?? "")) });
        return;
      }
      case "git.status": {
        const boundary = this.#requireBoundary(String(p.workspaceId ?? ""));
        this.#send(client, { type: "response", correlationId: cmd.id, payload: gitStatus(boundary) });
        return;
      }
      case "git.diff": {
        const boundary = this.#requireBoundary(String(p.workspaceId ?? ""));
        this.#send(client, { type: "response", correlationId: cmd.id, payload: { diff: gitDiff(boundary, p.path ? String(p.path) : undefined, p.staged === true) } });
        return;
      }
      case "model.list": {
        const rt = this.#requireRuntime(cmd);
        const models = await rt.worker!.command({ type: "get_available_models" }, 15_000);
        this.#send(client, { type: "response", correlationId: cmd.id, payload: { models } });
        return;
      }
      case "model.set": {
        const rt = this.#requireRuntime(cmd);
        await rt.worker!.command({ type: "set_model", provider: String(p.provider ?? ""), modelId: String(p.modelId ?? "") }, 15_000);
        await rt.refreshState();
        this.#send(client, { type: "response", correlationId: cmd.id, payload: { ok: true } });
        return;
      }
      case "thinking.set": {
        const rt = this.#requireRuntime(cmd);
        await rt.worker!.command({ type: "set_thinking_level", level: String(p.level ?? "off") }, 15_000);
        await rt.refreshState();
        this.#send(client, { type: "response", correlationId: cmd.id, payload: { ok: true } });
        return;
      }
      case "settings.update": {
        this.#send(client, { type: "response", correlationId: cmd.id, payload: { ok: true } });
        return;
      }
      default:
        throw new Error(`unknown command: ${cmd.type}`);
    }
  }

  // ----------------------------------------------------------- session ops

  async #listSessions(workspaceId?: string, query?: string, includeArchived = false) {
    const meta = query
      ? this.store.searchSessions(query, workspaceId)
      : this.store.listSessions(workspaceId, includeArchived);
    // merge with on-disk truth for the requested workspace
    if (workspaceId) {
      const boundary = this.#boundaries.get(workspaceId);
      const wsRow = this.store.listWorkspaces().find((w) => w.id === workspaceId);
      if (wsRow) {
        const b = boundary ?? new WorkspaceBoundary(wsRow.root);
        this.#boundaries.set(workspaceId, b);
        const onDisk = listSessionFiles(b.root);
        for (const s of onDisk) {
          const existing = meta.find((m) => m.sessionId === s.sessionId);
          if (!existing) {
            this.store.upsertSession({
              sessionId: s.sessionId, sessionFile: s.sessionFile, workspaceId,
              title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt, messageCount: s.messageCount,
            });
            meta.push({
              sessionId: s.sessionId, sessionFile: s.sessionFile, workspaceId,
              title: s.title, archived: 0, createdAt: s.createdAt, updatedAt: s.updatedAt, messageCount: s.messageCount,
            });
          }
        }
      }
    }
    return meta.map((m) => ({
      sessionId: m.sessionId,
      sessionFile: m.sessionFile,
      cwd: "",
      title: m.title,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      messageCount: m.messageCount,
      archived: m.archived === 1,
      workerState: this.#runtimes.get(m.sessionFile)?.worker?.state ?? "stopped",
    }));
  }

  async #ensureRuntime(boundary: WorkspaceBoundary, sessionFile: string | undefined, workspaceId: string): Promise<SessionRuntime> {
    const key = sessionFile ?? `new:${boundary.root}`;
    let rt = this.#runtimes.get(key);
    if (rt && rt.worker && rt.worker.state !== "crashed") return rt;

    rt = new SessionRuntime(boundary.root, sessionFile, this.store, (ev) => this.#emitFromRuntime(rt!, ev));
    this.#runtimes.set(key, rt);

    const worker = new OmpWorker(
      {
        cwd: boundary.root,
        sessionFile,
        ompBin: this.opts.ompBin,
        env: this.opts.workerEnv,
        extraArgs: this.opts.approvalMode ? [`--approval-mode=${this.opts.approvalMode}`] : [],
      },
      {
        onFrame: (frame) => {
          if (frame.type === "ready") return;
          rt!.onWorkerFrame(frame);
        },
        onStateChange: (state, detail) => {
          rt!.workerStateChanged(state, detail);
          if (state === "ready") {
            void rt!.refreshState();
            // subagent visibility for the browser panel
            worker.command({ type: "set_subagent_subscription", level: "progress" }, 10_000)
              .catch(() => { /* older runtimes: subagent frames simply absent */ });
          }
        },
        onExit: () => { /* runtime keeps sessionFile; restart happens on next ensure */ },
      },
    );
    rt.attachWorker(worker);
    worker.start();
    // wait until ready (first ready frame)
    await new Promise<void>((resolvePromise, reject) => {
      const deadline = setTimeout(() => reject(new Error("worker start timed out")), 30_000);
      const check = setInterval(() => {
        if (worker.state === "ready") { clearTimeout(deadline); clearInterval(check); resolvePromise(); }
        if (worker.state === "crashed") { clearTimeout(deadline); clearInterval(check); reject(new Error(`worker crashed at startup: ${worker.stderrTail.slice(-500)}`)); }
      }, 50);
    });
    await rt.refreshState();
    // Re-key runtime from the speculative key to the authoritative session file,
    // and index the session so it survives daemon restarts.
    if (rt.sessionFile && key !== rt.sessionFile) {
      this.#runtimes.delete(key);
      this.#runtimes.set(rt.sessionFile, rt);
    }
    if (rt.sessionId && rt.sessionFile) {
      const now = new Date().toISOString();
      this.store.upsertSession({
        sessionId: rt.sessionId,
        sessionFile: rt.sessionFile,
        workspaceId,
        title: this.store.getSessionByFile(rt.sessionFile)?.title ?? "(untitled session)",
        createdAt: now,
        updatedAt: now,
        messageCount: rt.state.messageCount ?? 0,
      });
    }
    return rt;
  }

  #emitFromRuntime(rt: SessionRuntime, ev: { type: string; payload?: unknown }): void {
    const eventId = `ev_${randomUUID()}`; 
    const journalTypes = new Set([
      "message.started", "message.completed", "message.failed",
      "tool.started", "tool.updated", "tool.completed", "tool.failed",
      "approval.requested", "question.requested",
      "status.updated", "context.updated",
      "subagent.started", "subagent.updated", "subagent.completed",
      "todos.updated", "worker.ready", "worker.stopped", "worker.crashed",
    ]);
    let sequence: number | undefined;
    if (journalTypes.has(ev.type) && rt.sessionId) {
      sequence = this.store.appendEvent(rt.sessionId, eventId, ev.type, ev.payload ?? null).sequence;
    }
    this.#broadcast({
      type: ev.type as Envelope["type"],
      sessionId: rt.sessionId || undefined,
      eventId,
      sequence,
      payload: ev.payload,
    } as Envelope);
    // message deltas: journal only message.completed but broadcast every delta
    if (ev.type === "message.delta") {
      // not journaled (too chatty); clients rebuild text from snapshot on resume
    }
  }

  async #resumeSession(client: Client, sessionIdOrFile: string, afterSequence: number, correlationId: string): Promise<void> {
    const meta = this.store.getSessionByFile(sessionIdOrFile)
      ?? this.store.listSessions(undefined, true).find((s) => s.sessionId === sessionIdOrFile)
      ?? (sessionIdOrFile.endsWith(".jsonl") ? this.#indexSessionFile(sessionIdOrFile) : undefined);
    if (!meta) {
      this.#send(client, { type: "response", correlationId, error: { message: "unknown session", code: "session_not_found" } });
      return;
    }
    // Snapshot from the authoritative omp session file (always, so a client
    // with no cursor still gets the full transcript).
    this.#send(client, {
      type: "session.snapshot",
      sessionId: meta.sessionId,
      correlationId,
      payload: buildSnapshot(meta.sessionFile),
    });
    const events = this.store.replaySince(meta.sessionId, afterSequence);
    for (const e of events) {
      this.#send(client, {
        type: e.type as Envelope["type"],
        sessionId: e.sessionId,
        eventId: e.eventId,
        sequence: e.sequence,
        payload: JSON.parse(e.payload),
      });
    }
    this.#send(client, {
      type: "replay.completed",
      sessionId: meta?.sessionId,
      correlationId,
      payload: { replayed: events.length, lastSequence: meta ? this.store.lastSequence(meta.sessionId) : 0 },
    });
  }

  // -------------------------------------------------------------- helpers

  #indexSessionFile(sessionFile: string) {
    const entries = readSessionEntries(sessionFile);
    let sessionId = "";
    let cwd = "";
    let title = "";
    let createdAt = new Date().toISOString();
    let messageCount = 0;
    for (const e of entries) {
      if (e.type === "session") { sessionId = String(e.id ?? ""); cwd = String(e.cwd ?? ""); createdAt = String(e.timestamp ?? createdAt); }
      else if (e.type === "title" && e.title) title = String(e.title);
      else if (e.type === "message") messageCount++;
    }
    if (!sessionId) return undefined;
    const wsRow = this.store.listWorkspaces().find((w) => cwd.startsWith(w.root)) ?? this.store.listWorkspaces()[0];
    if (!wsRow) return undefined;
    const meta = {
      sessionId, sessionFile, workspaceId: wsRow.id,
      title: title || "(untitled session)", createdAt,
      updatedAt: new Date().toISOString(), messageCount,
    };
    this.store.upsertSession(meta);
    return this.store.getSessionByFile(sessionFile);
  }

  #requireBoundary(workspaceId: string): WorkspaceBoundary {
    let b = this.#boundaries.get(workspaceId);
    if (b) return b;
    const wsRow = this.store.listWorkspaces().find((w) => w.id === workspaceId);
    if (!wsRow) throw new Error("unknown workspace; call workspace.open first");
    b = new WorkspaceBoundary(wsRow.root);
    this.#boundaries.set(workspaceId, b);
    return b;
  }

  #requireRuntime(cmd: ClientCommand): SessionRuntime {
    const key = cmd.sessionId ?? "";
    let rt = this.#runtimes.get(key)
      ?? [...this.#runtimes.values()].find((r) => r.sessionId === key || r.sessionFile === key);
    // Alias: "new:<cwd>" addresses the most recent runtime for that workspace root
    if (!rt && key.startsWith("new:")) {
      const cwd = key.slice(4);
      rt = [...this.#runtimes.values()].filter((r) => r.cwd === cwd).pop();
    }
    if (!rt || !rt.worker || rt.worker.state !== "ready") throw new Error("session is not active; open it first");
    return rt;
  }

  #reapIdleWorkers(): void {
    const now = Date.now();
    for (const [key, rt] of this.#runtimes) {
      if (!rt.worker || rt.worker.state !== "ready") continue;
      if (rt.state.isStreaming) continue;
      const last = (rt as unknown as { lastActivity?: number }).lastActivity ?? now;
      if (now - last > this.opts.workerIdleMs) {
        void rt.worker.stop();
        this.#runtimes.delete(key);
        rt.dispose();
      }
    }
  }

  #send(client: Client, event: Partial<Envelope> & { type: string }): void {
    if (client.ws.readyState !== WebSocket.OPEN) return;
    client.ws.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, ...event }));
  }

  #broadcast(event: Partial<Envelope> & { type: string }): void {
    const msg = JSON.stringify({ protocolVersion: PROTOCOL_VERSION, ...event });
    for (const c of this.#clients) {
      if (c.ws.readyState === WebSocket.OPEN) c.ws.send(msg);
    }
  }
}

/** Build a transcript snapshot from the authoritative omp session JSONL. */
export function buildSnapshot(sessionFile: string) {
  const entries = readSessionEntries(sessionFile);
  const items: unknown[] = [];
  let title = "";
  let sessionId = "";
  for (const e of entries) {
    if (e.type === "title" && typeof e.title === "string" && e.title) title = e.title;
    else if (e.type === "session") sessionId = String(e.id ?? "");
    else if (e.type === "message") {
      const raw = e.message as Record<string, unknown> | undefined;
      const role = raw?.role as string | undefined;
      if (role === "assistant" && Array.isArray(raw?.content)) {
        // assistant text (may accompany tool calls)
        const msg = normalizeMessage(raw);
        if (msg?.text) {
          items.push({
            id: String(e.id ?? `m_${items.length}`),
            kind: "assistant", role: "assistant", text: msg.text, timestamp: msg.timestamp,
          });
        }
        // tool calls live as content blocks on assistant messages
        for (const c of raw.content as Record<string, unknown>[]) {
          if (c && c.type === "toolCall") {
            items.push({
              id: `tc_${String(c.id ?? items.length)}`,
              kind: "tool",
              toolName: c.name,
              toolCallId: c.id,
              toolState: "success", // refined by the matching toolResult below
              toolArgs: c.arguments,
            });
          }
        }
      } else if (role === "toolResult") {
        items.push({
          id: `tr_${String(raw.toolCallId ?? items.length)}`,
          kind: "tool",
          toolName: raw.toolName,
          toolCallId: raw.toolCallId,
          toolState: raw.isError === true ? "failure" : "success",
          toolResult: { content: raw.content, details: raw.details },
          isError: raw.isError === true,
          timestamp: raw.timestamp,
        });
      } else {
        const msg = normalizeMessage(raw);
        if (msg && (msg.text || msg.role)) {
          items.push({
            id: String(e.id ?? `m_${items.length}`),
            kind: msg.kind ?? "assistant",
            role: msg.role,
            text: msg.text ?? "",
            timestamp: msg.timestamp,
          });
        }
      }
    }
  }
  return { sessionId, sessionFile, title, items };
}

/** Create a forked session file (copy entries up to entryId, new session id). */
export function forkSessionFile(sourceFile: string, entries: Record<string, unknown>[], upToEntryId?: string): string {
  const newId = randomUUID();
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "Z");
  const dir = join(sourceFile, "..");
  const newFile = join(dir, `${ts}_${newId}.jsonl`);
  const lines: string[] = [];
  let copied = 0;
  for (const e of entries) {
    if (e.type === "session") {
      lines.push(JSON.stringify({ ...e, id: newId, parentSession: sourceFile, timestamp: new Date().toISOString() }));
      continue;
    }
    lines.push(JSON.stringify(e));
    copied++;
    if (upToEntryId && e.id === upToEntryId) break;
  }
  writeFileSync(newFile, lines.join("\n") + "\n");
  return newFile;
}
