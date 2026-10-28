import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const files = [
  "../frames/AppFrame.tsx", "../frames/AppFrameBrandTheme.tsx", "../frames/FrameDock.tsx", "../shell/FrameSlots.tsx", "../blocks/PageBar.tsx", "../blocks/AppNavigation.tsx", "../blocks/CommandMenu.tsx",
  "../blocks/AccountMenu.tsx", "../blocks/Drawer.tsx", "../blocks/ResizablePane.tsx", "../blocks/Panel.tsx",
] as const;

function intrinsicTags(source: string): string[] {
  const file = ts.createSourceFile("composition.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const tags: string[] = [];
  function visit(node: ts.Node): void {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      (ts.isJsxNamespacedName(node.tagName) || ts.isIdentifier(node.tagName) && /^[a-z]/.test(node.tagName.text))) {
      tags.push(node.tagName.getText(file));
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return tags;
}

function assertComponentComposition(source: string): void {
  expect(intrinsicTags(source), "Frame compositions must use shared components for every element").toEqual([]);
}

describe("frame component composition", () => {
  for (const file of files) {
    it(`${file} contains zero raw intrinsic JSX tags`, () => {
      assertComponentComposition(readFileSync(new URL(file, import.meta.url), "utf8"));
    });
  }
  it("rejects a raw div mutation even without attributes or children", () => {
    const source = "const Content = () => <FrameRegion><Text>Content</Text></FrameRegion>;";
    assertComponentComposition(source);
    expect(() => assertComponentComposition(source.replace("<Text>Content</Text>", "<div />"))).toThrow();
  });
});
