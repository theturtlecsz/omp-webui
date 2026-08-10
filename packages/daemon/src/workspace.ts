/**
 * workspace.ts — workspace-root enforcement for file and git APIs.
 * All paths are canonicalized (symlinks resolved) before containment checks.
 */
import { realpathSync, statSync, readdirSync, readFileSync } from "node:fs";
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

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SEARCH_RESULTS = 200;

export function readWorkspaceFile(boundary: WorkspaceBoundary, userPath: string): { path: string; content: string; truncated: boolean } {
  const full = boundary.resolveContained(userPath);
  const stat = statSync(full);
  if (!stat.isFile()) throw new Error(`not a file: ${userPath}`);
  if (stat.size > MAX_FILE_BYTES) {
    const buf = readFileSync(full);
    return { path: boundary.relative(full), content: buf.subarray(0, MAX_FILE_BYTES).toString("utf8"), truncated: true };
  }
  return { path: boundary.relative(full), content: readFileSync(full, "utf8"), truncated: false };
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
