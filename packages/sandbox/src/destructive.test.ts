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
});
