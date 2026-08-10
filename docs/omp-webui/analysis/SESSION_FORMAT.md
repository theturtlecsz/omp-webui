# Session format and offline operations

## File and entry format

A session is a JSONL file: the first physical line is a fixed 256-byte title/header slot, followed by one JSON object per entry (`docs/session.md:63-76`; `packages/coding-agent/src/session/session-entries.ts:27-46`). The storage representation is `RawSessionEntry`, with the logical record union exposed as `SessionEntry` (`session-entries.ts:264-285`). The loader specifically strips/folds the title slot then parses remaining JSONL (`session-loader.ts:63-72`).

`SessionEntry` includes session headers, user/assistant/model messages, tool executions, compaction markers, branch summaries, custom entries, and session-info updates; its exact discriminated union is the authoritative source (`session-entries.ts:264-279`). Every entry has the shared `SessionEntryBase` identity/timing fields (`id`, `parentId?`, `timestamp`, and `type`) (`session-entries.ts:58-63`). Do not invent a relational schema: parent/branch topology is encoded in entry metadata and reconstructed by the session manager.

## Storage location and naming

The documented location is under `~/.omp/agent/sessions/` and historically used a scope/project/hash directory followed by `<timestamp>_<sessionId>.jsonl` (`docs/session.md:35-63`). Current code computes the directory using the encoded working-directory convention in `computeDefaultSessionDir` (`packages/coding-agent/src/session/session-paths.ts:185-196`), retaining compatibility logic for the hash-style names used by versions 17.2.5–17.2.8 (`session-paths.ts:45-60`).

**Important discrepancy.** `docs/session.md:35-63` presents the hash-style directory as current; `session-paths.ts:45-60,185-196` says it is legacy and creates/uses the encoded path. Use the code—not the prose—to locate a newly created 17.2.12 session.

## Tree, parent, branch, fork, and resume semantics

1. **Parent relationship.** Creating a session with `new_session` can provide `parentSession?: string` (`rpc-types.ts:28-45`); session headers preserve parent-session provenance (`session-entries.ts:27-46`).
2. **Branch.** The `branch` RPC command targets an `entryId` and returns `{ text, cancelled }` (`rpc-types.ts:81-92`, `rpc-types.ts:196-342`). `SessionManager.branch` moves the active leaf to an existing entry; `branchWithSummary` creates a summarizing continuation (`session-manager.ts:2382-2480`). The tree/plan documentation describes this as choosing a prior message path rather than duplicating unrelated history (`docs/session-tree-plan.md:1-145`).
3. **Fork.** `fork` clones the session file/identity into a new session with preserved lineage, while `forkFrom` can build a new file from an explicit point in a source session (`session-manager.ts:1359-1395`, `session-manager.ts:2535-2573`). The operations guide distinguishes file-level fork, branch, handoff, export, and resume workflows (`docs/session-operations-export-share-fork-resume.md:1-220`).
4. **Resume/switch.** `setSessionFile` loads, migrates, and adopts a selected JSONL session (`session-manager.ts:1286-1337`); RPC `switch_session` accepts a `sessionPath` and returns cancellation state (`rpc-types.ts:81-92`). A prefix/path resolver supports selection of resumable sessions (`session-manager.ts:657-715`).

## Listing and searching without a running worker

The session files are local artifacts, not worker-owned database rows. `FileSessionStorage.listAll` discovers sessions from the filesystem (`session-storage.ts:609-630`) and the loader can parse their JSONL directly (`session-loader.ts:63-72`). Therefore an offline tool can:

1. resolve `~/.omp/agent/sessions` using the same code convention,
2. list `*.jsonl` through `FileSessionStorage`, and
3. read the title/header and JSONL entries using the loader/types.

No worker is required for these steps. For an operator-facing history search, scan parsed `SessionEntry` message text or build a local index. The interactive tree plan describes free-text filtering of rendered/semantic content (`docs/session-tree-plan.md:132-145`), but the storage API shown above provides listing and path/prefix resolution—not a documented persistent full-text index. Keep “offline listing” and “full-text search UI” as separate implementation concerns.

## Safety and compatibility notes

* Preserve the 256-byte header slot when writing; it is part of the file format, not a cosmetic banner (`docs/session.md:63-76`; `session-entries.ts:27-46`).
* Run code migration/loading paths instead of assuming every stored line matches the current union; session loading explicitly performs normalization/migration (`session-manager.ts:1286-1337`).
* A branch follows a tree path, whereas a fork creates a new session artifact. Treat their identifiers and resulting files differently (`session-manager.ts:1359-1395`, `session-manager.ts:2382-2480`).
