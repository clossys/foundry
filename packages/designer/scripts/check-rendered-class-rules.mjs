#!/usr/bin/env node
/**
 * Independent, read-only class coverage gate. It checks shipped CSS, never a
 * fresh Tailwind build (which could conceal an omitted shipped rule).
 *
 * Source mode follows className/class assignments, cn/cx/clsx/twMerge calls,
 * cva bases/variants/compoundVariants, and referenced local class tables and
 * helpers. It does not mistake arbitrary prose literals for class names.
 * Unknown package-generated expressions and unverified caller class inputs
 * fail; a separate HTML invocation measures concrete rendered values.
 * HTML mode checks every class in the supplied rendered DOM, including SVG.
 * Neither mode proves selector matching, cascade, visual fidelity, or unrendered
 * runtime states. Positive selector participation is the measured contract:
 * structural markers must occur in a declaration-bearing selector too.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import * as cssTree from "css-tree";
import { parse as parseHtml } from "parse5";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirs = ["components", "blocks", "shell", "frames", "runtime", "studio"];
const classHelpers = new Set(["cn", "cx", "clsx", "classnames", "twMerge"]);
const classProperty = /^(?:class|className|[a-zA-Z]+ClassName)$/;
const skippedFile = /\.(?:test|spec|check|stories)\.[cm]?tsx?$|\.d\.ts$/;
const words = value => value.split(/[\t\n\f\r ]+/).filter(Boolean);
const nameOf = node => node && (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) ? node.text : undefined;

export function cssClassRules(css, file = "stylesheet") {
  const evidence = new Map();
  const tokens = cssTree.tokenTypes, closers = new Map([
    [tokens.LeftCurlyBracket, tokens.RightCurlyBracket], [tokens.LeftSquareBracket, tokens.RightSquareBracket],
    [tokens.LeftParenthesis, tokens.RightParenthesis], [tokens.Function, tokens.RightParenthesis],
  ]), balance = [];
  cssTree.tokenize(css, (type, start, end) => {
    if (closers.has(type)) balance.push(closers.get(type));
    else if ([tokens.RightCurlyBracket, tokens.RightSquareBracket, tokens.RightParenthesis].includes(type) && balance.pop() !== type) throw new Error(`${file}: unbalanced CSS delimiter at offset ${start}`);
    if ([tokens.BadString, tokens.BadUrl].includes(type)) throw new Error(`${file}: invalid CSS token at offset ${start}`);
    if (type === tokens.Comment && !css.slice(start, end).endsWith("*/")) throw new Error(`${file}: unterminated CSS comment`);
    if (type === tokens.String && css[start] !== css[end - 1]) throw new Error(`${file}: unterminated CSS string`);
  });
  if (balance.length) throw new Error(`${file}: unterminated CSS block or function`);
  const parseErrors = [];
  const ast = cssTree.parse(css, { positions: true, onParseError(error, fallback) {
    // Conditions use speculative alternatives: e.g. a valid selector() query
    // first attempts a declaration. A null fallback is not recovered CSS.
    // Raw recovery is different: the parser could not understand the input.
    if (fallback !== null) parseErrors.push({ error, fallback });
  } });
  const recoveredNesting = new Set();
  function selectorClasses(node, found = new Set()) {
    if (node.type === "PseudoClassSelector" && !["is", "where", "has", "nth-child", "nth-last-child"].includes(node.name.toLowerCase())) return found;
    if (node.type === "PseudoElementSelector") return found;
    if (node.type === "ClassSelector") found.add(cssTree.ident.decode(node.name));
    if (node.type === "AttributeSelector" && node.name?.name === "class" && ["=", "~="].includes(node.matcher)) {
      const value = node.value?.type === "String" ? node.value.value : node.value?.name;
      if (value !== undefined) for (const token of words(cssTree.ident.decode(value))) found.add(token);
    }
    if (node.children) node.children.forEach(child => selectorClasses(child, found));
    return found;
  }
  function visit(node, selectors = [], keyframes = false) {
    // css-tree currently supports &-prefixed nesting directly. Valid bare
    // nested selectors arrive as Raw declaration recovery. Reparse that exact
    // span as a rule list; accept it only if the full nested parse is sound.
    // Invalid declarations cannot become evidence through Raw recovery.
    if (node.type === "Raw" && selectors.length && !keyframes) {
      const errors = [];
      const nested = cssTree.parse(node.value, {
        positions: true, offset: node.loc?.start.offset ?? 0,
        line: node.loc?.start.line ?? 1, column: node.loc?.start.column ?? 1,
        onParseError(error, fallback) { if (fallback !== null) errors.push(error.message); },
      });
      if (errors.length || nested.children.isEmpty || nested.children.some(child => child.type !== "Rule" && child.type !== "Atrule")) throw new Error(`${file}: unsupported CSS recovery at line ${node.loc?.start.line ?? "?"}`);
      recoveredNesting.add(node);
      visit(nested, selectors, keyframes);
      return;
    }
    if (node.type === "Atrule" && /(?:^|-)keyframes$/i.test(node.name)) keyframes = true;
    if (node.type === "Atrule" && node.name.toLowerCase() === "import") throw new Error(`${file}: unresolved CSS @import; supply the compiled stylesheet`);
    if (node.type === "Atrule" && !cssTree.lexer.getAtrule(node.name) && !cssTree.lexer.getAtrule(node.name.replace(/^-(?:webkit|moz|o)-/i, ""))) throw new Error(`${file}: unsupported CSS @${node.name}`);
    if (node.type === "Rule" && !keyframes) {
      if (node.prelude?.type !== "SelectorList") throw new Error(`${file}: unsupported selector at line ${node.loc?.start.line ?? "?"}`);
      selectors = [...selectors, node.prelude];
    }
    if (node.type === "Declaration" && !keyframes) {
      if (!node.property.startsWith("--") && (node.value.type !== "Value" || node.value.children.isEmpty)) throw new Error(`${file}: invalid declaration at line ${node.loc?.start.line ?? "?"}`);
      const match = !selectors.length || node.property.startsWith("--") ? {} : cssTree.lexer.matchDeclaration(node);
      if (match.error && !/Matching for a tree with var\(\)/.test(match.error.message)) throw new Error(`${file}: invalid declaration ${node.property} at line ${node.loc?.start.line ?? "?"}: ${match.error.message}`);
      for (const selector of selectors) {
        const detail = { file, line: selector.loc?.start.line ?? null, selector: cssTree.generate(selector) };
        for (const token of selectorClasses(selector)) {
          if (!evidence.has(token)) evidence.set(token, []);
          if (!evidence.get(token).some(row => row.selector === detail.selector && row.line === detail.line)) evidence.get(token).push(detail);
        }
      }
      return;
    }
    if (node.block) visit(node.block, selectors, keyframes);
    if (node.children) node.children.forEach(child => visit(child, selectors, keyframes));
  }
  visit(ast);
  const unrecovered = parseErrors.find(row => !recoveredNesting.has(row.fallback));
  if (unrecovered) throw new Error(`${file}: CSS parser recovery refused: ${unrecovered.error.message}`);
  return evidence;
}

