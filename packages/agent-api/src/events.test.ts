import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendEvent, readEvents } from "./events.js";

describe("events", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-events-"));
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("appends and reads back events for a run, timestamped", () => {
    appendEvent(stateDir, "r1", { type: "model.response", text: "hi", toolCalls: 0 });
    const events = readEvents(stateDir, "r1");
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("model.response");
    expect(events[0]!.ts).toBeGreaterThan(0);
  });

  it("returns an empty array for a run with no events yet", () => {
    expect(readEvents(stateDir, "nope")).toEqual([]);
  });

  it("rejects a path-traversal runId on appendEvent/readEvents instead of writing/reading outside stateDir (real gap caught in round 3 of security review — reachable via `agent inspect` / the RPC `inspect` method)", () => {
    const evil = "../../../../../../tmp/clutchcode-events-poc";
    expect(() => appendEvent(stateDir, evil, { type: "model.response", text: "hi", toolCalls: 0 })).toThrow(/invalid runId/);
    expect(() => readEvents(stateDir, evil)).toThrow(/invalid runId/);
    expect(fs.existsSync("/tmp/clutchcode-events-poc")).toBe(false);
  });
});
