export { replayTranscript, checkExpectations, fixturesDir, listFixtureFiles } from "./replay.js";
export type { ReplayResult, ReplayAssertionFailure } from "./replay.js";
export { loadTranscript } from "./transcript.js";
export type { RecordedTranscript } from "./transcript.js";
export { makeFixtureRepo, makeTempDir } from "./fixture-repo.js";

// The §16.1/§16.2/§16.3b eval suite and per-model scoreboard.
export {
  EVAL_CATEGORIES,
  applyReferenceSolution,
  checkTaskRequirements,
  copyTree,
  defaultSuiteDir,
  loadEvalTask,
  loadSuite,
  materializeTaskRepo,
  parseTaskJson,
  runOracle
} from "./eval-task.js";
export type { EvalCategory, EvalTask, OracleResult, RequirementCheck } from "./eval-task.js";
export { DEFAULT_EVAL_BUDGETS, runEvalTask, runSuite } from "./eval-runner.js";
export type { RunEvalOptions, RunEvalTaskResult, RunSuiteOptions } from "./eval-runner.js";
export { computeScoreboard, formatScoreboard, summarizeRun } from "./scoreboard.js";
export type { EvalTaskResult, Scoreboard, ScoreboardMeta, ScoreboardMetrics, SummarizeInput } from "./scoreboard.js";
export { readScoreboardHistory, saveScoreboard, scoreboardHistoryPath } from "./scoreboard-store.js";
export type { SavedScoreboard, ScoreboardHistoryRow } from "./scoreboard-store.js";
export { buildEvalProgram, selectTasks } from "./eval-cli.js";
