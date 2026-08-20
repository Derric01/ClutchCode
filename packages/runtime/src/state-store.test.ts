import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunStateStore } from "./state-store.js";
import { createRunState, transition } from "./run-state.js";

describe("RunStateStore", () => {
  let stateDir: string;
  let store: RunStateStore;

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-state-store-"));
    store = new RunStateStore(stateDir);
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("returns null for a run that was never saved", () => {
    expect(store.load("nope")).toBeNull();
  });

  it("round-trips a saved RunState, enabling resume", () => {
    const state = createRunState({ runId: "r1", task: "fix the bug", provider: "fake", model: "fake" });
    transition(state, "UNDERSTANDING");
    transition(state, "INSPECTING");
    transition(state, "ACTING");
    store.save(state);

    const loaded = store.load("r1");
    expect(loaded).not.toBeNull();
    expect(loaded!.status).toBe("ACTING");
    expect(loaded!.task).toBe("fix the bug");
  });

  it("lists saved runs", () => {
    store.save(createRunState({ runId: "r1", task: "a", provider: "fake", model: "fake" }));
    store.save(createRunState({ runId: "r2", task: "b", provider: "fake", model: "fake" }));
    expect(store.list().sort()).toEqual(["r1", "r2"]);
  });

  it("deletes a run's persisted state", () => {
    store.save(createRunState({ runId: "r1", task: "a", provider: "fake", model: "fake" }));
    store.delete("r1");
    expect(store.load("r1")).toBeNull();
  });

  it("rejects a path-traversal runId on load/save/delete instead of reading/writing outside stateDir (real gap caught in round 3 of security review — round 2 only validated runId at worktree creation, not at every RunStateStore entry point)", () => {
    const evil = "../../../../../../tmp/clutchcode-state-store-poc";
    expect(() => store.load(evil)).toThrow(/invalid runId/);
    expect(() =>
      store.save(createRunState({ runId: evil, task: "a", provider: "fake", model: "fake" }))
    ).toThrow(/invalid runId/);
    expect(() => store.delete(evil)).toThrow(/invalid runId/);
    expect(fs.existsSync("/tmp/clutchcode-state-store-poc")).toBe(false);
  });
});
