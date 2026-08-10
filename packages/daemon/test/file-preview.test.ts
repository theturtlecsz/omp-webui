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
