import { describe, expect, it } from "vitest";
import { Denylist } from "./denylist.js";

describe("Denylist", () => {
  const dl = new Denylist();

  it("denies dotenv files but allows .env.example", () => {
    expect(dl.isDenied("/repo/.env")).toBe(true);
    expect(dl.isDenied(".env.local")).toBe(true);
    expect(dl.isDenied("/repo/.env.example")).toBe(false);
  });

  it("denies well-known credential directories", () => {
    expect(dl.isDenied("/home/user/.ssh/id_rsa")).toBe(true);
    expect(dl.isDenied("/home/user/.aws/credentials")).toBe(true);
    expect(dl.isDenied("/home/user/.kube/config")).toBe(true);
    expect(dl.isDenied("/home/user/.config/gcloud/creds.json")).toBe(true);
  });

  it("denies shell history and git-credentials", () => {
    expect(dl.isDenied("/home/user/.bash_history")).toBe(true);
    expect(dl.isDenied("/repo/.git-credentials")).toBe(true);
    expect(dl.isDenied("/home/user/.netrc")).toBe(true);
  });

  it("allows ordinary project files", () => {
    expect(dl.isDenied("/repo/src/index.ts")).toBe(false);
    expect(dl.isDenied("/repo/package.json")).toBe(false);
    expect(dl.isDenied("/repo/README.md")).toBe(false);
  });

  it("supports project-specific extra denylist entries", () => {
    const custom = new Denylist({ extraBasenames: ["secrets.local.json"] });
    expect(custom.isDenied("/repo/secrets.local.json")).toBe(true);
    expect(dl.isDenied("/repo/secrets.local.json")).toBe(false);
  });
});
