/** JSON-RPC 2.0 message shapes (PROJECT_SPEC.md §18.1/§18.5). */

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: string | number;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  error: JsonRpcError;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

/** Standard JSON-RPC 2.0 error codes this server actually uses. */
export const JsonRpcErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INTERNAL_ERROR: -32603
} as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function isRequest(msg: unknown): msg is JsonRpcRequest {
  return isObject(msg) && msg.jsonrpc === "2.0" && typeof msg.method === "string" && (typeof msg.id === "string" || typeof msg.id === "number");
}

export function isNotification(msg: unknown): msg is JsonRpcNotification {
  return isObject(msg) && msg.jsonrpc === "2.0" && typeof msg.method === "string" && !("id" in msg);
}

export function isResponse(msg: unknown): msg is JsonRpcResponse {
  return isObject(msg) && msg.jsonrpc === "2.0" && ("result" in msg || "error" in msg);
}

export function successResponse(id: string | number, result: unknown): JsonRpcSuccessResponse {
  return { jsonrpc: "2.0", id, result };
}

export function errorResponse(id: string | number | null, error: JsonRpcError): JsonRpcErrorResponse {
  return { jsonrpc: "2.0", id, error };
}

export function notification(method: string, params?: unknown): JsonRpcNotification {
  return { jsonrpc: "2.0", method, params };
}
