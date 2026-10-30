import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { marketingComponentSelection, MarketingComponentProvider } from "./marketing-component-selection.js";
import { SelectedComponentLeaf } from "../runtime/component-leaf.client.js";
import { componentSecondaryExports } from "../catalog-core/component-secondary-exports.js";
import { verifyComponentOutput } from "../catalog-core/resolve-components.js";

describe("native marketing component selection", () => {
  it("resolves actual pinned source descriptors and proves concrete local exported functions", () => {
    const selection = marketingComponentSelection(), profile = selection.profile.components;
    for (const leaf of ["components.button", "components.card", "components.tabs"]) {
      const selected = profile.components[leaf]!;
      expect(selected.origin).toMatchObject({ kind: "adopted", source: "shadcn@aria" });
      expect(selected.impl.kind).toBe("source");
      verifyComponentOutput(selected.descriptor, profile.files);
      const entry = selected.impl.kind === "source" ? selected.impl.entry : "";
      const source = profile.files.find(file => file.path === entry)!;
      const ast = ts.createSourceFile(entry, source.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const functions = new Set(ast.statements.filter(ts.isFunctionDeclaration).flatMap(node => node.name ? [node.name.text] : []));
      const exports = new Set(ast.statements.filter(ts.isExportDeclaration).flatMap(node => node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements.map(item => item.name.text) : []));
      for (const part of componentSecondaryExports(selected.descriptor, profile.files)) { expect(functions.has(part.export)).toBe(true); expect(exports.has(part.export)).toBe(true); }
    }
  });
  it("renders the actual native Card and LinkButton and preserves keyboard navigation", async () => {
    const user = userEvent.setup();
    render(<MarketingComponentProvider><SelectedComponentLeaf leaf="components.card" parts={[]} componentProps={{ children: <SelectedComponentLeaf leaf="components.button" parts={["LinkButton"]} componentProps={{ href: "#native-detail", variant: "outline", size: "default", children: "Native action" }} /> }} /></MarketingComponentProvider>);
    const link = screen.getByRole("link", { name: "Native action" });
    expect(link).toHaveAttribute("data-slot", "button"); expect(link).toHaveAttribute("data-variant", "outline"); expect(link).toHaveAttribute("data-size", "default");
    expect(link.closest('[data-slot="card"]')).not.toBeNull();
    await user.tab(); expect(link).toHaveFocus();
  });
  it("rejects unapproved exports and modified source bytes instead of inventing parts", () => {
    const profile = marketingComponentSelection().profile.components, button = profile.components["components.button"]!;
    expect(() => componentSecondaryExports({ ...button.descriptor, secondaryExports: [{ name: "Invented", export: "Invented" }] }, profile.files)).toThrow(/secondary/);
    const entry = button.impl.kind === "source" ? button.impl.entry : "";
    const changed = profile.files.map(file => file.path === entry ? { ...file, content: file.content + " " } : file);
    expect(() => verifyComponentOutput(button.descriptor, changed)).toThrow(/output/);
    expect(() => componentSecondaryExports(button.descriptor, changed)).toThrow(/secondary/);
  });
});
