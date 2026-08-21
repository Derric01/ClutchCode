import { describe, expect, it } from "vitest";
import { isDestructiveCommand } from "./destructive.js";

describe("isDestructiveCommand", () => {
  it("flags known-destructive commands", () => {
    const cases = [
      "rm -rf /",
      "rm -rf node_modules",
      "git push origin main --force",
      "git push -f origin main",
      "git reset --hard HEAD~5",
      "git clean -fdx",
      "dd if=/dev/zero of=/dev/sda",
      "mkfs.ext4 /dev/sda1",
      "shutdown -h now",
      "DROP TABLE users;"
    ];
    for (const c of cases) {
      expect(isDestructiveCommand(c), `expected destructive: ${c}`).toBe(true);
    }
  });

  it("does not flag ordinary commands", () => {
    const cases = ["npm test", "git status", "ls -la", "git diff", "npm install", "pytest -q"];
    for (const c of cases) {
      expect(isDestructiveCommand(c), `expected safe: ${c}`).toBe(false);
    }
  });

  it("flags rm -rf equivalents regardless of flag order or short/long-form mixing (real gap: the old pure-regex alternatives only matched a fixed set of concrete spellings, and these four are functionally identical to `rm -rf` per POSIX/GNU option parsing but were previously unmatched)", () => {
    const cases = [
      "rm -r -f /tmp/x",
      "rm -f -r /tmp/x",
      "rm --force -r /tmp/x",
      "rm -f --recursive /tmp/x",
      "rm --recursive -f /tmp/x",
      "rm --force --recursive /tmp/x"
    ];
    for (const c of cases) {
      expect(isDestructiveCommand(c), `expected destructive: ${c}`).toBe(true);
    }
  });

  it("flags a long-form `--recursive` alone the same way the already-flagged short-form `-r` alone is (a non-interactive rm never prompts without -i, so recursion alone is already dangerous regardless of force)", () => {
    expect(isDestructiveCommand("rm --recursive somedir")).toBe(true);
  });

  it("flags an rm invocation chained after another command in a pipeline, without its own dangerous flags leaking from/into the other command", () => {
    expect(isDestructiveCommand("npm install && rm -f -r /tmp/x")).toBe(true);
    expect(isDestructiveCommand("npm install -r && rm -f /tmp/x")).toBe(false); // -r belongs to npm here, not rm; rm here is force-only
  });

  it("does not flag a single non-recursive rm even with force", () => {
    expect(isDestructiveCommand("rm -f singlefile.txt")).toBe(false);
  });
});
