/**
 * index.ts — omp-webui daemon entry point.
 *   bun packages/daemon/src/index.ts [--host 127.0.0.1] [--port 7483] [--token ...] [--web-dist ../web/dist]
 */
import { Daemon } from "./server.js";

function parseArgs(argv: string[]): Record<string, string | boolean | string[]> {
  const out: Record<string, string | boolean | string[]> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        if (key === "origin") {
          (out.origin as string[] | undefined ?? (out.origin = [])).push(next);
        } else {
          out[key] = next;
        }
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

const args = parseArgs(process.argv);

const daemon = new Daemon({
  host: typeof args.host === "string" ? args.host : "127.0.0.1",
  port: typeof args.port === "string" ? Number(args.port) : 7483,
  authToken: typeof args.token === "string" ? args.token : undefined,
  webDistDir: typeof args["web-dist"] === "string" ? args["web-dist"] : undefined,
  allowedOrigins: Array.isArray(args.origin) ? args.origin : undefined,
  approvalMode: typeof args["approval-mode"] === "string" ? args["approval-mode"] : undefined,
});

await daemon.start();
const addr = `http://${typeof args.host === "string" ? args.host : "127.0.0.1"}:${daemon.port}`;
console.log(`omp-webui daemon listening on ${addr}`);
console.log(`web UI: ${addr}/   websocket: ${addr.replace("http", "ws")}/ws`);

process.on("SIGINT", async () => { await daemon.stop(); process.exit(0); });
process.on("SIGTERM", async () => { await daemon.stop(); process.exit(0); });
