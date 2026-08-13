// tree-sitter-javascript and tree-sitter-typescript ship no type declarations
// of their own; they're plain native-addon language objects passed to
// `Parser#setLanguage`. `tree-sitter`'s own .d.ts already types that
// parameter as `any`, so an ambient `unknown` export here is honest and
// sufficient — we never inspect the language object's own shape.
declare module "tree-sitter-javascript" {
  const language: unknown;
  export default language;
}

declare module "tree-sitter-typescript" {
  export const typescript: unknown;
  export const tsx: unknown;
}
