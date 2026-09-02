import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { defaultSuiteDir, loadEvalTask, materializeTaskRepo } from "./eval-task.js";
import { makeTempDir } from "./fixture-repo.js";
import {
  NAKED_SYSTEM_PROMPT,
  applyWholeFileBlocks,
  buildNakedPrompt,
  collectRepoFiles,
  parseWholeFileBlocks,
  runNakedTask
} from "./naked-arm.js";
import { startScriptedModelServer, type ScriptedModelServer } from "./scripted-model-server.js";

/**
 * The naked arm of the §16.4 A/B.
 *
 * The end-to-end cases below are real in every layer the harness owns: a
 * real git repository materialized from the shipped suite, a real HTTP
 * round trip through the real `OpenAICompatibleProvider`, real files
 * written to a real disk, and the real held-out oracle executed as a real
 * child process afterwards. Only the model's reply text is scripted —
 * `CLAUDE.md`'s standing split.
 *
 * The load-bearing assertion in every end-to-end case is
 * `server.requestCount()`. "Naked" is defined by what does *not* happen —
 * no repair iteration, no verification feedback, no second turn — and a
 * call counter is the only thing that actually proves it, since a naked
 * arm that quietly grew a retry would still look plausible on every other
 * metric while destroying the delta the whole experiment exists to
 * measure.
 */

const BUGFIX = loadEvalTask(path.join(defaultSuiteDir(), "node-bugfix-duration"));

const FIXED_DURATION_JS = `'use strict';

/**
 * Parse a duration string ("1h30m", "90m", "45s") into milliseconds.
 * Unrecognized text is ignored; an empty string is 0.
 */
function parseDuration(text) {
  const pattern = /(\\d+)(h|m|s)/g;
  let total = 0;
  let match;
  while ((match = pattern.exec(String(text))) !== null) {
    const value = Number(match[1]);
    const unit = match[2];
    if (unit === 'h') {
      total += value * 60 * 60 * 1000;
    } else if (unit === 'm') {
      total += value * 60 * 1000;
    } else {
      total += value * 1000;
    }
  }
  return total;
}

module.exports = { parseDuration };
`;

let servers: ScriptedModelServer[] = [];
const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = makeTempDir(prefix);
  tempDirs.push(dir);
  return dir;
}

async function scriptedText(text: string): Promise<ScriptedModelServer> {
  const server = await startScriptedModelServer([{ kind: "text", text }]);
  servers.push(server);
  return server;
}

