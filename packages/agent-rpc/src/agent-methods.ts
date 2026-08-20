import crypto from "node:crypto";
import { Agent, assertSafeRunId, type ApproveOptions, type PrOptions, type ResumeOptions, type RunOptions } from "@clutchcode/agent-api";
import type { RpcHandler } from "./dispatcher.js";

/**
 * Maps the JSON-RPC method surface onto `@clutchcode/agent-api`'s `Agent`
 * (PROJECT_SPEC.md §18.5: "the extension spawns/attaches to the runtime;
 * no separate reimplementation of agent logic in the extension"). Every
 * method name here mirrors a `clutchcode` CLI command 1:1 — this is the
 * same Agent API surface, just reached over stdio instead of in-process.
 */

export interface AgentRpcMethodsOptions {
  repoPath: string;
  stateDir?: string;
  /** Called for every RuntimeEvent a `run`/`resume` call produces, tagged with the run it belongs to — the server forwards these as `clutchcode/event` notifications (§18.4 "streaming: model tokens + tool activity stream live"). */
  onRuntimeEvent: (runId: string, event: unknown) => void;
}

function newRunId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function buildAgentRpcMethods(opts: AgentRpcMethodsOptions): { agent: Agent; handlers: Record<string, RpcHandler> } {
  const agent = new Agent(opts.repoPath, opts.stateDir);

  function requireRunId(params: unknown): string {
    const runId = (params as { runId?: unknown } | undefined)?.runId;
    if (typeof runId !== "string" || runId.length === 0) throw new Error("params.runId is required and must be a non-empty string");
    // §13.1: reject a malformed runId at the RPC boundary itself, before it
    // ever reaches `Agent`'s `diff`/`approve`/`reject`/`resume`/`inspect`/
    // `checkpoints`/`rollback`/`pr` — defense-in-depth on top of (not a
    // replacement for) the same check now also enforced inside
    // `RunStateStore`, `worktree-store.ts`, and `events.ts` directly, so a
    // bad `runId` fails fast with a clear RPC error instead of surfacing as
    // whatever downstream error the traversed path happens to produce.
    assertSafeRunId(runId);
    return runId;
  }

  const handlers: Record<string, RpcHandler> = {
    run: (params) => {
      const p = (params ?? {}) as RunOptions;
      // Resolved here, not left to `Agent.run`'s own default, so the
      // server can tag every event this run produces from its very first
      // one — the caller learns the id from the resolved response too.
      const runId = p.runId ?? newRunId();
      return agent.run({ ...p, runId, onEvent: (e) => opts.onRuntimeEvent(runId, e) });
    },

    status: () => agent.status(),
    listRuns: () => agent.listRuns(),

    diff: (params) => ({ diff: agent.diff(requireRunId(params)) }),
    diffFiles: (params) => ({ files: agent.diffFiles(requireRunId(params)) }),

    // Each of these forwards `params` straight through as the options bag
    // for its Agent method — `params.runId` riding along as an extra,
    // unused property is harmless (a type assertion, not a literal, so TS's
    // excess-property check doesn't apply and the Agent method itself never reads it).
    approve: (params) => agent.approve(requireRunId(params), params as ApproveOptions),

    reject: (params) => agent.reject(requireRunId(params)),

    resume: (params) => {
      const runId = requireRunId(params);
      return agent.resume(runId, { ...(params as ResumeOptions), onEvent: (e) => opts.onRuntimeEvent(runId, e) });
    },

    inspect: (params) => agent.inspect(requireRunId(params)),
    checkpoints: (params) => agent.checkpoints(requireRunId(params)),

    rollback: (params) => {
      const runId = requireRunId(params);
      const sha = (params as { sha?: unknown }).sha;
      if (typeof sha !== "string" || sha.length === 0) throw new Error("params.sha is required and must be a non-empty string");
      return agent.rollback(runId, sha);
    },

    pr: (params) => agent.pr(requireRunId(params), params as PrOptions)
  };

  return { agent, handlers };
}
