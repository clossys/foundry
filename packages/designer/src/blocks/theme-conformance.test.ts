import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative, posix } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { extractStyleCandidates } from "../style-scan.js";
import { TOKENS } from "../tokens/tokens.js";
import { parseDeclarationsForSelector, parseRootDeclarations } from "../tokens/internal/parse-css.js";
import { mergeDeclarations, registryFromDeclarations } from "../tokens/internal/registry-from-css.js";
import { resolveTokenValue } from "../tokens/internal/resolve-token-value.js";
import { checkTokenContrast } from "../tokens/contrast-gate.js";
import { CONTRAST_PAIRS, contrastPairsForTheme } from "../tokens/contrast-pairs.js";
import { BLOCK_THEME_CONFORMANCE, NON_BLOCK_THEME_EXPORTS, type BlockThemeRegistration } from "./theme-conformance.js";

const packageRoot = resolve(import.meta.dirname, "../..");
const blocksRoot = resolve(packageRoot, "src/blocks");
const COLOR_PROPERTY = /^(?:color|background|backgroundColor|border(?:Block|Inline)?(?:Start|End|Top|Right|Bottom|Left)?Color|outlineColor|textDecorationColor|textEmphasisColor|caretColor|accentColor|fill|stroke)$/;
const INHERITED_COLOR = new Set(["current", "currentColor", "inherit", "transparent", "none"]);
// CSS named colors, not CSS system-color keywords such as Menu/Mark/Canvas:
// those words also name exported components, SVG concepts and HTML elements.
const NAMED_COLORS = new Set((
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood " +
  "cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgrey darkgreen darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet " +
  "deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray grey green greenyellow honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon " +
  "lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgrey lightgreen lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon " +
  "mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid " +
  "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
).split(" "));
const syntaxCache = new Map<string, ts.SourceFile>();

function namedColor(value: string): boolean {
  return NAMED_COLORS.has(value.toLowerCase());
}

/** Colons inside arbitrary selectors/values belong to the variant, not its utility. */
function utilityBase(candidate: string): string {
  let depth = 0, start = 0;
  for (let i = 0; i < candidate.length; i++) {
    if (candidate[i] === "[") depth++;
    else if (candidate[i] === "]") depth--;
    else if (candidate[i] === ":" && depth === 0) start = i + 1;
  }
  return candidate.slice(start).replace(/^!|!$/g, "");
}

function colorUtility(candidate: string): { token?: string; invalid?: string } {
  const utility = utilityBase(candidate);
  if (/^border-[trblsexy]$/.test(utility)) return {};
  if (/^(?:text|bg|border|outline|ring|fill|stroke)-$/.test(utility)) return { invalid: candidate };
  const match = /^(text|bg|border(?:-[trblsexy])?|outline|ring(?:-offset)?|fill|stroke|decoration|divide|accent|caret|placeholder|from|via|to|shadow)-(.+)$/.exec(utility);
  if (!match) return {};
  const [, prefix, suffix] = match as unknown as [string, string, string];
  const property = `--color-${suffix}`;
  if (TOKENS[property]) return { token: property };
  if (INHERITED_COLOR.has(suffix)) return {};
  if (prefix === "text" && (TOKENS[`--text-${suffix}`] || /^(?:left|right|start|end|center|justify|balance|pretty|wrap|nowrap|ellipsis|clip|xs|sm|base|lg|xl|[2-9]xl)$/.test(suffix))) return {};
  if (/^border/.test(prefix) && /^(?:\d+|solid|dashed|dotted|double|hidden|collapse|separate|spacing-.+)$/.test(suffix)) return {};
  if (prefix === "outline" && /^(?:\d+|offset-\d+|solid|dashed|dotted|double|hidden)$/.test(suffix)) return {};
  if (/^ring/.test(prefix) && /^(?:\d+|inset)$/.test(suffix)) return {};
  if (prefix === "stroke" && /^\d+$/.test(suffix)) return {};
  if (prefix === "shadow" && /^(?:xs|sm|md|lg|xl|2xl|inner)$/.test(suffix)) return {};
  if (suffix.startsWith("[")) {
    const value = suffix.slice(1, -1).replace(/^color:/, "");
    const variable = /^var\((--color-[\w-]+)\)$/.exec(value);
    if (variable && TOKENS[variable[1]!]) return { token: variable[1] };
    if ((prefix === "text" || prefix === "stroke") && /^(?:length:)?[\d.]+(?:px|rem|em|%)?$/.test(value)) return {};
  }
  return { invalid: candidate };
}

