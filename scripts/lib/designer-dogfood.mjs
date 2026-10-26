import ts from "typescript";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";

const controls = new Set(["button", "input", "select", "textarea", "details", "summary", "dialog", "a"]);
const color = /#[\da-f]{3,8}\b|\brgba?\s*\(/i;
const sourceExtensions = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".css"];
const source = file => sourceExtensions.includes(extname(file)) && !/\.(?:test|spec|check)\.[cm]?[jt]sx?$/.test(file);
const inside = (root, file) => { const path = relative(root, file); return !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const acceptedFoundation = JSON.parse(readFileSync(new URL("./designer-foundation.json", import.meta.url), "utf8"));

/** Resolve real source files only. A missing import is evidence, never an empty module. */
function localFile(file, specifier) {
  const path = resolve(dirname(file), specifier);
  const base = path.replace(/\.[cm]?jsx?$/, "");
  for (const candidate of [path, ...sourceExtensions.map(extension => base + extension), ...sourceExtensions.map(extension => resolve(path, "index" + extension))]) {
    try { if (statSync(candidate).isFile()) return realpathSync(candidate); } catch { /* next exact source candidate */ }
  }
  throw new Error(`unresolved local import ${specifier}`);
}
function filesBelow(root) {
  if (statSync(root).isFile()) return source(root) ? [realpathSync(root)] : [];
  return readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    if (["node_modules", "dist", ".git", "__fixtures__"].includes(entry.name)) return [];
    const path = resolve(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`symlink in consumer scope: ${path}`);
    return entry.isDirectory() ? filesBelow(path) : source(path) ? [realpathSync(path)] : [];
  });
}

/** Foundation boundaries must have a public barrel export AND an authored component slot.
 * A helper moved beside a component gains no ownership. No caller-supplied exemptions exist.
 */
export function foundationComponents(designerRoot, receipt = acceptedFoundation) {
  const root = realpathSync(designerRoot), components = resolve(root, "src/components");
  const authenticate = file => {
    const name = relative(root, file).split(sep).join("/");
    if (!receipt.files[name] || hash(readFileSync(file)) !== receipt.files[name]) throw new Error(`foundation source identity differs: ${name}`);
  };
  const barrelPath = resolve(components, "index.ts"), barrel = readFileSync(barrelPath, "utf8");
  const slotsPath = resolve(root, "src/catalog/slots/components.json"), slotsBytes = readFileSync(slotsPath, "utf8");
  const slots = JSON.parse(slotsBytes);
  const aliasesPath = resolve(root, "src/catalog/aliases/components.json");
  const aliasesBytes = readFileSync(aliasesPath, "utf8");
  for (const file of [barrelPath, slotsPath, aliasesPath]) authenticate(file);
  const packageName = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).name;
  const names = new Set(), provenance = new Map();
  // Ownership comes from the accepted authored fill and its explicit implementation/
  // secondary bindings, in addition to the accepted barrel and implementation closure.
  // A new export or a component-shaped filename cannot grant itself authority.
  for (const name of Object.keys(receipt.files).filter(name => /^src\/catalog\/fills\/foundry\/components\.[^/]+\.json$/.test(name)).sort()) {
    const path = resolve(root, name); authenticate(path);
    const fill = JSON.parse(readFileSync(path, "utf8")), meta = fill.$extensions?.["com.clossys.fill"];
    if (!meta || meta.source !== "foundry" || meta.author !== "foundry" || !slots.some(slot => slot.id === meta.slot) || meta.mode !== "implementation") continue;
    for (const implementation of Object.values(fill.components ?? {})) {
      if (implementation.impl?.kind !== "package" || implementation.impl.module !== packageName + "/components" || implementation.pin?.package !== packageName || meta.pin?.package !== packageName) continue;
      const exports = [implementation.impl.export];
      for (const address of Object.values(implementation.propMap ?? {})) {
        const match = typeof address === "string" && /^\.\/components#([A-Za-z_$][\w$]*)(?:[.([=]|$)/.exec(address);
        if (match) exports.push(match[1]);
      }
      for (const exported of exports) if (typeof exported === "string" && /^[A-Za-z_$][\w$]*$/.test(exported)) {
        names.add(exported); provenance.set(exported, { slot: meta.slot, fill: meta.id, fillSha256: receipt.files[name], implementation: implementation.impl });
      }
    }
  }
  const ast = ts.createSourceFile(barrelPath, barrel, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const boundaries = new Map();
  for (const statement of ast.statements) {
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
    const exported = statement.exportClause.elements.filter(element => !element.isTypeOnly && names.has(element.name.text));
    if (!exported.length) continue;
    const file = localFile(barrelPath, statement.moduleSpecifier.text);
    if (!inside(components, file)) throw new Error("component export leaves its ownership boundary");
    const visited = new Set();
    const closure = dependency => {
      if (visited.has(dependency)) return;
      visited.add(dependency); authenticate(dependency);
      const parsed = ts.createSourceFile(dependency, readFileSync(dependency, "utf8"), ts.ScriptTarget.Latest, true, /x$/.test(dependency) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      for (const node of parsed.statements) if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && !node.isTypeOnly && !node.importClause?.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith(".")) closure(localFile(dependency, node.moduleSpecifier.text));
    };
    closure(file);
    boundaries.set(file, { file, exports: exported.map(element => element.name.text).sort(), provenance: exported.map(element => provenance.get(element.name.text)), sha256: hash(readFileSync(file)), barrelSha256: hash(barrel), slotsSha256: hash(slotsBytes), aliasesSha256: hash(aliasesBytes) });
  }
  return boundaries;
}

