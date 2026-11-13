/** Shared CSS syntax only; no filesystem, environment or renderer authority. */
import { fork, walk, generate, type CssNode, type SyntaxConfig } from "css-tree";
import type { EmittedTokenDefinition } from "./emit.js";

type TokenActivation = Pick<EmittedTokenDefinition, "selector" | "atRules">;
// css-tree 3.2.1 supports singular `atrule` parser extensions in config/mix.js;
// official 3.2.0 typings describe lexer `atrules` but omit this parser field.
interface SourceSyntaxConfig extends SyntaxConfig {
  atrule: Record<"utility" | "theme", { parse: { block(this: { Block(style: boolean): CssNode }): CssNode } }>;
}
const sourceConfig: SourceSyntaxConfig = { atrule: {
  utility: { parse: {
    // Reuse the native mixed style block parser, including nested & and at-rules.
    // Parsing utility syntax grants no token definition authority.
    block() { return this.Block(true); },
  } },
  theme: { parse: {
    // Theme declarations may surround nested keyframes; the unknown-at-rule
    // rule-list heuristic cannot parse this mix. Token authority stays separate.
    block() { return this.Block(true); },
  } },
} };
interface DeclarationParser {
  Rule(this: DeclarationParser): CssNode;
  parseWithFallback(consumer: (this: DeclarationParser) => CssNode, fallback: (this: DeclarationParser) => CssNode): CssNode;
}
const sourceSyntax = fork(sourceConfig).fork(config => {
  const declaration = config.node!.Declaration as { parse(this: DeclarationParser): CssNode };
  return { ...config, node: { ...config.node, Declaration: { ...declaration,
    // Native style blocks recognize leading &, but nested selectors can start
    // with :root, a class or a type selector. Try the same native Rule grammar
    // after Declaration fails; final unparsed syntax is still refused below.
    parse(this: DeclarationParser) { return this.parseWithFallback(declaration.parse, this.Rule); },
  } } };
});
export function parseTokenCss(source: string, context = "stylesheet"): CssNode {
  // Native grammar alternatives use recoverable, nullable fallbacks (for example
  // nested @supports conditions). Validate the final AST rather than aborting
  // those alternatives. Unparsed final syntax remains refused below.
  const ast = sourceSyntax.parse(source, { context, positions: true, parseCustomProperty: true });
  walk(ast, node => { if (node.type === "Raw") throw new Error("Unsupported raw CSS syntax"); });
  return ast;
}
export function cssTokenValue(source: string): string { return generate(parseTokenCss(source, "value")); }
export function tokenVarProperties(ast: CssNode): string[] {
  const properties = new Set<string>();
  walk(ast, node => {
    if (node.type !== "Function" || node.name.toLowerCase() !== "var") return;
    const name = node.children.first;
    if (name?.type !== "Identifier" || !/^--[a-zA-Z0-9-]+$/.test(name.name)) throw new Error("Unresolved CSS variable reference");
    properties.add(name.name);
  });
  return [...properties].sort();
}
/** The emitter's own selector wrapper supplies its complete activation context. */
export function tokenActivation(selector: string): TokenActivation {
  const ast = parseTokenCss(`${selector} {}${"}".repeat((selector.match(/\{/g) ?? []).length)}`);
  const rules: string[] = [], atRules: { name: string; prelude: string }[] = [];
  walk(ast, node => {
    if (node.type === "Rule") rules.push(generate(node.prelude));
    if (node.type === "Atrule") atRules.push({ name: node.name, prelude: node.prelude ? generate(node.prelude) : "" });
  });
  if (rules.length !== 1) throw new Error("Ambiguous emitted theme selector");
  return { selector: rules[0]!, atRules };
}
