import { describe, expect, it } from "vitest";
import type { Command, Option } from "commander";
import { buildProgram } from "./program.js";

/**
 * A structural invariant over the whole command tree, guarding a real bug
 * that shipped in six places at once (§18.2/§18.4).
 *
 * **The bug.** In commander v15, when a parent command and one of its
 * subcommands both declare the same long option, the flag is parsed onto
 * the **parent**, and the subcommand's own `opts()` keeps its declared
 * default forever. Every `memory`/`providers` subcommand re-registered
 * `baseOptions`, so:
 *
 * - `clutchcode memory correct build "npm run build" --repo /other/repo`
 *   wrote the fact into the **current directory's** repo instead — and
 *   printed a success message. Reproduced against the real binary before
 *   the fix, and again after (`cli.test.ts` pins the behavior).
 * - `clutchcode memory list --json` printed human-readable prose,
 *   breaking §18.4's "`--json` always prints machine-readable output to
 *   stdout" contract that scripts and CI depend on.
 *
 * **Why a structural test and not only behavioral ones.** Per this repo's
 * "fix the class, not the instance" rule: the behavioral tests cover the
 * eight subcommands that exist today, but the next subcommand added the
 * old way would silently reintroduce the same defect. This walks the real
 * tree instead, so the invariant holds for every command that will ever
 * be registered — the same reasoning that made `assertSafeRunId` one
 * shared validator rather than a fix at one call site.
 */

interface Shadow {
  path: string;
  flag: string;
  shadowedBy: string;
}

function longFlags(cmd: Command): string[] {
  return (cmd.options as Option[]).map((o) => o.long).filter((l): l is string => typeof l === "string");
}

/** Walks the tree, collecting every option a command declares that one of its ancestors also declares. */
function findShadowedOptions(cmd: Command, ancestors: { path: string; flags: string[] }[] = [], path: string[] = []): Shadow[] {
  const here = [...path, cmd.name()];
  const label = here.join(" ");
  const found: Shadow[] = [];

  for (const flag of longFlags(cmd)) {
    for (const ancestor of ancestors) {
      if (ancestor.flags.includes(flag)) found.push({ path: label, flag, shadowedBy: ancestor.path });
    }
  }

  const nextAncestors = [...ancestors, { path: label, flags: longFlags(cmd) }];
  for (const child of cmd.commands as Command[]) found.push(...findShadowedOptions(child, nextAncestors, here));
  return found;
}

describe("CLI command tree structure (§18.2)", () => {
  it("no subcommand re-declares an option one of its ancestors already declares", () => {
    // A shadowed option is silently unreadable via the subcommand's own
    // `opts()`: commander parses it onto the ancestor. Declare it once, on
    // the group parent, and read the merged view with `globalOpts`.
    expect(findShadowedOptions(buildProgram())).toEqual([]);
  });

  it("the walker actually detects shadowing (so the invariant above isn't vacuously true)", () => {
    const program = buildProgram();
    const group = program.commands.find((c) => c.name() === "memory")!;
    const victim = group.commands.find((c) => c.name() === "list")!;
    // `memory` declares --json; re-declaring it on `memory list` is exactly
    // the pre-fix shape this test exists to reject.
    victim.option("--json", "machine-readable JSON output", false);

    expect(findShadowedOptions(program)).toEqual([{ path: "clutchcode memory list", flag: "--json", shadowedBy: "clutchcode memory" }]);
  });

  it("every group parent that owns shared options still declares them itself, so its subcommands can inherit them", () => {
    const program = buildProgram();
    for (const name of ["memory", "providers", "workflow"]) {
      const group = program.commands.find((c) => c.name() === name);
      expect(group, `expected a "${name}" group command`).toBeDefined();
      expect(longFlags(group!), `${name} must own --repo/--json for its subcommands to inherit`).toEqual(expect.arrayContaining(["--repo", "--json"]));
      expect(group!.commands.length, `${name} should have subcommands`).toBeGreaterThan(0);
    }
  });
});
