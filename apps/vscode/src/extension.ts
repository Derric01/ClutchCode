import * as vscode from "vscode";
import type { FileDiff, RunState } from "@clutchcode/agent-api";
import { connectToAgentRpc, type RpcConnection } from "./connection.js";
import { formatDiffTabTitle } from "./presentation.js";
import { pickRun, prTask, resumeTask, rollbackTask, runClutchCodeTask, type TaskUI } from "./runTask.js";

/**
 * The VS Code half of PROJECT_SPEC.md §18.5: "extension (TS) ⇄ Agent API
 * over stdio JSON-RPC. The extension spawns/attaches to the runtime; no
 * separate reimplementation of agent logic in the extension." Every
 * `vscode`-API call lives in this one file — `connection.ts`/`runTask.ts`/
 * `presentation.ts` hold all the actual logic and are unit-tested (see
 * their `.test.ts` files, including a real spawned-`clutchcode`-binary
 * round trip); this file is deliberately thin glue on top of them.
 *
 * **Honesty note, stated once and meant literally:** this file has never
 * run inside a real VS Code extension host — there is no `vscode` runtime
 * in this environment, only its published `.d.ts` types (`@types/vscode`)
 * for type-checking. It's written carefully against the documented,
 * long-stable extension API (the same handful of calls most extensions
 * use: commands, output channels, quick picks, a text document content
 * provider for the diff view), but "compiles against the types" is not the
 * same claim as "runs correctly in VS Code." Flagged, not silently
 * claimed — see `tier1-macos.ts` for the same pattern applied to the other
 * unverified-here piece of this codebase.
 */

let connection: RpcConnection | undefined;
let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
  outputChannel ??= vscode.window.createOutputChannel("ClutchCode");
  return outputChannel;
}

function getConnection(): RpcConnection {
  if (connection) return connection;

  const config = vscode.workspace.getConfiguration("clutchcode");
  const cliPath = config.get<string>("cliPath", "clutchcode");
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) throw new Error("open a workspace folder first — ClutchCode needs a repo to run against");

  connection = connectToAgentRpc({ command: cliPath, args: ["serve"], cwd });
  return connection;
}

/**
 * Serves `clutchcode-diff://<runId>/before|after/<path>` virtual documents
 * so a run's diff opens as real, native `vscode.diff` editors — one per
 * changed file, each with two whole documents (not a unified-diff text
 * blob), so VS Code's own diff renderer does the side-by-side highlighting
 * and the file's real extension still drives language-aware syntax
 * coloring on both sides. `authority` carries the run id specifically so
 * the `path` component stays the real repo-relative file path verbatim.
 */
class DiffContentProvider implements vscode.TextDocumentContentProvider {
  private readonly content = new Map<string, string>();
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changeEmitter.event;

  private uriFor(runId: string, side: "before" | "after", filePath: string): vscode.Uri {
    return vscode.Uri.from({ scheme: "clutchcode-diff", authority: runId, path: `/${side}/${filePath}` });
  }

  set(runId: string, side: "before" | "after", filePath: string, text: string): vscode.Uri {
    const uri = this.uriFor(runId, side, filePath);
    this.content.set(uri.toString(), text);
    this.changeEmitter.fire(uri);
    return uri;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.content.get(uri.toString()) ?? "";
  }
}

function buildTaskUI(diffProvider: DiffContentProvider): TaskUI {
  const channel = getOutputChannel();
  return {
    showOutputLine(line) {
      channel.appendLine(line);
    },
    showDiff(runId, files) {
      for (const file of files) {
        if (file.binary) {
          channel.appendLine(`ClutchCode: ${file.path} changed but is binary — open it directly to review, no diff view shown.`);
          continue;
        }
        const leftUri = diffProvider.set(runId, "before", file.oldPath ?? file.path, file.before ?? "");
        const rightUri = diffProvider.set(runId, "after", file.path, file.after ?? "");
        void vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, formatDiffTabTitle(file), { preview: false });
      }
    },
    async askApproveOrReject() {
      const picked = await vscode.window.showQuickPick(
        [
          { label: "$(check) Approve", value: "approve" as const },
          { label: "$(x) Reject", value: "reject" as const },
          { label: "Decide later", value: "later" as const }
        ],
        { placeHolder: "ClutchCode: verification is green — review the diff, then approve or reject" }
      );
      return picked?.value ?? "later";
    },
    showInfo(message) {
      void vscode.window.showInformationMessage(message);
    },
    showError(message) {
      void vscode.window.showErrorMessage(message);
    },
    async pickRun(runs, placeholder) {
      const picked = await vscode.window.showQuickPick(
        runs.map((state) => ({
          label: state.runId,
          description: state.status,
          detail: state.task,
          runId: state.runId
        })),
        { placeHolder: placeholder }
      );
      return picked?.runId;
    }
  };
}

/** Shared by every command below that operates on "some run" rather than always the one just started. */
async function pickRunOrWarn(ui: TaskUI, placeholder: string, filter?: (state: RunState) => boolean): Promise<string | undefined> {
  const { client } = getConnection();
  return pickRun(client, ui, { placeholder, filter });
}

