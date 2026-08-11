/**
 * workspace.ts — workspace-root enforcement for file and git APIs.
 * All paths are canonicalized (symlinks resolved) before containment checks.
 */
import { realpathSync, statSync, readdirSync, openSync, readSync, closeSync } from "node:fs";
import { resolve, relative, isAbsolute, join, sep } from "node:path";
import { execFileSync } from "node:child_process";

export class WorkspaceBoundary {
  readonly root: string;
  #canonicalRoot: string;

  constructor(root: string) {
    const abs = resolve(root);
    let canonical: string;
    try {
      canonical = realpathSync(abs);
    } catch {
      throw new Error(`workspace root does not exist: ${root}`);
    }
    const stat = statSync(canonical);
    if (!stat.isDirectory()) throw new Error(`workspace root is not a directory: ${root}`);
    this.#canonicalRoot = canonical;
    this.root = canonical;
  }

  /** Resolve a user-supplied path and verify containment. Throws on escape. */
  resolveContained(userPath: string): string {
    const candidate = isAbsolute(userPath) ? userPath : join(this.#canonicalRoot, userPath);
    const resolvedPath = resolve(candidate);
    let canonical: string;
    try {
      canonical = realpathSync(resolvedPath); // resolves symlinks of existing paths
    } catch {
      // Non-existent path: check the nearest existing ancestor instead
      canonical = this.#canonicalizeAncestor(resolvedPath);
    }
    const rel = relative(this.#canonicalRoot, canonical);
    if (rel === "" ) return canonical;
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new PathEscapeError(`path escapes workspace: ${userPath}`);
    }
    return canonical;
  }

  #canonicalizeAncestor(p: string): string {
    let cur = p;
    for (let i = 0; i < 64; i++) {
      try {
        const real = realpathSync(cur);
        const suffix = relative(cur, p);
        return suffix ? join(real, suffix) : real;
      } catch {
        const parent = resolve(cur, "..");
        if (parent === cur) break;
        cur = parent;
      }
    }
    return p;
  }

  relative(p: string): string {
    return relative(this.#canonicalRoot, p) || ".";
  }
}

export class PathEscapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathEscapeError";
  }
}

const MAX_FILE_BYTES = 512 * 1024;
const MAX_SEARCH_RESULTS = 200;

export interface FileReadRange { start?: number; end?: number }
export interface WorkspaceFileRead {
  path: string;
  content: string;
  truncated: boolean;
  binary?: boolean;
  lineCount?: number;
  range?: { start: number; end: number };
}

/**
 * Preview-oriented text read. The byte cap makes a dialog safe to render and binary
 * files are deliberately not decoded into replacement-character noise.
 */
export function readWorkspaceFile(boundary: WorkspaceBoundary, userPath: string, requested: FileReadRange = {}): WorkspaceFileRead {
  const full = boundary.resolveContained(userPath);
  const stat = statSync(full);
  if (!stat.isFile()) throw new Error(`not a file: ${userPath}`);
  // Bounded read: never allocate the whole file. A sparse multi-hundred-MiB
  // file must cost at most MAX_FILE_BYTES (+1 to detect truncation) of RSS.
  const preview = readBounded(full, MAX_FILE_BYTES + 1).subarray(0, MAX_FILE_BYTES);
  const text = preview.toString("utf8");
  // A NUL or an invalid UTF-8 round trip makes this unsuitable for a code preview
  // and for automatic prompt inlining.
  if (preview.includes(0) || !Buffer.from(text, "utf8").equals(preview)) {
    return { path: boundary.relative(full), content: "", truncated: stat.size > MAX_FILE_BYTES, binary: true };
  }
  const lines = text.split("\n");
  const start = Number.isInteger(requested.start) && requested.start! > 0 ? requested.start! : undefined;
  const end = Number.isInteger(requested.end) && requested.end! >= (start ?? 1) ? requested.end! : undefined;
  if (start !== undefined || end !== undefined) {
    const first = Math.min(lines.length, start ?? 1);
    const last = Math.min(lines.length, end ?? lines.length);
    return {
      path: boundary.relative(full),
      content: lines.slice(first - 1, last).join("\n"),
      truncated: stat.size > MAX_FILE_BYTES,
      lineCount: lines.length,
      range: { start: first, end: last },
    };
  }
  return { path: boundary.relative(full), content: text, truncated: stat.size > MAX_FILE_BYTES, lineCount: lines.length };
}