function sourceEvidence(file: string, source: string) {
  const findings: string[] = [];
  const tokens = new Set<string>();
  const paintTokens = new Set<string>();
  const foregroundTokens = new Set<string>();
  const scanned = extractStyleCandidates(source, file);
  for (const candidate of scanned.candidates) {
    if (candidate.kind === "hex-color" || candidate.kind === "color-function") findings.push(`${file}: color literal ${candidate.raw}`);
  }
  for (const item of scanned.unchecked) findings.push(`${file}: unchecked style ${item.detail}`);
  const ast = astOf(file, source);
  function visit(node: ts.Node) {
    if (ts.isTypeNode(node) || ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isNewExpression(node) && /^(?:Error|TypeError|RangeError)$/.test(node.expression.getText(ast))) return;
    if (ts.isPropertyAssignment(node)) {
      const name = node.name.getText(ast).replace(/[\[\]"']/g, "").replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      if (COLOR_PROPERTY.test(name)) findings.push(`${file}: inline color property ${name}`);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (ts.isPropertyAccessExpression(node.left) && COLOR_PROPERTY.test(node.left.name.text) && /\.style$/.test(node.left.expression.getText(ast))) findings.push(`${file}: inline color assignment ${node.left.name.text}`);
      if (ts.isElementAccessExpression(node.left) && ts.isStringLiteralLike(node.left.argumentExpression) && COLOR_PROPERTY.test(node.left.argumentExpression.text) && /\.style$/.test(node.left.expression.getText(ast))) findings.push(`${file}: inline color assignment ${node.left.argumentExpression.text}`);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "setProperty" && /\.style$/.test(node.expression.expression.getText(ast))) {
      const key = node.arguments[0];
      if (key && ts.isStringLiteralLike(key) && COLOR_PROPERTY.test(key.text.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()))) findings.push(`${file}: inline color setProperty ${key.text}`);
    }
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (namedColor(node.text)) findings.push(`${file}: named color ${node.text}`);
      for (const candidate of node.text.split(/\s+/)) {
        const color = colorUtility(candidate);
        if (color.token) {
          tokens.add(color.token); paintTokens.add(color.token);
          if (/^(?:text|fill|stroke|outline|ring|border|decoration|accent|caret|placeholder)-/.test(utilityBase(candidate))) foregroundTokens.add(color.token);
        }
        if (color.invalid) findings.push(`${file}: color utility has no token ${color.invalid}`);
      }
      for (const match of node.text.matchAll(/--color-[\w-]+/g)) tokens.add(match[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { findings, tokens, paintTokens, foregroundTokens };
}

function blockSources(directory = blocksRoot): Map<string, string> {
  const sources = new Map<string, string>();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) for (const [file, source] of blockSources(path)) sources.set(file, source);
    else if (/\.tsx?$/.test(entry.name) && !/\.(?:test|check)\.tsx?$/.test(entry.name)) sources.set(relative(packageRoot, path), readFileSync(path, "utf8"));
  }
  return sources;
}

interface ConformanceInputs {
  sources: Map<string, string>;
  css: string;
  themeKeys: string;
  registrations: readonly BlockThemeRegistration[];
}

function realInputs(): ConformanceInputs {
  return {
    sources: new Map([...blockSources(), ...blockSources(resolve(packageRoot, "src/atoms"))]),
    css: readFileSync(resolve(packageRoot, "styles/tokens.css"), "utf8"),
    themeKeys: readFileSync(resolve(packageRoot, "styles/theme-keys.css"), "utf8"),
    registrations: BLOCK_THEME_CONFORMANCE,
  };
}

function astOf(file: string, source: string) {
  const key = file + "\0" + source;
  if (!syntaxCache.has(key)) syntaxCache.set(key, ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX));
  return syntaxCache.get(key)!;
}

function valueExports(file: string, source: string) {
  const exports: { name: string; original: string; module: string }[] = [];
  for (const node of astOf(file, source).statements) {
    if (ts.isExportAssignment(node)) { exports.push({ name: "default", original: "default", module: "" }); continue; }
    if (!ts.isExportDeclaration(node)) {
      const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
      if (!modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) continue;
      if (modifiers.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) { exports.push({ name: "default", original: "default", module: "" }); continue; }
      if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name)) throw new Error(`${file}: value exports must be explicitly named`);
          exports.push({ name: declaration.name.text, original: declaration.name.text, module: "" });
        }
      } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) && node.name) exports.push({ name: node.name.text, original: node.name.text, module: "" });
      else throw new Error(`${file}: unsupported value export`);
      continue;
    }
    if (node.isTypeOnly) continue;
    if (!node.exportClause || !ts.isNamedExports(node.exportClause) || !node.moduleSpecifier || !ts.isStringLiteralLike(node.moduleSpecifier)) throw new Error(`${file}: value exports must be explicitly named`);
    for (const item of node.exportClause.elements) {
      if (!item.isTypeOnly) exports.push({ name: item.name.text, original: (item.propertyName ?? item.name).text, module: node.moduleSpecifier.text });
    }
  }
  return exports;
}

