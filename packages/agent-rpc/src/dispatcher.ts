import { errorResponse, isNotification, isRequest, successResponse, JsonRpcErrorCode, type JsonRpcResponse } from "./protocol.js";

export type RpcHandler = (params: unknown) => Promise<unknown> | unknown;

/**
 * Pure request→response dispatch, deliberately decoupled from any stream —
 * `handle(message)` is a plain async function over plain objects, so the
 * whole method-routing/error-shape contract is testable without stdio,
 * a child process, or a real `Agent`.
 */
export function createDispatcher(handlers: Record<string, RpcHandler>) {
  return async function handle(message: unknown): Promise<JsonRpcResponse | null> {
    if (isRequest(message)) {
      const handler = handlers[message.method];
      if (!handler) {
        return errorResponse(message.id, { code: JsonRpcErrorCode.METHOD_NOT_FOUND, message: `method not found: ${message.method}` });
      }
      try {
        const result = await handler(message.params);
        return successResponse(message.id, result ?? null);
      } catch (e) {
        // A thrown `Agent` error (e.g. "no such run") becomes a JSON-RPC
        // error response, never an uncaught rejection that would take the
        // whole server down over one bad request.
        return errorResponse(message.id, { code: JsonRpcErrorCode.INTERNAL_ERROR, message: e instanceof Error ? e.message : String(e) });
      }
    }

    if (isNotification(message)) {
      // Per JSON-RPC 2.0: notifications never get a response, even on
      // failure or an unknown method — there's no id to respond to.
      const handler = handlers[message.method];
      if (handler) {
        try {
          await handler(message.params);
        } catch {
          /* nothing to report a notification failure to */
        }
      }
      return null;
    }

    return errorResponse(null, { code: JsonRpcErrorCode.INVALID_REQUEST, message: "not a valid JSON-RPC 2.0 request or notification" });
  };
}
