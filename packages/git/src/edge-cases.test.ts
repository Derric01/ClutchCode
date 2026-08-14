import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempRepo } from "./test-helpers.js";
import { listLfsPatterns, listSubmodules } from "./edge-cases.js";

describe("listSubmodules (§13.4)", () => {
  let repoPath: string;

  beforeEach(() => {
    repoPath = makeTempRepo();
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  it("returns an empty list when there's no .gitmodules", () => {
    expect(listSubmodules(repoPath)).toEqual([]);
  });

  it("lists every submodule path from .gitmodules, even if not checked out", () => {
    fs.writeFileSync(
      path.join(repoPath, ".gitmodules"),
      ['[submodule "libs/foo"]', "\tpath = libs/foo", "\turl = https://example.com/foo.git", "", '[submodule "vendor/bar"]', "\tpath = vendor/bar", "\turl = https://example.com/bar.git", ""].join(
        "\n"
      ),
      "utf8"
    );
    expect(listSubmodules(repoPath).sort()).toEqual(["libs/foo", "vendor/bar"]);
  });
});

describe("listLfsPatterns (§13.4)", () => {
  let repoPath: string;

  beforeEach(() => {
    repoPath = makeTempRepo();
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  it("returns an empty list when there's no .gitattributes", () => {
    expect(listLfsPatterns(repoPath)).toEqual([]);
  });

  it("extracts only filter=lfs patterns, ignoring unrelated attribute lines", () => {
    fs.writeFileSync(
      path.join(repoPath, ".gitattributes"),
      ["*.psd filter=lfs diff=lfs merge=lfs -text", "*.md text eol=lf", "# a comment", "vendor/*.bin filter=lfs diff=lfs merge=lfs -text", ""].join("\n"),
      "utf8"
    );
    expect(listLfsPatterns(repoPath)).toEqual(["*.psd", "vendor/*.bin"]);
  });
});
