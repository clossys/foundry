/** CSS definitions are source checks, never observed styles or runtime clearance. */
import { generate, walk, type CssNode } from "css-tree";
import { check } from "./check.js";
import { resolve, type EngineInput } from "./resolve.js";
import { emittedTokenManifest, type EmittedTokenManifest } from "./emit.js";
import { cssTokenValue, parseTokenCss, tokenVarProperties } from "./token-css-syntax.js";

export interface DogfoodCssIssue { readonly file: string; readonly start: number; readonly end: number; readonly evidence: string }
/** Reuse the selected value engine; caller-supplied expected CSS/manifests are not inputs. */
export function dogfoodCssIssues(files: readonly { file: string; content: string }[], tokenLibrary: EngineInput | undefined, literalIssues: (value: string, file: string) => readonly string[]): DogfoodCssIssue[] {
  const issues: DogfoodCssIssue[] = [];
  let manifest: EmittedTokenManifest | undefined, unavailable = "Selected token library input unavailable";
  if (tokenLibrary) {
    try {
      if (!check(tokenLibrary).ok) throw new Error("Selected token library check failed");
      // Full canonical emission includes invariant dark rows as well as both
      // production activation paths. Preview selectors/extra vars are never input.
      manifest = emittedTokenManifest(resolve(tokenLibrary), ["css-brand", "css-scales", "tailwind-theme"], { full: true });
    } catch { unavailable = "Selected token library input invalid or unresolved"; }
  }
  const registered = new Map(manifest?.tokens.flatMap(token => token.outputs.map(property => [property, token.id] as const)) ?? []);
  const contextKey = (selector: string | null, atRules: readonly { name: string; prelude: string }[]) => JSON.stringify({ selector, atRules });
  const definitions = manifest?.definitions ?? [];
  const occurrences = new Map<string, { file: string; node: CssNode }[]>();
  function add(file: string, node: CssNode, evidence: string) {
    issues.push({ file, start: node.loc?.start.offset ?? 0, end: node.loc?.end.offset ?? 0, evidence });
  }
  for (const file of files.filter(file => file.file.endsWith(".css"))) {
    let ast: CssNode;
    try { ast = parseTokenCss(file.content); }
    catch (error) { issues.push({ file: file.file, start: 0, end: file.content.length, evidence: `Unresolved CSS: ${(error as Error).message}` }); continue; }
    const rules: string[] = [], atRules: { name: string; prelude: string }[] = [];
    walk(ast, {
      enter(node: CssNode) {
        if (node.type === "Rule") rules.push(generate(node.prelude));
        if (node.type === "Atrule") atRules.push({ name: node.name, prelude: node.prelude ? generate(node.prelude) : "" });
        if (node.type !== "Declaration") return;
        const value = generate(node.value);
        if (!node.property.startsWith("--")) {
          for (const evidence of literalIssues(value, file.file)) add(file.file, node, evidence);
          return;
        }
        const id = registered.get(node.property);
        if (!id) { add(file.file, node, `Unregistered token definition ${node.property}.${manifest ? "" : ` ${unavailable}.`}`); return; }
        const context = contextKey(rules.length === 1 ? rules[0]! : null, atRules);
        const expected = rules.length <= 1 ? definitions.find(row => row.id === id && row.property === node.property && contextKey(row.selector, row.atRules) === context) : undefined;
        if (!expected || node.important) { add(file.file, node, `Token definition outside declared theme context: ${node.property}; observed ${context}${node.important ? "; !important is not declared" : ""}`); return; }
        const key = JSON.stringify([id, node.property, manifest!.selectionHash, expected.theme, context]);
        const found = occurrences.get(key) ?? [];
        found.push({ file: file.file, node }); occurrences.set(key, found);
        try {
          const unknown = tokenVarProperties(node.value).filter(property => !registered.has(property));
          if (unknown.length) { add(file.file, node, `Unregistered alias reference: ${unknown.join(", ")}`); return; }
          if (cssTokenValue(value) !== cssTokenValue(expected.value)) add(file.file, node, `Token definition value mismatch: ${node.property}`);
        } catch (error) { add(file.file, node, `Unresolved CSS token value: ${(error as Error).message}`); }
      },
      leave(node: CssNode) {
        if (node.type === "Rule") rules.pop();
        if (node.type === "Atrule") atRules.pop();
      },
    });
  }
  for (const found of occurrences.values()) if (found.length > 1) {
    const locations = found.map(row => `${row.file}:${row.node.loc?.start.line ?? 1}`).join(", ");
    for (const row of found) add(row.file, row.node, `Duplicate token definition: ${locations}`);
  }
  return issues;
}

/** Actual CSS import nodes supply dependency edges; strings/comments never do. */
export function dogfoodCssImports(content: string): string[] {
  const modules: string[] = [];
  const ast = parseTokenCss(content);
  walk(ast, node => {
    if (node.type !== "Atrule" || node.name.toLowerCase() !== "import") return;
    const prelude = node.prelude;
    const value = prelude?.type === "AtrulePrelude" ? prelude.children.first : undefined;
    if (!value || !["String", "Url"].includes(value.type)) throw new Error("Unresolved CSS import");
    const module = value.type === "String" || value.type === "Url" ? value.value : "";
    // Conditional/layer imports change activation context, which this static
    // source closure cannot reconstruct by scanning a dependency separately.
    if (prelude?.type !== "AtrulePrelude" || prelude.children.size !== 1 || !module || /^(?:[a-z]+:|\/\/|#|\/)/i.test(module)) throw new Error("Unsupported conditional or nonlocal CSS import");
    modules.push(module);
  });
  return modules;
}
