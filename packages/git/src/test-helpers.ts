import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { git } from "./git-exec.js";

export function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Initialize a throwaway git repo with an initial commit, ready for worktree tests. */
export function makeTempRepo(): string {
  const dir = makeTempDir("clutchcode-git-test-repo-");
  git(["init", "-q", "-b", "main"], { cwd: dir });
  git(["config", "user.email", "test@example.com"], { cwd: dir });
  git(["config", "user.name", "Test"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "README.md"), "hello\n", "utf8");
  git(["add", "."], { cwd: dir });
  git(["commit", "-q", "-m", "initial commit"], { cwd: dir });
  return dir;
}