function ownedDependency(file: string, module: string, sources: ReadonlyMap<string, string>): string | undefined {
  if (!module.startsWith(".")) return;
  const path = posix.normalize(posix.join(posix.dirname(file), module)).replace(/\.js$/, "");
  if (!/^src\/(?:blocks|atoms)\//.test(path)) return;
  for (const suffix of [".ts", ".tsx"]) if (sources.has(path + suffix)) return path + suffix;
  throw new Error(`${file}: missing owned dependency ${module}`);
}

function sourceGraph(entry: string, sources: ReadonlyMap<string, string>): string[] {
  const visited = new Set<string>();
  function visit(file: string) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = sources.get(file);
    if (source === undefined) throw new Error(`missing source ${file}`);
    const ast = astOf(file, source);
    for (const node of ast.statements) {
      let module: string | undefined;
      if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
        const clause = node.importClause;
        if (clause?.isTypeOnly) continue;
        if (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.every(item => item.isTypeOnly)) continue;
        module = node.moduleSpecifier.text;
      }
      if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        if (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.every(item => item.isTypeOnly)) continue;
        module = node.moduleSpecifier.text;
      }
      if (module) {
        const dependency = ownedDependency(file, module, sources);
        if (dependency) visit(dependency);
      }
    }
  }
  visit(entry);
  return [...visited];
}

function exportedSource(name: string, file: string, sources: ReadonlyMap<string, string>, visited = new Set<string>()): string {
  if (visited.has(file)) throw new Error(`export cycle for ${name}`);
  visited.add(file);
  const source = sources.get(file);
  if (source === undefined) throw new Error(`missing source ${file}`);
  const reexport = valueExports(file, source).find(entry => entry.name === name);
  if (!reexport || !reexport.module) return file;
  const dependency = ownedDependency(file, reexport.module, sources);
  if (!dependency) throw new Error(`${name}: Block source is outside the owned component graph`);
  return exportedSource(reexport.original, dependency, sources, visited);
}