const moduleCache = new Map();
function moduleAst(file) {
  const text = readFileSync(file, "utf8"), digest = hash(text), previous = moduleCache.get(file);
  if (previous?.digest === digest) return previous.ast;
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  moduleCache.set(file, { digest, ast }); return ast;
}
function exportedExpression(file, name, trail = new Set()) {
  const identity = file + "#" + name;
  if (trail.has(identity)) return undefined;
  trail = new Set([...trail, identity]);
  const ast = moduleAst(file), local = new Map();
  const collect = node => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) local.set(node.name.text, node.initializer); ts.forEachChild(node, collect); };
  collect(ast);
  const unalias = (node, names = new Set()) => {
    if (node && ts.isIdentifier(node) && local.has(node.text) && !names.has(node.text)) return unalias(local.get(node.text), new Set([...names, node.text]));
    return node;
  };
  for (const statement of ast.statements) {
    if (ts.isVariableStatement(statement) && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) for (const row of statement.declarationList.declarations) if (ts.isIdentifier(row.name) && row.name.text === name) return unalias(row.initializer);
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.exportClause && ts.isNamedExports(statement.exportClause)) for (const row of statement.exportClause.elements) if (!row.isTypeOnly && row.name.text === name) {
      const original = (row.propertyName ?? row.name).text;
      if (!statement.moduleSpecifier) return unalias(local.get(original));
      if (ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text.startsWith(".")) return exportedExpression(localFile(file, statement.moduleSpecifier.text), original, trail);
    }
  }
  return undefined;
}
/** Strict source gate. All files and reachable local helpers are inspected once. */
export function scanDesignerDogfood({ roots, designerRoot, foundationReceipt = acceptedFoundation }) {
  const findings = [], inventory = [], seen = new Set();
  let boundaries;
  try { boundaries = foundationComponents(designerRoot, foundationReceipt); }
  catch (error) { return { schema: "designer-dogfood/v1", ok: false, findings: [{ code: "DG0", file: resolve(designerRoot), line: 1, message: error.message }], inventory, foundation: [] }; }
  const packageName = JSON.parse(readFileSync(resolve(designerRoot, "package.json"), "utf8")).name;
  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file);
    let text;
    const add = (code, node, message) => findings.push({ code, file, line: node ? ts.getLineAndCharacterOfPosition(ast, node.getStart(ast)).line + 1 : 1, message });
    let ast;
    try { text = readFileSync(file, "utf8"); } catch (error) { findings.push({ code: "DG0", file, line: 1, message: error.message }); return; }
    inventory.push({ file, sha256: hash(text) });
    const foundationName = relative(designerRoot, file).split(sep).join("/");
    if (["src/tokens/tokens.ts", "src/tokens/guidance.ts"].includes(foundationName)) {
      if (hash(text) !== foundationReceipt.files[foundationName]) findings.push({ code: "DG0", file, line: 1, message: "registered token definition identity differs" });
      return;
    }
    if (extname(file) === ".json") {
      try { JSON.parse(text); const name = relative(designerRoot, file).split(sep).join("/"); if (hash(text) !== foundationReceipt.files[name]) throw new Error("unregistered data source identity"); }
      catch (error) { findings.push({ code: "DG0", file, line: 1, message: error.message }); }
      return;
    }
    if (extname(file) === ".css") {
      const clean = text.replace(/\/\*[\s\S]*?\*\//g, "");
      for (const match of clean.matchAll(/(?:^|[;{])\s*[\w-]+\s*:\s*([^;}]+)/g)) if (color.test(match[1])) findings.push({ code: "DG3", file, line: clean.slice(0, match.index).split("\n").length, message: "raw CSS color" });
      for (const statement of clean.matchAll(/@import\s+([^;]+)(?:;|$)/g)) {
        const match = /^(?:url\(\s*)?["']([^"']+)["']/.exec(statement[1].trim());
        try { if (!match) throw new Error("unresolved CSS import scope"); if (/^(?:https?:|data:|\/\/)/.test(match[1])) throw new Error("unqualified external CSS import"); visit(localFile(file, match[1].startsWith(".") ? match[1] : "./" + match[1])); } catch (error) { findings.push({ code: "DG0", file, line: 1, message: error.message }); }
      }
      return;
    }
    ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    for (const diagnostic of ast.parseDiagnostics) add("DG0", undefined, ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
    const lexical = new Map(), imports = new Map(), importedBindings = new Map(), namespaces = new Map(), elementFactories = new Set(["createElement"]);
    const importModule = (specifier, node) => {
      if (specifier === "react-aria-components" || specifier.startsWith("react-aria-components/")) { add("DG1", node, "raw React Aria import"); return; }
      if (specifier.startsWith(".")) { try { const target = localFile(file, specifier); if (!boundaries.has(target)) visit(target); } catch (error) { add("DG0", node, error.message); } return; }
      if (specifier.startsWith(packageName + "/")) {
        const subpath = specifier.slice(packageName.length + 1);
        try {
          const packageJson = JSON.parse(readFileSync(resolve(designerRoot, "package.json"), "utf8"));
          const entry = packageJson.exports["./" + subpath];
          const compiled = typeof entry === "string" ? entry : entry?.import;
          if (typeof compiled !== "string" || !compiled.startsWith("./dist/")) throw new Error(`unregistered foundation export ${specifier}`);
          const target = localFile(resolve(designerRoot, "src/_entry.ts"), "./" + compiled.slice("./dist/".length));
          const name = relative(designerRoot, target).split(sep).join("/");
          if (hash(readFileSync(target)) !== foundationReceipt.files[name]) throw new Error(`foundation export identity differs: ${specifier}`);
          if (!boundaries.has(target)) visit(target);
        } catch (error) { add("DG0", node, error.message); }
        return;
      }
      if (!["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client", "react-dom/server"].includes(specifier) && !specifier.startsWith("node:")) add("DG0", node, `unqualified external import ${specifier}`);
    };
    const scopeOf = node => {
      for (let parent = node.parent; parent; parent = parent.parent) if (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isFunctionLike(parent) || ts.isForStatement(parent) || ts.isForOfStatement(parent) || ts.isForInStatement(parent)) return parent;
      return ast;
    };
    const bind = (node, name, value) => {
      const scope = scopeOf(node), values = lexical.get(scope) ?? new Map();
      if (values.has(name)) values.set(name, { ambiguous: true }); else values.set(name, value);
      lexical.set(scope, values);
    };
    const bindingAt = node => {
      for (let parent = node.parent; parent; parent = parent.parent) {
        const found = lexical.get(parent)?.get(node.text);
        if (found) return found;
      }
      return undefined;
    };
    const gather = node => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) bind(node, node.name.text, { initializer: node.initializer });
      if (ts.isParameter(node) && ts.isIdentifier(node.name)) bind(node, node.name.text, { parameter: true });
      if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) for (const binding of node.name.elements) if (ts.isIdentifier(binding.name) && !binding.dotDotDotToken) bind(node, binding.name.text, { object: node.initializer, key: (binding.propertyName ?? binding.name).text });
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && !node.importClause?.isTypeOnly) {
        const specifier = node.moduleSpecifier.text;
        importModule(specifier, node);
        const clause = node.importClause;
        if (specifier.startsWith(".") && clause?.namedBindings) try {
          const target = localFile(file, specifier);
          if (ts.isNamespaceImport(clause.namedBindings)) namespaces.set(clause.namedBindings.name.text, target);
          else for (const binding of clause.namedBindings.elements) if (!binding.isTypeOnly) importedBindings.set(binding.name.text, { target, name: (binding.propertyName ?? binding.name).text });
        } catch { /* importModule already reports the unresolved edge */ }
        if (clause?.name) imports.set(clause.name.text, specifier);
        if (clause?.namedBindings) for (const binding of ts.isNamespaceImport(clause.namedBindings) ? [clause.namedBindings] : clause.namedBindings.elements.filter(element => !element.isTypeOnly)) imports.set(binding.name.text, specifier);
        if (specifier === "react" && clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const binding of clause.namedBindings.elements) if ((binding.propertyName ?? binding.name).text === "createElement") elementFactories.add(binding.name.text);
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) importModule(node.moduleSpecifier.text, node);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require") && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) importModule(node.arguments[0].text, node);
      ts.forEachChild(node, gather);
    };
    gather(ast);
    const unwrap = (node, trail = new Set()) => {
      if (!node) return node;
      if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) return unwrap(node.expression, trail);
      if (ts.isIdentifier(node) && !trail.has(node.text)) {
        const binding = bindingAt(node);
        if (binding) {
          if (binding.initializer) return unwrap(binding.initializer, new Set([...trail, node.text]));
          if (binding.object) {
            const object = unwrap(binding.object, new Set([...trail, node.text]));
            if (ts.isObjectLiteralExpression(object)) {
              const found = object.properties.find(property => property.name && !ts.isComputedPropertyName(property.name) && property.name.text === binding.key);
              if (found && ts.isPropertyAssignment(found)) return unwrap(found.initializer, new Set([...trail, node.text]));
            }
          }
          return node;
        }
      }
      if (ts.isIdentifier(node) && !trail.has(node.text)) {
        if (importedBindings.has(node.text)) {
          const binding = importedBindings.get(node.text), expression = exportedExpression(binding.target, binding.name);
          if (expression) return unwrap(expression, new Set([...trail, node.text]));
        }

      }
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const object = unwrap(node.expression, trail);
        if (ts.isIdentifier(node.expression) && namespaces.has(node.expression.text)) {
          const name = ts.isPropertyAccessExpression(node) ? node.name.text : ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : undefined;
          if (name) { const expression = exportedExpression(namespaces.get(node.expression.text), name); if (expression) return unwrap(expression, trail); }
        }
        const key = ts.isPropertyAccessExpression(node) ? node.name.text : ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : undefined;
        if (key && ts.isObjectLiteralExpression(object)) {
          const property = object.properties.find(property => property.name && !ts.isComputedPropertyName(property.name) && property.name.text === key);
          if (property && ts.isPropertyAssignment(property)) return unwrap(property.initializer, trail);
        }
      }
      return node;
    };
    const property = node => node && ts.isPropertyAccessExpression(node) ? node.name.text : node && ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : undefined;
    const styleTarget = expression => {
      const node = unwrap(expression);
      if (property(node) === "style") return true;
      return !!node && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && styleTarget(node.expression);
    };
    const spread = (expression, trail = new Set()) => {
      const node = unwrap(expression);
      if (!node || trail.has(node)) return false;
      if (ts.isConditionalExpression(node)) return spread(node.whenTrue, new Set(trail)) && spread(node.whenFalse, new Set(trail));
      if (!ts.isObjectLiteralExpression(node)) return false;
      trail.add(node);
      return node.properties.every(property => {
        if (ts.isSpreadAssignment(property)) return spread(property.expression, trail);
        if (!property.name || ts.isComputedPropertyName(property.name)) return false;
        if (property.name.getText(ast).replace(/["']/g, "") === "style") return false;
        return true;
      });
    };
    const controlTag = node => {
      if (ts.isIdentifier(node) && controls.has(node.text)) return true;
      const resolved = unwrap(node);
      if (ts.isStringLiteralLike(resolved)) return controls.has(resolved.text);
      if (ts.isIdentifier(resolved)) return controls.has(resolved.text);
      return false;
    };
    const inspect = node => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        if (controlTag(node.tagName)) add("DG2", node, "raw interactive element");
        const paint = unwrap(node.tagName), paintName = ts.isStringLiteralLike(paint) ? paint.text : node.tagName.getText(ast);
        if (["svg", "path", "circle", "rect", "polygon", "polyline", "ellipse", "line"].includes(paintName)) add("DG6", node, "unregistered SVG paint must use an owned asset or diagram mechanism");
        for (const attribute of node.attributes.properties) {
          if (ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === "style") add("DG4", attribute, "inline style bypasses Foundry ownership");
          if (ts.isJsxAttribute(attribute) && ["dangerouslySetInnerHTML", "srcDoc"].includes(attribute.name.getText(ast))) add("DG0", attribute, "unqualified raw markup source");
          if (ts.isJsxSpreadAttribute(attribute) && !spread(attribute.expression)) add("DG4", attribute, "unresolved JSX spread may supply inline styling");
        }
      }
      if (ts.isCallExpression(node)) {
        const resolvedCallee = unwrap(node.expression), callee = resolvedCallee.getText(resolvedCallee.getSourceFile()), factory = elementFactories.has(callee) || /\.createElement$/.test(callee);
        if (factory && node.arguments[0] && controlTag(node.arguments[0])) add("DG2", node, "raw interactive createElement");
        if (callee === "require" && node.arguments.some(arg => ts.isStringLiteral(arg) && arg.text === "react-aria-components")) add("DG1", node, "raw React Aria require");
        if ((node.expression.kind === ts.SyntaxKind.ImportKeyword || callee === "require") && (!node.arguments[0] || !ts.isStringLiteral(node.arguments[0]))) add("DG0", node, "unresolved dynamic import scope");
        if (factory && node.arguments[1] && node.arguments[1].kind !== ts.SyntaxKind.NullKeyword && !spread(node.arguments[1])) add("DG4", node, "unresolved createElement props may supply inline styling");
        if ((/\.style\.(?:setProperty|removeProperty)$/.test(callee)) || (callee === "Object.assign" && node.arguments[0] && /\.style$/.test(unwrap(node.arguments[0]).getText(ast)))) add("DG4", node, "imperative inline styling call");
        if ((ts.isPropertyAccessExpression(unwrap(node.expression)) || ts.isElementAccessExpression(unwrap(node.expression))) && styleTarget(unwrap(node.expression).expression) && !/\.style\.(?:setProperty|removeProperty)$/.test(callee)) add("DG4", node, "aliased imperative inline styling call");
        if (property(unwrap(node.expression)) === "setAttribute" && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text === "style") add("DG4", node, "inline style attribute mutation");
      }
      const literal = ts.isStringLiteralLike(node) || [ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail].includes(node.kind);
      if (literal && color.test(node.text)) add("DG3", node, "raw color literal");
      if (literal && /\[[^\]]*(?:\d(?:px|rem|em|vh|vw|vmin|vmax)|#[\da-f]{3,8})[^\]]*\]/i.test(node.text)) add("DG5", node, "arbitrary class paint bypasses registered token binding");
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && styleTarget(node.left)) add("DG4", node, "imperative inline style bypasses Foundry ownership");
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ["innerHTML", "outerHTML"].includes(property(node.left))) add("DG0", node, "unqualified raw markup mutation");
      ts.forEachChild(node, inspect);
    };
    inspect(ast);
  };
  for (const root of [...roots].sort()) {
    try { const files = filesBelow(realpathSync(root)); if (!files.length) throw new Error("empty consumer source scope"); for (const file of files) visit(file); }
    catch (error) { findings.push({ code: "DG0", file: resolve(root), line: 1, message: error.message }); }
  }
  if (!roots.length) findings.push({ code: "DG0", file: "", line: 1, message: "no consumer source scope" });
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
  inventory.sort((a, b) => a.file.localeCompare(b.file));
  return { schema: "designer-dogfood/v1", ok: findings.length === 0, findings, inventory, foundation: [...boundaries.values()].sort((a, b) => a.file.localeCompare(b.file)) };
}