afterEach(async () => {
  for (const server of servers) await server.close();
  servers = [];
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("parseWholeFileBlocks (§16.4)", () => {
  it("reads a bare path line immediately before a fence", () => {
    const parsed = parseWholeFileBlocks(["src/slug.js", "```", "module.exports = 1;", "```"].join("\n"));
    expect(parsed.files).toEqual([{ path: "src/slug.js", content: "module.exports = 1;\n" }]);
    expect(parsed.unlabeledBlocks).toBe(0);
    expect(parsed.totalBlocks).toBe(1);
  });

  it("reads the path out of the fence info string, and is not fooled by a bare language tag", () => {
    const withPath = parseWholeFileBlocks(["```js src/slug.js", "const a = 1;", "```"].join("\n"));
    expect(withPath.files.map((f) => f.path)).toEqual(["src/slug.js"]);

    // A language tag has neither an extension nor a separator, so it must
    // never be mistaken for a filename — that would write a file called
    // "javascript" and score the run as having produced an edit.
    const languageOnly = parseWholeFileBlocks(["```javascript", "const a = 1;", "```"].join("\n"));
    expect(languageOnly.files).toEqual([]);
    expect(languageOnly.unlabeledBlocks).toBe(1);
  });

  it("accepts the label shapes models actually use", () => {
    const shapes: Array<[string, string]> = [
      ["`src/slug.js`", "backticked"],
      ["**src/slug.js**", "bold"],
      ["File: src/slug.js", "File: prefix"],
      ["filename: src/slug.js", "filename: prefix"],
      ["### src/slug.js", "markdown heading"],
      ["- src/slug.js", "list bullet"],
      ["src/slug.js:", "trailing colon"],
      ["./src/slug.js", "leading ./"],
      ["/src/slug.js", "leading /"]
    ];
    for (const [label, why] of shapes) {
      const parsed = parseWholeFileBlocks([label, "```", "x", "```"].join("\n"));
      expect(parsed.files.map((f) => f.path), why).toEqual(["src/slug.js"]);
    }
  });

  it("looks back past a blank line, but not past four lines of prose", () => {
    const nearby = parseWholeFileBlocks(["src/slug.js", "", "```", "x", "```"].join("\n"));
    expect(nearby.files.map((f) => f.path)).toEqual(["src/slug.js"]);

    const buried = parseWholeFileBlocks(["src/slug.js", "", "Here is the fix, which I am quite proud of.", "", "```", "x", "```"].join("\n"));
    expect(buried.files).toEqual([]);
    expect(buried.unlabeledBlocks).toBe(1);
  });

  it("counts an unattributable block instead of dropping it silently", () => {
    const parsed = parseWholeFileBlocks(["Here you go:", "```", "some code", "```", "", "src/ok.js", "```", "fine", "```"].join("\n"));
    expect(parsed.files.map((f) => f.path)).toEqual(["src/ok.js"]);
    expect(parsed.unlabeledBlocks).toBe(1);
    expect(parsed.totalBlocks).toBe(2);
  });

  it("lets the last block win when the same file is emitted twice", () => {
    const parsed = parseWholeFileBlocks(["a.js", "```", "first", "```", "", "a.js", "```", "second", "```"].join("\n"));
    expect(parsed.files).toEqual([{ path: "a.js", content: "second\n" }]);
  });

  it("preserves content verbatim and terminates the file with a newline", () => {
    const parsed = parseWholeFileBlocks(["a.py", "```python", "def f():", "    return {'k': 'v'}", "", "", "```"].join("\n"));
    expect(parsed.files[0]!.content).toBe("def f():\n    return {'k': 'v'}\n\n");
  });

  it("closes on a fence of the same character and at least the opening length, so a nested shorter fence survives", () => {
    const parsed = parseWholeFileBlocks(["notes.md", "````", "```", "inner", "```", "````"].join("\n"));
    expect(parsed.files).toEqual([{ path: "notes.md", content: "```\ninner\n```\n" }]);
  });

  it("keeps whatever a truncated reply managed to emit rather than discarding an unterminated block", () => {
    const parsed = parseWholeFileBlocks(["a.js", "```", "const a = 1;"].join("\n"));
    expect(parsed.files).toEqual([{ path: "a.js", content: "const a = 1;\n" }]);
  });

  it("finds nothing in a reply that is only prose", () => {
    const parsed = parseWholeFileBlocks("I would change the multiplier in src/duration.js from 60 to 3600.");
    expect(parsed.files).toEqual([]);
    expect(parsed.totalBlocks).toBe(0);
  });
});

describe("collectRepoFiles (§16.4)", () => {
  it("reads a real materialized task repo, skips .git, and orders deterministically", () => {
    const repo = path.join(tempDir("clutchcode-naked-collect-"), "repo");
    materializeTaskRepo(BUGFIX, repo);

    const collected = collectRepoFiles(repo);
    const paths = collected.files.map((f) => f.path);
    expect(paths).toContain("src/duration.js");
    expect(paths).toContain("test/duration.test.js");
    expect(paths).toContain("package.json");
    expect(paths.some((p) => p.startsWith(".git/"))).toBe(false);
    expect(paths).toEqual([...paths].sort((a, b) => a.localeCompare(b)));
    expect(collected.files.find((f) => f.path === "src/duration.js")!.content).toContain("parseDuration");
  });

  it("omits an oversized or binary file with a stated reason instead of truncating the prompt silently", () => {
    const repo = path.join(tempDir("clutchcode-naked-collect-omit-"), "repo");
    materializeTaskRepo(BUGFIX, repo);
    fs.writeFileSync(path.join(repo, "huge.txt"), "x".repeat(200_000), "utf8");
    fs.writeFileSync(path.join(repo, "blob.bin"), Buffer.from([0x01, 0x00, 0x02]));

    const collected = collectRepoFiles(repo, { maxFileBytes: 1024 });
    expect(collected.omitted).toContainEqual({ path: "huge.txt", reason: "too-large" });
    expect(collected.omitted).toContainEqual({ path: "blob.bin", reason: "binary" });
    expect(collected.files.map((f) => f.path)).not.toContain("huge.txt");
  });

  it("stops at the total byte budget and says which files it dropped", () => {
    const repo = tempDir("clutchcode-naked-collect-budget-");
    fs.writeFileSync(path.join(repo, "a.txt"), "a".repeat(100), "utf8");
    fs.writeFileSync(path.join(repo, "b.txt"), "b".repeat(100), "utf8");

    const collected = collectRepoFiles(repo, { maxTotalBytes: 150 });
    expect(collected.files.map((f) => f.path)).toEqual(["a.txt"]);
    expect(collected.omitted).toEqual([{ path: "b.txt", reason: "total-budget" }]);
  });
});

describe("buildNakedPrompt (§16.4)", () => {
  it("hands the model the task verbatim and every file's real contents", () => {
    const messages = buildNakedPrompt(BUGFIX, [
      { path: "src/a.js", content: "const a = 1;\n" },
      { path: "src/b.js", content: "const b = 2;\n" }
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toBe(NAKED_SYSTEM_PROMPT);

    const user = messages[1]!.content;
    expect(user).toContain(BUGFIX.prompt);
    expect(user).toContain("const a = 1;");
    expect(user).toContain("const b = 2;");
    // Input files are delimited, not fenced, so a file that itself
    // contains a code fence cannot terminate its own section — and so the
    // reply parser never mistakes an input file for an output block.
    expect(user).toContain("----- BEGIN FILE src/a.js -----");
    expect(user).toContain("----- END FILE src/b.js -----");
    expect(parseWholeFileBlocks(user).totalBlocks).toBe(0);
  });
});

describe("applyWholeFileBlocks (§16.4)", () => {
  it("creates nested files that do not exist yet", () => {
    const repo = tempDir("clutchcode-naked-apply-");
    const outcome = applyWholeFileBlocks(repo, [{ path: "tests/deep/test_x.py", content: "assert True\n" }]);
    expect(outcome.written).toEqual(["tests/deep/test_x.py"]);
    expect(outcome.rejected).toEqual([]);
    expect(fs.readFileSync(path.join(repo, "tests/deep/test_x.py"), "utf8")).toBe("assert True\n");
  });

  it("refuses a traversal path, and the file outside the repo is genuinely untouched", () => {
    const parent = tempDir("clutchcode-naked-apply-escape-");
    const repo = path.join(parent, "repo");
    fs.mkdirSync(repo);
    const canary = path.join(parent, "canary.txt");
    fs.writeFileSync(canary, "original\n", "utf8");

    const outcome = applyWholeFileBlocks(repo, [{ path: "../canary.txt", content: "OVERWRITTEN\n" }]);
    expect(outcome.written).toEqual([]);
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]!.path).toBe("../canary.txt");
    // The assertion that actually matters: the write did not happen.
    expect(fs.readFileSync(canary, "utf8")).toBe("original\n");
  });

  it("refuses an absolute path and a Windows drive path even on POSIX", () => {
    const repo = tempDir("clutchcode-naked-apply-abs-");
    const outcome = applyWholeFileBlocks(repo, [
      { path: "/etc/clutchcode-should-not-exist", content: "no\n" },
      { path: "C:\\Windows\\System32\\nope.txt", content: "no\n" }
    ]);
    expect(outcome.written).toEqual([]);
    expect(outcome.rejected).toHaveLength(2);
    expect(fs.existsSync("/etc/clutchcode-should-not-exist")).toBe(false);
  });

  it("refuses to write into .git, which is never a file the task asked for", () => {
    const repo = path.join(tempDir("clutchcode-naked-apply-git-"), "repo");
    materializeTaskRepo(BUGFIX, repo);
    const before = fs.readFileSync(path.join(repo, ".git", "config"), "utf8");

    const outcome = applyWholeFileBlocks(repo, [{ path: ".git/config", content: "[core]\n  hooksPath = /tmp/evil\n" }]);
    expect(outcome.written).toEqual([]);
    expect(outcome.rejected[0]!.reason).toMatch(/\.git/);
    expect(fs.readFileSync(path.join(repo, ".git", "config"), "utf8")).toBe(before);
  });
});

describe("runNakedTask (§16.4) — real repo, real HTTP, real oracle, scripted reply", () => {
  it(
    "solves the bug-fix task when the single reply carries the corrected whole file — in exactly one model call",
    async () => {
      const server = await scriptedText(["Here is the fix.", "", "src/duration.js", "```js", FIXED_DURATION_JS.trimEnd(), "```"].join("\n"));

      const { result } = await runNakedTask(BUGFIX, {
        providerKind: "openai-compatible",
        model: "scripted-naked-solver",
        baseUrl: server.baseUrl
      });

      expect(result.solved).toBe(true);
      expect(result.oracleExitCode).toBe(0);
      expect(result.filesWritten).toBe(1);
      expect(result.filesRejected).toBe(0);
      expect(result.blocksEmitted).toBe(1);
      expect(result.unlabeledBlocks).toBe(0);
      expect(result.promptFiles).toBeGreaterThan(0);
      // Real tokens, reported by the real adapter from the scripted usage block.
      expect(result.tokens).toBeGreaterThan(0);
      expect(result.finishReason).toBe("stop");

      // The defining property of this arm: one call, no repair loop.
      expect(result.modelCalls).toBe(1);
      expect(server.requestCount()).toBe(1);
    },
    120_000
  );

  it(
    "scores a prose-only reply unsolved, and still only ever asks the model once",
    async () => {
      const server = await scriptedText("You should change the hours multiplier in src/duration.js to 60 * 60 * 1000.");

      const { result } = await runNakedTask(BUGFIX, {
        providerKind: "openai-compatible",
        model: "scripted-naked-talker",
        baseUrl: server.baseUrl
      });

      expect(result.solved).toBe(false);
      expect(result.oracleExitCode).not.toBe(0);
      expect(result.blocksEmitted).toBe(0);
      expect(result.filesWritten).toBe(0);
      // This is the whole point of the arm: the gate would have gone red
      // here and the ClutchCode arm would have got that failure fed back
      // (§14.5) and tried again. The naked arm does not, and the counter
      // is what proves it rather than the comment.
      expect(result.modelCalls).toBe(1);
      expect(server.requestCount()).toBe(1);
    },
    120_000
  );

  it(
    "is not fooled by a reply that guts the repository's own test instead of fixing the bug",
    async () => {
      // No cheat detector runs in this arm — it does not need one. The
      // held-out oracle never entered the model's prompt, so deleting the
      // repo's assertions buys nothing.
      const server = await scriptedText(
        ["test/duration.test.js", "```js", "// nothing to see here", "console.log('PASS');", "```"].join("\n")
      );

      const { result } = await runNakedTask(BUGFIX, {
        providerKind: "openai-compatible",
        model: "scripted-naked-cheater",
        baseUrl: server.baseUrl
      });

      expect(result.filesWritten).toBe(1);
      expect(result.solved).toBe(false);
      expect(server.requestCount()).toBe(1);
    },
    120_000
  );

  it(
    "reports a provider failure as an error rather than scoring it as the model's failure",
    async () => {
      const { result } = await runNakedTask(BUGFIX, {
        providerKind: "openai-compatible",
        model: "unreachable",
        // A port nothing is listening on: the adapter's fetch fails for
        // real, no mocking involved.
        baseUrl: "http://127.0.0.1:1"
      });

      expect(result.solved).toBe(false);
      expect(result.error).toBeTruthy();
      expect(result.modelCalls).toBe(1);
    },
    60_000
  );
});