export function htmlClasses(html, file = "rendered.html") {
  const classes = new Map();
  function visit(node) {
    for (const attr of node.attrs ?? []) if (attr.name === "class") {
      for (const token of words(attr.value)) {
        if (!classes.has(token)) classes.set(token, []);
        classes.get(token).push({ file, element: node.tagName });
      }
    }
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content) visit(node.content);
  }
  visit(parseHtml(html));
  return classes;
}

function sourceFiles(paths) {
  const files = new Set();
  function visit(path) {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) if (!["node_modules", "dist", "build", "__fixtures__", ".git"].includes(entry)) visit(resolve(path, entry));
    } else if (/\.[cm]?tsx?$/.test(path) && !skippedFile.test(path)) files.add(path);
  }
  for (const path of paths) visit(resolve(path));
  if (!files.size) throw new Error("Source selection matched no production TypeScript files");
  return [...files].sort();
}

export function sourceClasses(paths) {
  const files = sourceFiles(paths);
  const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, jsx: ts.JsxEmit.Preserve, noLib: true, types: [], skipLibCheck: true };
  const host = ts.createCompilerHost(options);
  // Only repository-relative source imports are needed. Do not load dependency
  // declaration trees, execute modules, or resolve packages over the network.
  host.resolveModuleNames = (names, containingFile) => names.map(name => {
    if (!name.startsWith(".")) return undefined;
    const target = resolve(dirname(containingFile), name);
    const stem = target.replace(/\.[cm]?js$/, "");
    const candidate = [target, stem + ".ts", stem + ".tsx", resolve(target, "index.ts"), resolve(target, "index.tsx")].find(path => /\.[cm]?tsx?$/.test(path) && existsSync(path) && statSync(path).isFile());
    return candidate ? { resolvedFileName: candidate, extension: extname(candidate) === ".tsx" ? ts.Extension.Tsx : ts.Extension.Ts } : undefined;
  });
  const program = ts.createProgram(files, options, host);
  for (const source of program.getSourceFiles()) if (source.parseDiagnostics.length) throw new Error(`${source.fileName}: TypeScript syntax error in selected source/import graph`);
  const checker = program.getTypeChecker();
  const classes = new Map(), unsupported = new Map(), externalInputs = new Map();
  let sinks = 0;
  const active = new Set();
  const location = node => {
    const source = node.getSourceFile();
    const point = source.getLineAndCharacterOfPosition(node.getStart(source));
    return { file: source.fileName, line: point.line + 1, expression: node.getText(source).slice(0, 180) };
  };
  const issue = (map, node, reason) => { const row = { ...location(node), reason }; map.set(`${row.file}:${row.line}:${row.expression}:${reason}`, row); };
  const add = (text, node) => {
    for (const token of words(text)) {
      if (!classes.has(token)) classes.set(token, []);
      const row = location(node);
      if (!classes.get(token).some(x => x.file === row.file && x.line === row.line)) classes.get(token).push(row);
    }
  };
  const symbolOf = node => {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return symbol;
  };
  const declarationOf = node => symbolOf(node)?.valueDeclaration ?? symbolOf(node)?.declarations?.[0];
  const unwrap = node => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
    return node;
  };
  function initializer(node) {
    node = unwrap(node);
    if (!node) return node;
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
      const declaration = declarationOf(ts.isPropertyAccessExpression(node) ? node.name : node);
      if (declaration?.initializer) return unwrap(declaration.initializer);
    }
    return node;
  }
  function properties(node) {
    node = initializer(node);
    return node && ts.isObjectLiteralExpression(node) ? node.properties : [];
  }
  function external(node) {
    node = unwrap(node);
    while (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) node = node.expression;
    const declaration = declarationOf(node);
    if (declaration && ts.isParameter(declaration)) return true;
    if (!declaration || !ts.isBindingElement(declaration)) return false;
    let parent = declaration.parent;
    while (parent && !ts.isParameter(parent) && !ts.isVariableDeclaration(parent)) parent = parent.parent;
    return !!parent && ts.isParameter(parent);
  }
  function cva(node, env) {
    if (node.arguments[0]) evaluate(node.arguments[0], env);
    if (node.arguments[1] && !ts.isObjectLiteralExpression(initializer(node.arguments[1]))) { issue(unsupported, node.arguments[1], "cva configuration must resolve to an object literal"); return; }
    for (const property of properties(node.arguments[1])) {
      if (ts.isSpreadAssignment(property)) { issue(unsupported, property, "cva configuration spread cannot be resolved"); continue; }
      if (nameOf(property.name) === "variants") {
        if (!ts.isObjectLiteralExpression(initializer(property.initializer))) issue(unsupported, property, "cva variants must resolve to an object literal");
        for (const variant of properties(property.initializer)) {
          if (!variant.initializer || !ts.isObjectLiteralExpression(initializer(variant.initializer))) { issue(unsupported, variant, "cva variant choices must resolve to an object literal"); continue; }
          for (const choice of properties(variant.initializer)) {
            if (choice.initializer) evaluate(choice.initializer, env);
            else issue(unsupported, choice, "cva variant choice cannot be resolved");
          }
        }
      }
      if (nameOf(property.name) === "compoundVariants") {
        const rows = initializer(property.initializer);
        if (!ts.isArrayLiteralExpression(rows)) { issue(unsupported, property, "cva compound variants must resolve to an array literal"); continue; }
        for (const row of rows.elements) {
          if (!ts.isObjectLiteralExpression(initializer(row))) { issue(unsupported, row, "cva compound variant must resolve to an object literal"); continue; }
          for (const entry of properties(row)) if (classProperty.test(nameOf(entry.name) ?? "") && entry.initializer) evaluate(entry.initializer, env);
        }
      }
    }
  }
  function finiteStrings(node, env, seen = new Set()) {
    node = unwrap(node);
    if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return [node.text];
    if (ts.isConditionalExpression(node)) {
      const a = finiteStrings(node.whenTrue, env, seen), b = finiteStrings(node.whenFalse, env, seen);
      return a && b ? [...new Set([...a, ...b])] : undefined;
    }
    if (ts.isIdentifier(node)) {
      const declaration = declarationOf(node);
      const bound = env.get(declaration);
      if (bound) return finiteStrings(bound.node, bound.env, seen);
      if (declaration?.initializer && !seen.has(declaration)) return finiteStrings(declaration.initializer, env, new Set([...seen, declaration]));
    }
    const type = checker.getTypeAtLocation(node);
    const types = type.isUnion() ? type.types : [type];
    if (types.every(t => t.isStringLiteral() || t.isNumberLiteral())) return types.map(t => String(t.value));
    return undefined;
  }
  function evaluate(expression, env = new Map()) {
    if (!expression) return;
    const node = unwrap(expression);
    if (active.has(node)) { issue(unsupported, node, "cyclic class expression"); return; }
    active.add(node);
    try {
      if (ts.isStringLiteralLike(node)) { add(node.text, node); return; }
      if ([ts.SyntaxKind.NullKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.UndefinedKeyword].includes(node.kind) || ts.isNumericLiteral(node)) return;
      if (ts.isIdentifier(node) && node.text === "undefined") return;
      if (ts.isConditionalExpression(node)) { evaluate(node.whenTrue, env); evaluate(node.whenFalse, env); return; }
      if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
        if (node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) evaluate(node.left, env);
        evaluate(node.right, env); return;
      }
      if (ts.isTemplateExpression(node)) {
        let strings = [node.head.text];
        for (const span of node.templateSpans) {
          const values = finiteStrings(span.expression, env);
          if (!values || strings.length * values.length > 512) { issue(unsupported, node, "class template is not a finite literal union (maximum 512 combinations)"); return; }
          strings = strings.flatMap(prefix => values.map(value => prefix + value + span.literal.text));
        }
        for (const value of strings) add(value, node);
        return;
      }
      if (ts.isArrayLiteralExpression(node)) { for (const entry of node.elements) evaluate(ts.isSpreadElement(entry) ? entry.expression : entry, env); return; }
      if (ts.isObjectLiteralExpression(node)) {
        for (const entry of node.properties) {
          if (ts.isSpreadAssignment(entry)) { evaluate(entry.expression, env); continue; }
          const name = nameOf(entry.name);
          if (name !== undefined) add(name, entry);
          else issue(unsupported, entry, "computed class object key");
        }
        return;
      }
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) { returns(node, env); return; }
      if (ts.isElementAccessExpression(node) || ts.isPropertyAccessExpression(node)) {
        const object = initializer(node.expression);
        if (ts.isObjectLiteralExpression(object)) {
          const names = ts.isPropertyAccessExpression(node) ? [node.name.text] : finiteStrings(node.argumentExpression, env);
          for (const entry of object.properties) if (entry.initializer && (!names || names.includes(nameOf(entry.name)))) evaluate(entry.initializer, env);
          return;
        }
        const declaration = declarationOf(ts.isPropertyAccessExpression(node) ? node.name : node);
        if (declaration?.initializer) { evaluate(declaration.initializer, env); return; }
        if (ts.isPropertyAccessExpression(node) && classProperty.test(node.name.text) && external(node)) { issue(externalInputs, node, "caller-supplied class property; concrete values require rendered HTML"); return; }
      }
      if (ts.isIdentifier(node)) {
        const declaration = declarationOf(node), bound = env.get(declaration);
        if (bound) { evaluate(bound.node, bound.env); return; }
        if (classProperty.test(node.text) && external(node)) {
          issue(externalInputs, node, "caller-supplied class input; concrete values require rendered HTML");
          if (declaration?.initializer) evaluate(declaration.initializer, env);
          return;
        }
        if (declaration?.initializer) { evaluate(declaration.initializer, env); return; }
      }
      if (ts.isCallExpression(node)) {
        const calledName = ts.isIdentifier(node.expression) ? node.expression.text : undefined;
        if (classHelpers.has(calledName)) { for (const arg of node.arguments) evaluate(arg, env); return; }
        if (calledName === "cva") { cva(node, env); return; }
        const initial = initializer(node.expression);
        if (ts.isCallExpression(initial) && ts.isIdentifier(initial.expression) && initial.expression.text === "cva") {
          cva(initial, env);
          for (const arg of node.arguments) for (const property of properties(arg)) if (classProperty.test(nameOf(property.name) ?? "")) evaluate(property.initializer ?? property.name, env);
          return;
        }
        if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "join" && (node.arguments.length === 0 || node.arguments[0].text === " ")) { evaluate(node.expression.expression, env); return; }
        const declaration = declarationOf(node.expression);
        const func = declaration?.initializer ?? declaration;
        if (func && (ts.isFunctionDeclaration(func) || ts.isArrowFunction(func) || ts.isFunctionExpression(func))) {
          const next = new Map(env);
          func.parameters.forEach((param, i) => { if (node.arguments[i]) next.set(param, { node: node.arguments[i], env }); });
          returns(func, next); return;
        }
      }
      issue(unsupported, node, "class expression cannot be statically resolved");
    } finally { active.delete(node); }
  }
  function returns(func, env) {
    if (!func.body) { issue(unsupported, func, "class helper has no implementation"); return; }
    if (!ts.isBlock(func.body)) { evaluate(func.body, env); return; }
    function walk(node) {
      if (node !== func.body && ts.isFunctionLike(node)) return;
      if (ts.isReturnStatement(node)) { evaluate(node.expression, env); return; }
      ts.forEachChild(node, walk);
    }
    walk(func.body);
  }
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (source.parseDiagnostics.length) throw new Error(`${file}: TypeScript syntax error`);
    function walk(node) {
      if (ts.isJsxAttribute(node) && classProperty.test(node.name.text) && node.initializer) {
        sinks++; evaluate(ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer);
      } else if (ts.isPropertyAssignment(node) && classProperty.test(nameOf(node.name) ?? "")) {
        sinks++; evaluate(node.initializer);
      } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && classProperty.test(node.left.name.text)) {
        sinks++; evaluate(node.right);
      } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (classHelpers.has(node.expression.text) || node.expression.text === "cva")) {
        sinks++; evaluate(node);
      }
      ts.forEachChild(node, walk);
    }
    walk(source);
  }
  return { classes, files: program.getSourceFiles().map(source => source.fileName).sort(), selectedFiles: files, sinks, unsupported: [...unsupported.values()], externalInputs: [...externalInputs.values()] };
}

