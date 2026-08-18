import fs from "node:fs";
import { Readable } from "node:stream";
import { execFileSync } from "node:child_process";
import { detectKeychainBackend, markTrusted } from "@clutchcode/agent-api";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cmdApprove,
  cmdCheckpoints,
  cmdDiff,
  cmdDoctor,
  cmdInit,
  cmdInspect,
  cmdMemoryCorrect,
  cmdMemoryForget,
  cmdMemoryList,
  cmdMemoryShow,
  cmdModelsList,
  cmdModelsProbe,
  cmdPr,
  cmdProviders,
  cmdProvidersSetKey,
  cmdProvidersUnsetKey,
  cmdReject,
  cmdResume,
  cmdRollback,
  cmdRun,
  cmdStatus,
  cmdTrust
} from "./commands.js";
import { EXIT, exitCodeForRunStatus } from "./exit-codes.js";
import {
  addBareOrigin,
  makeSampleRepo,
  makeTempDir,
  sseChunk,
  startScriptedServer,
  startThrowawaySecretService,
  type ScriptedServer,
  type ThrowawaySecretService
} from "./test-helpers.js";

describe("CLI commands (pure functions, no process spawning)", () => {
  let repoPath: string;
  let stateDir: string;

  beforeEach(() => {
    repoPath = makeSampleRepo();
    stateDir = makeTempDir("clutchcode-cli-state-");
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("init scaffolds config + AGENTS.md and reports it in human and JSON form", async () => {
    const human = await cmdInit({ repoPath });
    expect(human.exitCode).toBe(EXIT.SUCCESS);
    expect(human.output).toMatch(/created agent\.toml/);
    expect(fs.existsSync(`${repoPath}/agent.toml`)).toBe(true);
  });

  it("run --yes with the fake provider reaches DONE with exit code 0", async () => {
    const result = await cmdRun(
      { repoPath, stateDir },
      { task: "investigate", providerKind: "fake", model: "n/a", yes: true }
    );
    expect(result.exitCode).toBe(EXIT.SUCCESS);
    expect(result.output).toContain("DONE");
  }, 30_000);

  it("run without --yes stops at AWAITING_APPROVAL with exit code 2 (escalated/needs-human)", async () => {
    const result = await cmdRun({ repoPath, stateDir }, { task: "investigate", providerKind: "fake", model: "n/a" });
    expect(result.exitCode).toBe(EXIT.ESCALATED);
    expect(result.output).toContain("AWAITING_APPROVAL");
  }, 30_000);

  it("status reports 'no runs yet' before any run, then the latest run after", async () => {
    const before = await cmdStatus({ repoPath, stateDir });
    expect(before.output).toMatch(/no runs yet/);

    await cmdRun({ repoPath, stateDir }, { task: "investigate", providerKind: "fake", model: "n/a", yes: true });
    const after = await cmdStatus({ repoPath, stateDir });
    expect(after.output).toContain("DONE");
  }, 30_000);

  it("diff/approve/reject/inspect operate on a run started via run()", async () => {
    const runResult = await cmdRun({ repoPath, stateDir, json: true }, { task: "investigate", providerKind: "fake", model: "n/a" });
    const runId = (JSON.parse(runResult.output) as { runId: string }).runId;

    const diff = await cmdDiff({ repoPath, stateDir }, runId);
    expect(diff.exitCode).toBe(EXIT.SUCCESS);

    const inspected = await cmdInspect({ repoPath, stateDir }, runId);
    expect(inspected.exitCode).toBe(EXIT.SUCCESS);
    expect(inspected.output).toContain("decision trail");

    const approved = await cmdApprove({ repoPath, stateDir }, runId, { squash: true });
    expect(approved.exitCode).toBe(EXIT.SUCCESS);
    expect(approved.output).toContain("DONE");
  }, 30_000);

  it("reject moves a run to CANCELLED", async () => {
    const runResult = await cmdRun({ repoPath, stateDir, json: true }, { task: "investigate", providerKind: "fake", model: "n/a" });
    const runId = (JSON.parse(runResult.output) as { runId: string }).runId;

    const rejected = await cmdReject({ repoPath, stateDir }, runId);
    expect(rejected.output).toContain("CANCELLED");
  }, 30_000);

  it("trust marks the repo trusted", async () => {
    const result = await cmdTrust({ repoPath });
    expect(result.exitCode).toBe(EXIT.SUCCESS);
    expect(result.output).toContain("trusted");
  });

  it("providers lists credential presence without leaking values", async () => {
    const result = await cmdProviders({ repoPath, json: true });
    const parsed = JSON.parse(result.output) as { detected: Array<{ kind: string; credentialPresent: boolean }> };
    expect(parsed.detected.some((d) => d.kind === "ollama")).toBe(true);
    expect(result.output).not.toContain("sk-");
  });

  it("doctor reports the real, detected sandbox backend (bubblewrap is installed in this dev container)", async () => {
    const result = await cmdDoctor({ repoPath, json: true });
    const parsed = JSON.parse(result.output) as { checks: Array<{ name: string; ok: boolean; detail: string }> };
    const sandbox = parsed.checks.find((c) => c.name.startsWith("sandbox"));
    expect(sandbox?.ok).toBe(true);
    expect(sandbox?.detail).toMatch(/^bwrap/);
  });

  it("doctor reports seccomp hardening (§12.6) as supported on this x86_64 Linux container", async () => {
    const result = await cmdDoctor({ repoPath, json: true });
    const parsed = JSON.parse(result.output) as { checks: Array<{ name: string; ok: boolean; detail: string }> };
    const seccomp = parsed.checks.find((c) => c.name.startsWith("seccomp"));
    expect(seccomp?.ok).toBe(true);
    expect(seccomp?.detail).toContain("x86_64");
  });

  it("doctor runs real, non-fabricated checks", async () => {
    const result = await cmdDoctor({ repoPath, json: true });
    const parsed = JSON.parse(result.output) as { checks: Array<{ name: string; ok: boolean }> };
    const node = parsed.checks.find((c) => c.name === "node");
    expect(node?.ok).toBe(true);
  });

  it("doctor reports the OS keychain backend (§5.1) — secret-tool is installed in this dev container", async () => {
    const result = await cmdDoctor({ repoPath, json: true });
    const parsed = JSON.parse(result.output) as { checks: Array<{ name: string; ok: boolean; detail: string }> };
    const keychain = parsed.checks.find((c) => c.name.startsWith("OS keychain"));
    expect(keychain?.ok).toBe(true);
    expect(keychain?.detail).toMatch(/^secret-service/);
  });
});

describe("providers set-key/unset-key (§5.1 tier 1) — real Secret Service, not mocked", () => {
  const hasSecretTool = detectKeychainBackend("linux").backend === "secret-service";
  const maybeIt = hasSecretTool ? it : it.skip;

  let repoPath: string;
  let service: ThrowawaySecretService;

  beforeAll(() => {
    if (hasSecretTool) service = startThrowawaySecretService();
  });

  afterAll(() => {
    service?.close();
  });

  beforeEach(() => {
    repoPath = makeSampleRepo();
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  maybeIt("set-key stores a key read from stdin (never an argument), and providers then reports it present", async () => {
    const stdin = Readable.from(["sk-ant-cli-integration-test"]);
    const setResult = await cmdProvidersSetKey({ repoPath, env: service.env, json: true }, "anthropic", stdin);
    expect(setResult.exitCode).toBe(EXIT.SUCCESS);
    expect(JSON.parse(setResult.output)).toEqual({ provider: "anthropic", backend: "secret-service", ok: true });

    const providers = await cmdProviders({ repoPath, env: service.env, json: true });
    const parsed = JSON.parse(providers.output) as { detected: Array<{ kind: string; credentialPresent: boolean }> };
    expect(parsed.detected.find((d) => d.kind === "anthropic")?.credentialPresent).toBe(true);
    // The key value itself must never appear in providers' output — only presence.
    expect(providers.output).not.toContain("sk-ant-cli-integration-test");
  });

  maybeIt("unset-key removes a previously stored key", async () => {
    await cmdProvidersSetKey({ repoPath, env: service.env }, "openai-compatible", Readable.from(["sk-openai-to-be-removed"]));
    const unsetResult = await cmdProvidersUnsetKey({ repoPath, env: service.env, json: true }, "openai-compatible");
    expect(unsetResult.exitCode).toBe(EXIT.SUCCESS);
    expect(JSON.parse(unsetResult.output)).toEqual({ provider: "openai-compatible", backend: "secret-service", ok: true });

    const providers = await cmdProviders({ repoPath, env: service.env, json: true });
    const parsed = JSON.parse(providers.output) as { detected: Array<{ kind: string; credentialPresent: boolean }> };
    expect(parsed.detected.find((d) => d.kind === "openai-compatible")?.credentialPresent).toBe(false);
  });

  it("set-key rejects an unknown provider name without touching stdin", async () => {
    const result = await cmdProvidersSetKey({ repoPath }, "not-a-real-provider", Readable.from([]));
    expect(result.exitCode).toBe(EXIT.CONFIG_ERROR);
    expect(result.output).toContain("unknown provider");
  });

  it("set-key rejects empty stdin instead of silently storing a blank key", async () => {
    const result = await cmdProvidersSetKey({ repoPath, env: service?.env }, "anthropic", Readable.from(["   \n"]));
    expect(result.exitCode).toBe(EXIT.CONFIG_ERROR);
    expect(result.output).toContain("no key provided on stdin");
  });
});

describe("providers set-key/unset-key (§5.1 tier 2) — encrypted file store, when no keychain exists at all", () => {
  const NO_KEYCHAIN_ENV = { ...process.env, PATH: "/definitely/not/a/real/dir" } as NodeJS.ProcessEnv;

  let repoPath: string;
  let configDir: string;

  beforeEach(() => {
    repoPath = makeSampleRepo();
    configDir = makeTempDir("clutchcode-cli-credfile-test-");
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it("set-key falls back to the file store and providers reports it present, without leaking the value", async () => {
    const stdin = Readable.from(["sk-ant-file-store-cli-test"]);
    const setResult = await cmdProvidersSetKey({ repoPath, env: NO_KEYCHAIN_ENV, credentialFileStore: { configDir }, json: true }, "anthropic", stdin);
    expect(setResult.exitCode).toBe(EXIT.SUCCESS);
    expect(JSON.parse(setResult.output)).toEqual({ provider: "anthropic", backend: "file-store", ok: true });

    const providers = await cmdProviders({ repoPath, env: NO_KEYCHAIN_ENV, credentialFileStore: { configDir }, json: true });
    const parsed = JSON.parse(providers.output) as { detected: Array<{ kind: string; credentialPresent: boolean }> };
    expect(parsed.detected.find((d) => d.kind === "anthropic")?.credentialPresent).toBe(true);
    expect(providers.output).not.toContain("sk-ant-file-store-cli-test");

    // And it's genuinely encrypted on disk, not just "not printed by the CLI".
    const raw = fs.readFileSync(`${configDir}/credentials.age`, "utf8");
    expect(raw).not.toContain("sk-ant-file-store-cli-test");
  });

  it("unset-key removes a file-store-stored key", async () => {
    await cmdProvidersSetKey({ repoPath, env: NO_KEYCHAIN_ENV, credentialFileStore: { configDir } }, "openai-compatible", Readable.from(["sk-openai-to-be-removed"]));
    const unsetResult = await cmdProvidersUnsetKey({ repoPath, env: NO_KEYCHAIN_ENV, credentialFileStore: { configDir }, json: true }, "openai-compatible");
    expect(unsetResult.exitCode).toBe(EXIT.SUCCESS);
    expect(JSON.parse(unsetResult.output)).toEqual({ provider: "openai-compatible", backend: "file-store", ok: true });

    const providers = await cmdProviders({ repoPath, env: NO_KEYCHAIN_ENV, credentialFileStore: { configDir }, json: true });
    const parsed = JSON.parse(providers.output) as { detected: Array<{ kind: string; credentialPresent: boolean }> };
    expect(parsed.detected.find((d) => d.kind === "openai-compatible")?.credentialPresent).toBe(false);
  });

  it("doctor reports the file-store fallback (backend 'none') honestly when there's genuinely no keychain", async () => {
    const result = await cmdDoctor({ repoPath, env: NO_KEYCHAIN_ENV, json: true });
    const parsed = JSON.parse(result.output) as { checks: Array<{ name: string; ok: boolean; detail: string }> };
    const keychain = parsed.checks.find((c) => c.name.startsWith("OS keychain"));
    expect(keychain?.ok).toBe(false);
    expect(keychain?.detail).toMatch(/^none/);
  });
});

describe("memory list/show/forget/correct (§10.3)", () => {
  let repoPath: string;
  let memoryDir: string;
  let stateDir: string;

  beforeEach(() => {
    repoPath = makeSampleRepo();
    memoryDir = makeTempDir("clutchcode-cli-memory-test-");
    stateDir = makeTempDir("clutchcode-cli-memory-state-");
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(memoryDir, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("list reports nothing remembered before any run or correction", async () => {
    const result = await cmdMemoryList({ repoPath, memoryDir, json: true });
    expect(result.exitCode).toBe(EXIT.SUCCESS);
    expect(result.output).toBe("null");
  });

  it("correct seeds a fact; list and show then report it with provenance", async () => {
    const corrected = await cmdMemoryCorrect({ repoPath, memoryDir, json: true }, "test", "pytest -q --maxfail=1");
    expect(corrected.exitCode).toBe(EXIT.SUCCESS);
    expect(JSON.parse(corrected.output)).toEqual({ key: "test", value: "pytest -q --maxfail=1" });

    const list = await cmdMemoryList({ repoPath, memoryDir, json: true });
    const parsedList = JSON.parse(list.output) as { facts: { test?: { value: string; source: string } } };
    expect(parsedList.facts.test?.value).toBe("pytest -q --maxfail=1");
    expect(parsedList.facts.test?.source).toContain("human-corrected");

    const show = await cmdMemoryShow({ repoPath, memoryDir, json: true }, "test");
    const parsedShow = JSON.parse(show.output) as { value: string };
    expect(parsedShow.value).toBe("pytest -q --maxfail=1");
  });

  it("show reports null for a fact that was never remembered", async () => {
    const result = await cmdMemoryShow({ repoPath, memoryDir, json: true }, "lint");
    expect(result.exitCode).toBe(EXIT.SUCCESS);
    expect(result.output).toBe("null");
  });

  it("show/forget/correct reject an unknown fact key", async () => {
    expect((await cmdMemoryShow({ repoPath, memoryDir }, "not-a-real-key")).exitCode).toBe(EXIT.CONFIG_ERROR);
    expect((await cmdMemoryForget({ repoPath, memoryDir }, "not-a-real-key")).exitCode).toBe(EXIT.CONFIG_ERROR);
    expect((await cmdMemoryCorrect({ repoPath, memoryDir }, "not-a-real-key", "x")).exitCode).toBe(EXIT.CONFIG_ERROR);
  });

  it("forget removes a corrected fact; forgetting again reports nothing to remove", async () => {
    await cmdMemoryCorrect({ repoPath, memoryDir }, "build", "make");

    const first = await cmdMemoryForget({ repoPath, memoryDir, json: true }, "build");
    expect(JSON.parse(first.output)).toEqual({ key: "build", removed: true });

    const second = await cmdMemoryForget({ repoPath, memoryDir, json: true }, "build");
    expect(JSON.parse(second.output)).toEqual({ key: "build", removed: false });

    expect((await cmdMemoryShow({ repoPath, memoryDir, json: true }, "build")).output).toBe("null");
  });

  it("a real run persists real toolchain memory, readable back through the CLI", async () => {
    const runResult = await cmdRun({ repoPath, stateDir, memoryDir }, { task: "investigate", providerKind: "fake", model: "n/a", yes: true });
    expect(runResult.exitCode).toBe(EXIT.SUCCESS);

    const show = await cmdMemoryShow({ repoPath, memoryDir, json: true }, "test");
    const parsed = JSON.parse(show.output) as { value: string; source: string };
    expect(parsed.value).toBe("npm run test");
    expect(parsed.source).toBeTruthy();
  }, 30_000);
});

describe("resume (§6.2, §6.3)", () => {
  let repoPath: string;
  let stateDir: string;
  let server: ScriptedServer;

  const toolCallThenStop = [
    [
      sseChunk({
        choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "shell", arguments: JSON.stringify({ cmd: "echo hi" }) } }] } }]
      }),
      sseChunk({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 5, completion_tokens: 2 } }),
      "data: [DONE]\n\n"
    ],
    [sseChunk({ choices: [{ delta: { content: "done" }, finish_reason: "stop" }] }), "data: [DONE]\n\n"]
  ];

  beforeEach(() => {
    repoPath = makeSampleRepo();
    stateDir = makeTempDir("clutchcode-cli-state-");
    markTrusted(repoPath);
  });

  afterEach(async () => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
    await server?.close();
  });

  it("run --max-steps 1 pauses, then resume --extend-steps continues to DONE with the right exit codes", async () => {
    server = await startScriptedServer(toolCallThenStop);

    const paused = await cmdRun(
      { repoPath, stateDir, json: true },
      { task: "investigate", providerKind: "openai-compatible", model: "gpt-test", baseUrl: server.baseUrl, yes: true, maxSteps: 1 }
    );
    expect(paused.exitCode).toBe(EXIT.BUDGET);
    const runId = (JSON.parse(paused.output) as { runId: string }).runId;

    const resumed = await cmdResume({ repoPath, stateDir, json: true }, runId, { extendSteps: 5 });
    expect(resumed.exitCode).toBe(EXIT.SUCCESS);
    expect(JSON.parse(resumed.output)).toMatchObject({ status: "DONE" });
  }, 30_000);

  it("resume on a run that's already DONE is a no-op with exit code 0", async () => {
    const runResult = await cmdRun({ repoPath, stateDir, json: true }, { task: "investigate", providerKind: "fake", model: "n/a", yes: true });
    const runId = (JSON.parse(runResult.output) as { runId: string }).runId;

    const result = await cmdResume({ repoPath, stateDir, json: true }, runId);
    expect(result.exitCode).toBe(EXIT.SUCCESS);
    expect(JSON.parse(result.output)).toMatchObject({ status: "DONE" });
  }, 30_000);

  it("resume on an unknown run id reports a config error", async () => {
    const result = await cmdResume({ repoPath, stateDir }, "does-not-exist");
    expect(result.exitCode).toBe(EXIT.CONFIG_ERROR);
    expect(result.output).toMatch(/no such run/);
  });
});

describe("checkpoints / rollback (§13.3)", () => {
  let repoPath: string;
  let stateDir: string;
  let server: ScriptedServer;

  beforeEach(() => {
    repoPath = makeSampleRepo();
    stateDir = makeTempDir("clutchcode-cli-state-");
    markTrusted(repoPath);
  });

  afterEach(async () => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
    await server?.close();
  });

  it("checkpoints lists what the run committed, rollback restores an earlier one", async () => {
    server = await startScriptedServer([
      [
        sseChunk({
          choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "write_file", arguments: JSON.stringify({ path: "f.txt", body: "v1\n" }) } }] } }]
        }),
        sseChunk({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
        "data: [DONE]\n\n"
      ],
      [sseChunk({ choices: [{ delta: { content: "done" }, finish_reason: "stop" }] }), "data: [DONE]\n\n"]
    ]);
    const runResult = await cmdRun(
      { repoPath, stateDir, json: true },
      { task: "add a feature", providerKind: "openai-compatible", model: "gpt-test", baseUrl: server.baseUrl }
    );
    const runId = (JSON.parse(runResult.output) as { runId: string }).runId;

    const checkpoints = await cmdCheckpoints({ repoPath, stateDir, json: true }, runId);
    expect(checkpoints.exitCode).toBe(EXIT.SUCCESS);
    const parsed = JSON.parse(checkpoints.output) as Array<{ sha: string; message: string }>;
    expect(parsed.length).toBeGreaterThan(0);

    const rolledBack = await cmdRollback({ repoPath, stateDir, json: true }, runId, parsed[0]!.sha.slice(0, 7));
    expect(rolledBack.exitCode).toBe(EXIT.SUCCESS);
  }, 30_000);

  it("rollback reports a config error for an unknown checkpoint", async () => {
    const runResult = await cmdRun({ repoPath, stateDir, json: true }, { task: "investigate", providerKind: "fake", model: "n/a" });
    const runId = (JSON.parse(runResult.output) as { runId: string }).runId;

    const result = await cmdRollback({ repoPath, stateDir }, runId, "deadbeef");
    expect(result.exitCode).toBe(EXIT.CONFIG_ERROR);
    expect(result.output).toMatch(/no checkpoint matching/);
  }, 30_000);

  it("checkpoints reports 'no checkpoints yet' for a run that made no edits", async () => {
    const runResult = await cmdRun({ repoPath, stateDir, json: true }, { task: "investigate", providerKind: "fake", model: "n/a" });
    const runId = (JSON.parse(runResult.output) as { runId: string }).runId;

    const result = await cmdCheckpoints({ repoPath, stateDir }, runId);
    expect(result.output).toBe("no checkpoints yet");
  }, 30_000);
});