/** One canonical pipeline for real files, precision regressions and named mutants. */
function conformanceFindings(input: ConformanceInputs): string[] {
  const findings: string[] = [];
  const barrel = "src/blocks/index.ts";
  const exported = valueExports(barrel, input.sources.get(barrel)!);
  const names = exported.map(entry => entry.name);
  const registered = input.registrations.map(entry => entry.exportName);
  const nonBlocks = Object.keys(NON_BLOCK_THEME_EXPORTS);
  if (new Set(names).size !== names.length) findings.push("duplicate barrel export");
  if (new Set(registered).size !== registered.length) findings.push("duplicate Block registration");
  for (const name of names) if (!registered.includes(name) && !nonBlocks.includes(name)) findings.push(`unregistered barrel export ${name}`);
  for (const name of [...registered, ...nonBlocks]) if (!names.includes(name)) findings.push(`registration has no barrel export ${name}`);
  for (const [name, reason] of Object.entries(NON_BLOCK_THEME_EXPORTS)) if (!reason.trim() || registered.includes(name)) findings.push(`invalid non-Block classification ${name}`);

  const exemptions = input.registrations.filter(entry => "exemptionReason" in entry);
  if (exemptions.length > 2) findings.push("Block exemption count grew above 2");
  for (const entry of exemptions) {
    if (!["Panel", "Toolbar"].includes(entry.exportName)) findings.push(`new Block exemption ${entry.exportName}`);
    if (!entry.exemptionReason?.trim()) findings.push(`exemption without reason ${entry.exportName}`);
    if (entry.contrastPairs.length) findings.push(`stale exemption with contrast coverage ${entry.exportName}`);
  }

  const light = parseRootDeclarations(input.css);
  const darkExplicit = parseDeclarationsForSelector(input.css, ':root[data-theme="dark"]');
  const darkOs = parseDeclarationsForSelector(input.css, ':root:not([data-theme="light"])');
  const themeKeys = parseDeclarationsForSelector(input.themeKeys, "@theme inline");
  const themes = [
    { label: "light", policy: "light" as const, declarations: light },
    { label: "dark explicit", policy: "dark" as const, declarations: mergeDeclarations(light, darkExplicit) },
    { label: "dark OS", policy: "dark" as const, declarations: mergeDeclarations(light, darkOs) },
  ].map(theme => ({ ...theme, registry: registryFromDeclarations(theme.declarations) }));
  const cache = new Map<string, ReturnType<typeof sourceEvidence>>();
  const evidence = (file: string) => {
    if (!cache.has(file)) cache.set(file, sourceEvidence(file, input.sources.get(file)!));
    return cache.get(file)!;
  };
  for (const entry of input.registrations) {
    if (!names.includes(entry.exportName)) continue;
    if (exportedSource(entry.exportName, barrel, input.sources) !== entry.source) findings.push(`${entry.exportName}: source registration does not match barrel`);
    const graph = sourceGraph(entry.source, input.sources);
    const used = new Set<string>();
    const paint = new Set<string>();
    const foreground = new Set<string>();
    for (const file of graph) {
      const data = evidence(file);
      // Atoms retain their existing source rules; their real token roles are
      // included only to prove a Block's delegated contrast registration.
      if (file.startsWith("src/blocks/")) findings.push(...data.findings);
      for (const property of data.tokens) used.add(property);
      for (const property of data.paintTokens) paint.add(property);
      for (const property of data.foregroundTokens) foreground.add(property);
    }
    for (const property of used) {
      if (!TOKENS[property] || !light.get(property)?.trim()) findings.push(`${entry.exportName}: missing light token ${property}`);
      if (!themeKeys.get(property)?.includes(`var(${property},`)) findings.push(`${entry.exportName}: missing live utility token ${property}`);
      for (const theme of themes) {
        const resolved = resolveTokenValue(property, theme.registry);
        if (!resolved.value || resolved.cycle || resolved.missingProperty) findings.push(`${entry.exportName}: unresolved ${theme.label} token ${property}`);
        for (const dependency of resolved.chain) {
          if (TOKENS[dependency]?.themeDependent && (!darkExplicit.get(dependency)?.trim() || !darkOs.get(dependency)?.trim())) findings.push(`${entry.exportName}: missing dark value ${dependency}`);
        }
      }
    }
    if (!entry.exemptionReason?.trim() && !entry.contrastPairs.length) findings.push(`${entry.exportName}: no registered contrast pair or reason`);
    for (const id of entry.contrastPairs) {
      const pair = CONTRAST_PAIRS.find(candidate => candidate.id === id);
      if (!pair) findings.push(`${entry.exportName}: unknown contrast pair ${id}`);
      else if (!paint.has(pair.foreground)) findings.push(`${entry.exportName}: contrast foreground is not used or delegated ${id}`);
    }
    if (entry.exemptionReason?.trim()) {
      // Shared variable modules can also export unrelated ring fallbacks.
      // A fallback reference alone is not evidence of an authored foreground.
      if ([...foreground].some(property => CONTRAST_PAIRS.some(pair => pair.foreground === property))) findings.push(`${entry.exportName}: stale exemption now owns or delegates a contrast foreground`);
      continue;
    }
    for (const theme of themes) {
      const pairs = contrastPairsForTheme(theme.policy).filter(pair => entry.contrastPairs.includes(pair.id));
      if (pairs.length !== entry.contrastPairs.length) findings.push(`${entry.exportName}: incomplete ${theme.label} pair registration`);
      const report = checkTokenContrast(pairs, { tokens: theme.registry });
      if (!report.ok) findings.push(`${entry.exportName}: ${theme.label} contrast failed ${JSON.stringify({ findings: report.findings, unchecked: report.unchecked })}`);
    }
  }
  return [...new Set(findings)];
}