export function checkClasses(classes, rules) {
  return [...classes].filter(([name]) => !rules.has(name)).map(([name, occurrences]) => ({ class: name, occurrences })).sort((a, b) => a.class.localeCompare(b.class));
}

const usage = `Usage: node scripts/check-rendered-class-rules.mjs [--source PATH]... [--html PATH]... [--css PATH]... [--source-head SHA] [--render-manifest JSON]
Defaults: source components, blocks, shell, frames, runtime, studio; CSS styles/compiled.css.
Explicit --source or --html replaces the default source selection. HTML inputs must be actual rendered markup.
HTML requires a machine-collected render manifest: {version:1,sourceHead:<current Git HEAD>,files:[{path,sha256}]}.
Manifest paths are relative to the manifest; every HTML/CSS input must be inventoried and hash-matched. All inventoried HTML must be selected.
Source mode reports caller className inputs as unverified and fails until concrete markup is supplied in a separate HTML gate.
CSS inputs must be shipped, compiled stylesheets; imported or unparsed CSS fails closed.
Exit 0 = measured classes covered, 1 = missing rules/unsupported source, 2 = invalid input/could not run.
JSON reports exact inputs, selector evidence, missing classes, and source coverage limitations. No files are written.
`;

export function main(argv = process.argv.slice(2)) {
  try {
    const sources = [], html = [], css = [];
    let expectedHead, renderManifest;
    for (let i = 0; i < argv.length; i++) {
      const flag = argv[i];
      if (flag === "--help") { console.log(usage); return 0; }
      if (flag === "--strict-external") continue;
      if (flag === "--render-manifest") {
        if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error("--render-manifest requires a JSON file");
        renderManifest = resolve(argv[++i]);
        continue;
      }
      if (flag === "--source-head") {
        expectedHead = argv[++i];
        if (!/^[0-9a-f]{40}$/.test(expectedHead ?? "")) throw new Error("--source-head requires a full lowercase Git SHA");
        continue;
      }
      const target = { "--source": sources, "--html": html, "--css": css }[flag];
      if (!target || !argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`Invalid argument ${flag}; use --help`);
      target.push(resolve(argv[++i]));
    }
    if (!sources.length && !html.length) sources.push(...sourceDirs.map(dir => resolve(packageRoot, "src", dir)).filter(existsSync));
    if (!css.length) css.push(resolve(packageRoot, "styles/compiled.css"));
    const sourceHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: packageRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    if (expectedHead && expectedHead !== sourceHead) throw new Error(`Source head mismatch: expected ${expectedHead}, found ${sourceHead}`);
    if (html.length) {
      if (!renderManifest) throw new Error("HTML mode requires --render-manifest from the native render capture");
      const manifest = JSON.parse(readFileSync(renderManifest, "utf8"));
      if (manifest.version !== 1 || manifest.sourceHead !== sourceHead) throw new Error("Render manifest version or sourceHead does not match current repository HEAD");
      if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error("Render manifest requires a nonempty file inventory");
      const inventory = new Map();
      for (const entry of manifest.files) {
        if (!entry || typeof entry.path !== "string" || !entry.path || isAbsolute(entry.path) || !/^[0-9a-f]{64}$/.test(entry.sha256 ?? "")) throw new Error("Render manifest file requires a relative path and SHA-256");
        const file = resolve(dirname(renderManifest), entry.path);
        if (inventory.has(file)) throw new Error("Render manifest contains a duplicate file");
        if (createHash("sha256").update(readFileSync(file)).digest("hex") !== entry.sha256) throw new Error(`Render manifest hash mismatch: ${entry.path}`);
        inventory.set(file, entry.sha256);
      }
      const rendered = [...inventory.keys()].filter(file => /\.html?$/i.test(file));
      if (!rendered.length || rendered.some(file => !html.includes(file))) throw new Error("Render manifest requires a nonempty, fully selected HTML inventory");
      for (const file of [...html, ...css]) if (!inventory.has(file)) throw new Error(`Render input absent from manifest: ${file}`);
    } else if (renderManifest) throw new Error("--render-manifest requires --html inputs");
    const rules = new Map();
    for (const file of css) for (const [token, evidence] of cssClassRules(readFileSync(file, "utf8"), file)) rules.set(token, [...(rules.get(token) ?? []), ...evidence]);
    if (!rules.size) throw new Error("CSS selection contains no declaration-bearing class selectors");
    const source = sources.length ? sourceClasses(sources) : { classes: new Map(), files: [], sinks: 0, unsupported: [], externalInputs: [] };
    const classes = new Map(source.classes);
    for (const file of html) for (const [token, occurrences] of htmlClasses(readFileSync(file, "utf8"), file)) classes.set(token, [...(classes.get(token) ?? []), ...occurrences]);
    if (!classes.size) throw new Error("No classes measured; refusing an empty pass");
    const missing = checkClasses(classes, rules);
    const failed = Boolean(missing.length || source.unsupported.length || source.externalInputs.length);
    const inputHashes = [...new Set([...source.files, ...html, ...css, ...(renderManifest ? [renderManifest] : [])])].sort().map(file => ({ file, sha256: createHash("sha256").update(readFileSync(file)).digest("hex") }));
    console.log(JSON.stringify({
      gate: "rendered-class-rules", sourceHead, inputHashes,
      scope: { sourceFiles: source.files, htmlFiles: html, cssFiles: css, ...(renderManifest ? { renderManifest } : {}) },
      counts: { checked: classes.size, missing: missing.length, unsupported: source.unsupported.length, unverified: source.externalInputs.length },
      violations: [...missing.map(row => ({ kind: "missing-rule", ...row })), ...source.unsupported.map(row => ({ kind: "unsupported-source", ...row }))],
      ok: !failed, mode: sources.length ? (html.length ? "source+html" : "source") : "html",
      status: failed ? "findings" : "covered", measurement: "positive selector participation in declaration-bearing shipped CSS rules",
      cssFiles: css, sourceFiles: source.files, htmlFiles: html, classCount: classes.size, classSinkCount: source.sinks,
      checkedClasses: classes.size, missing, unsupported: source.unsupported, coverageUnverified: source.externalInputs, externalInputs: source.externalInputs, strictExternal: true,
      covered: [...classes.keys()].filter(token => rules.has(token)).sort().map(token => ({ class: token, evidence: rules.get(token) })),
      limitations: ["Source mode enumerates statically resolvable package classes; caller class inputs are listed separately.", "HTML mode measures only supplied rendered states.", "Selector participation does not prove selector matching, cascade, computed styles, or visual parity."],
    }, null, 2));
    return failed ? 1 : 0;
  } catch (error) {
    console.log(JSON.stringify({ gate: "rendered-class-rules", ok: false, status: "invalid-input", counts: { checked: 0, missing: 0, unsupported: 1, unverified: 1 }, violations: [{ kind: "invalid-input", reason: error.message }], coverageUnverified: [{ reason: "Gate could not complete" }] }, null, 2));
    console.error(`class-rule-check: ${error.message}`);
    return 2;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = main();
