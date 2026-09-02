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
export { abHistoryPath, readAbHistory, readScoreboardHistory, saveAbReport, saveScoreboard, scoreboardHistoryPath } from "./scoreboard-store.js";
export type { AbHistoryRow, SavedAbReport, SavedScoreboard, ScoreboardHistoryRow } from "./scoreboard-store.js";

// The §16.4 A/B: the naked arm, and the delta that substantiates §16.1's claim.
export {
  DEFAULT_NAKED_MAX_OUTPUT_TOKENS,
  NAKED_SYSTEM_PROMPT,
  applyWholeFileBlocks,
  buildNakedPrompt,
  collectRepoFiles,
  parseWholeFileBlocks,
  runNakedTask
} from "./naked-arm.js";
export type {
  ApplyOutcome,
  CollectRepoFilesOptions,
  CollectedRepoFiles,
  NakedRepoFile,
  NakedRunOptions,
  NakedTaskResult,
  OmissionReason,
  ParsedWholeFile,
  RunNakedTaskResult,
  WholeFileParseResult
} from "./naked-arm.js";
export {
  ARMS,
  DEFAULT_BOOTSTRAP_RESAMPLES,
  DEFAULT_BOOTSTRAP_SEED,
  Z_95,
  computeAbReport,
  formatAbReport,
  mulberry32,
  pairedBootstrapDeltaInterval,
  runAbComparison,
  wilsonInterval
} from "./ab.js";
export type { AbReport, AbReportMeta, AbRunOutput, Arm, ArmObservation, ArmSummary, BootstrapOptions, Interval, PerTaskOutcome, RunAbOptions } from "./ab.js";
export { buildEvalProgram, selectTasks } from "./eval-cli.js";
