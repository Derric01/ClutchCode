import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { NormalizedMessage, Provider, ToolCallRequest } from "@clutchcode/providers";
import { collect, MAX_TOOL_PARSE_RETRIES, parseToolProtocolResponse, renderToolProtocolInstructions } from "@clutchcode/providers";
import {
  buildEditFormatGuidance,
  computeContextBudget,
  budgetToMaxOutputTokens,
  defaultProfileFromProvider,
  MAX_EDIT_RETRIES,
  type CapabilityProfile,
  type ContextBudget
} from "@clutchcode/capability";
import type { Tool, ToolContext } from "@clutchcode/tools";
import type { RunWorktree } from "@clutchcode/git";
import { approveRun, changedFiles, checkpoint, diffAgainstBase, diffStat } from "@clutchcode/git";
import type { ToolchainCommands, CheatFlag, PipelineResult } from "@clutchcode/verification";
import {
  buildImpactedTestCommand,
  classifyFailure,
  detectCheats,
  evaluateCompletion,
  findTestFiles,
  MAX_REPAIR_ITERS,
  runAdHocCommand,
  runPipeline,
  selectImpactedTests
} from "@clutchcode/verification";

import type { RunState, RunStatus } from "./run-state.js";
import { transition } from "./run-state.js";
import { BudgetGuard, type BudgetLimitKind } from "./budget.js";
import { LoopDetector, initLoopDetectorState, type LoopDetectorState, type LoopWarning } from "./loop-detector.js";
import { shouldPlan } from "./planning-heuristic.js";
import { buildCheatReviewMessage, buildInitialMessages, buildRepairMessage, toolsToSchemas } from "./message-builder.js";
import { compactHistory } from "./context-compaction.js";
import { classifyToolError } from "./error-taxonomy.js";

/**
 * The agent orchestration loop (PROJECT_SPEC.md §6.1, §6.2):
 *
 * ```
 * Task → Understand → Plan(optional) → Inspect → Act(tools) → Edit → Test →
 * Analyze-failure → Repair → Verify → Summarize
 * ```
 *
 * Model-stubbable (§2): every dependency is an interface, so this class is
 * exercised end-to-end in tests with `FakeProvider` and a real (temp) git
 * worktree — zero tokens, zero network, fully deterministic.
 */

export type RuntimeEvent =
  | { type: "state.transition"; from: RunStatus; to: RunStatus }
  | { type: "model.request" }
  | { type: "model.response"; text: string; toolCalls: number }
  | { type: "tool.call"; tool: string; args: string }
  | { type: "tool.result"; tool: string; ok: boolean; errorCode?: string }
  | { type: "verify.stage"; stage: string; passed: boolean }
  | { type: "cheat.flag"; rule: string; file: string }
  | { type: "budget.hit"; kinds: BudgetLimitKind[] }
  | { type: "loop.detected"; warning: LoopWarning }
  | { type: "context.compacted"; removedMessages: number }
  | { type: "escalation"; reason: string }
  | { type: "run.end"; status: RunStatus };

export interface AgentLoopDeps {
  provider: Provider;
  tools: Map<string, Tool<unknown, unknown>>;
  toolContext: ToolContext;
  run: RunWorktree;
  toolchainCommands: ToolchainCommands;
  evidenceDir: string;
  /** AGENTS.md prose (§10.1), if the repo has one — folded into the system prompt. */
  projectMemory?: string;
  /** §4.9: drives §4.8 tool-call transport selection. Falls back to native tool-calling when absent (unprobed model). */
  capabilityProfile?: CapabilityProfile;
}

export interface AgentLoopOptions {
  /** `agent run --yes` (§14.7): auto-commit when the gate is green and no cheats are flagged. */
  yesMode?: boolean;
  onEvent?: (event: RuntimeEvent) => void;
}

export class AgentLoop {
  readonly state: RunState;
  private readonly budgetGuard: BudgetGuard;
  private readonly loopDetector: LoopDetector;
  private messages: NormalizedMessage[];
  private readonly emulationMode: boolean;
  private readonly effectiveProfile: CapabilityProfile;
  private readonly contextBudget: ContextBudget;
  private toolParseRetries = 0;
  private readonly editFailureCounts = new Map<string, number>();
  private readonly downgradeNudgedPaths = new Set<string>();

