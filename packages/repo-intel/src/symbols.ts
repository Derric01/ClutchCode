// Repo intelligence, Tier 0 (PROJECT_SPEC.md §9): on-demand tree-sitter
// symbol extraction. No persistent index — a file's symbols are parsed
// fresh each time this is called, same spirit as shelling out to ripgrep.
import Parser from "tree-sitter";
import javascript from "tree-sitter-javascript";
import typescriptGrammars from "tree-sitter-typescript";

const { typescript, tsx } = typescriptGrammars as unknown as {
  typescript: unknown;
  tsx: unknown;
};

export type SupportedLanguage = "javascript" | "typescript" | "tsx";

export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "interface"
  | "type"
  | "const"
  | "variable"
  | "enum";

export interface CodeSymbol {
  kind: SymbolKind;
  name: string;
  /** 1-indexed, inclusive */
  startLine: number;
  /** 1-indexed, inclusive */
  endLine: number;
  exported: boolean;
}

const EXTENSION_LANGUAGE_MAP: Record<string, SupportedLanguage> = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
};

export function languageForPath(filePath: string): SupportedLanguage | null {
  const match = /\.[^./\\]+$/.exec(filePath);
  if (!match) return null;
  return EXTENSION_LANGUAGE_MAP[match[0].toLowerCase()] ?? null;
}

function grammarFor(language: SupportedLanguage): unknown {
  switch (language) {
    case "javascript":
      return javascript;
    case "typescript":
      return typescript;
    case "tsx":
      return tsx;
  }
}

function lineOf(pointRow: number): number {
  // tree-sitter positions are 0-indexed rows; CodeSymbol lines are 1-indexed.
  return pointRow + 1;
}

/**
 * Extracts top-level (and class-member) symbols from source text. This is a
 * deliberately shallow pass over `tree.rootNode.namedChildren` plus one
 * level into class bodies for methods — it is not a full scope resolver.
 * Good enough for "what's defined in this file" style repo intelligence,
 * per §9's Tier 0 scope (no persistent index, no cross-file resolution).
 */
export function extractSymbols(content: string, language: SupportedLanguage): CodeSymbol[] {
  const parser = new Parser();
  parser.setLanguage(grammarFor(language) as never);
  const tree = parser.parse(content);

  const out: CodeSymbol[] = [];
  for (const child of tree.rootNode.namedChildren) {
    if (child.type === "export_statement") {
      const declaration = child.childForFieldName("declaration");
      if (declaration) {
        extractDeclarationSymbols(declaration, true, out);
      }
      // `export { a, b }` and `export default <expr>` (non-declaration
      // forms) have no `declaration` field to walk; skipped for MVP scope.
    } else {
      extractDeclarationSymbols(child, false, out);
    }
  }
  return out;
}

function extractDeclarationSymbols(node: Parser.SyntaxNode, exported: boolean, out: CodeSymbol[]): void {
  switch (node.type) {
    case "function_declaration":
    case "generator_function_declaration": {
      const name = node.childForFieldName("name");
      if (name) {
        out.push(symbol("function", name.text, node, exported));
      }
      break;
    }
    case "class_declaration": {
      const name = node.childForFieldName("name");
      const className = name?.text;
      if (className) {
        out.push(symbol("class", className, node, exported));
      }
      const body = node.childForFieldName("body");
      if (body) {
        for (const member of body.namedChildren) {
          if (member.type === "method_definition") {
            const methodName = member.childForFieldName("name");
            if (methodName) {
              const qualifiedName = className ? `${className}.${methodName.text}` : methodName.text;
              out.push(symbol("method", qualifiedName, member, exported));
            }
          }
        }
      }
      break;
    }
    case "interface_declaration": {
      const name = node.childForFieldName("name");
      if (name) {
        out.push(symbol("interface", name.text, node, exported));
      }
      break;
    }
    case "type_alias_declaration": {
      const name = node.childForFieldName("name");
      if (name) {
        out.push(symbol("type", name.text, node, exported));
      }
      break;
    }
    case "enum_declaration": {
      const name = node.childForFieldName("name");
      if (name) {
        out.push(symbol("enum", name.text, node, exported));
      }
      break;
    }
    case "lexical_declaration":
    case "variable_declaration": {
      const kind: SymbolKind = node.type === "lexical_declaration" && startsWithConst(node) ? "const" : "variable";
      for (const declarator of node.namedChildren) {
        if (declarator.type !== "variable_declarator") continue;
        const name = declarator.childForFieldName("name");
        // Only plain identifiers are captured; destructuring patterns
        // (`const { a, b } = ...`) are out of scope for this MVP pass.
        if (name && name.type === "identifier") {
          out.push(symbol(kind, name.text, node, exported));
        }
      }
      break;
    }
    default:
      // Not a declaration form we extract symbols from (e.g. expression
      // statements, import statements). Silently skipped.
      break;
  }
}

function startsWithConst(node: Parser.SyntaxNode): boolean {
  const first = node.child(0);
  return first?.type === "const";
}

function symbol(kind: SymbolKind, name: string, node: Parser.SyntaxNode, exported: boolean): CodeSymbol {
  return {
    kind,
    name,
    startLine: lineOf(node.startPosition.row),
    endLine: lineOf(node.endPosition.row),
    exported,
  };
}
