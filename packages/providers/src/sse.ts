/**
 * Minimal Server-Sent-Events parser over a web ReadableStream, shared by the
 * OpenAI-compatible and Anthropic adapters (both stream via SSE).
 */

export interface SSEEvent {
  event: string | null;
  data: string;
}

function parseEventBlock(block: string): SSEEvent | null {
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

export async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent, void, void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const evt = parseEventBlock(rawEvent);
        if (evt) yield evt;
      }
    }
    if (buffer.trim().length > 0) {
      const evt = parseEventBlock(buffer);
      if (evt) yield evt;
    }
  } finally {
    reader.releaseLock();
  }
}