  constructor(
    state: RunState,
    private readonly deps: AgentLoopDeps,
    private readonly opts: AgentLoopOptions = {}
  ) {
    this.state = state;
    // §4.9: an explicit probe result drives adaptation; absent one, fall
    // back to the provider adapter's own declared defaults rather than
    // assuming the worst (or the best) about an unknown model.
    this.effectiveProfile = deps.capabilityProfile ?? defaultProfileFromProvider(deps.provider, state.model);
    this.emulationMode = this.effectiveProfile.toolTransport === "emulation";
    this.contextBudget = computeContextBudget(this.effectiveProfile);
    this.budgetGuard = new BudgetGuard(state.budgets, state.consumed);
    const restoredDetectorState = state.loopDetectorState as LoopDetectorState | undefined;
    this.loopDetector = new LoopDetector(restoredDetectorState ?? initLoopDetectorState());
    state.loopDetectorState = this.loopDetector.getState();
    const toolProtocolInstructions = this.emulationMode ? renderToolProtocolInstructions(toolsToSchemas(deps.tools)) : undefined;
    const editFormatGuidance = deps.capabilityProfile ? buildEditFormatGuidance(deps.capabilityProfile) : undefined;
    this.messages = buildInitialMessages(state.task, { projectMemory: deps.projectMemory, toolProtocolInstructions, editFormatGuidance });
  }

  private emit(event: RuntimeEvent): void {
    this.opts.onEvent?.(event);
  }

  private setStatus(to: RunStatus): void {
    const from = this.state.status;
    transition(this.state, to);
    this.emit({ type: "state.transition", from, to });
  }

  private finish(): RunState {
    this.emit({ type: "run.end", status: this.state.status });
    return this.state;
  }

  async run(): Promise<RunState> {
    this.setStatus("UNDERSTANDING");

    const plan = shouldPlan({
      taskDescription: this.state.task,
      lowInstructionFidelity: !this.deps.provider.supportsNativeTools
    });
    if (plan) {
      this.setStatus("PLANNING");
      // MVP: the planning *stage* exists (state, gating heuristic, storage
      // in RunState.plan) without a dedicated separate model call yet — a
      // Phase-2+ refinement per §6.7 [C:Med]. The main loop below still
      // does the work; this records that planning was warranted.
      this.state.plan.push("planning heuristic triggered for this task (multi-file/ambiguous/low-fidelity)");
    }

    this.setStatus("INSPECTING");
    this.setStatus("ACTING");

    return await this.actAndVerifyLoop();
  }

  private async actAndVerifyLoop(): Promise<RunState> {
    const outcome = await this.actLoop();
    if (outcome === "stopped") return this.finish();
    return await this.verifyAndFinish();
  }

