import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  Agent,
  assertSafeRunId,
  loadConfig,
  type PrOptions,
  type ProviderKind,
  type RunState
} from "@clutchcode/agent-api";
import { agent as buildAcpAgentApp, RequestError, PROTOCOL_VERSION, type AgentApp } from "@agentclientprotocol/sdk";
import type {
  ContentBlock,
  InitializeResponse,
  NewSessionResponse,
  PromptResponse,
  StopReason
} from "@agentclientprotocol/sdk";
import { resolveSessionProvider } from "./session-config.js";
import { createSessionUpdateMapper } from "./updates.js";

const ACP_AGENT_NAME = "clutchcode";
const ACP_AGENT_VERSION = "0.1.0";

interface AcpSession {
  agent: Agent;
  cwd: string;
  providerKind: ProviderKind;
  model: string;
  baseUrl?: string;
  lastRunId?: string;
  /** Recorded by `session/cancel` — see the header comment on `buildAcpApp` for why this cannot (yet) preempt an in-flight `Agent.run()`. */
  cancelRequested: boolean;
}

export interface AcpAgentMethodsOptions {
  /** Shared RunState storage dir across every ACP session in this process — same default `Agent`'s own constructor uses when omitted. */
  stateDir?: string;
}

function extractPromptText(prompt: ContentBlock[]): string {
  return prompt
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/** RunState.status → ACP StopReason. ACP's vocabulary (`end_turn`|`max_tokens`|`max_turn_requests`|`refusal`|`cancelled`) has no dedicated slot for §6.2's richer state machine (AWAITING_APPROVAL, ESCALATED, PAUSED, FAILED) — every one of those is a turn that genuinely *ended* from ACP's point of view, so they all map to `"end_turn"`; the final `agent_message_chunk` (see `updates.ts`'s `run.end` case) carries the real status text. Only a genuine `CANCELLED` run state maps to `"cancelled"`. */
function stopReasonFor(status: RunState["status"]): StopReason {
  return status === "CANCELLED" ? "cancelled" : "end_turn";
}

function requireSession(sessions: Map<string, AcpSession>, sessionId: string): AcpSession {
  const session = sessions.get(sessionId);
  if (!session) throw RequestError.invalidParams(undefined, `unknown sessionId: ${sessionId}`);
  return session;
}

function requireSessionId(raw: unknown): string {
  const sessionId = (raw as { sessionId?: unknown } | undefined)?.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) throw RequestError.invalidParams(undefined, "params.sessionId is required and must be a non-empty string");
  return sessionId;
}

/** Resolves `{session, runId}` for a `clutchcode/*` extension method: `params.runId` if given (validated via §13.1's `assertSafeRunId`, same defense-in-depth `@clutchcode/agent-rpc` applies), else the session's own most recently started run. */
function paramsRunId(sessions: Map<string, AcpSession>, raw: unknown): { session: AcpSession; runId: string } {
  const session = requireSession(sessions, requireSessionId(raw));
  const requested = (raw as { runId?: unknown } | undefined)?.runId;
  const runId = typeof requested === "string" && requested.length > 0 ? requested : session.lastRunId;
  if (!runId) throw RequestError.invalidParams(undefined, "params.runId is required (no run has started in this session yet)");
  assertSafeRunId(runId);
  return { session, runId };
}

const identityParser = (raw: unknown): unknown => raw;

/**
 * Registers the `clutchcode/*` custom ACP methods — ACP's own sanctioned
 * extensibility mechanism (arbitrary method names on the same JSON-RPC
 * connection; see the `_meta`/"Extensibility" doc comments throughout
 * `@agentclientprotocol/sdk`'s schema types). These mirror
 * `@clutchcode/agent-rpc`'s `run`/`diff`/`approve`/… method surface almost
 * 1:1 — same `Agent` methods, same validation (`assertSafeRunId`) — so an
 * ACP client that knows about them gets full parity with the stdio-JSON-RPC
 * binding: fetching a diff, approving or rejecting the run's final commit,
 * inspecting the decision trail, rolling back a checkpoint. A client that
 * *doesn't* know about them still gets a fully working `session/prompt`
 * turn with live streaming — these are additive, never required.
 */