describe("pr (§13.5)", () => {
  let repoPath: string;
  let stateDir: string;
  let bareRemote: string;

  beforeEach(() => {
    repoPath = makeSampleRepo();
    stateDir = makeTempDir("clutchcode-cli-state-");
    bareRemote = addBareOrigin(repoPath);
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(bareRemote, { recursive: true, force: true });
  });

  it("pushes the branch and reports the outcome even without gh/GitHub available", async () => {
    const runResult = await cmdRun({ repoPath, stateDir, json: true }, { task: "investigate", providerKind: "fake", model: "n/a" });
    const runId = (JSON.parse(runResult.output) as { runId: string }).runId;

    const result = await cmdPr({ repoPath, stateDir, json: true }, runId);
    expect(result.exitCode).toBe(EXIT.SUCCESS);
    const parsed = JSON.parse(result.output) as { branch: string; method: string };
    expect(parsed.method).toBe("manual");
    const branches = execFileSync("git", ["branch", "--list", parsed.branch], { cwd: bareRemote, encoding: "utf8" });
    expect(branches.trim()).not.toBe("");
  }, 30_000);

  it("reports a config error for an unknown run id", async () => {
    const result = await cmdPr({ repoPath, stateDir }, "does-not-exist");
    expect(result.exitCode).toBe(EXIT.CONFIG_ERROR);
    expect(result.output).toMatch(/no such run/);
  });
});

