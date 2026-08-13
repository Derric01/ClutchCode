import { describe, expect, it } from "vitest";
import { classifyProviderError, classifyToolError, classifyVerificationFailure } from "./error-taxonomy.js";

describe("classifyToolError", () => {
  it("classifies ordinary tool-usage mistakes as tool-error", () => {
    expect(classifyToolError("not-found")).toBe("tool-error");
    expect(classifyToolError("denylisted")).toBe("tool-error");
    expect(classifyToolError("policy-denied")).toBe("tool-error");
  });

  it("classifies a bad edit block as model-error", () => {
    expect(classifyToolError("edit-block-failed")).toBe("model-error");
  });

  it("classifies infrastructure problems as environment-error", () => {
    expect(classifyToolError("spawn-error")).toBe("environment-error");
    expect(classifyToolError("search-backend-unavailable")).toBe("environment-error");
    expect(classifyToolError("timeout")).toBe("environment-error");
  });

  it("falls back to unknown for an unrecognized code", () => {
    expect(classifyToolError("something-new")).toBe("unknown");
  });
});

describe("classifyProviderError", () => {
  it("treats a retryable provider error as environment-error", () => {
    expect(classifyProviderError(true)).toBe("environment-error");
  });

  it("treats a non-retryable provider error as model-error", () => {
    expect(classifyProviderError(false)).toBe("model-error");
  });
});

describe("classifyVerificationFailure", () => {
  it("is always a task error", () => {
    expect(classifyVerificationFailure()).toBe("task-error");
  });
});
