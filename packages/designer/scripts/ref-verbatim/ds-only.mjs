/**
 * The ds-only scan, shared by the Studio ds-only test (producer) and the
 * ref-verbatim `composition` rule: one source file's module imports and its
 * raw styled markup, in source order. Callers decide which imports a layer
 * may take; the markup rule is the same everywhere:
 *
 * - a raw (lowercase) element carrying `className`, `style` or a spread is
 *   styled raw markup;
 * - in a frame only, the page landmarks (`header`, `main`, `aside`) are the
 *   block's shell and may carry its layout classes, and a raw element whose
 *   tag and literal `className` appear verbatim in the frame's reference
 *   blocks (`blockMarkup`, `"<tag> <className>"` pairs) is the block's own
 *   markup and passes its `className`.
 */
import { loadTypeScript } from "./typescript.mjs";

export const DS_COMPONENT_LAYER = "@clossys/designer-ui";
export const DS_FRAME_LANDMARKS = new Set(["header", "main", "aside"]);

/**
 * Ordered ds-only events of one source file:
 * - `{ type: "import", specifier, typeOnly, names }` per import or re-export
 *   declaration with a string module specifier (`names` are the imported
 *   binding names, `"*"` for a namespace or `export *`, `"default"` for a
 *   default import);
 * - `{ type: "dynamic", specifier }` per `import(...)` or `require(...)` call;
 * - `{ type: "markup", tag, attr }` per styled raw element attribute.
 */
export function dsOnlyEvents(text, fileName, { kind = "section", blockMarkup = new Set() } = {}) {
  const ts = loadTypeScript();
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const events = [];
  const classAttribute = (node) => node.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === "className");
  const importNames = (node) => {
    if (ts.isExportDeclaration(node)) {
      if (!node.exportClause) return ["*"];
      return ts.isNamedExports(node.exportClause) ? node.exportClause.elements.map((e) => (e.propertyName ?? e.name).text) : ["*"];
    }
    const clause = node.importClause;
    if (!clause) return [];
    const names = clause.name ? ["default"] : [];
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) names.push("*");
    else if (bindings) for (const e of bindings.elements) names.push((e.propertyName ?? e.name).text);
    return names;
  };
  const visit = (node) => {
    const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
    if (specifier !== undefined) {
      events.push({ type: "import", specifier, typeOnly: ts.isImportDeclaration(node) && !!node.importClause?.isTypeOnly, names: importNames(node) });
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      const [first] = node.arguments;
      events.push({ type: "dynamic", specifier: first && ts.isStringLiteralLike(first) ? first.text : first ? first.getText(source) : "" });
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const value = classAttribute(node)?.initializer;
      const block = kind === "frame" && !!value && ts.isStringLiteral(value) && blockMarkup.has(`${tag} ${value.text}`);
      if (/^[a-z]/.test(tag) && !(kind === "frame" && DS_FRAME_LANDMARKS.has(tag))) for (const attribute of node.attributes.properties) {
        if (block && ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "className") continue;
        const attr = ts.isJsxAttribute(attribute) ? attribute.name.getText(source) : "{...spread}";
        if (attr === "className" || attr === "style" || attr === "{...spread}") events.push({ type: "markup", tag, attr });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return events;
}
