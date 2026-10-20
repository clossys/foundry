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
const COLOR_SHORTHAND = /^(?:border(?:Block|Inline)?(?:Start|End|Top|Right|Bottom|Left)?|outline|boxShadow|textShadow|textDecoration|textEmphasis)$/;
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

function normalizeProperty(name: string): string {
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** Inspect authored value fragments, never expression identifiers or copy elsewhere. */
function inlineColor(rawName: string, value: ts.Node | undefined): boolean {
  if (rawName.startsWith("--color-")) return true;
  const name = normalizeProperty(rawName);
  if (COLOR_PROPERTY.test(name)) return true;
  if (!COLOR_SHORTHAND.test(name) || !value) return false;
  const fragments: string[] = [];
  function inspectValue(node: ts.Node) {
    if (ts.isTypeNode(node)) return;
    if (ts.isConditionalExpression(node)) {
      inspectValue(node.whenTrue);
      inspectValue(node.whenFalse);
      return;
    }
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) fragments.push(node.text);
    ts.forEachChild(node, inspectValue);
  }
  inspectValue(value);
  return fragments.some(fragment => /--color-[\w-]+|#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i.test(fragment)
    || (fragment.match(/[a-zA-Z_-][\w-]*/g) ?? []).some(namedColor));
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
  const arbitraryProperty = /^\[([\w-]+):.+\]$/.exec(utility);
  if (arbitraryProperty && (arbitraryProperty[1]!.startsWith("--color-") || COLOR_PROPERTY.test(normalizeProperty(arbitraryProperty[1]!)) || COLOR_SHORTHAND.test(normalizeProperty(arbitraryProperty[1]!)))) return { invalid: candidate };
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
      const name = ts.isStringLiteralLike(node.name) ? node.name.text
        : ts.isComputedPropertyName(node.name) && ts.isStringLiteralLike(node.name.expression) ? node.name.expression.text
        : node.name.getText(ast).replace(/[\[\]"']/g, "");
      if (inlineColor(name, node.initializer)) findings.push(`${file}: inline color property ${name.startsWith("--") ? name : normalizeProperty(name)}`);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (ts.isPropertyAccessExpression(node.left) && inlineColor(node.left.name.text, node.right) && /\.style$/.test(node.left.expression.getText(ast))) findings.push(`${file}: inline color assignment ${node.left.name.text}`);
      if (ts.isElementAccessExpression(node.left) && ts.isStringLiteralLike(node.left.argumentExpression) && inlineColor(node.left.argumentExpression.text, node.right) && /\.style$/.test(node.left.expression.getText(ast))) findings.push(`${file}: inline color assignment ${node.left.argumentExpression.text}`);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "setProperty" && /\.style$/.test(node.expression.expression.getText(ast))) {
      const key = node.arguments[0];
      if (key && ts.isStringLiteralLike(key) && inlineColor(key.text, node.arguments[1])) findings.push(`${file}: inline color setProperty ${key.text.startsWith("--") ? key.text : normalizeProperty(key.text)}`);
    }
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      // A CSS property key is technical syntax, not a utility class value.
      if (ts.isCallExpression(node.parent) && node.parent.arguments[0] === node && ts.isPropertyAccessExpression(node.parent.expression) && node.parent.expression.name.text === "setProperty" && /\.style$/.test(node.parent.expression.expression.getText(ast))) return;
      if (namedColor(node.text)) findings.push(`${file}: named color ${node.text}`);
      for (const candidate of node.text.split(/\s+/)) {
        const color = colorUtility(candidate);
        if (color.token) {
          tokens.add(color.token); paintTokens.add(color.token);
          if (/^(?:text|fill|stroke)-/.test(utilityBase(candidate))) foregroundTokens.add(color.token);
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
      // Text/fill/stroke utilities author a foreground regardless of pair membership.
      // Surface/edge classes and unrelated variable fallbacks remain token checks.
      if (foreground.size) findings.push(`${entry.exportName}: stale exemption now owns or delegates a contrast foreground`);
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
    expect(sourceEvidence("Example.tsx", 'const paint = { color: "var(--color-ink-primary, currentColor)" };').findings).toContain("Example.tsx: inline color property color");
  });

  it.each([
    "[color:red]", "[background-color:rebeccapurple]", "hover:[color:red]",
    "[&>a]:focus:[background-color:white]", "md:hover:[color:Blue]",
    "![border-inline-start-color:red]", "dark:[&_[data-state=open]]:hover:[fill:red]",
    "[color:var(--color-ink-primary,currentColor)]", "[box-shadow:0_0_1px_red]",
  ])("refuses arbitrary color properties: %s", candidate => {
    expect(sourceEvidence("Example.tsx", `const classes = ${JSON.stringify(candidate)};`).findings)
      .toContain(`Example.tsx: color utility has no token ${candidate}`);
  });

  it.each([
    "[--color-ink-primary:red]", "hover:[--color-ink-primary:red]",
    "dark:[&_[data-state=open]]:hover:![--color-ink-primary:red]",
    "md:[--color-ink-primary:red]!", "[--color-ink-primary:var(--color-surface-base,currentColor)]",
  ])("rejects custom color properties through the canonical pipeline: %s", candidate => {
    const input = realInputs();
    const file = "src/blocks/PageHeader.tsx";
    const source = input.sources.get(file)!;
    expect(source).toContain('className={cx("');
    input.sources.set(file, source.replace('className={cx("', `className={cx("${candidate} `));
    expect(conformanceFindings(input)).toEqual([`${file}: color utility has no token ${candidate}`]);
  });

  it.each([
    "[--layout-gap:1rem]", "--color-ink-primary", "[&_[data-color=red]]:text-ink-primary",
  ])("preserves structural custom properties through the canonical pipeline: %s", candidate => {
    const input = realInputs();
    const file = "src/blocks/PageHeader.tsx";
    const source = input.sources.get(file)!;
    expect(source).toContain('className={cx("');
    input.sources.set(file, source.replace('className={cx("', `className={cx("${candidate} `));
    expect(conformanceFindings(input)).toEqual([]);
  });

  it.each([
    ["border", "1px solid red"], ["boxShadow", "0 0 1px red"],
    ["borderInlineStart", "1px solid rebeccapurple"], ["outline", "1px dotted Blue"],
    ["textShadow", "0 0 1px red, 0 1px 1px blue"],
    ["border", "1px solid var(--color-line-base,currentColor)"],
  ])("refuses inline color shorthands: %s = %s", (property, value) => {
    const literal = JSON.stringify(value);
    const cssProperty = property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
    for (const [source, kind] of [
      [`const style = { ${property}: ${literal} };`, "property"],
      [`const element = <div style={{ ${property}: ${literal} }} />;`, "property"],
      [`element.style.${property} = ${literal};`, "assignment"],
      [`element.style[${JSON.stringify(property)}] = ${literal};`, "assignment"],
      [`element.style.setProperty(${JSON.stringify(cssProperty)}, ${literal});`, "setProperty"],
    ]) {
      expect(sourceEvidence("Example.tsx", source!).findings, source)
        .toContain(`Example.tsx: inline color ${kind} ${property}`);
    }
  });

  it("detects a shorthand color in a literal template fragment", () => {
    expect(sourceEvidence("Example.tsx", 'const style = { border: `${width}px solid red` };').findings)
      .toContain("Example.tsx: inline color property border");
  });

  it("preserves structural arbitrary properties, inherited ink and non-paint metadata", () => {
    for (const source of [
      'const classes = "[width:1rem] hover:[grid-template-columns:1fr_2fr] [&>a]:[padding-inline:1rem] [--layout-gap:1rem] [border-width:1px]";',
      'const style = { borderWidth: "1px", border: "none", boxShadow: "none", padding: "1rem" };',
      'const style = { border: "1px solid currentColor", boxShadow: UI_ELEVATION_PANEL };',
      'const style = { border: `${red}px solid currentColor` };',
      'const classes = { border: "border-line-base", boxShadow: "shadow-sm" };',
      'element.style.borderWidth = "1px"; element.style.setProperty("border-width", "1px");',
      'const description = "A red border and white shadow";',
    ]) expect(sourceEvidence("Example.tsx", source).findings, source).toEqual([]);
  });

  it.each([
    'active ? "1px solid red" : "none"',
    'active ? "none" : "1px solid red"',
    'active ? (ready ? "1px solid red" : "none") : "none"',
    'active ? "none" : (ready ? "none" : "1px solid red")',
    '(active ? "1px solid red" : "none")',
    '(active ? "none" : "1px solid red") as string',
    '(active ? "none" : "1px solid red") satisfies string',
    '`${active ? "1px solid red" : "none"}`',
    '"1px " + (active ? "solid red" : "solid currentColor")',
  ])("rejects conditional shorthand paint: %s", expression => {
    for (const [source, kind] of [
      [`const style = { border: ${expression} };`, "property"],
      [`const element = <div style={{ border: ${expression} }} />;`, "property"],
      [`element.style.border = ${expression};`, "assignment"],
      [`element.style["border"] = ${expression};`, "assignment"],
      [`element.style.setProperty("border", ${expression});`, "setProperty"],
    ]) expect(sourceEvidence("Example.tsx", source!).findings, source)
      .toContain(`Example.tsx: inline color ${kind} border`);
  });

  it("checks conditional shadows while preserving inherited ink and identifiers", () => {
    for (const source of [
      'const style = { border: active ? "1px solid currentColor" : "none" };',
      'const style = { border: (active ? "none" : "1px solid currentColor") as string };',
      'const style = { boxShadow: active ? UI_ELEVATION_PANEL : "none" };',
      'const style = { border: `${active ? red : width}px solid currentColor` };',
    ]) expect(sourceEvidence("Example.tsx", source).findings, source).toEqual([]);
    expect(sourceEvidence("Example.tsx", 'const style = { boxShadow: active ? "none" : "0 0 1px red" };').findings)
      .toContain("Example.tsx: inline color property boxShadow");
  });

  it.each([
    "text-line-base", "fill-line-base", "stroke-line-base",
    "hover:text-line-base", "[&_span]:text-line-base",
  ])("refuses a foreground-free exemption with authored foreground %s", utility => {
    for (const name of ["Toolbar", "Panel"]) {
      const input = realInputs();
      const file = input.registrations.find(entry => entry.exportName === name)!.source;
      const source = input.sources.get(file)!;
      expect(source).toContain('className={cx("');
      input.sources.set(file, source.replace('className={cx("', `className={cx("${utility} `));
      expect(conformanceFindings(input), `${name}: ${utility}`)
        .toContain(`${name}: stale exemption now owns or delegates a contrast foreground`);
    }
  });

  it("keeps structural text and surface or edge paint foreground-free", () => {
    for (const name of ["Toolbar", "Panel"]) {
      const input = realInputs();
      const file = input.registrations.find(entry => entry.exportName === name)!.source;
      const source = input.sources.get(file)!;
      input.sources.set(file, source.replace('className={cx("', 'className={cx("border-line-base bg-surface-base text-body-s stroke-2 '));
      expect(conformanceFindings(input), name).toEqual([]);
    }
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

describe("raw inline custom color properties", () => {
  it.each([
    ["style object", 'style={{ "--color-ink-primary": "var(--color-surface-base,currentColor)" }}', "property"],
    ["computed string style key", 'style={{ [ "--color-ink-primary" ]: "var(--color-surface-base,currentColor)" }}', "property"],
    ["computed template style key", 'style={{ [ `--color-ink-primary` ]: "var(--color-surface-base,currentColor)" }}', "property"],
    ["escaped string style key", String.raw`style={{ "\u002d\u002dcolor-ink-primary": "var(--color-surface-base,currentColor)" }}`, "property"],
    ["style element assignment", 'element.style["--color-ink-primary"] = "var(--color-surface-base,currentColor)";', "assignment"],
    ["style setProperty", 'element.style.setProperty("--color-ink-primary", "var(--color-surface-base,currentColor)");', "setProperty"],
  ])("rejects raw inline overrides through the canonical pipeline: %s", (_name, fragment, kind) => {
    const input = realInputs();
    const file = "src/blocks/PageHeader.tsx";
    const source = input.sources.get(file)!;
    expect(source).toContain("<header {...rest}");
    input.sources.set(file, kind === "property"
      ? source.replace("<header {...rest}", `<header {...rest} ${fragment}`)
      : source + `\nfunction applyOverride(element: HTMLElement) { ${fragment} }`);
    expect(conformanceFindings(input)).toEqual([`${file}: inline color ${kind} --color-ink-primary`]);
  });

  it.each([
    ["layout style object", 'style={{ "--layout-gap": "1rem" }}', true],
    ["computed layout style key", 'style={{ [ "--layout-gap" ]: "1rem" }}', true],
    ["layout style assignment", 'element.style["--layout-gap"] = "1rem";', false],
    ["layout setProperty", 'element.style.setProperty("--layout-gap", "1rem");', false],
    ["plain color token reference", 'const reference = "--color-ink-primary";', false],
  ])("preserves non-color custom properties and token references: %s", (_name, fragment, property) => {
    const input = realInputs();
    const file = "src/blocks/PageHeader.tsx";
    const source = input.sources.get(file)!;
    input.sources.set(file, property
      ? source.replace("<header {...rest}", `<header {...rest} ${fragment}`)
      : source + `\nfunction preserveLayout(element: HTMLElement) { ${fragment} }`);
    expect(conformanceFindings(input)).toEqual([]);
  });
});
