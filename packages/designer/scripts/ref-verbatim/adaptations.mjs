/** Recorded, content-bound changes; a reason never excuses a failed hunk. */
import { createHash } from "node:crypto";
import { loadTypeScript } from "./typescript.mjs";
export const ADAPTATION_KINDS = Object.freeze(["import-paths", "token-mapping", "data-binding", "data-fit", "slot-bound-copy", "slot-bound-identity"]);
export const adaptationHash = (hunk, reference, candidate) => {
  const slice = (text, range) => {
    if (!range) return null;
    const lines = text.split(/\r?\n/);
    const offset = ({ line, column }) => lines.slice(0, line - 1).reduce((n, s) => n + s.length + 1, 0) + column - 1;
    return text.slice(offset(range.start), offset(range.end));
  };
  return `sha256:${createHash("sha256").update(JSON.stringify([hunk.rule, slice(reference, hunk.ref), slice(candidate, hunk.file), hunk.detail])).digest("hex")}`;
};
const RULES = {
  "import-paths": ["H-IMPORT"],
  "token-mapping": ["H-TOKEN"],
  "data-binding": ["H-DATA", "H-PROPS", "H-LINK"],
  "slot-bound-copy": ["H-DATA"],
  "slot-bound-identity": ["H-DATA"],
};
function sameImportBindings(reference, candidate) {
  const ts = loadTypeScript();
  const imports = text => {
    const source = ts.createSourceFile("imports.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    return source.statements.filter(ts.isImportDeclaration).map(node => [
      node.importClause?.getText(source).replace(/\s+/g, " ") ?? "<side-effect>",
      node.attributes?.getText(source) ?? "",
    ].join("|")).sort().join("\n");
  };
  return imports(reference) === imports(candidate);
}
export function recordedHunk(hunk, file, reference, candidate, adaptations) {
  const hash = adaptationHash(hunk, reference, candidate);
  return adaptations.some(a => a.file === file && a.hash === hash && a.reason?.trim() && RULES[a.kind]?.includes(hunk.rule) && (a.kind !== "import-paths" || sameImportBindings(reference, candidate)));
}

/** Only the stock single-option menu can collapse to its existing trigger body.
 * No replacement JSX or classes are supplied by the adaptation record.
 */
export function staticSingleOptionRow(text, fileName, adaptation) {
  if (adaptation.operation !== "single-option-static-row" || adaptation.optionCount !== 1 || !adaptation.reason?.trim()) throw new Error("data-fit requires single-option-static-row, optionCount: 1 and a reason");
  const ts = loadTypeScript();
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const tag = node => ts.isJsxElement(node) ? node.openingElement.tagName.getText(source) : undefined;
  const elements = [];
  const walk = node => { if (tag(node) === "DropdownMenu") elements.push(node); ts.forEachChild(node, walk); };
  walk(source);
  const menu = elements.find(node => node.getStart(source) === text.indexOf(adaptation.menu));
  if (!menu || menu.getText(source) !== adaptation.menu) throw new Error("data-fit menu must name one exact stock DropdownMenu subtree");
  const children = menu.children.filter(node => ts.isJsxElement(node));
  const trigger = children.find(node => tag(node) === "DropdownMenuTrigger");
  const content = children.find(node => tag(node) === "DropdownMenuContent");
  if (children.length !== 2 || !trigger || !content) throw new Error("data-fit requires one trigger and one content subtree");
  const items = [];
  const visit = node => {
    if (tag(node) === "DropdownMenuItem") items.push(node);
    if (ts.isJsxExpression(node) && node.expression) throw new Error("data-fit refuses dynamic menu options");
    ts.forEachChild(node, visit);
  };
  visit(content);
  if (items.length !== 1) throw new Error("data-fit refuses a menu without exactly one static option");
  const asChild = trigger.openingElement.attributes.properties;
  if (asChild.length !== 1 || !ts.isJsxAttribute(asChild[0]) || asChild[0].name.getText(source) !== "asChild" || asChild[0].initializer) throw new Error("data-fit requires the stock asChild trigger");
  const body = trigger.children.filter(node => !ts.isJsxText(node) || node.text.trim());
  if (body.length !== 1 || !(ts.isJsxElement(body[0]) || ts.isJsxSelfClosingElement(body[0]))) throw new Error("data-fit requires a single existing trigger body");
  // Retain the entire trigger body verbatim: no class, event or copy rewrite.
  return text.slice(0, menu.getStart(source)) + body[0].getText(source) + text.slice(menu.getEnd());
}
