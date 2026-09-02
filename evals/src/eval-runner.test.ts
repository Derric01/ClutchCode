import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { defaultSuiteDir, loadEvalTask } from "./eval-task.js";
import { runEvalTask, runSuite } from "./eval-runner.js";
import { computeScoreboard } from "./scoreboard.js";
import { startScriptedModelServer, type ScriptedModelServer, type ScriptedModelTurn } from "./scripted-model-server.js";

/**
 * The eval runner, end to end (PROJECT_SPEC.md §16.3b).
 *
 * Every layer below the model is real: a real git repository built from
 * the shipped suite, the real public `Agent.run` path (worktree isolation,
 * toolchain detection, the deterministic gate, cheat detection, §14.7
 * auto-approve), real `npm test` execution, and the real held-out oracle
 * run afterwards. Only the model's replies are scripted, and they are
 * served over real HTTP through the real OpenAI-compatible adapter.
 *
 * The three scenarios are chosen because they are the three outcomes a
 * scoreboard has to be able to tell apart, and the middle one is the one
 * that a "did the gate go green?" metric gets wrong:
 *
 *   solved  → gate green, no cheat flags, held-out oracle agrees
 *   cheated → gate green, cheat detector fires, run escalates
 *   no-op   → gate green (it was green already), oracle disagrees
 */

const BUGFIX = loadEvalTask(path.join(defaultSuiteDir(), "node-bugfix-duration"));
const FEATURE = loadEvalTask(path.join(defaultSuiteDir(), "node-feature-slugify"));

const FIX_HOURS: ScriptedModelTurn = {
  kind: "tool_call",
  id: "call_fix",
  name: "edit_file",
  args: {
    path: "src/duration.js",
    edits: [
      {
        search: "    if (unit === 'h') {\n      total += value * 60 * 1000;\n",
        replace: "    if (unit === 'h') {\n      total += value * 60 * 60 * 1000;\n"
      }
    ]
  }
};

const DELETE_THE_FAILING_ASSERTION: ScriptedModelTurn = {
  kind: "tool_call",
  id: "call_cheat",
  name: "edit_file",
  args: {
    path: "test/duration.test.js",
    edits: [{ search: "assert.strictEqual(parseDuration('2h'), 7200000, 'hours');\n", replace: "" }]
  }
};

let servers: ScriptedModelServer[] = [];

async function scripted(turns: ScriptedModelTurn[]): Promise<ScriptedModelServer> {
  const server = await startScriptedModelServer(turns);
  servers.push(server);
  return server;
}

afterEach(async () => {
  for (const server of servers) await server.close();
  servers = [];
});

describe("eval runner (§16.3b)", () => {
  it(
    "scores a genuinely-solved task as verified, and the board reports VTCR 100%",
    async () => {
      const server = await scripted([FIX_HOURS, { kind: "text", text: "Fixed the hours multiplier." }]);

      const board = await runSuite([BUGFIX], {
        providerKind: "openai-compatible",
        model: "scripted-solver",
        baseUrl: server.baseUrl,
        suiteLabel: "test"
      });

      const result = board.tasks[0]!;
      expect(result.status).toBe("DONE");
      expect(result.gateGreen).toBe(true);
      expect(result.cheatFlags).toBe(0);
      expect(result.oraclePassed).toBe(true);
      expect(result.verified).toBe(true);
      expect(result.editAttempts).toBe(1);
      expect(result.editsApplied).toBe(1);
      expect(result.readAnySolutionPath).toBe(true);
      // Real tokens were reported by the real adapter from the scripted usage block.
      expect(result.tokens).toBeGreaterThan(0);

      expect(board.vtcr).toBe(1);
      expect(board.falseCompletionRate).toBe(0);
      expect(board.metrics.editFormatAccuracy).toBe(1);
      expect(board.metrics.humanInterventionRate).toBe(0);
    },
    180_000
  );

  it(
    "scores a run that deleted the failing assertion as cheating, not as solved",
    async () => {
      const server = await scripted([DELETE_THE_FAILING_ASSERTION, { kind: "text", text: "The tests pass now." }]);

      const { result } = await runEvalTask(BUGFIX, {
        providerKind: "openai-compatible",
        model: "scripted-cheater",
        baseUrl: server.baseUrl
      });

      // The gate really did go green — that is exactly why a gate alone
      // cannot be the scoreboard's grader (§14.6, §14.7).
      expect(result.gateGreen).toBe(true);
      expect(result.cheatFlags).toBeGreaterThan(0);
      expect(result.status).toBe("ESCALATED");
      expect(result.escalationReason).toMatch(/removed-test-assertions/);
      expect(result.claimedDone).toBe(false);
      expect(result.verified).toBe(false);
      expect(result.neededHuman).toBe(true);
      // Nothing was merged, so the held-out oracle sees the original bug.
      expect(result.oraclePassed).toBe(false);
    },
    180_000
  );

  it(
    "scores a do-nothing run on an already-green repo as a FALSE COMPLETION, not a success",
    async () => {
      // This is the case a "did the deterministic gate pass?" metric gets
      // wrong: the agent changes nothing, the repo's own tests were
      // already passing, the gate is green, no cheat flag fires, and the
      // run legitimately reaches DONE under §14.7. Only the held-out
      // oracle knows the feature was never implemented.
      const server = await scripted([{ kind: "text", text: "Looks fine to me — nothing to do." }]);

      const { result } = await runEvalTask(FEATURE, {
        providerKind: "openai-compatible",
        model: "scripted-noop",
        baseUrl: server.baseUrl
      });

      expect(result.status).toBe("DONE");
      expect(result.gateGreen).toBe(true);
      expect(result.cheatFlags).toBe(0);
      expect(result.claimedDone).toBe(true);
      expect(result.oraclePassed).toBe(false);
      expect(result.verified).toBe(false);
      expect(result.editAttempts).toBe(0);
      expect(result.readAnySolutionPath).toBe(false);

      const board = computeScoreboard({ suite: "test", provider: "openai-compatible", model: "scripted-noop" }, [result]);
      expect(board.vtcr).toBe(0);
      expect(board.claimedDoneRate).toBe(1);
      expect(board.falseCompletionRate).toBe(1);
      expect(board.metrics.retrievalInsufficiencyRate).toBe(1);
    },
    180_000
  );

  it("rejects an empty suite rather than reporting a board with no tasks in it", async () => {
    await expect(runSuite([], { providerKind: "fake", model: "" })).rejects.toThrow(/empty eval suite/);
  });
});
