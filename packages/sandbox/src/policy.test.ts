import { describe, expect, it } from "vitest";
import { PolicyEngine } from "./policy.js";
import type { PolicyRequest } from "./types.js";

function req(overrides: Partial<PolicyRequest>): PolicyRequest {
  return {
    permissionClass: "READ",
    commandClass: "test",
    subject: "x",
    repoTrustMode: "untrusted",
    ...overrides
  };
}

describe("PolicyEngine", () => {
  it("allows read of a non-denylisted path", () => {
    const p = new PolicyEngine();
    const r = p.decide(req({ permissionClass: "READ", denylisted: false }));
    expect(r.decision).toBe("ALLOW");
  });

  it("denies read of a denylisted path", () => {
    const p = new PolicyEngine();
    const r = p.decide(req({ permissionClass: "READ", denylisted: true }));
    expect(r.decision).toBe("DENY");
  });

  it("allows write inside the workspace, denies outside", () => {
    const p = new PolicyEngine();
    expect(p.decide(req({ permissionClass: "WRITE", insideWorkspace: true })).decision).toBe("ALLOW");
    expect(p.decide(req({ permissionClass: "WRITE", insideWorkspace: false })).decision).toBe("DENY");
  });

  it("asks on first non-destructive execute in an untrusted repo, then remembers", () => {
    const p = new PolicyEngine();
    const first = p.decide(req({ permissionClass: "EXECUTE", commandClass: "npm test" }));
    expect(first.decision).toBe("ASK");

    p.remember("npm test", "ALLOW");
    const second = p.decide(req({ permissionClass: "EXECUTE", commandClass: "npm test" }));
    expect(second.decision).toBe("ALLOW");
  });

  it("always asks for destructive commands, even after remembering ALLOW for the class", () => {
    const p = new PolicyEngine();
    p.remember("git push", "ALLOW");
    const r = p.decide(
      req({ permissionClass: "EXECUTE", commandClass: "git push", destructive: true })
    );
    expect(r.decision).toBe("ASK");
  });

  it("allows non-destructive execute by default in a trusted repo", () => {
    const p = new PolicyEngine();
    const r = p.decide(req({ permissionClass: "EXECUTE", commandClass: "ls", repoTrustMode: "trusted" }));
    expect(r.decision).toBe("ALLOW");
  });

  it("denies network by default; allowlisted hosts still ask, never silent-allow", () => {
    const p = new PolicyEngine();
    expect(p.decide(req({ permissionClass: "NETWORK", networkAllowlisted: false })).decision).toBe("DENY");
    expect(p.decide(req({ permissionClass: "NETWORK", networkAllowlisted: true })).decision).toBe("ASK");
  });

  it("records every decision to the log", () => {
    const p = new PolicyEngine();
    p.decide(req({ permissionClass: "READ" }));
    p.decide(req({ permissionClass: "WRITE", insideWorkspace: true }));
    expect(p.getLog()).toHaveLength(2);
  });
});
