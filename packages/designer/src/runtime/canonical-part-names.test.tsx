import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import * as native from "../components/index.js";
import * as tableSource from "../components/preview-runtime/components/table/table.js";
import { defaultSourceModules } from "../components/preview-runtime/modules.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import { componentDescriptorHash } from "../catalog-core/resolve-components.js";
import { ConsumerComponentProvider, SelectedComponentLeaf, type ConsumerComponentSelection } from "./component-leaf.client.js";
import { fixtureConsumerComponents } from "../catalog-core/__fixtures__/surface-consumer-components.js";

function part(leaf: string, name: string | undefined, componentProps: Record<string, unknown>) {
  return createElement(SelectedComponentLeaf, { leaf, parts: name ? [name] : [], componentProps });
}
it("canonical part names resolve from the adopted shadcn source without compound aliases", () => {
  const selection = fixtureConsumerComponents();
  const table = selection.profile.components.components["components.table"]!;
  expect(table.origin).toMatchObject({ kind: "adopted", source: "shadcn@aria" });
  expect(table.impl).toEqual({ kind: "source", entry: "components/table/table.tsx", export: "Table" });
  expect(defaultSourceModules["components/table/table.tsx"]).toBe(tableSource);
  const row = (name: string | undefined, props: Record<string, unknown>) => part("components.table", name, props);
  const { container } = render(<ConsumerComponentProvider value={selection}>
    {row(undefined, { "aria-label": "Records", children: [
      row("TableHeader", { key: "header", children: row("TableHead", { id: "name", isRowHeader: true, children: "Name" }) }),
      row("TableBody", { key: "body", children: row("TableRow", { id: "record", children: row("TableCell", { children: "Record" }) }) }),
    ] })}
  </ConsumerComponentProvider>);
  const html = container.innerHTML;
  for (const name of ["table", "table-header", "table-head", "table-body", "table-row", "table-cell"]) expect(html).toContain(`data-slot="${name}"`);
  expect(html).toContain("Record");
  const fills = loadCatalogBundles().componentFills;
  for (const [slot, chosen] of Object.entries(selection.profile.components.components)) {
    if (chosen.origin.kind !== "adopted" || chosen.origin.source !== "shadcn@aria" || chosen.impl.kind !== "source") continue;
    expect(chosen.impl.kind).toBe("source");
    if (chosen.impl.kind !== "source") throw new Error("Expected selected source");
    const namespace = selection.modules[chosen.impl.entry]!;
    const canonical = fills.find(doc => doc.$extensions["com.clossys.fill"].id === `shadcn@aria/${slot}`)!;
    const descriptor = Object.values(canonical.components)[0]!;
    expect(chosen.descriptor.secondaryExports).toEqual(descriptor.secondaryExports);
    for (const secondary of descriptor.secondaryExports ?? []) {
      expect(namespace[secondary.export], `${slot}.${secondary.name}`).toBeDefined();
    }
  }
});

it.each([
  { item: "NavigationTreeItem", content: "NavigationTreeItemContent" },
  { item: "Item", content: "ItemContent" },
])("preserves actual Foundry NavigationTree parts and collection behavior ($item)", ({ item, content }) => {
  const selection = fixtureConsumerComponents();
  const tree = selection.profile.components.components["components.navigation-tree"]!;
  expect(tree.impl).toEqual({ kind: "package", module: "@clossys/designer/components", export: "NavigationTree" });
  if (tree.impl.kind !== "package") throw new Error("Expected selected package");
  expect(selection.modules[tree.impl.module]?.NavigationTreeItem).toBe(native.NavigationTreeItem);
  // The barrel also exports an unrelated Item; the selected root owns .Item.
  expect(selection.profile.components.packageExports[tree.impl.module]).toContain("Item");
  expect(selection.modules[tree.impl.module]?.Item).not.toBe(native.NavigationTree.Item);
  render(<ConsumerComponentProvider value={selection}>
    {part("components.navigation-tree", undefined, { "aria-label": "Navigation", children:
      part("components.navigation-tree", item, { id: "record", textValue: "Record", href: "/record", children:
        part("components.navigation-tree", content, { children: () => <native.Link>Record</native.Link> }) }) })}
  </ConsumerComponentProvider>);
  expect(screen.getByRole("treegrid", { name: "Navigation" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Record" })).toBeInTheDocument();
});

it("refuses uninspected package names and absent source parts without aliases or fallback", () => {
  const selection = fixtureConsumerComponents();
  const draw = (value: ConsumerComponentSelection, leaf: string, name: string) => () => renderToStaticMarkup(<ConsumerComponentProvider value={value}>{part(leaf, name, {})}</ConsumerComponentProvider>);
  const module = "@clossys/designer/components";
  const injected = { ...selection, modules: { ...selection.modules, [module]: { ...selection.modules[module], Invented: () => <span>Invented</span> } } };
  expect(draw(injected, "components.navigation-tree", "Invented")).toThrow(/NEED component selection/);
  expect(draw(selection, "components.table", "Header")).toThrow(/undeclared/);
  const profile = structuredClone(selection.profile);
  profile.components.packageExports[module] = profile.components.packageExports[module]!.filter(name => name !== "NavigationTreeItem");
  const uninspected = { ...selection, profile };
  expect(draw(uninspected, "components.navigation-tree", "NavigationTreeItem")).toThrow(/NEED component selection/);
  const table = selection.profile.components.components["components.table"]!;
  expect(selection.descriptors[table.slot]).toBe(componentDescriptorHash(table.descriptor));
});