describe("Block theme conformance", () => {
  it("every Block source uses token colors without inline color", () => {
    const findings = [...blockSources()].flatMap(([file, source]) => sourceEvidence(file, source).findings);
    expect(findings).toEqual([]);
  });

  it("every exported Block conforms in both themes", () => {
    const input = realInputs();
    expect(conformanceFindings(input)).toEqual([]);
  });

  it("follows real re-exports and nested runtime render helpers", () => {
    const input = realInputs();
    expect(exportedSource("Scene", "src/blocks/index.ts", input.sources)).toBe("src/blocks/scene/Scene.tsx");
    for (const [name, dependency] of [
      ["Items", "src/blocks/items/render.tsx"], ["Specimen", "src/blocks/specimen/parts.tsx"],
      ["Tree", "src/blocks/tree/policies.ts"], ["ResizablePane", "src/atoms/ResizeHandle.tsx"],
      ["Panel", "src/atoms/Card.tsx"],
    ]) {
      const entry = input.registrations.find(item => item.exportName === name)!;
      expect(sourceGraph(entry.source, input.sources), name).toContain(dependency);
    }
  });

  it("distinguishes structural classes and metadata from actual paint", () => {
    const source = 'const classes = "border-t border-s border-b border-2 text-body-s text-start [&_blockquote]:border-s [&_h1]:text-ink-primary [&_code]:bg-surface-sunken"; const names = ["Menu", "canvas", "mark"];';
    const result = sourceEvidence("Example.tsx", source);
    expect(result.findings).toEqual([]);
    expect([...result.tokens].sort()).toEqual(["--color-ink-primary", "--color-surface-sunken"]);
    for (const literal of ["red", "rebeccapurple", "Blue"]) expect(sourceEvidence("Example.tsx", `const paint = "${literal}";`).findings).toContain(`Example.tsx: named color ${literal}`);
    for (const utility of ["border-t-red", "bg-gray-500", "text-[#fff]", "[&_p]:text-rebeccapurple", "bg-[rgb(1,2,3)]"]) expect(sourceEvidence("Example.tsx", `const classes = "${utility}";`).findings.some(item => item.includes("color utility has no token"))).toBe(true);
    expect(sourceEvidence("Example.tsx", 'const paint = { color: "var(--color-ink-primary)" };').findings).toContain("Example.tsx: inline color property color");
  });

  it("rejects a hex-color mutant through the canonical pipeline", () => {
    const input = realInputs();
    const file = "src/blocks/PageHeader.tsx";
    input.sources.set(file, input.sources.get(file)! + '\nconst paint = "#123456";');
    expect(conformanceFindings(input)).toContain(`${file}: color literal #123456`);
  });

  it("rejects a missing dark-token mutant instead of inheriting its light value", () => {
    const input = realInputs();
    const start = input.css.search(/^:root\[data-theme="dark"\]\s*\{/m);
    expect(start).toBeGreaterThan(-1);
    const lightBefore = parseRootDeclarations(input.css).get("--color-ink-primary");
    input.css = input.css.slice(0, start) + input.css.slice(start).replace(/--color-ink-primary\s*:[^;]+;/, "");
    expect(parseRootDeclarations(input.css).get("--color-ink-primary")).toBe(lightBefore);
    expect(parseDeclarationsForSelector(input.css, ':root[data-theme="dark"]').has("--color-ink-primary")).toBe(false);
    expect(conformanceFindings(input)).toContain("PageHeader: missing dark value --color-ink-primary");
  });

  it("rejects an unregistered new Block export", () => {
    const input = realInputs();
    const file = "src/blocks/index.ts";
    input.sources.set(file, input.sources.get(file)! + '\nexport { NewBlock } from "./NewBlock.js";');
    expect(conformanceFindings(input)).toContain("unregistered barrel export NewBlock");
    input.sources.set(file, input.sources.get(file)! + '\nexport const InlineBlock = () => null;');
    expect(conformanceFindings(input)).toContain("unregistered barrel export InlineBlock");
  });

  it("rejects an exemption without a reason and any growth or replacement", () => {
    const input = realInputs();
    input.registrations = input.registrations.map(entry => entry.exportName === "Panel" ? { ...entry, exemptionReason: " " } : entry);
    expect(conformanceFindings(input)).toContain("exemption without reason Panel");
    input.registrations = input.registrations.map(entry => entry.exportName === "PageHeader" ? { ...entry, contrastPairs: [], exemptionReason: "Unjustified replacement" } : entry);
    const findings = conformanceFindings(input);
    expect(findings).toContain("Block exemption count grew above 2");
    expect(findings).toContain("new Block exemption PageHeader");
  });
});
