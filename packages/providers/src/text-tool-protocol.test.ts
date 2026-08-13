import { describe, expect, it } from "vitest";
import { parseToolProtocolResponse, renderToolProtocolInstructions } from "./text-tool-protocol.js";

describe("renderToolProtocolInstructions", () => {
  it("lists every tool's name, description, and schema", () => {
    const text = renderToolProtocolInstructions([
      { name: "read_file", description: "Read a file.", parameters: { type: "object" } }
    ]);
    expect(text).toContain("read_file");
    expect(text).toContain("Read a file.");
    expect(text).toContain('<tool name="TOOL_NAME">');
  });
});

describe("parseToolProtocolResponse", () => {
  it("returns kind 'none' when there is no <tool> block (the model is done)", () => {
    expect(parseToolProtocolResponse("I'm done, the fix looks correct.")).toEqual({ kind: "none" });
  });

  it("parses a simple string-arg tool call", () => {
    const text = '<tool name="read_file">\n<arg name="path">math.js</arg>\n</tool>';
    const result = parseToolProtocolResponse(text);
    expect(result.kind).toBe("call");
    if (result.kind === "call") {
      expect(result.call.name).toBe("read_file");
      expect(JSON.parse(result.call.argsJson)).toEqual({ path: "math.js" });
    }
  });

  it("parses a JSON array arg (edit_file's edits)", () => {
    const text =
      '<tool name="edit_file">\n<arg name="path">math.js</arg>\n<arg name="edits">[{"search":"a - b","replace":"a + b"}]</arg>\n</tool>';
    const result = parseToolProtocolResponse(text);
    expect(result.kind).toBe("call");
    if (result.kind === "call") {
      const args = JSON.parse(result.call.argsJson) as { path: string; edits: unknown[] };
      expect(args.path).toBe("math.js");
      expect(args.edits).toEqual([{ search: "a - b", replace: "a + b" }]);
    }
  });

  it("errors on more than one <tool> block", () => {
    const text = '<tool name="a"></tool><tool name="b"></tool>';
    const result = parseToolProtocolResponse(text);
    expect(result.kind).toBe("error");
  });

  it("errors on malformed JSON inside a JSON-shaped arg", () => {
    const text = '<tool name="edit_file">\n<arg name="edits">[{not valid json</arg>\n</tool>';
    const result = parseToolProtocolResponse(text);
    expect(result.kind).toBe("error");
  });

  it("tolerates surrounding prose around the tool block", () => {
    const text = 'Let me fix this.\n\n<tool name="read_file">\n<arg name="path">a.ts</arg>\n</tool>\n\nThanks.';
    const result = parseToolProtocolResponse(text);
    expect(result.kind).toBe("call");
  });
});
