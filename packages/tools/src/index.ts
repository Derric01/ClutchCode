export * from "./types.js";
export { truncate, truncateSearchResults } from "./truncate.js";
export type { TruncateOptions, SearchMatch } from "./truncate.js";
export { resolveInWorkspace } from "./workspace-path.js";
export { applyEditBlock, applyEdits } from "./edit-cascade.js";
export type { EditBlock, ApplyResult, ApplyAllResult, ApplyStrategy } from "./edit-cascade.js";

export { readFileTool } from "./tools/read-file.js";
export type { ReadFileArgs, ReadFileData } from "./tools/read-file.js";
export { writeFileTool } from "./tools/write-file.js";
export type { WriteFileArgs, WriteFileData } from "./tools/write-file.js";
export { editFileTool } from "./tools/edit-file.js";
export type { EditFileArgs, EditFileData } from "./tools/edit-file.js";
export { searchTool } from "./tools/search.js";
export type { SearchArgs, SearchData } from "./tools/search.js";
export { shellTool } from "./tools/shell.js";
export type { ShellArgs, ShellData } from "./tools/shell.js";
export { gitTool } from "./tools/git.js";
export type { GitArgs, GitData, GitOp } from "./tools/git.js";
export { processTool } from "./tools/process.js";
export type { ProcessArgs, ProcessData, ProcessRow } from "./tools/process.js";
export { symbolsTool } from "./tools/symbols.js";
export type { SymbolsArgs, SymbolsData } from "./tools/symbols.js";

import type { Tool } from "./types.js";
import { readFileTool } from "./tools/read-file.js";
import { writeFileTool } from "./tools/write-file.js";
import { editFileTool } from "./tools/edit-file.js";
import { searchTool } from "./tools/search.js";
import { shellTool } from "./tools/shell.js";
import { gitTool } from "./tools/git.js";
import { processTool } from "./tools/process.js";
import { symbolsTool } from "./tools/symbols.js";

/** The MVP native tool set (§11), keyed by name for the runtime's tool registry. */
export function nativeToolSet(): Map<string, Tool<any, any>> {
  const tools: Array<Tool<any, any>> = [
    readFileTool,
    writeFileTool,
    editFileTool,
    searchTool,
    shellTool,
    gitTool,
    processTool,
    symbolsTool
  ];
  return new Map(tools.map((t) => [t.name, t]));
}