  /** Runs model↔tool turns until the model stops calling tools, or budgets/loop-detection force a stop. */
  private async actLoop(): Promise<"completed" | "stopped"> {
    while (true) {
      const budgetResult = this.budgetGuard.check();
      if (!budgetResult.ok) {
        this.emit({ type: "budget.hit", kinds: budgetResult.exceeded });
        if (budgetResult.hardStop) {
          this.setStatus("ESCALATED");
          this.state.escalationReason = `cost ceiling reached ($${this.state.budgets.costUsd})`;
        } else {
          this.setStatus("PAUSED");
          this.state.escalationReason = `budget exceeded: ${budgetResult.exceeded.join(", ")}`;
        }
        return "stopped";
      }

      // §4.5: compact conversation/tool history before it blows the budget —
      // mandatory for small-context local models, harmless (a no-op) for
      // large-context ones since the budget scales with effectiveContext.
      const compaction = compactHistory(this.messages, this.contextBudget.historyChars);
      if (compaction.compactedCount > 0) {
        this.messages = compaction.messages;
        this.emit({ type: "context.compacted", removedMessages: compaction.compactedCount });
      }

      this.emit({ type: "model.request" });
      const response = await collect(
        this.deps.provider.chat({
          model: this.state.model,
          messages: this.messages,
          maxOutputTokens: budgetToMaxOutputTokens(this.contextBudget),
          // §4.8: an emulation-mode model isn't offered native tool schemas
          // at all — it was given the text protocol in the system prompt instead.
          tools: this.emulationMode ? undefined : toolsToSchemas(this.deps.tools)
        })
      );
      this.budgetGuard.recordStep();
      if (response.usage) this.budgetGuard.recordUsage(response.usage.inputTokens, response.usage.outputTokens);

      if (response.finishReason === "error") {
        this.emit({ type: "model.response", text: response.text, toolCalls: response.toolCalls.length });
        this.setStatus("ESCALATED");
        this.state.escalationReason = "the model provider returned an error";
        return "stopped";
      }

      let effectiveToolCalls: ToolCallRequest[] = response.toolCalls;

      if (this.emulationMode) {
        const parsed = parseToolProtocolResponse(response.text);
        if (parsed.kind === "call") {
          effectiveToolCalls = [{ id: `emu_${this.state.stepIndex}`, name: parsed.call.name, argsJson: parsed.call.argsJson }];
        } else if (parsed.kind === "error") {
          this.toolParseRetries += 1;
          this.messages.push({ role: "assistant", content: response.text });
          if (this.toolParseRetries > MAX_TOOL_PARSE_RETRIES) {
            this.setStatus("ESCALATED");
            this.state.escalationReason = `tool-call text protocol parse failed repeatedly: ${parsed.error}`;
            return "stopped";
          }
          this.messages.push({
            role: "user",
            content: `Your tool call could not be parsed: ${parsed.error}. Follow the exact <tool name="..."><arg name="...">...</arg></tool> format from the system prompt, with exactly one block.`
          });
          continue; // re-prompt without executing anything or consuming a "real" step's tool-call bookkeeping
        }
        // kind === "none": effectiveToolCalls stays as response.toolCalls (already empty) — the model is done.
      }

      this.emit({ type: "model.response", text: response.text, toolCalls: effectiveToolCalls.length });

      if (effectiveToolCalls.length === 0) {
        this.messages.push({ role: "assistant", content: response.text });
        return "completed";
      }

      this.messages.push({
        role: "assistant",
        content: response.text,
        toolCalls: effectiveToolCalls.map((tc) => ({ id: tc.id, name: tc.name, argsJson: tc.argsJson }))
      });

      let anyEdit = false;
      for (const call of effectiveToolCalls) {
        const repeatWarning = this.loopDetector.recordToolCall(call.name, call.argsJson);
        if (repeatWarning) {
          this.emit({ type: "loop.detected", warning: repeatWarning });
          if (repeatWarning.escalate) {
            this.setStatus("ESCALATED");
            const times = repeatWarning.kind === "repeated-call" ? ` (${repeatWarning.count}x)` : "";
            this.state.escalationReason = `loop detected: ${repeatWarning.kind}${times}`;
            return "stopped";
          }
        }

        // §5.2: tool-call *arguments* are model output too — a model can
        // copy a secret it read straight into a shell command's args. Scrub
        // before this reaches any persisted artifact (event log, RunState).
        const redactedArgs = this.deps.toolContext.redactor.scrub(call.argsJson).text;
        this.emit({ type: "tool.call", tool: call.name, args: redactedArgs });
        const { ok, errorCode, payload, isEdit, editedPath, attemptedPath } = await this.runToolCall(call.name, call.argsJson);
        if (isEdit) anyEdit = true;

        this.state.toolCallLog.push({ step: this.state.stepIndex++, tool: call.name, args: redactedArgs, ok, errorCode, ts: Date.now() });
        this.emit({ type: "tool.result", tool: call.name, ok, errorCode });
        this.messages.push({ role: "tool", toolCallId: call.id, content: payload });

        // §4.4 repeated-failure fallback: after MAX_EDIT_RETRIES failed
        // edit_file attempts on the same file, nudge the model to switch to
        // write_file (whole-file) for that file instead of retrying forever.
        if (call.name === "edit_file" && !ok && attemptedPath) {
          const count = (this.editFailureCounts.get(attemptedPath) ?? 0) + 1;
          this.editFailureCounts.set(attemptedPath, count);
          if (count > MAX_EDIT_RETRIES && !this.downgradeNudgedPaths.has(attemptedPath)) {
            this.downgradeNudgedPaths.add(attemptedPath);
            this.messages.push({
              role: "user",
              content: `edit_file has failed ${count} times on "${attemptedPath}". Per the edit-format fallback (§4.4), switch to write_file to rewrite the whole file instead.`
            });
          }
        }

        if (isEdit && editedPath) {
          const oscillationWarning = this.recordEditForLoopDetection(editedPath);
          if (oscillationWarning) {
            this.emit({ type: "loop.detected", warning: oscillationWarning });
            if (oscillationWarning.escalate) {
              this.setStatus("ESCALATED");
              this.state.escalationReason = `loop detected: ${oscillationWarning.kind} on ${editedPath}`;
              return "stopped";
            }
          }
        }

        if (!ok && errorCode && classifyToolError(errorCode) === "environment-error") {
          // §6.8: an environment error is NOT the model's problem to fix — surface it, don't loop on it.
          this.setStatus("ESCALATED");
          this.state.escalationReason = `environment error from tool "${call.name}": ${errorCode}`;
          return "stopped";
        }
      }

      const progressWarning = this.loopDetector.recordProgress(diffStat(this.deps.run));
      if (progressWarning) {
        this.emit({ type: "loop.detected", warning: progressWarning });
        if (progressWarning.escalate) {
          this.setStatus("ESCALATED");
          this.state.escalationReason = `loop detected: ${progressWarning.kind}`;
          return "stopped";
        }
      }

      this.setStatus(anyEdit ? "EDITING" : "ACTING");
    }
  }