function registerClutchCodeExtensionMethods(app: AgentApp, sessions: Map<string, AcpSession>): void {
  app.onRequest("clutchcode/status", identityParser, (ctx) => {
    const session = requireSession(sessions, requireSessionId(ctx.params));
    return { state: session.agent.status(), lastRunId: session.lastRunId, cancelRequested: session.cancelRequested };
  });

  app.onRequest("clutchcode/listRuns", identityParser, (ctx) => {
    const session = requireSession(sessions, requireSessionId(ctx.params));
    return { runs: session.agent.listRuns() };
  });

  app.onRequest("clutchcode/diff", identityParser, (ctx) => {
    const { session, runId } = paramsRunId(sessions, ctx.params);
    return { runId, diff: session.agent.diff(runId) };
  });

  app.onRequest("clutchcode/diffFiles", identityParser, (ctx) => {
    const { session, runId } = paramsRunId(sessions, ctx.params);
    return { runId, files: session.agent.diffFiles(runId) };
  });

  app.onRequest("clutchcode/approve", identityParser, (ctx) => {
    const { session, runId } = paramsRunId(sessions, ctx.params);
    const p = ctx.params as { squash?: unknown; message?: unknown };
    return session.agent.approve(runId, {
      ...(typeof p.squash === "boolean" ? { squash: p.squash } : {}),
      ...(typeof p.message === "string" ? { message: p.message } : {})
    });
  });

  app.onRequest("clutchcode/reject", identityParser, (ctx) => {
    const { session, runId } = paramsRunId(sessions, ctx.params);
    return session.agent.reject(runId);
  });

  app.onRequest("clutchcode/checkpoints", identityParser, (ctx) => {
    // Bare array, not `{ runId, checkpoints }` — matching both
    // `Agent.checkpoints()`'s own return type (`CheckpointRecord[]`) and
    // `agent-rpc`'s sibling binding for this exact method
    // (`checkpoints: (params) => agent.checkpoints(requireRunId(params))`,
    // no wrapper). `diff`/`diffFiles` deliberately add `runId` alongside
    // their value for caller convenience; `checkpoints` never grew that
    // convention on the `agent-rpc` side, so introducing it only here would
    // make the one binding meant to mirror `agent-rpc`'s shape diverge from
    // it for no reason.
    const { session, runId } = paramsRunId(sessions, ctx.params);
    return session.agent.checkpoints(runId);
  });

  app.onRequest("clutchcode/rollback", identityParser, (ctx) => {
    const { session, runId } = paramsRunId(sessions, ctx.params);
    const sha = (ctx.params as { sha?: unknown } | undefined)?.sha;
    if (typeof sha !== "string" || sha.length === 0) throw RequestError.invalidParams(undefined, "params.sha is required and must be a non-empty string");
    return session.agent.rollback(runId, sha);
  });

  app.onRequest("clutchcode/inspect", identityParser, (ctx) => {
    const { session, runId } = paramsRunId(sessions, ctx.params);
    return session.agent.inspect(runId);
  });

  app.onRequest("clutchcode/pr", identityParser, (ctx) => {
    const { session, runId } = paramsRunId(sessions, ctx.params);
    return session.agent.pr(runId, ctx.params as PrOptions);
  });
}

