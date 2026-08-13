import http from "node:http";
import type { AddressInfo } from "node:net";

export interface MockSSEServer {
  baseUrl: string;
  close(): Promise<void>;
  /** Requests received, for assertions. */
  requests: Array<{ path: string; body: string }>;
}

/**
 * Spins up a local HTTP server that responds to any POST with a
 * Server-Sent-Events stream built from `chunks` (each already-formatted,
 * e.g. `"data: {...}\n\n"`). Used to test the provider adapters without
 * calling a real API.
 */
export function startMockSSEServer(chunks: string[]): Promise<MockSSEServer> {
  const requests: MockSSEServer["requests"] = [];

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        requests.push({ path: req.url ?? "", body });
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive"
        });
        for (const chunk of chunks) res.write(chunk);
        res.end();
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        requests,
        close: () => new Promise<void>((r) => server.close(() => r()))
      });
    });
  });
}
