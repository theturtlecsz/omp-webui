import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceBoundary, readWorkspaceFile } from "../src/workspace.js";
import { encodeSessionDirName } from "../src/session-files.js";

describe("OMP session directory encoding", () => {
  it("uses the verified single-dash home-relative directory prefix", () => {
    expect(encodeSessionDirName(join(process.env.HOME ?? "/home/user", "workspace", "project"))).toBe("-workspace-project");
    expect(encodeSessionDirName("/tmp/workspace/project")).toBe("-tmp-workspace-project");
  });
});

describe("file preview ranges", () => {
  it("returns only the requested inclusive text range and refuses binary preview", () => {
    const root = mkdtempSync(join(tmpdir(), "omp-webui-preview-"));
    writeFileSync(join(root, "notes.txt"), "one\ntwo\nthree\nfour\n");
    writeFileSync(join(root, "image.bin"), Buffer.from([0x00, 0x01, 0x02]));
    const boundary = new WorkspaceBoundary(root);

    expect(readWorkspaceFile(boundary, "notes.txt", { start: 2, end: 3 })).toMatchObject({
      path: "notes.txt",
      content: "two\nthree",
      lineCount: 5,
      range: { start: 2, end: 3 },
      truncated: false,
    });
    expect(readWorkspaceFile(boundary, "image.bin")).toMatchObject({
      path: "image.bin",
      binary: true,
      content: "",
    });
  });
});

describe("bounded large-file reads (phase 6 review)", () => {
  it("reads at most the preview cap from a sparse 513 MiB file", async () => {
    const { openSync, ftruncateSync, closeSync } = await import("node:fs");
    const workspace = mkdtempSync(join(tmpdir(), "omp-webui-bounded-read-"));
    const file = join(workspace, "sparse.bin");
    const fd = openSync(file, "w");
    ftruncateSync(fd, 513 * 1024 * 1024); // sparse: nearly zero disk blocks
    closeSync(fd);

    const before = process.memoryUsage().rss;
    const read = readWorkspaceFile(new WorkspaceBoundary(workspace), "sparse.bin");
    const after = process.memoryUsage().rss;

    expect(read.binary).toBe(true); // sparse zero bytes contain NULs
    expect(read.truncated).toBe(true);
    expect(read.content.length).toBe(0);
    // The advertised availability bound: a 513 MiB file must not translate
    // into anywhere near that much daemon memory.
    expect(after - before).toBeLessThan(64 * 1024 * 1024);
  });

  it("returns capped text content for a large text file without full allocation", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "omp-webui-bounded-text-"));
    // 3 MiB of plain text (no NULs) so we exercise the text path.
    const line = "const value = 42; // padding padding padding padding\n";
    writeFileSync(join(workspace, "big.ts"), line.repeat(3 * 1024 * 1024 / line.length | 0));

    const before = process.memoryUsage().rss;
    const read = readWorkspaceFile(new WorkspaceBoundary(workspace), "big.ts");
    const after = process.memoryUsage().rss;

    expect(read.binary).toBeUndefined();
    expect(read.truncated).toBe(true);
    expect(read.content.length).toBeLessThanOrEqual(512 * 1024);
    expect(after - before).toBeLessThan(64 * 1024 * 1024);
  });
});
