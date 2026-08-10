/**
 * rpc-probe.ts — captures real `omp --mode rpc` wire traffic as fixtures.
 * Usage: bun scripts/rpc-probe.ts [outDir]
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2] ?? new URL("../docs/omp-webui/analysis/fixtures", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
const workDir = new URL("../scratch/probe-workspace", import.meta.url).pathname;
mkdirSync(workDir, { recursive: true });

const frames: unknown[] = [];
const sent: unknown[] = [];
let buf = "";

const child = spawn("omp", ["--mode", "rpc"], {
  cwd: workDir,
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env },
});

child.stdout!.on("data", (d) => {
  buf += d.toString("utf8");
  for (;;) {
    const nl = buf.indexOf("\n");
    if (nl < 0) break;
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try {
      frames.push(JSON.parse(line));
    } catch {
      frames.push({ _unparsed: line.slice(0, 500) });
    }
  }
});

function send(cmd: Record<string, unknown>) {
  sent.push(cmd);
  child.stdin!.write(JSON.stringify(cmd) + "\n");
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await sleep(2500); // wait for ready frame
  send({ id: "probe-negotiate", type: "negotiate_protocol", protocolVersion: 2 });
  await sleep(500);
  send({ id: "probe-state", type: "get_state" });
  await sleep(500);
  send({ id: "probe-models", type: "get_available_models" });
  await sleep(500);
  send({ id: "probe-commands", type: "get_available_commands" });
  await sleep(500);
  send({ id: "probe-login", type: "get_login_providers" });
  await sleep(500);
  send({
    id: "probe-todos",
    type: "set_todos",
    phases: [
      {
        id: "phase-1",
        name: "Probe",
        tasks: [
          { id: "t1", content: "Capture ready frame", status: "completed" },
          { id: "t2", content: "Capture state", status: "in_progress" },
        ],
      },
    ],
  });
  await sleep(500);
  send({ id: "probe-state2", type: "get_state" });
  await sleep(500);
  send({ id: "probe-setmodel", type: "set_model", provider: "teststub", modelId: "stub-1" });
  await sleep(500);
  // Plain streaming prompt.
  send({ id: "probe-prompt", type: "prompt", message: "Reply with just the word hello" });
  await sleep(6000);
  // Tool-executing prompt: captures tool_execution_* frames.
  send({ id: "probe-prompt2", type: "prompt", message: "Please use a tool to say hi" });
  await sleep(10000);
  send({ id: "probe-state3", type: "get_state" });
  await sleep(500);
  send({ id: "probe-abort", type: "abort" });
  await sleep(1000);
  send({ id: "probe-messages", type: "get_messages" });
  await sleep(1500);
  send({ id: "probe-bad", type: "definitely_not_a_command" });
  await sleep(500);
  child.stdin!.write("this is not json\n");
  await sleep(1000);
  child.stdin!.end();
  await sleep(1500);
  child.kill("SIGTERM");

  writeFileSync(join(outDir, "rpc-probe-frames.jsonl"), frames.map((f) => JSON.stringify(f)).join("\n") + "\n");
  writeFileSync(join(outDir, "rpc-probe-sent.jsonl"), sent.map((f) => JSON.stringify(f)).join("\n") + "\n");
  const summary = {
    frameCount: frames.length,
    frameTypes: [...new Set(frames.map((f: any) => f?.type ?? "?"))],
    exitCode: child.exitCode,
  };
  writeFileSync(join(outDir, "rpc-probe-summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main();
