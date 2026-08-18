import * as vscode from "vscode";
import { connectToAgentRpc, type RpcConnection } from "./connection.js";
import { runClutchCodeTask, type TaskUI } from "./runTask.js";

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
 * use: commands, output channels, input boxes, quick picks, a text
 * document content provider for the diff view), but "compiles against the
 * types" is not the same claim as "runs correctly in VS Code." Flagged,
 * not silently claimed — see `tier1-macos.ts` for the same pattern
 * applied to the other unverified-here piece of this codebase.
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

/** Serves `clutchcode-diff:<runId>` virtual documents so a run's diff opens in a real editor tab with diff syntax highlighting, without writing a temp file to disk. */
class DiffContentProvider implements vscode.TextDocumentContentProvider {
  private readonly content = new Map<string, string>();
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changeEmitter.event;

  set(runId: string, diffText: string): vscode.Uri {
    this.content.set(runId, diffText);
    const uri = vscode.Uri.parse(`clutchcode-diff:${runId}.diff`);
    this.changeEmitter.fire(uri);
    return uri;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const runId = uri.path.replace(/\.diff$/, "");
    return this.content.get(runId) ?? "(no diff recorded for this run)";
  }
}

function buildTaskUI(diffProvider: DiffContentProvider): TaskUI {
  const channel = getOutputChannel();
  return {
    showOutputLine(line) {
      channel.appendLine(line);
    },
    showDiff(runId, diffText) {
      const uri = diffProvider.set(runId, diffText);
      void vscode.workspace.openTextDocument(uri).then((doc) => vscode.window.showTextDocument(doc, { preview: false }));
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
    }
  };
}

async function promptForRunId(prompt: string): Promise<string | undefined> {
  return vscode.window.showInputBox({ prompt });
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
      const runId = await promptForRunId("Run id to show the diff for");
      if (!runId) return;
      try {
        const { client } = getConnection();
        const { diff } = await client.request<{ diff: string }>("diff", { runId });
        buildTaskUI(diffProvider).showDiff(runId, diff);
      } catch (e) {
        void vscode.window.showErrorMessage(`ClutchCode: ${e instanceof Error ? e.message : String(e)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("clutchcode.approve", async () => {
      const runId = await promptForRunId("Run id to approve");
      if (!runId) return;
      try {
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
      const runId = await promptForRunId("Run id to reject");
      if (!runId) return;
      try {
        const { client } = getConnection();
        await client.request("reject", { runId });
        void vscode.window.showInformationMessage(`ClutchCode: run ${runId} rejected.`);
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
