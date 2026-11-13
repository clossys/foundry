/**
 * Accessible-name contract for icon-only buttons (R2F-52 retarget of the
 * former `icon-button-contract.check.tsx`).
 *
 * Before: Foundry `IconButton` made `label: string` required and omitted
 * `aria-label`/`aria-labelledby`, so `tsc` refused an unnamed icon-only
 * control. After: `IconButton` is gone and icon-only controls are the stock
 * shadcn@aria `Button` with `size="icon*"` (or the button slot's
 * `shape="icon-only"`). The same guarantee is now held here:
 *
 *   1. Static: every JSX element in this package's source (and the
 *      producer/publisher sources that consume it) that sets `size="icon"`,
 *      `size="icon-*"` or `shape="icon-only"` carries an accessible name:
 *      `aria-label`, `aria-labelledby`, a visually hidden (`sr-only`) text
 *      child, or a props spread (the wrapper's caller names it, and is
 *      scanned in turn). A literal empty `aria-label` does not count.
 *   2. Rendered: the stock button at icon size exposes exactly the name it
 *      is given and ships no default name of its own.
 *
 * Mutation proof (by hand while authoring): deleting `aria-label={label}`
 * from `blocks/chat/Chat.tsx`'s icon button made assertion 1 fail naming
 * that file and line; reverted.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "../preview-runtime/components/button/button.js";

const here = dirname(fileURLToPath(import.meta.url));
const designerSrc = join(here, "..", "..");
const packagesRoot = join(designerSrc, "..", "..");
const roots = [
  designerSrc,
  join(packagesRoot, "producer", "src"),
  join(packagesRoot, "publisher", "src"),
];

/**
 * Stock upstream elements named by react-aria context rather than by an
 * attribute: the ComboBox trigger button is labelled by the ComboBox's own
 * label slot (RAC wires `aria-labelledby` through `ButtonContext`); the
 * combobox chip's `slot="remove"` button is named by RAC's Tag
 * (`useTag` removeButtonProps: `aria-label` "Remove" plus `aria-labelledby`
 * the tag row, delivered through `ButtonContext` slot `remove`).
 */
const CONTEXT_NAMED = new Set([
  "components/preview-runtime/components/combo-box/combobox.tsx:data-slot=combobox-trigger",
  "components/preview-runtime/components/combo-box/combobox.tsx:data-slot=combobox-chip-remove",
]);

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) tsxFiles(path, out);
    else if (entry.endsWith(".tsx") && !/\.(test|check|visual-pass\.test)\.tsx$/.test(entry)) out.push(path);
  }
  return out;
}

function literal(attr: ts.JsxAttribute): string | undefined {
  const init = attr.initializer;
  if (!init) return undefined;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression && ts.isStringLiteralLike(init.expression)) return init.expression.text;
  return undefined;
}

function hasSrOnlyChild(element: ts.JsxElement): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isJsxAttribute(node) && node.name.getText() === "className") {
      const value = literal(node);
      if (value && /(^|\s)sr-only(\s|$)/.test(value)) found = true;
    }
    ts.forEachChild(node, visit);
  };
  element.children.forEach(visit);
  return found;
}

interface Unnamed { readonly where: string }

function scan(file: string): Unnamed[] {
  const text = readFileSync(file, "utf8");
  if (!/size=(\{)?"icon|shape=(\{)?"icon-only"/.test(text)) return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const misses: Unnamed[] = [];
  const check = (opening: ts.JsxOpeningLikeElement, parent: ts.JsxElement | undefined) => {
    let iconOnly = false;
    let named = false;
    let slot: string | undefined;
    for (const prop of opening.attributes.properties) {
      if (ts.isJsxSpreadAttribute(prop)) { named = true; continue; }
      const name = prop.name.getText();
      const value = literal(prop);
      if (name === "size" && value?.startsWith("icon")) iconOnly = true;
      if (name === "shape" && value === "icon-only") iconOnly = true;
      if (name === "data-slot") slot = value;
      if ((name === "aria-label" || name === "aria-labelledby") && value !== "") named = true;
    }
    if (!iconOnly || named) return;
    if (parent && hasSrOnlyChild(parent)) return;
    const rel = relative(designerSrc, file);
    if (slot && CONTEXT_NAMED.has(`${rel}:data-slot=${slot}`)) return;
    const { line } = source.getLineAndCharacterOfPosition(opening.getStart());
    misses.push({ where: `${relative(packagesRoot, file)}:${line + 1}` });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node)) check(node.openingElement, node);
    else if (ts.isJsxSelfClosingElement(node)) check(node, undefined);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return misses;
}

describe("icon-only button accessible-name contract", () => {
  it("names every icon-size or icon-only button in source", () => {
    const files = roots.flatMap(root => tsxFiles(root));
    expect(files.length).toBeGreaterThan(100);
    const misses = files.flatMap(scan).map(miss => miss.where);
    expect(misses).toEqual([]);
  });

  it("scans the known icon-only call sites (guards against a vacuous pass)", () => {
    const chat = join(designerSrc, "blocks", "chat", "Chat.tsx");
    const text = readFileSync(chat, "utf8");
    expect(text).toMatch(/shape="icon-only" aria-label=\{label\}/);
    const stripped = text.replace(/ aria-label=\{label\}/, "");
    const tmp = ts.createSourceFile(chat, stripped, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let flagged = false;
    const visit = (node: ts.Node) => {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const attrs = node.attributes.properties;
        const iconOnly = attrs.some(a => ts.isJsxAttribute(a) && a.name.getText() === "shape" && literal(a) === "icon-only");
        const named = attrs.some(a => ts.isJsxSpreadAttribute(a) || (ts.isJsxAttribute(a) && /^aria-label/.test(a.name.getText())));
        if (iconOnly && !named) flagged = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(tmp);
    expect(flagged).toBe(true);
  });

  it("renders the stock icon button with exactly the given name and no default", () => {
    const { unmount } = render(
      <Button size="icon" variant="ghost" aria-label="Next slide">
        <svg aria-hidden="true" />
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Next slide" })).toBeTruthy();
    unmount();
    render(
      <Button size="icon" variant="ghost">
        <svg aria-hidden="true" />
      </Button>,
    );
    const unnamed = screen.getByRole("button");
    expect(unnamed.getAttribute("aria-label")).toBeNull();
    expect(unnamed.textContent).toBe("");
  });
});
