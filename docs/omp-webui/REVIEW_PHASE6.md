# Phase 6 independent security review

**Reviewer:** independent security review  
**Scope:** Phase 6 delta (`401b230..9ec86a4`) only  
**Review date:** 2026-08-10  
**Verdict: FIX-FIRST → REMEDIATED (see addendum)**

The review found no executable Markdown XSS and no bypass of the established
WebSocket token/origin/protocol-version controls. Upload path containment,
workspace/symlink attachment containment, terminal isolation, and session-file
containment held under the probes below. However, three availability/resource
bounds required by the standing model are ineffective or absent. In particular,
`file.read` and workspace attachments synchronously allocate the *entire* file
before applying the advertised 512 KiB preview cap. This is a release blocker.

## Findings

| Severity | Surface | Reproduction | Impact | Suggested fix |
|---|---|---|---|---|
| **High** | `file.read`; workspace-path attachments | Create a sparse 513 MiB workspace file and issue `file.read`; the response is correctly empty/binary/truncated, but the daemon's RSS increased by **539,897,856 bytes**. `readWorkspaceFile()` calls `readFileSync(full)` before `subarray(0, 512 KiB)`. `#messageWithAttachments()` calls this same function before it decides a file exceeds the 12 KiB inline threshold. | Any authenticated/origin-approved browser client can make the daemon allocate a workspace file's full size, block its event loop on synchronous I/O, and potentially kill it through memory pressure. The 512 KiB preview and 12 KiB attachment limits do not provide the stated availability protection. | Check `stat.size` first and read at most `MAX_FILE_BYTES` using a bounded file descriptor read/stream. For a non-ranged attachment larger than the inline limit, emit only its path without reading it. For ranges, use bounded streaming/line scanning with a hard byte and line-work limit. Add a sparse-large-file regression test that asserts bounded allocation/read count. |
| **Medium** | `session.reask` | A valid re-ask with `message: "X".repeat(10 * 1024 * 1024)` was accepted in 119 ms and the fake RPC worker received all **10,485,760 bytes**. Only `message.trim()` is checked. A zero-length message is rejected. | A client can repeatedly fork sessions and push arbitrarily large strings into the daemon, JSONL fork/worker IPC, and provider request path. This enables local/remote authenticated resource exhaustion and unnecessary provider spend. | Introduce a UTF-8 byte cap for re-ask messages before fork creation or worker dispatch; apply the same cap consistently to `prompt.submit`, `prompt.queue`, and `prompt.steer`. Reject with a stable `message_too_large` code and document the bound. |
| **Medium** | Markdown renderer availability | Rendering 30,000 repeated unsafe Markdown links plus an SVG payload (about 0.8 MiB) took **6.8–7.8 seconds** synchronously in jsdom. The renderer has no message-length/input-node limit. The payload did not create an executable DOM node. | A hostile model/tool message can freeze the browser UI for seconds. This is an availability issue rather than an XSS bypass. | Impose a conservative Markdown character/block limit before parsing (render excess as a bounded plain-text/truncated view), optionally parse off the main thread, and retain a performance regression test with a practical time/input budget. |
| **Low** | Oversized `file.upload` protocol behavior | Sending a 30 MiB base64 string (decodes to roughly 22.5 MiB) and a 100 MiB base64 string caused the requesting WebSocket to end with client-side close code 1006 after about 1.1 s; no correlated error response was returned. Other clients remained responsive. Code inspection shows the encoded-length check runs before `Buffer.from()`, so no decoded payload is written. | The request is rejected, but not with the documented command error contract. A malformed/oversized upload can unnecessarily disconnect a legitimate client and makes client behavior indistinguishable from a transport failure. | Set an explicit WebSocket `maxPayload` appropriate for the encoded upload maximum, reject oversized payloads with a controlled close/error policy, and document it. Keep the pre-decode length guard and add a transport-level test for the expected outcome. |

## Adversarial tests run

### Added durable regressions

| Test file / command | Result | Coverage |
|---|---|---|
| `packages/daemon/test/phase6-security-review.test.ts` — `bun test test/phase6-security-review.test.ts --timeout 30000` | **PASS** — 6 tests, 67 assertions | Real daemon on port 0; upload filenames (`..`, absolute, separators, Unicode directional control, 4,000-character name); invalid/whole-nonobject upload payloads; workspace ID rejection; private upload root and `0600` mode; attachment symlink escape; ≤12 KiB inline and >12 KiB path-only behavior; hostile file ranges; forged/nonexistent/foreign/empty re-ask inputs; version/token/origin guards; terminal disabled/escape/env/rate-limit/forged-ID/reaping controls. |
| `packages/web/test/markdown.test.tsx` — `bun x vitest run test/markdown.test.tsx` | **PASS** — 4 tests | SVG `onload`/`animate`, raw HTML, iframe/form/srcdoc, `javascript:` with HTML entity obfuscation, `data:text/html`, nested image/link syntax, and Unicode bidi content in fenced code. No untrusted executable node or unsafe URI attribute rendered. The long-input test also records the availability finding above. |

