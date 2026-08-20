export { git, isGitRepo, GitError } from "./git-exec.js";
export { SAFE_RUN_ID_RE, isSafeRunId, assertSafeRunId } from "./run-id.js";
export type { GitExecOptions } from "./git-exec.js";
export { isDirty, handleDirtyTree, restoreStash } from "./dirty-tree.js";
export type { DirtyTreeStrategy, DirtyTreeResult } from "./dirty-tree.js";
export {
  createRunWorktree,
  diffAgainstBase,
  diffFilesAgainstBase,
  diffStat,
  checkpoint,
  listCheckpoints,
  rollbackTo,
  discardRun,
  approveRun
} from "./worktree.js";
export type { CreateRunOptions, RunWorktree, CheckpointRecord, ApproveOptions, FileDiff } from "./worktree.js";
export { SnapshotBackup } from "./snapshot-backup.js";
export type { SnapshotBackupOptions, SnapshotDiffEntry } from "./snapshot-backup.js";
export { listSubmodules, listLfsPatterns } from "./edge-cases.js";
export { remoteUrl, pushBranch, parseGitHubRemote, githubCompareUrl } from "./remote.js";
export type { GitHubRepoRef } from "./remote.js";
