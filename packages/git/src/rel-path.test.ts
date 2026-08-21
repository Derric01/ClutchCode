import { describe, expect, it } from "vitest";
import { assertContainedIn, assertSafeRelPath, isSafeRelPath } from "./rel-path.js";

describe("isSafeRelPath / assertSafeRelPath (§13.4 relPath traversal guard)", () => {
  it("accepts ordinary workspace-relative paths, including nested ones", () => {
    expect(isSafeRelPath("a.txt")).toBe(true);
    expect(isSafeRelPath("src/nested/file.ts")).toBe(true);
    expect(isSafeRelPath("dir.with.dots/file")).toBe(true);
    expect(isSafeRelPath("...weird-but-fine.txt")).toBe(true);
    expect(() => assertSafeRelPath("src/nested/file.ts")).not.toThrow();
  });

  it("rejects a leading '..' traversal segment", () => {
    expect(isSafeRelPath("../outside.txt")).toBe(false);
    expect(() => assertSafeRelPath("../outside.txt")).toThrow(/invalid relative path/);
  });

  it("rejects a '..' segment buried deeper in the path", () => {
    expect(isSafeRelPath("a/b/../../../etc/passwd")).toBe(false);
    expect(isSafeRelPath("a/../b")).toBe(false);
  });

  it("rejects a bare '..'", () => {
    expect(isSafeRelPath("..")).toBe(false);
  });

  it("rejects an absolute POSIX path", () => {
    expect(isSafeRelPath("/etc/passwd")).toBe(false);
  });

  it("rejects a Windows-shaped drive-absolute or UNC-style path even on POSIX", () => {
    expect(isSafeRelPath("C:\\Windows\\System32\\evil")).toBe(false);
    expect(isSafeRelPath("\\\\server\\share\\evil")).toBe(false);
  });

  it("rejects a backslash-separated traversal segment even where the platform wouldn't split on it", () => {
    // On POSIX, "..\\foo" is a single filename to `path`, but this is
    // untrusted text that may assume a different separator convention —
    // reject the traversal shape regardless of the current platform.
    expect(isSafeRelPath("..\\foo")).toBe(false);
  });

  it("rejects an empty string and embedded NUL bytes", () => {
    expect(isSafeRelPath("")).toBe(false);
    expect(isSafeRelPath("a\0b")).toBe(false);
  });
});

describe("assertContainedIn (defense-in-depth containment re-check)", () => {
  it("does not throw when the resolved path is under the root", () => {
    expect(() => assertContainedIn("/ws/root", "/ws/root/src/file.ts")).not.toThrow();
    expect(() => assertContainedIn("/ws/root", "/ws/root")).not.toThrow();
  });

  it("throws when the resolved path escapes the root", () => {
    expect(() => assertContainedIn("/ws/root", "/ws/other/file.ts")).toThrow(/escapes root/);
    expect(() => assertContainedIn("/ws/root", "/etc/passwd")).toThrow(/escapes root/);
  });

  it("does not treat a sibling directory with the root as a string prefix as contained", () => {
    // "/ws/root-evil" starts with the string "/ws/root" but is not under it.
    expect(() => assertContainedIn("/ws/root", "/ws/root-evil/file.ts")).toThrow(/escapes root/);
  });
});
