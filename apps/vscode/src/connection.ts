import { spawn } from "node:child_process";
import { createAgentRpcClient, type AgentRpcClient } from "@clutchcode/agent-rpc";

/**
 * §18.5: "the extension spawns/attaches to the runtime; no separate
 * reimplementation of agent logic in the extension." No `vscode` import —
 * testable against the real, compiled `clutchcode` CLI binary, spawned
 * exactly the way it would be from the extension host.
 */
export interface SpawnSpec {
  command: string;
  args: string[];
  cwd?: string;
}

export interface RpcConnection {
  client: AgentRpcClient;
  dispose(): void;
}

export function connectToAgentRpc(spec: SpawnSpec): RpcConnection {
  const child = spawn(spec.command, spec.args, { cwd: spec.cwd, stdio: ["pipe", "pipe", "pipe"] });
  const client = createAgentRpcClient(child.stdin, child.stdout);

  return {
    client,
    dispose() {
      client.close();
      child.kill();
    }
  };
}
