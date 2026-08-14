import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectToAgentRpc, type RpcConnection } from "./connection.js";
import { makeSampleRepo } from "./test-helpers.js";

/**
 * Spawns the *real*, compiled `clutchcode` CLI binary (`clutchcode serve`)
 * as an actual child process and talks to it over real OS pipes — the
 * exact mechanism the extension uses, just invoked directly instead of
 * from inside a VS Code extension host. Requires `apps/cli` to have been
 * built (`tsc -b`) first, same as the rest of this monorepo's test run.
 */
const cliEntry = path.resolve(import.meta.dirname, "..", "..", "cli", "dist", "cli.js");

describe.skipIf(!fs.existsSync(cliEntry))("connectToAgentRpc (spawns the real clutchcode binary)", () => {
  let repoPath: string;
  let connection: RpcConnection;

  beforeEach(() => {
    repoPath = makeSampleRepo();
    connection = connectToAgentRpc({ command: "node", args: [cliEntry, "serve"], cwd: repoPath });
  });

  afterEach(() => {
    connection.dispose();
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  it("a spawned real clutchcode serve process answers a run request", async () => {
    const result = await connection.client.request<{ status: string }>("run", {
      task: "investigate",
      providerKind: "fake",
      model: "n/a",
      yesMode: true
    });
    expect(result.status).toBe("DONE");
  }, 30_000);
});