### One-off execution probes retained in the workspace

| Probe | Result |
|---|---|
| `packages/daemon/phase6-large-read.ts` | **FINDING:** a sparse 513 MiB file produced a capped/empty response but increased RSS by 539,897,856 bytes. |
| `packages/daemon/phase6-large-reask-probe.ts` | **FINDING:** 10 MiB `session.reask` accepted; worker observed 10,485,760 bytes. |
| `packages/daemon/phase6-large-upload-probe.ts` and `phase6-100mb-upload-probe.ts` | **FINDING:** 30 MiB and 100 MiB encoded uploads were rejected by abrupt client disconnect, not a correlated error; a second client remained responsive. |

## Standing-model regression check

| Requirement | Result | Evidence |
|---|---|---|
| Token, origin, and protocol-version gates on every new command | **PASS** | New commands enter `#onClientMessage()` before `#dispatch()`. The real-daemon probes rejected foreign origin (4403), missing token (4401), and a bad `protocolVersion` before `file.upload`. Terminal commands also go through this path. |
| Loopback-only default bind | **PASS** | `new Daemon()` still defaults to `127.0.0.1`; the complete daemon suite passed the pre-existing non-loopback-without-token refusal test. |
| Upload root containment/per-workspace separation | **PASS, with protocol caveat above** | Tests verified sanitized paths beneath `~/.omp-webui/uploads/<workspaceId>/`, directory creation, and file mode `0600`; bad workspace IDs were rejected. The source's encoded-length guard precedes base64 decoding. |
| Workspace attachment containment and binary handling | **PASS for confidentiality/integrity; availability failure above** | Outside and symlinked workspace attachment paths did not reach the worker; binary previews were refused. The large-file read behavior remains a resource-bound failure. |
| Ranged read output bound | **PASS for response size; availability failure above** | Negative, inverted, huge, and non-integer bounds did not exceed 512 KiB of returned content. The eager full-file read must still be corrected. |
| Markdown XSS safety | **PASS** | No raw untrusted HTML, SVG, iframe, form, event handler, or unsafe link URI rendered in the executed probes. No critical XSS was found. |
| Opt-in terminal isolation | **PASS** | `--terminal` off rejected commands; absolute and symlink cwd escapes failed; allowed environment keys excluded credential variables; 1,025 small 1 KiB output chunks were rate-limited after 1 MiB; crafted terminal IDs could not address a PTY; disconnect cleanup was exercised. |
| Session-file containment | **PASS** | Foreign session files and forged entry IDs were rejected; full daemon containment tests also passed. |

## Required complete suites

Both requested commands were run from their package directories with `PATH` including `/home/user/.bun/bin`:

- `packages/daemon`: `PATH="/home/user/.bun/bin:$PATH" bun test` — **PASS: 29 tests, 0 failures, 144 assertions**. The local stub LLM was started on port 8788 for the integration cases.
- `packages/web`: `PATH="/home/user/.bun/bin:$PATH" bun x vitest run` — **PASS: 6 files, 25 tests, 0 failures**.

## Ship criteria

Do not ship Phase 6 until the High file-read/attachment allocation flaw is fixed and independently retested. The re-ask and Markdown input limits should be fixed in the same remediation because both are directly reachable untrusted-input resource-exhaustion paths. The upload transport-error behavior is lower priority but should be made deterministic before public/non-loopback deployment.

---

## Remediation addendum (orchestrator, 2026-08-10)

All four findings fixed and independently re-verified by the orchestrator:

| Finding | Fix | Verification |
|---|---|---|
| High — unbounded file read | `readWorkspaceFile` now uses a bounded fd read (`readBounded`, max 512 KiB + 1); whole-file attachments above the inline threshold are path-referenced without any read | New regression tests in `test/file-preview.test.ts` (sparse 513 MiB file: RSS delta < 64 MiB, binary+truncated flags correct; 3 MiB text file capped) — PASS |
| Medium — re-ask/prompt size | `MAX_PROMPT_BYTES` = 512 KiB on the fully-assembled prompt (message + inlined attachments) across `prompt.submit/queue/steer` and `session.reask`; rejected with stable code `message_too_large` | Daemon suite 31/31 PASS |
| Medium — markdown render freeze | Parser input capped at 100,000 chars; overflow rendered on demand as plain text in a collapsed `<details>` | Web suite 25/25 PASS (incl. reviewer's hostile-input tests) |
| Low — upload transport rejection | Explicit WS `maxPayload` = 32 MiB (fits 20 MB file → ~27 MB base64 + envelope); oversized frames get deterministic close 1009 instead of the library default path | Documented in PROTOCOL.md |

Full re-verification after remediation: daemon `tsc` clean + 31/31, web `tsc` + 25/25 + build, Playwright 15/15 + terminal config 1/1, clean-clone PASS.

**Final verdict: SHIP.**
