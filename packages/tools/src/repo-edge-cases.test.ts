import { describe, expect, it } from "vitest";
import { isInsideAnySubmodule, isLfsPointerContent, looksBinary, matchesLfsPattern, parseLfsPointer } from "./repo-edge-cases.js";

describe("isInsideAnySubmodule (§13.4)", () => {
  const submodules = ["libs/foo", "vendor/bar"];

  it("matches the submodule root itself", () => {
    expect(isInsideAnySubmodule("libs/foo", submodules)).toBe(true);
  });

  it("matches a file nested inside a submodule", () => {
    expect(isInsideAnySubmodule("libs/foo/src/index.ts", submodules)).toBe(true);
  });

  it("does not match a sibling with a matching prefix", () => {
    expect(isInsideAnySubmodule("libs/foobar/x.ts", submodules)).toBe(false);
  });

  it("does not match a path outside any submodule", () => {
    expect(isInsideAnySubmodule("src/index.ts", submodules)).toBe(false);
  });

  it("returns false when there are no submodules", () => {
    expect(isInsideAnySubmodule("libs/foo/x.ts", [])).toBe(false);
  });
});

describe("matchesLfsPattern (§13.4)", () => {
  it("matches a bare extension pattern anywhere in the tree, by basename", () => {
    expect(matchesLfsPattern("assets/hero.psd", ["*.psd"])).toBe(true);
    expect(matchesLfsPattern("deep/nested/dir/hero.psd", ["*.psd"])).toBe(true);
    expect(matchesLfsPattern("hero.png", ["*.psd"])).toBe(false);
  });

  it("anchors a slash-containing pattern to the repo root", () => {
    expect(matchesLfsPattern("vendor/blob.bin", ["vendor/*.bin"])).toBe(true);
    expect(matchesLfsPattern("other/vendor/blob.bin", ["vendor/*.bin"])).toBe(false);
  });

  it("`**` matches across directory boundaries", () => {
    expect(matchesLfsPattern("assets/deep/nested/blob.bin", ["assets/**"])).toBe(true);
  });

  it("returns false for an empty pattern list", () => {
    expect(matchesLfsPattern("anything.psd", [])).toBe(false);
  });
});

describe("LFS pointer parsing (§13.4)", () => {
  const pointer = [
    "version https://git-lfs.github.com/spec/v1",
    "oid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393",
    "size 12345",
    ""
  ].join("\n");

  it("recognizes LFS pointer content by its version line", () => {
    expect(isLfsPointerContent(pointer)).toBe(true);
    expect(isLfsPointerContent("just a normal file\n")).toBe(false);
  });

  it("parses oid and size out of a pointer body", () => {
    expect(parseLfsPointer(pointer)).toEqual({
      oid: "4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393",
      size: 12345
    });
  });

  it("returns undefined fields for malformed pointer content", () => {
    expect(parseLfsPointer("not a pointer")).toEqual({ oid: undefined, size: undefined });
  });
});

describe("looksBinary", () => {
  it("is false for ordinary text", () => {
    expect(looksBinary(Buffer.from("hello, world\nsecond line\n", "utf8"))).toBe(false);
  });

  it("is true when a NUL byte appears in the first few KB", () => {
    expect(looksBinary(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]))).toBe(true);
  });

  it("ignores a NUL byte far past the sniff window", () => {
    const buf = Buffer.concat([Buffer.alloc(9000, "a"), Buffer.from([0x00])]);
    expect(looksBinary(buf)).toBe(false);
  });
});
