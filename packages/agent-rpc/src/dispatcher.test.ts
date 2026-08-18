import { describe, expect, it } from "vitest";
import { createDispatcher } from "./dispatcher.js";
import { JsonRpcErrorCode } from "./protocol.js";

describe("createDispatcher", () => {
  it("routes a request to its handler and wraps the result", async () => {
    const dispatch = createDispatcher({ echo: (params) => ({ got: params }) });
    const response = await dispatch({ jsonrpc: "2.0", id: 1, method: "echo", params: { x: 1 } });
    expect(response).toEqual({ jsonrpc: "2.0", id: 1, result: { got: { x: 1 } } });
  });

  it("awaits an async handler", async () => {
    const dispatch = createDispatcher({ slow: async (params) => Promise.resolve({ params }) });
    const response = await dispatch({ jsonrpc: "2.0", id: "abc", method: "slow", params: null });
    expect(response).toEqual({ jsonrpc: "2.0", id: "abc", result: { params: null } });
  });

  it("returns METHOD_NOT_FOUND for an unregistered method", async () => {
    const dispatch = createDispatcher({});
    const response = await dispatch({ jsonrpc: "2.0", id: 1, method: "nope" });
    expect(response).toMatchObject({ id: 1, error: { code: JsonRpcErrorCode.METHOD_NOT_FOUND } });
  });

  it("converts a thrown handler error into a JSON-RPC error response, not an uncaught rejection", async () => {
    const dispatch = createDispatcher({
      boom: () => {
        throw new Error("no such run: xyz");
      }
    });
    const response = await dispatch({ jsonrpc: "2.0", id: 1, method: "boom" });
    expect(response).toEqual({ jsonrpc: "2.0", id: 1, error: { code: JsonRpcErrorCode.INTERNAL_ERROR, message: "no such run: xyz" } });
  });

  it("converts a rejected async handler the same way", async () => {
    const dispatch = createDispatcher({ boom: async () => Promise.reject(new Error("async fail")) });
    const response = await dispatch({ jsonrpc: "2.0", id: 1, method: "boom" });
    expect(response).toEqual({ jsonrpc: "2.0", id: 1, error: { code: JsonRpcErrorCode.INTERNAL_ERROR, message: "async fail" } });
  });

  it("routes a notification (no id) to its handler and returns null — no response is ever sent", async () => {
    let received: unknown = undefined;
    const dispatch = createDispatcher({ notify: (params) => (received = params) });
    const response = await dispatch({ jsonrpc: "2.0", method: "notify", params: { x: 1 } });
    expect(response).toBeNull();
    expect(received).toEqual({ x: 1 });
  });

  it("swallows a notification handler's error silently (nothing to report it to)", async () => {
    const dispatch = createDispatcher({
      notify: () => {
        throw new Error("boom");
      }
    });
    await expect(dispatch({ jsonrpc: "2.0", method: "notify" })).resolves.toBeNull();
  });

  it("returns INVALID_REQUEST for garbage that's neither a request nor a notification", async () => {
    const dispatch = createDispatcher({});
    const response = await dispatch({ not: "jsonrpc at all" });
    expect(response).toMatchObject({ id: null, error: { code: JsonRpcErrorCode.INVALID_REQUEST } });
  });
});