/**
 * Builds the ACP-side Agent Client Protocol app (PROJECT_SPEC.md §18.1: our
 * stdio JSON-RPC binding is "deliberately the same shape as ACP"; §20 calls
 * the boundary "ACP-shaped"; §26's risk register commits to "leaning into
 * those protocols as a client rather than fighting them"). This is that
 * commitment kept: a *second*, additive binding alongside
 * `@clutchcode/agent-rpc` — same `@clutchcode/agent-api` underneath, zero
 * changes to the VS Code extension's own binding, which keeps using
 * `agent-rpc` unmodified.
 *
 * **Mapping notes (read before extending):**
 * - One ACP `session` ↔ one `@clutchcode/agent-api` `Agent` bound to that
 *   session's `cwd` (`Agent` already keys everything by repo path).
 * - `session/prompt` maps 1:1 onto `Agent.run()`. ACP's session model
 *   implies a standing conversation; ClutchCode's model is one task → one
 *   worktree → one PR (§13). A second `session/prompt` in the same ACP
 *   session therefore starts a **new** ClutchCode run (fresh worktree), not
 *   a continuation of the first one's conversation history — a deliberate
 *   simplification, not an oversight.
 * - ClutchCode's real human-in-the-loop gate is the **end-of-run diff
 *   approval** (`Agent.approve`/`Agent.reject`, §14.7), not a per-tool-call
 *   permission prompt — `PolicyEngine`'s `ASK` decisions today fail the
 *   tool call outright rather than pausing for a live decision (there is no
 *   synchronous approval hook in `AgentLoop` to wire ACP's
 *   `session/request_permission` into — a pre-existing gap, not one this
 *   binding introduces; confirmed by grep: no production call site invokes
 *   `PolicyEngine.decide()` outside the tools themselves). So
 *   `session/prompt` always returns `"end_turn"` once the run reaches a
 *   terminal-for-this-turn state; if that state is `AWAITING_APPROVAL`, the
 *   final `agent_message_chunk` says so and the client finishes the loop
 *   with the `clutchcode/approve`/`clutchcode/reject` extension methods.
 * - `session/cancel` is honored as a notification but — same underlying
 *   reason — cannot actually preempt an in-flight `Agent.run()` today:
 *   `AgentLoopOptions` has no `AbortSignal`. The notification is recorded
 *   (observable via `clutchcode/status`) but the in-flight `session/prompt`
 *   still resolves with the run's real outcome, not `"cancelled"`. Wiring
 *   real preemption needs an `AbortSignal` threaded through `AgentLoop`
 *   itself — a runtime change, intentionally out of scope for an additive
 *   binding package; flagged in `HANDOFF.md`'s "What's left".
 */
export function buildAcpApp(opts: AcpAgentMethodsOptions = {}): AgentApp {
  const sessions = new Map<string, AcpSession>();
  const app = buildAcpAgentApp({ name: ACP_AGENT_NAME });

  app.onRequest("initialize", (): InitializeResponse => ({
    protocolVersion: PROTOCOL_VERSION,
    agentCapabilities: {
      loadSession: false,
      promptCapabilities: { image: false, audio: false, embeddedContext: false }
    },
    authMethods: [],
    agentInfo: { name: ACP_AGENT_NAME, version: ACP_AGENT_VERSION }
  }));

  app.onRequest("session/new", ({ params }): NewSessionResponse => {
    if (!path.isAbsolute(params.cwd)) throw RequestError.invalidParams(undefined, "cwd must be an absolute path");
    if (!fs.existsSync(params.cwd) || !fs.statSync(params.cwd).isDirectory()) {
      throw RequestError.invalidParams(undefined, `cwd does not exist or is not a directory: ${params.cwd}`);
    }

    const config = loadConfig(params.cwd);
    const resolved = resolveSessionProvider(config, (params._meta ?? undefined) as Record<string, unknown> | undefined);
    if ("error" in resolved) throw RequestError.invalidParams(undefined, resolved.error);

    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, {
      agent: new Agent(params.cwd, opts.stateDir),
      cwd: params.cwd,
      providerKind: resolved.providerKind,
      model: resolved.model,
      baseUrl: resolved.baseUrl,
      cancelRequested: false
    });
    return { sessionId };
  });

  app.onRequest("session/prompt", async (ctx): Promise<PromptResponse> => {
    const session = requireSession(sessions, ctx.params.sessionId);
    const task = extractPromptText(ctx.params.prompt);
    if (!task) throw RequestError.invalidParams(undefined, "prompt must include at least one non-empty text content block");

    session.cancelRequested = false;
    const mapEvent = createSessionUpdateMapper();

    let state: RunState;
    try {
      state = await session.agent.run({
        task,
        providerKind: session.providerKind,
        model: session.model,
        ...(session.baseUrl ? { baseUrl: session.baseUrl } : {}),
        onEvent: (event) => {
          for (const update of mapEvent(event)) {
            void ctx.client.notify("session/update", { sessionId: ctx.params.sessionId, update });
          }
        }
      });
    } catch (e) {
      throw RequestError.internalError(undefined, (e as Error).message);
    }

    session.lastRunId = state.runId;
    return { stopReason: stopReasonFor(state.status) };
  });

  app.onNotification("session/cancel", (ctx) => {
    const session = sessions.get(ctx.params.sessionId);
    if (session) session.cancelRequested = true; // see the header comment above: recorded, not (yet) preemptive
  });

  registerClutchCodeExtensionMethods(app, sessions);

  return app;
}
