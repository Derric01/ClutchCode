import { describe, expect, it } from "vitest";
import { scrubEnv } from "./env.js";

describe("scrubEnv", () => {
  it("strips API keys, tokens, and cloud credentials", () => {
    const out = scrubEnv({
      PATH: "/usr/bin",
      HOME: "/home/user",
      OPENAI_API_KEY: "sk-should-not-survive",
      ANTHROPIC_API_KEY: "sk-ant-should-not-survive",
      AWS_SECRET_ACCESS_KEY: "should-not-survive",
      AWS_ACCESS_KEY_ID: "should-not-survive",
      GH_TOKEN: "should-not-survive",
      GITHUB_TOKEN: "should-not-survive",
      DB_PASSWORD: "should-not-survive"
    });

    expect(out.PATH).toBe("/usr/bin");
    expect(out.HOME).toBe("/home/user");
    expect(out).not.toHaveProperty("OPENAI_API_KEY");
    expect(out).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(out).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
    expect(out).not.toHaveProperty("AWS_ACCESS_KEY_ID");
    expect(out).not.toHaveProperty("GH_TOKEN");
    expect(out).not.toHaveProperty("GITHUB_TOKEN");
    expect(out).not.toHaveProperty("DB_PASSWORD");
  });

  it("drops anything not on the allowlist by default (allowlist-first)", () => {
    const out = scrubEnv({ PATH: "/usr/bin", SOME_RANDOM_VAR: "value" });
    expect(out).not.toHaveProperty("SOME_RANDOM_VAR");
  });

  it("passes through extra explicitly-allowed vars", () => {
    const out = scrubEnv({ PATH: "/usr/bin", MY_SAFE_FLAG: "1" }, { extraAllowed: ["MY_SAFE_FLAG"] });
    expect(out.MY_SAFE_FLAG).toBe("1");
  });
});
