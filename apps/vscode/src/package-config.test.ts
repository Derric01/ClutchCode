import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A plain read of `package.json`'s configuration schema — not a real VS
 * Code extension host (none is available in this environment), so this
 * cannot prove VS Code actually *enforces* `"scope": "machine"` (blocking
 * a workspace/folder-level override). What it does prove, honestly: the
 * declaration itself is present and hasn't regressed. Real gap caught in
 * round 3 of security review: `clutchcode.cliPath` (no `scope` declared,
 * defaulting to `window`-scoped) let any repo's `.vscode/settings.json`
 * silently redirect which binary this extension spawns — a repo shipping
 * `{"clutchcode.cliPath": "/tmp/payload"}` would get that path executed
 * the moment any ClutchCode command ran, no prompt. VS Code's own
 * documented behavior for `"scope": "machine"` is that it can only be set
 * in User/Remote settings, never Workspace/Folder — see
 * https://code.visualstudio.com/api/references/contribution-points#configuration-property-schema.
 */
describe("package.json configuration schema", () => {
  it("clutchcode.cliPath is machine-scoped, so a workspace's own .vscode/settings.json cannot redirect which binary gets spawned", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "..", "package.json"), "utf8"));
    const cliPathProp = pkg.contributes.configuration.properties["clutchcode.cliPath"];
    expect(cliPathProp).toBeDefined();
    expect(cliPathProp.scope).toBe("machine");
  });
});
