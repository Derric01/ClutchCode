import { describe, expect, it } from "vitest";
import { loadCredentialsFromEnv } from "./credentials.js";

describe("loadCredentialsFromEnv", () => {
  it("reads the documented escape-hatch env vars (§5.1)", () => {
    const creds = loadCredentialsFromEnv({
      ANTHROPIC_API_KEY: "sk-ant-test",
      OPENAI_API_KEY: "sk-test",
      OPENAI_BASE_URL: "https://example.invalid/v1"
    } as NodeJS.ProcessEnv);

    expect(creds).toEqual({
      anthropicApiKey: "sk-ant-test",
      openaiApiKey: "sk-test",
      openaiBaseUrl: "https://example.invalid/v1"
    });
  });

  it("leaves fields undefined when unset", () => {
    const creds = loadCredentialsFromEnv({} as NodeJS.ProcessEnv);
    expect(creds.anthropicApiKey).toBeUndefined();
    expect(creds.openaiApiKey).toBeUndefined();
  });
});
