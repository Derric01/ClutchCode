import { describe, expect, it } from "vitest";
import { extractSymbols, languageForPath } from "./symbols.js";

describe("languageForPath", () => {
  it("maps known extensions", () => {
    expect(languageForPath("a/b.js")).toBe("javascript");
    expect(languageForPath("a/b.jsx")).toBe("javascript");
    expect(languageForPath("a/b.mjs")).toBe("javascript");
    expect(languageForPath("a/b.ts")).toBe("typescript");
    expect(languageForPath("a/b.mts")).toBe("typescript");
    expect(languageForPath("a/b.tsx")).toBe("tsx");
  });

  it("returns null for unknown or missing extensions", () => {
    expect(languageForPath("a/b.py")).toBeNull();
    expect(languageForPath("a/README")).toBeNull();
  });

  it("is case-insensitive on the extension", () => {
    expect(languageForPath("a/B.TS")).toBe("typescript");
  });
});

describe("extractSymbols (javascript)", () => {
  it("extracts an exported function declaration", () => {
    const symbols = extractSymbols("export function add(a, b) {\n  return a + b;\n}\n", "javascript");
    expect(symbols).toEqual([
      { kind: "function", name: "add", startLine: 1, endLine: 3, exported: true },
    ]);
  });

  it("extracts a non-exported function declaration", () => {
    const symbols = extractSymbols("function helper() {\n  return 1;\n}\n", "javascript");
    expect(symbols).toEqual([
      { kind: "function", name: "helper", startLine: 1, endLine: 3, exported: false },
    ]);
  });

  it("extracts an exported class with its methods, qualified as Class.method", () => {
    const src = [
      "export class Greeter {",
      "  constructor(name) {",
      "    this.name = name;",
      "  }",
      "  greet() {",
      "    return `hi ${this.name}`;",
      "  }",
      "}",
      "",
    ].join("\n");
    const symbols = extractSymbols(src, "javascript");
    const names = symbols.map((s) => `${s.kind}:${s.name}:${s.exported}`);
    expect(names).toEqual([
      "class:Greeter:true",
      "method:Greeter.constructor:true",
      "method:Greeter.greet:true",
    ]);
  });

  it("extracts each declarator from a multi-declarator export const", () => {
    const symbols = extractSymbols("export const x = 1, y = 2;\n", "javascript");
    expect(symbols).toEqual([
      { kind: "const", name: "x", startLine: 1, endLine: 1, exported: true },
      { kind: "const", name: "y", startLine: 1, endLine: 1, exported: true },
    ]);
  });

  it("marks a top-level const not exported", () => {
    const symbols = extractSymbols("const z = 3;\n", "javascript");
    expect(symbols).toEqual([{ kind: "const", name: "z", startLine: 1, endLine: 1, exported: false }]);
  });

  it("distinguishes let/var as 'variable' from const", () => {
    const symbols = extractSymbols("let a = 1;\nvar b = 2;\n", "javascript");
    expect(symbols).toEqual([
      { kind: "variable", name: "a", startLine: 1, endLine: 1, exported: false },
      { kind: "variable", name: "b", startLine: 2, endLine: 2, exported: false },
    ]);
  });

  it("extracts a default-exported function declaration", () => {
    const symbols = extractSymbols("export default function anon() {\n  return 1;\n}\n", "javascript");
    expect(symbols).toEqual([
      { kind: "function", name: "anon", startLine: 1, endLine: 3, exported: true },
    ]);
  });

  it("skips destructuring declarators", () => {
    const symbols = extractSymbols("const { a, b } = getStuff();\n", "javascript");
    expect(symbols).toEqual([]);
  });

  it("returns an empty array for a file with no top-level declarations", () => {
    const symbols = extractSymbols("console.log('hi');\n", "javascript");
    expect(symbols).toEqual([]);
  });
});

describe("extractSymbols (typescript)", () => {
  it("extracts interfaces, type aliases, and enums", () => {
    const src = [
      "export interface Point {",
      "  x: number;",
      "  y: number;",
      "}",
      "",
      "type Pair = [number, number];",
      "",
      "export enum Color {",
      "  Red,",
      "  Green,",
      "}",
      "",
    ].join("\n");
    const symbols = extractSymbols(src, "typescript");
    expect(symbols).toEqual([
      { kind: "interface", name: "Point", startLine: 1, endLine: 4, exported: true },
      { kind: "type", name: "Pair", startLine: 6, endLine: 6, exported: false },
      { kind: "enum", name: "Color", startLine: 8, endLine: 11, exported: true },
    ]);
  });

  it("extracts a typed class with a method", () => {
    const src = ["class Box<T> {", "  get(): T {", "    return this.value;", "  }", "}", ""].join("\n");
    const symbols = extractSymbols(src, "typescript");
    expect(symbols).toEqual([
      { kind: "class", name: "Box", startLine: 1, endLine: 5, exported: false },
      { kind: "method", name: "Box.get", startLine: 2, endLine: 4, exported: false },
    ]);
  });
});

describe("extractSymbols (tsx)", () => {
  it("extracts an exported function component", () => {
    const src = "export function Widget() {\n  return <div />;\n}\n";
    const symbols = extractSymbols(src, "tsx");
    expect(symbols).toEqual([
      { kind: "function", name: "Widget", startLine: 1, endLine: 3, exported: true },
    ]);
  });
});