  /** Reads the edited file's current content and feeds its hash to the oscillation detector (§6.4) — never the raw content (§5.2). */
  private recordEditForLoopDetection(editedPath: string): LoopWarning | null {
    try {
      const abs = path.resolve(this.deps.toolContext.workspaceRoot, editedPath);
      const content = fs.readFileSync(abs, "utf8");
      const hash = crypto.createHash("sha256").update(content).digest("hex");
      return this.loopDetector.recordEdit(editedPath, hash);
    } catch {
      return null; // file unreadable/removed — not this detector's problem
    }
  }

  private async runToolCall(
    name: string,
    argsJson: string
  ): Promise<{ ok: boolean; errorCode?: string; payload: string; isEdit: boolean; editedPath?: string; attemptedPath?: string }> {
    const tool = this.deps.tools.get(name);
    if (!tool) {
      return { ok: false, errorCode: "unknown-tool", payload: JSON.stringify({ ok: false, error: { code: "unknown-tool", message: `no such tool: ${name}` } }), isEdit: false };
    }

    let args: unknown;
    try {
      args = argsJson ? JSON.parse(argsJson) : {};
    } catch {
      return {
        ok: false,
        errorCode: "malformed-json",
        payload: JSON.stringify({ ok: false, error: { code: "malformed-json", message: "tool arguments were not valid JSON" } }),
        isEdit: false
      };
    }

    const validated = tool.validate(args);
    if (!validated.ok) {
      return {
        ok: false,
        errorCode: "invalid-args",
        payload: JSON.stringify({ ok: false, error: { code: "invalid-args", message: validated.error.message } }),
        isEdit: false
      };
    }

    const result = await tool.run(validated.value, this.deps.toolContext);
    const isEditOrWriteTool = name === "edit_file" || name === "write_file";
    const isEdit = result.ok && isEditOrWriteTool;
    const attemptedPath = isEditOrWriteTool ? (validated.value as { path?: string }).path : undefined;
    return {
      ok: result.ok,
      errorCode: result.error?.code,
      payload: JSON.stringify(result),
      isEdit,
      editedPath: isEdit ? attemptedPath : undefined,
      attemptedPath
    };
  }