/** Read at most `maxBytes` of a file without ever allocating its full size. */
function readBounded(path: string, maxBytes: number): Buffer {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    const read = readSync(fd, buf, 0, maxBytes, 0);
    return buf.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

export function searchWorkspaceFiles(boundary: WorkspaceBoundary, query: string): string[] {
  const q = query.toLowerCase();
  const results: string[] = [];
  const skip = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "__pycache__"]);
  const walk = (dir: string, depth: number) => {
    if (depth > 12 || results.length >= MAX_SEARCH_RESULTS) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (results.length >= MAX_SEARCH_RESULTS) return;
      if (e.name.startsWith(".") && e.name !== ".") { if (skip.has(e.name) || e.name.startsWith(".")) continue; }
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (skip.has(e.name)) continue;
        walk(full, depth + 1);
      } else if (e.isFile()) {
        const rel = boundary.relative(full);
        if (rel.toLowerCase().includes(q)) results.push(rel);
      }
    }
  };
  walk(boundary.root, 0);
  return results.sort();
}

export interface DirectoryEntry {
  name: string;
  path: string;             // workspace-relative, posix separators
  kind: "file" | "dir" | "symlink";
  size: number;
  modifiedMs: number;
}

export interface DirectoryListing {
  path: string;             // workspace-relative dir, "" for root
  entries: DirectoryEntry[];
  truncated: boolean;
}

const MAX_LIST_ENTRIES = 500;

/** Single-level directory listing. Dirs first, then files, alpha within each.
 * Symlinks that escape the boundary are dropped by resolveContained. */
export function listWorkspaceDirectory(boundary: WorkspaceBoundary, dir: string): DirectoryListing {
  const abs = boundary.resolveContained(dir || ".");
  const stat = statSync(abs);
  if (!stat.isDirectory()) throw new Error(`not a directory: ${dir || "/"}`);
  const entries: DirectoryEntry[] = [];
  let truncated = false;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    if (entries.length >= MAX_LIST_ENTRIES) { truncated = true; break; }
    if (e.name === "node_modules" || e.name === ".git") continue;
    const full = join(abs, e.name);
    let s;
    try { s = statSync(full); } catch { continue; } // dangling symlink or race
    const kind: DirectoryEntry["kind"] = e.isSymbolicLink() ? "symlink" : s.isDirectory() ? "dir" : "file";
    entries.push({ name: e.name, path: boundary.relative(full), kind, size: s.isFile() ? s.size : 0, modifiedMs: Math.round(s.mtimeMs) });
  }
  entries.sort((a, b) => (a.kind === "dir" ? 0 : 1) - (b.kind === "dir" ? 0 : 1) || a.name.localeCompare(b.name));
  const relDir = boundary.relative(abs);
  return { path: relDir === "." ? "" : relDir, entries, truncated };
}

export interface GitStatusEntry { path: string; status: string; staged: boolean }

export function gitStatus(boundary: WorkspaceBoundary): { entries: GitStatusEntry[]; branch: string } {
  const out = execFileSync("git", ["status", "--porcelain=v1", "-b", "--untracked-files=normal"], {
    cwd: boundary.root, encoding: "utf8", timeout: 10_000, maxBuffer: 8 * 1024 * 1024,
  });
  const entries: GitStatusEntry[] = [];
  let branch = "";
  for (const line of out.split("\n")) {
    if (line.startsWith("## ")) {
      branch = line.slice(3).trim();
      continue;
    }
    if (line.length < 4) continue;
    const x = line[0], y = line[1];
    const path = line.slice(3).replace(/^"|"$/g, "");
    entries.push({ path, status: (x !== " " ? x : y) ?? "?", staged: x !== " " && x !== "?" });
  }
  return { entries, branch };
}

export function gitDiff(boundary: WorkspaceBoundary, path?: string, staged = false): string {
  const args = ["diff", "--no-color", "--no-ext-diff"];
  if (staged) args.push("--cached");
  if (path) {
    const contained = boundary.resolveContained(path);
    args.push("--", boundary.relative(contained));
  }
  const out = execFileSync("git", args, {
    cwd: boundary.root, encoding: "utf8", timeout: 15_000, maxBuffer: 16 * 1024 * 1024,
  });
  const LIMIT = 1024 * 1024;
  return out.length > LIMIT ? out.slice(0, LIMIT) + `\n… [diff truncated at ${LIMIT} chars]` : out;
}
