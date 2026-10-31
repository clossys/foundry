/**
 * Reference normalizer for the ref-verbatim check, pinned to shadcn CLI 4.23.0.
 *
 * `shadcn add` rewrites a registry file before it lands in a consumer: it maps
 * the `@/registry/<style>/*` aliases to the consumer's components.json aliases
 * (transformImport), drops "use client" when rsc is false (transformRsc),
 * swaps `IconPlaceholder` for the configured icon library (transformIcons),
 * resolves the menu markers (transformMenu), turns `cn-font-heading` into
 * `font-heading` (transformFont) and strips the remaining `cn-*` marker classes
 * from className/classNames attributes, cva() and mergeProps() (transformCleanup).
 * This module replays exactly those rules on the reference, synchronously,
 * with the TypeScript compiler API, so a stock file added by the CLI
 * normalizes to the bytes-equivalent AST of the vendored reference.
 *
 * The CLI's prettier pass is not replayed: the diff compares ASTs, which
 * formatting cannot change.
 */
import { loadTypeScript } from "./typescript.mjs";

/** Icon libraries the CLI knows, by components.json `iconLibrary`. */
export const ICON_LIBRARIES = {
  lucide: { attribute: "lucide", module: "lucide-react" },
  tabler: { attribute: "tabler", module: "@tabler/icons-react" },
  phosphor: { attribute: "phosphor", module: "@phosphor-icons/react" },
  remixicon: { attribute: "remixicon", module: "@remixicon/react" },
};
const ICON_ATTRIBUTES = new Set(["lucide", "tabler", "hugeicons", "phosphor", "remixicon"]);
const MARKER = /\bcn-[a-z-]+\b/;

/** components.json → the normalizer config. */
export function configFromComponents(components) {
  return {
    style: components.style,
    rsc: components.rsc === true,
    iconLibrary: components.iconLibrary ?? "lucide",
    menuColor: components.menuColor ?? "default",
    aliases: components.aliases ?? {},
  };
}