  /**
   * §14.4: "don't run 20 min on a 1-line change" — a fast, scoped pass over
   * just the tests impacted by the diff so far, run BEFORE the full
   * pipeline. It can only ever short-circuit a *failure* faster; a pass
   * here never substitutes for the full-suite run below, so an
   * unsupported language or an imperfect file-filter heuristic can never
   * weaken the completion gate — worst case it just doesn't save any time.
   */
  private runImpactedTestsFastPass(): PipelineResult | null {
    const testCommand = this.deps.toolchainCommands.test;
    if (!testCommand) return null;

    const changed = changedFiles(this.deps.run);
    if (changed.length === 0) return null;

    const testFiles = findTestFiles(this.deps.toolContext.workspaceRoot);
    const { selected, runFullSuite } = selectImpactedTests(changed, testFiles);
    if (runFullSuite || selected.length === 0) return null;

    const command = buildImpactedTestCommand(testCommand, selected, this.deps.toolchainCommands.language);
    if (!command) return null;

    const result = runAdHocCommand("test", command, {
      cwd: this.deps.run.worktreePath,
      evidenceDir: this.deps.evidenceDir,
      timeoutMs: 60_000
    });
    if (result.passed) return null; // fast pass is only useful as an early failure signal

    return { stages: [result], allGreen: false, firstFailure: result };
  }

  private async verifyAndFinish(): Promise<RunState> {
    this.setStatus("VERIFYING");

    const pipelineResult = this.runImpactedTestsFastPass() ?? runPipeline(this.deps.toolchainCommands, {
      cwd: this.deps.run.worktreePath,
      evidenceDir: this.deps.evidenceDir
    });
    for (const stage of pipelineResult.stages) {
      if (stage.ran) this.emit({ type: "verify.stage", stage: stage.stage, passed: stage.passed });
    }

    const diffText = diffAgainstBase(this.deps.run);
    const cheatFlags: CheatFlag[] = pipelineResult.allGreen ? detectCheats(diffText) : [];
    for (const f of cheatFlags) this.emit({ type: "cheat.flag", rule: f.rule, file: f.file });

    this.state.verificationResults.push({
      step: this.state.stepIndex,
      allGreen: pipelineResult.allGreen,
      firstFailureStage: pipelineResult.firstFailure?.stage,
      cheatFlagCount: cheatFlags.length,
      ts: Date.now()
    });

    const stallWarning = this.loopDetector.recordVerifyResult(pipelineResult.allGreen);
    if (stallWarning?.escalate) {
      this.emit({ type: "loop.detected", warning: stallWarning });
      this.setStatus("ESCALATED");
      this.state.escalationReason = `${stallWarning.kind}: verification kept failing across repair attempts`;
      return this.finish();
    }

    if (!pipelineResult.allGreen) {
      const failure = pipelineResult.firstFailure!;
      if (this.state.repairIterations >= MAX_REPAIR_ITERS) {
        this.setStatus("FAILED");
        const failureClass = classifyFailure(failure);
        this.state.lastError = { class: failureClass, detail: `standing failure at stage "${failure.stage}" after ${MAX_REPAIR_ITERS} repair attempts` };
        return this.finish();
      }

      this.state.repairIterations += 1;
      this.setStatus("REPAIRING");
      const failureClass = classifyFailure(failure);
      this.messages.push(buildRepairMessage(failure, failureClass));
      this.setStatus("EDITING");
      this.setStatus("ACTING");
      return await this.actAndVerifyLoop();
    }

    // Deterministic gate is green — checkpoint this state (§13.2).
    checkpoint(this.deps.run, `verify passed at step ${this.state.stepIndex}`);

    if (cheatFlags.length > 0) {
      this.messages.push(buildCheatReviewMessage(cheatFlags));
      this.setStatus("ESCALATED");
      this.state.escalationReason = `cheat detection flagged ${cheatFlags.length} issue(s): ${cheatFlags.map((f) => f.rule).join(", ")}`;
      return this.finish();
    }

    this.setStatus("AWAITING_APPROVAL");

    const completion = evaluateCompletion({
      gateGreen: true,
      cheatFlags: [],
      humanApproved: false,
      yesMode: this.opts.yesMode ?? false
    });

    if (completion.status === "DONE-SUCCESS") {
      this.setStatus("COMMITTING");
      approveRun(this.deps.run, { squash: true, message: `clutchcode: ${this.state.task}` });
      this.setStatus("DONE");
    } else {
      this.state.escalationReason = completion.status === "DONE-ESCALATED" ? completion.reason : undefined;
    }

    return this.finish();
  }
}
