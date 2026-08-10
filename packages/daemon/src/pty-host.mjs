/**
 * PTY host shim. The daemon runs under Bun, whose native ABI differs from
 * Node's; node-pty therefore cannot load in-process. This file is executed by
 * a real Node runtime as a child process and proxies PTY traffic over
 * newline-delimited JSON on stdio.
 *
 * Inbound  (one JSON object per line):
 *   { type: "spawn",  id, cwd, shell, env, cols, rows }
 *   { type: "input",  id, data }
 *   { type: "resize", id, cols, rows }
 *   { type: "kill",   id }
 *
 * Outbound:
 *   { type: "ready" }                  — emitted once node-pty has loaded
 *   { type: "spawned", id } | { type: "spawn_error", id, message }
 *   { type: "output",  id, data }
 *   { type: "exit",    id, code }
 *
 * Security contract: the parent (daemon) is the trust boundary. It resolves
 * cwd inside the workspace, scrubs env, and rate-limits output before this
 * process ever sees a request. This shim performs no authorization of its
 * own and must never be exposed to a network client.
 */
import { createRequire } from "node:module";
import readline from "node:readline";

const require = createRequire(import.meta.url);

let pty;
try {
  pty = require("node-pty");
} catch (error) {
  process.stdout.write(`${JSON.stringify({ type: "load_error", message: String(error?.message ?? error) })}\n`);
  process.exit(2);
}

process.stdout.write(`${JSON.stringify({ type: "ready" })}\n`);

const terminals = new Map();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function spawnTerminal(message) {
  const { id, cwd, shell, env, cols, rows } = message;
  try {
    const proc = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env,
    });
    terminals.set(id, proc);
    proc.onData((data) => send({ type: "output", id, data }));
    proc.onExit(({ exitCode }) => {
      terminals.delete(id);
      send({ type: "exit", id, code: exitCode });
    });
    send({ type: "spawned", id });
  } catch (error) {
    send({ type: "spawn_error", id, message: String(error?.message ?? error) });
  }
}

function killAll() {
  for (const proc of terminals.values()) {
    try { proc.kill("SIGTERM"); } catch { /* already reaped */ }
  }
  terminals.clear();
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  switch (message.type) {
    case "spawn":
      spawnTerminal(message);
      break;
    case "input": {
      const proc = terminals.get(message.id);
      if (proc) proc.write(message.data);
      break;
    }
    case "resize": {
      const proc = terminals.get(message.id);
      if (proc) {
        try { proc.resize(message.cols, message.rows); } catch { /* raced with exit */ }
      }
      break;
    }
    case "kill": {
      const proc = terminals.get(message.id);
      if (proc) {
        try { proc.kill("SIGTERM"); } catch { /* already reaped */ }
        terminals.delete(message.id);
        // Interactive shells (bash job control) can outlive SIGTERM; escalate.
        setTimeout(() => {
          try { proc.kill("SIGKILL"); } catch { /* already reaped */ }
        }, 500).unref();
      }
      break;
    }
    default:
      break;
  }
});

rl.on("close", () => {
  killAll();
  process.exit(0);
});

process.on("SIGTERM", () => { killAll(); process.exit(0); });
process.on("SIGINT", () => { killAll(); process.exit(0); });