/** transformImport's specifier rule (shadcn CLI 4.23.0, local registry files). */
export function mapImport(spec, aliases) {
  let t = spec;
  if (t === "#registry") t = "@/registry";
  else if (t.startsWith("#/")) t = t.replace(/^#\//, "@/");
  else if (t.startsWith("#registry/")) t = t.replace(/^#registry\//, "@/registry/");
  if (!t.startsWith("@/")) return t;
  if (t === "@/registry") return aliases.components;
  if (!t.startsWith("@/registry/")) {
    if (t === "@/lib/utils" && aliases.utils) return aliases.utils;
    if (aliases.ui && /^@\/components\/ui(?=\/|$)/.test(t)) return t.replace(/^@\/components\/ui/, aliases.ui);
    if (aliases.components && /^@\/components(?=\/|$)/.test(t)) return t.replace(/^@\/components/, aliases.components);
    if (aliases.hooks && /^@\/hooks(?=\/|$)/.test(t)) return t.replace(/^@\/hooks/, aliases.hooks);
    if (aliases.lib && /^@\/lib(?=\/|$)/.test(t)) return t.replace(/^@\/lib/, aliases.lib);
    const head = (aliases.components ?? "@").split("/")[0];
    return t.replace(/^@\//, `${head}/`);
  }
  if (/^@\/registry\/(.+)\/ui/.test(t)) return t.replace(/^@\/registry\/(.+)\/ui/, aliases.ui ?? `${aliases.components}/ui`);
  if (aliases.utils && /^@\/registry\/(.+)\/lib\/utils$/.test(t)) return aliases.utils;
  if (aliases.components && /^@\/registry\/(.+)\/components/.test(t)) return t.replace(/^@\/registry\/(.+)\/components/, aliases.components);
  if (aliases.lib && /^@\/registry\/(.+)\/lib/.test(t)) return t.replace(/^@\/registry\/(.+)\/lib/, aliases.lib);
  if (aliases.hooks && /^@\/registry\/(.+)\/hooks/.test(t)) return t.replace(/^@\/registry\/(.+)\/hooks/, aliases.hooks);
  return t.replace(/^@\/registry\/[^/]+/, aliases.components);
}

/** transformMenu + transformFont + transformCleanup on one class string. */
export function cleanClasses(value, config) {
  if (!MARKER.test(value)) return value;
  let out = value;
  if (config.menuColor === "inverted") out = out.replace(/\bcn-menu-target\b/g, "dark");
  out = out.replace(/\bcn-font-heading\b/g, "font-heading");
  return out
    .split(/\s+/)
    .filter((token) => token.length > 0 && !MARKER.test(token))
    .join(" ");
}

class NormalizeError extends Error {}

/**
 * Normalize one reference file. Returns the normalized source text.
 * Throws NormalizeError (code REF-NORMALIZE) on a parse or transform failure.
 */
export function normalizeReference(text, fileName, config) {
  const ts = loadTypeScript();
  const kind = /\.tsx$|\.jsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  if (sf.parseDiagnostics?.length) {
    const d = sf.parseDiagnostics[0];
    throw new NormalizeError(`${fileName}: parse error ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  }
  const edits = [];
  const replace = (node, value) => edits.push({ start: node.getStart(sf), end: node.getEnd(), text: value });
  const quote = (node) => (sf.text[node.getStart(sf)] === "'" ? "'" : '"');
  const library = ICON_LIBRARIES[config.iconLibrary];

  // rsc: false drops the "use client" directive.
  if (!config.rsc) {
    for (const statement of sf.statements) {
      if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
      if (statement.expression.text === "use client") edits.push({ start: statement.getFullStart(), end: statement.getEnd(), text: "" });
    }
  }

  // Imports: alias rewrite and the icon-placeholder import.
  const icons = new Set();
  let placeholderImport;
  let placeholderName;
  for (const statement of sf.statements) {
    const spec = (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier;
    if (!spec || !ts.isStringLiteral(spec)) continue;
    if (ts.isImportDeclaration(statement) && /(^|\/)icon-placeholder$/.test(spec.text)) {
      placeholderImport = statement;
      const named = statement.importClause?.namedBindings;
      const binding = named && ts.isNamedImports(named) ? named.elements.find((e) => (e.propertyName ?? e.name).text === "IconPlaceholder") : undefined;
      placeholderName = binding ? binding.name.text : "IconPlaceholder";
      continue;
    }
    const mapped = mapImport(spec.text, config.aliases);
    if (mapped !== spec.text) replace(spec, `${quote(spec)}${mapped}${quote(spec)}`);
  }

  const classAttr = (name) => name === "className" || name === "classNames";
  const cleanLiteral = (node) => {
    const value = node.text;
    const next = cleanClasses(value, config);
    if (next !== value) replace(node, ts.isNoSubstitutionTemplateLiteral(node) ? `\`${next}\`` : `"${next}"`);
    return next;
  };
  const cleanInside = (node) => {
    const visit = (n) => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) cleanLiteral(n);
      else ts.forEachChild(n, visit);
    };
    visit(node);
  };
  const calleeName = (call) => (ts.isIdentifier(call.expression) ? call.expression.text : undefined);

  const visit = (node) => {
    if (ts.isJsxAttribute(node) && classAttr(node.name.getText(sf))) {
      const init = node.initializer;
      if (init && ts.isStringLiteral(init)) {
        if (MARKER.test(init.text) && cleanClasses(init.text, config) === "") {
          edits.push({ start: node.getFullStart(), end: node.getEnd(), text: "" });
        } else cleanLiteral(init);
        return;
      }
      if (init && ts.isJsxExpression(init) && init.expression) cleanInside(init.expression);
      return;
    }
    if (ts.isCallExpression(node) && (calleeName(node) === "cva" || calleeName(node) === "mergeProps")) {
      for (const arg of node.arguments) cleanInside(arg);
      return;
    }
    if (placeholderImport && (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(sf) === placeholderName) {
      if (!library) throw new NormalizeError(`${fileName}: iconLibrary ${JSON.stringify(config.iconLibrary)} is not supported by the ref-verbatim normalizer`);
      const attr = node.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === library.attribute);
      const icon = attr?.initializer && ts.isStringLiteral(attr.initializer) ? attr.initializer.text : undefined;
      if (!icon) throw new NormalizeError(`${fileName}: IconPlaceholder at line ${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} has no ${library.attribute} icon`);
      icons.add(icon);
      replace(node.tagName, icon);
      if (ts.isJsxOpeningElement(node)) {
        const element = node.parent;
        replace(element.closingElement.tagName, icon);
      }
      for (const property of node.attributes.properties) {
        if (ts.isJsxAttribute(property) && ICON_ATTRIBUTES.has(property.name.getText(sf))) {
          edits.push({ start: property.getFullStart(), end: property.getEnd(), text: "" });
        } else visit(property);
      }
      if (ts.isJsxOpeningElement(node)) for (const child of node.parent.children) visit(child);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (placeholderImport) {
    const text = icons.size ? `import { ${[...icons].join(", ")} } from "${library.module}"` : "";
    edits.push({ start: placeholderImport.getStart(sf), end: placeholderImport.getEnd(), text });
  }

  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  let floor = Infinity;
  for (const edit of edits) {
    if (edit.end > floor) throw new NormalizeError(`${fileName}: overlapping normalizer edits at ${edit.start}`);
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    floor = edit.start;
  }
  return out;
}

export { NormalizeError };
