import { describe, expect, it } from "vitest";
import { LoopDetector } from "./loop-detector.js";

describe("LoopDetector", () => {
  it("warns on a repeated identical tool call, then escalates past the cap", () => {
    const d = new LoopDetector();
    const args = { path: "a.ts" };

    expect(d.recordToolCall("read_file", args)).toBeNull();
    const warn = d.recordToolCall("read_file", args);
    expect(warn?.kind).toBe("repeated-call");
    expect(warn?.escalate).toBe(false);

    d.recordToolCall("read_file", args);
    const escalate = d.recordToolCall("read_file", args);
    expect(escalate?.kind).toBe("repeated-call");
    expect(escalate?.escalate).toBe(true);
  });

  it("treats calls with different args as distinct (no false positive)", () => {
    const d = new LoopDetector();
    expect(d.recordToolCall("read_file", { path: "a.ts" })).toBeNull();
    expect(d.recordToolCall("read_file", { path: "b.ts" })).toBeNull();
  });

  it("is insensitive to key order when hashing args (stable stringify)", () => {
    const d = new LoopDetector();
    d.recordToolCall("shell", { cmd: "ls", timeoutMs: 1000 });
    const warn = d.recordToolCall("shell", { timeoutMs: 1000, cmd: "ls" });
    expect(warn?.kind).toBe("repeated-call");
  });

  it("detects an oscillating edit (A -> B -> A) on the same file", () => {
    const d = new LoopDetector();
    expect(d.recordEdit("f.ts", "hashA")).toBeNull();
    expect(d.recordEdit("f.ts", "hashB")).toBeNull();
    const osc = d.recordEdit("f.ts", "hashA");
    expect(osc?.kind).toBe("oscillating-edit");
  });

  it("does not flag steady forward progress on a file", () => {
    const d = new LoopDetector();
    expect(d.recordEdit("f.ts", "h1")).toBeNull();
    expect(d.recordEdit("f.ts", "h2")).toBeNull();
    expect(d.recordEdit("f.ts", "h3")).toBeNull();
    expect(d.recordEdit("f.ts", "h4")).toBeNull();
  });

  it("flags no-progress when the diff-stat is unchanged across the window", () => {
    const d = new LoopDetector();
    let warning = null;
    for (let i = 0; i < 5; i++) {
      warning = d.recordProgress("1 file changed, 3 insertions(+)");
    }
    expect(warning?.kind).toBe("no-progress");
  });

  it("does not flag progress when the diff-stat keeps changing", () => {
    const d = new LoopDetector();
    let warning = null;
    for (let i = 0; i < 5; i++) {
      warning = d.recordProgress(`${i} files changed`);
    }
    expect(warning).toBeNull();
  });

  it("flags an almost-done stall after repeated verify failures, and resets on a pass", () => {
    const d = new LoopDetector();
    expect(d.recordVerifyResult(false)?.kind).toBeUndefined();
    expect(d.recordVerifyResult(false)?.kind).toBeUndefined();
    const stall = d.recordVerifyResult(false);
    expect(stall?.kind).toBe("almost-done-stall");

    expect(d.recordVerifyResult(true)).toBeNull(); // resets the streak
  });
});