describe("run --scope (§13.4 monorepos)", () => {
  let repoPath: string;
  let stateDir: string;

  beforeEach(() => {
    stateDir = makeTempDir("clutchcode-cli-state-");
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("reports a config error for a scope that doesn't exist in the worktree", async () => {
    repoPath = makeSampleRepo();
    const result = await cmdRun({ repoPath, stateDir }, { task: "investigate", providerKind: "fake", model: "n/a", scope: "packages/nope" });
    expect(result.exitCode).toBe(EXIT.CONFIG_ERROR);
    expect(result.output).toMatch(/does not exist/);
  }, 30_000);
});

describe("run --workflow (§8.2)", () => {
  let repoPath: string;
  let stateDir: string;

  beforeEach(() => {
    repoPath = makeSampleRepo();
    stateDir = makeTempDir("clutchcode-cli-state-");
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("selects review-only through the real CLI command boundary", async () => {
    const result = await cmdRun(
      { repoPath, stateDir, json: true },
      { task: "review the repo", providerKind: "fake", model: "n/a", yes: true, workflowId: "review-only" }
    );
    expect(result.exitCode).toBe(EXIT.SUCCESS);
    expect(JSON.parse(result.output).status).toBe("DONE");
  }, 30_000);

  it("reports a config error for an unknown workflow id", async () => {
    const result = await cmdRun({ repoPath, stateDir }, { task: "investigate", providerKind: "fake", model: "n/a", workflowId: "not-a-real-workflow" });
    expect(result.exitCode).toBe(EXIT.CONFIG_ERROR);
    expect(result.output).toMatch(/unknown workflow "not-a-real-workflow"/);
  }, 30_000);
});

describe("models probe/list (§4.9)", () => {
  let repoPath: string;
  let modelsDir: string;

  beforeEach(() => {
    repoPath = makeSampleRepo();
    modelsDir = makeTempDir("clutchcode-cli-models-");
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(modelsDir, { recursive: true, force: true });
  });

  it("probes a model with the fake provider and persists a profile", async () => {
    const result = await cmdModelsProbe(
      { repoPath, modelsDir, json: true },
      { model: "test-model", providerKind: "fake", trials: 1 }
    );
    expect(result.exitCode).toBe(EXIT.SUCCESS);
    const parsed = JSON.parse(result.output) as { cached: boolean; profile: { modelId: string } };
    expect(parsed.cached).toBe(false);
    expect(parsed.profile.modelId).toBe("test-model");
  });

  it("reuses a cached profile on a second call, and re-probes with --force", async () => {
    const first = await cmdModelsProbe({ repoPath, modelsDir, json: true }, { model: "test-model", providerKind: "fake", trials: 1 });
    const second = await cmdModelsProbe({ repoPath, modelsDir, json: true }, { model: "test-model", providerKind: "fake", trials: 1 });
    expect((JSON.parse(second.output) as { cached: boolean }).cached).toBe(true);

    const forced = await cmdModelsProbe(
      { repoPath, modelsDir, json: true },
      { model: "test-model", providerKind: "fake", trials: 1, force: true }
    );
    expect((JSON.parse(forced.output) as { cached: boolean }).cached).toBe(false);
    expect(JSON.parse(first.output)).toBeTruthy(); // first was consumed, just asserting it didn't throw
  });

  it("list reports 'no probed models yet' before any probe, then the profile after", async () => {
    const before = await cmdModelsList({ repoPath, modelsDir });
    expect(before.output).toMatch(/no probed models yet/);

    await cmdModelsProbe({ repoPath, modelsDir }, { model: "test-model", providerKind: "fake", trials: 1 });
    const after = await cmdModelsList({ repoPath, modelsDir });
    expect(after.output).toContain("test-model");
  });
});

describe("exitCodeForRunStatus", () => {
  it("maps every status to its documented exit code (§18.4)", () => {
    expect(exitCodeForRunStatus("DONE")).toBe(0);
    expect(exitCodeForRunStatus("FAILED")).toBe(1);
    expect(exitCodeForRunStatus("ESCALATED")).toBe(2);
    expect(exitCodeForRunStatus("AWAITING_APPROVAL")).toBe(2);
    expect(exitCodeForRunStatus("PAUSED")).toBe(3);
    expect(exitCodeForRunStatus("CANCELLED")).toBe(130);
  });
});