export function activate(context: vscode.ExtensionContext): void {
  const diffProvider = new DiffContentProvider();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("clutchcode-diff", diffProvider));

  context.subscriptions.push(
    vscode.commands.registerCommand("clutchcode.run", async () => {
      const task = await vscode.window.showInputBox({ prompt: "What should ClutchCode do?", placeHolder: "e.g. fix the failing test in src/parser.ts" });
      if (!task) return;

      const config = vscode.workspace.getConfiguration("clutchcode");
      try {
        const { client } = getConnection();
        getOutputChannel().show(true);
        await runClutchCodeTask(
          client,
          {
            task,
            providerKind: config.get<string>("providerKind", "ollama"),
            model: config.get<string>("model", ""),
            baseUrl: config.get<string>("baseUrl") || undefined
          },
          buildTaskUI(diffProvider)
        );
      } catch (e) {
        void vscode.window.showErrorMessage(`ClutchCode: ${e instanceof Error ? e.message : String(e)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("clutchcode.diff", async () => {
      const ui = buildTaskUI(diffProvider);
      try {
        const runId = await pickRunOrWarn(ui, "Select a run to view its diff");
        if (!runId) return;
        const { client } = getConnection();
        const { files } = await client.request<{ files: FileDiff[] }>("diffFiles", { runId });
        ui.showDiff(runId, files);
      } catch (e) {
        void vscode.window.showErrorMessage(`ClutchCode: ${e instanceof Error ? e.message : String(e)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("clutchcode.approve", async () => {
      const ui = buildTaskUI(diffProvider);
      try {
        const runId = await pickRunOrWarn(ui, "Select a run to approve", (s) => s.status === "AWAITING_APPROVAL");
        if (!runId) return;
        const { client } = getConnection();
        await client.request("approve", { runId, squash: true });
        void vscode.window.showInformationMessage(`ClutchCode: run ${runId} approved and committed.`);
      } catch (e) {
        void vscode.window.showErrorMessage(`ClutchCode: ${e instanceof Error ? e.message : String(e)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("clutchcode.reject", async () => {
      const ui = buildTaskUI(diffProvider);
      try {
        const runId = await pickRunOrWarn(ui, "Select a run to reject", (s) => s.status === "AWAITING_APPROVAL");
        if (!runId) return;
        const { client } = getConnection();
        await client.request("reject", { runId });
        void vscode.window.showInformationMessage(`ClutchCode: run ${runId} rejected.`);
      } catch (e) {
        void vscode.window.showErrorMessage(`ClutchCode: ${e instanceof Error ? e.message : String(e)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("clutchcode.resume", async () => {
      const ui = buildTaskUI(diffProvider);
      try {
        const runId = await pickRunOrWarn(ui, "Select a paused run to resume", (s) => s.status === "PAUSED");
        if (!runId) return;
        const extendInput = await vscode.window.showInputBox({
          prompt: "Extend the step budget by how many steps? (blank = resume without extending — it may just re-pause immediately)",
          placeHolder: "e.g. 20"
        });
        const extendSteps = extendInput ? Number(extendInput) : undefined;
        const { client } = getConnection();
        getOutputChannel().show(true);
        await resumeTask(client, runId, ui, extendSteps !== undefined && !Number.isNaN(extendSteps) ? { extendSteps } : {});
      } catch (e) {
        void vscode.window.showErrorMessage(`ClutchCode: ${e instanceof Error ? e.message : String(e)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("clutchcode.rollback", async () => {
      const ui = buildTaskUI(diffProvider);
      try {
        const runId = await pickRunOrWarn(ui, "Select a run to roll back");
        if (!runId) return;
        const { client } = getConnection();
        const checkpoints = await client.request<{ sha: string; message: string }[]>("checkpoints", { runId });
        if (checkpoints.length === 0) {
          void vscode.window.showInformationMessage(`ClutchCode: run ${runId} has no checkpoints to roll back to.`);
          return;
        }
        const picked = await vscode.window.showQuickPick(
          checkpoints.map((c) => ({ label: c.sha.slice(0, 7), description: c.message, sha: c.sha })),
          { placeHolder: "Roll back to which checkpoint?" }
        );
        if (!picked) return;
        await rollbackTask(client, runId, picked.sha, ui);
      } catch (e) {
        void vscode.window.showErrorMessage(`ClutchCode: ${e instanceof Error ? e.message : String(e)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("clutchcode.pr", async () => {
      const ui = buildTaskUI(diffProvider);
      try {
        const runId = await pickRunOrWarn(ui, "Select a run to open a PR for");
        if (!runId) return;
        const { client } = getConnection();
        await prTask(client, runId, ui);
      } catch (e) {
        void vscode.window.showErrorMessage(`ClutchCode: ${e instanceof Error ? e.message : String(e)}`);
      }
    })
  );
}

export function deactivate(): void {
  connection?.dispose();
  connection = undefined;
  outputChannel?.dispose();
  outputChannel = undefined;
}
