import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { createElement, type ComponentProps } from "react";
import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "../atoms/Button.js";
import { describe, expect, it, vi } from "vitest";
import * as blocks from "./index.js";

const root = resolve(import.meta.dirname, "../..");
const materials = () => (blocks as any).APP_FRAME_MATERIALS ?? [];

describe("AppFrame Material registration", () => {
  it("forwards AppNavigation host header, footer and corner trigger from its real record", () => {
    const navigation = materials().find((entry: any) => entry.id === "app-navigation");
    const supplied = {
      tree: [{ id: "home", label: "Home", href: "#home" }], label: "Workspace destinations",
      header: createElement(Button, {}, "Find a command"), footer: createElement(Button, {}, "Host account"),
      trigger: createElement(Button, {}, "Host navigation toggle"),
    };
    const authored = Object.fromEntries(navigation.authoredInputs.filter((name: string) => name in supplied)
      .map((name: keyof typeof supplied) => [name, supplied[name]]));
    const view = render(createElement(blocks.AppNavigation, authored as ComponentProps<typeof blocks.AppNavigation>));
    expect(view.getByRole("button", { name: "Find a command" })).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Host account" })).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Host navigation toggle" })).toBeInTheDocument();
    view.unmount();
  });

  it("forwards only the admitted Drawer close layout through its own authored-input record", async () => {
    const drawer = materials().find((entry: any) => entry.id === "drawer");
    const supplied = {
      heading: "Tools", closeLabel: "Close tools", children: "Tool content", trigger: createElement(Button, {}, "Open tools"),
      closeButtonStyle: { position: "fixed" as const, insetBlockStart: 35, insetInlineStart: 117, direction: "rtl" as const },
    };
    const authored = Object.fromEntries(drawer.authoredInputs.filter((name: string) => name in supplied)
      .map((name: keyof typeof supplied) => [name, supplied[name]]));
    const view = render(createElement(blocks.Drawer, authored as ComponentProps<typeof blocks.Drawer>));
    await userEvent.click(view.getByRole("button", { name: "Open tools" }));
    expect(view.getByRole("button", { name: "Close tools" })).toHaveStyle({ position: "fixed", insetBlockStart: "35px", insetInlineStart: "117px", direction: "rtl" });
    view.unmount();
  });

  it("keeps the Drawer opener available through its authored inputs", async () => {
    const drawer = materials().find((entry: any) => entry.id === "drawer");
    const supplied = {
      heading: "Tools", closeLabel: "Close tools", children: "Tool content",
      trigger: createElement(Button, {}, "Open tools"),
    };
    const authored = Object.fromEntries(drawer.authoredInputs
      .filter((name: string) => name in supplied)
      .map((name: keyof typeof supplied) => [name, supplied[name]]));
    const view = render(createElement(blocks.Drawer, authored as ComponentProps<typeof blocks.Drawer>));
    await userEvent.click(view.getByRole("button", { name: "Open tools" }));
    expect(view.getByRole("dialog", { name: "Tools" })).toHaveTextContent("Tool content");
    view.unmount();
  });

  it("forwards the authored CommandMenu count message from its real record", () => {
    const command = materials().find((entry: any) => entry.id === "command-menu");
    const supplied = {
      heading: "Commands", searchLabel: "Search commands", closeLabel: "Close commands",
      emptyMessage: "No matching commands", groups: [], isOpen: true,
      onOpenChange: (_open: boolean) => {}, query: "", onQueryChange: (_query: string) => {},
      resultCountMessage: (count: number) => `Commands found: ${count}`,
    };
    const authored = Object.fromEntries(command.authoredInputs
      .filter((name: string) => name in supplied)
      .map((name: keyof typeof supplied) => [name, supplied[name]]));
    const view = render(createElement(blocks.CommandMenu, authored as ComponentProps<typeof blocks.CommandMenu>));
    expect(view.getByRole("status")).toHaveTextContent(/^Commands found: 0$/);
    view.unmount();
  });

  it("registers AccountMenu's rendered atoms, regions and complete public inputs", () => {
    const account = materials().find((entry: any) => entry.id === "account-menu");
    expect(account).toMatchObject({
      exportName: "AccountMenu", source: "src/blocks/AccountMenu.tsx",
      regions: ["identity", "trigger", "content", "preferences"],
      dependencies: [
        { exportName: "Avatar", source: "src/atoms/Avatar.tsx" },
        { exportName: "Button", source: "src/atoms/Button.tsx" },
        { exportName: "Icon", source: "src/atoms/Icon.tsx" },
        { exportName: "Menu", source: "src/atoms/Menu.tsx" },
        { exportName: "Tooltip", source: "src/atoms/Tooltip.tsx" },
      ],
      configs: [{ prop: "collapsed", values: [false, true], default: false, source: "src/blocks/AccountMenu.tsx" }],
      authoredInputs: ["actor", "sections", "contextLabel", "triggerLabel", "collapsed", "onClose", "onRoute"],
    });
  });

  it("opens the real AccountMenu through its record and forwards controlled preferences, actions and routes", async () => {
    const account = materials().find((entry: any) => entry.id === "account-menu");
    const onCheckedChange = vi.fn(), onAction = vi.fn(), onClose = vi.fn(), onRoute = vi.fn();
    const link = { id: "profile", kind: "link" as const, label: "Profile", href: "#profile" };
    const supplied: ComponentProps<typeof blocks.AccountMenu> = {
      actor: { name: "Alex Morgan", secondaryText: "alex@example.test" },
      contextLabel: "Workspace", triggerLabel: "Manage account", collapsed: true, onClose, onRoute,
      sections: [
        { id: "account", label: "Account", entries: [link,
          { id: "settings", kind: "action", label: "Settings", onAction }] },
        { id: "preferences", kind: "preferences", label: "Preferences", entries: [
          { id: "compact", kind: "preference", label: "Compact view", checked: true, onCheckedChange },
        ] },
      ],
    };
    const authored = Object.fromEntries(account.authoredInputs
      .filter((name: string) => name in supplied)
      .map((name: keyof typeof supplied) => [name, supplied[name]]));
    const view = render(createElement(account.component, authored as ComponentProps<typeof blocks.AccountMenu>));
    const user = userEvent.setup();
    const trigger = view.getByRole("button", { name: "Manage account" });
    await user.click(trigger);
    expect(await view.findByRole("menu", { name: "Manage account" })).toHaveTextContent("alex@example.test");
    expect(view.getByRole("menu")).toHaveTextContent("Workspace");
    await user.click(view.getByRole("menuitemcheckbox", { name: "Compact view" }));
    expect(onCheckedChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(view.getByRole("menuitemcheckbox", { name: "Compact view" })).toHaveAttribute("aria-checked", "true");
    expect(onClose).not.toHaveBeenCalled();
    await user.click(view.getByRole("menuitem", { name: "Settings" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(view.queryByRole("menu")).not.toBeInTheDocument());
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(trigger);
    const route = await view.findByRole("menuitem", { name: "Profile" });
    expect(route).toHaveAttribute("href", "#profile");
    await user.click(route);
    expect(onRoute).toHaveBeenCalledExactlyOnceWith(link);
    await waitFor(() => expect(view.queryByRole("menu")).not.toBeInTheDocument());
    expect(onClose).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it("renders a grouped table from its actual authored-input record", () => {
    const entry = materials().find((entry: any) => entry.id === "grouped-table");
    const supplied = {
      caption: "Results", rowHeader: { id: "name", header: "Name", cell: (row: { name: string }) => row.name },
      groups: [{ id: "totals", header: "Totals", columns: [{ id: "count", header: "Count", cell: () => 0 }] }],
      rows: [{ name: "Alpha" }], rowKey: (row: { name: string }) => row.name, emptyMessage: "No rows",
    };
    const authored = Object.fromEntries(entry.authoredInputs.map((name: keyof typeof supplied) => [name, supplied[name]]));
    const view = render(createElement(entry.component, authored));
    expect(view.getByRole("table", { name: "Results" })).toHaveTextContent("Alpha");
    expect(view.getByRole("cell", { name: "0" })).toBeInTheDocument();
    view.unmount();
  });

  it("registers actual exported Block components, named regions, dependencies and finite configs", () => {
    expect(materials().map((entry: any) => entry.id)).toEqual(["panel", "drawer", "resizable-pane", "command-menu", "app-navigation", "page-bar", "account-menu", "grouped-table", "relation-graph"]);
    for (const entry of materials()) {
      expect(entry.layer).toBe("blocks");
      expect(entry.component).toBe((blocks as any)[entry.exportName]);
      expect(entry.component).toBeTypeOf("function");
      if (entry.id === "page-bar") expect(entry.regions).toEqual(["brand", "trail", "page-info", "actions", "width"]);
      else expect(entry.regions).toContain("content");
      const source = readFileSync(join(root, entry.source), "utf8");
      const ast = ts.createSourceFile(entry.source, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
      const rendered = new Set<string>();
      const imports = new Map<string, string>();
      for (const statement of ast.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
          if (!binding.isTypeOnly) imports.set(binding.name.text, statement.moduleSpecifier.text);
        }
      }
      const visit = (node: ts.Node) => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) rendered.add(node.tagName.getText(ast));
        ts.forEachChild(node, visit);
      };
      visit(ast);
      for (const dependency of entry.dependencies) {
        expect(rendered.has(dependency.exportName), `${entry.id} really renders ${dependency.exportName}`).toBe(true);
        const importedSource = resolve(dirname(join(root, entry.source)), imports.get(dependency.exportName)!);
        expect(importedSource.replace(/\.js$/, ".tsx")).toBe(join(root, dependency.source));
      }
      for (const config of entry.configs) {
        const configSource = readFileSync(join(root, config.source), "utf8");
        expect(config.values.length).toBeGreaterThan(1);
        expect(config.values).toContain(config.default);
        if (entry.id === "account-menu") expect(configSource).toContain("collapsed = " + JSON.stringify(config.default));
        if (entry.id === "app-navigation") expect(configSource).toContain("defaultCollapsed = " + JSON.stringify(config.default));
        for (const value of config.values) expect(configSource, `${entry.id}.${config.prop}`).toContain(JSON.stringify(value));
      }
    }
  });

  it("keeps Dialog the single overlay owner and all additions outside server subsets", () => {
    const dialog = readFileSync(join(root, "src/atoms/Dialog.tsx"), "utf8");
    const drawer = readFileSync(join(root, "src/blocks/Drawer.tsx"), "utf8");
    expect([...dialog.matchAll(/<ModalOverlay\b/g)]).toHaveLength(1);
    expect(drawer).not.toMatch(/ModalOverlay|DialogTrigger|usePreventScroll|document\.(?:body|documentElement)\.style/);
    for (const layer of ["atoms", "blocks", "shell"]) {
      const source = readFileSync(join(root, `src/${layer}/server.ts`), "utf8");
      expect(source).not.toMatch(/ResizeHandle|ResizablePane|\bDrawer\b|\bPanel\b|APP_FRAME_MATERIALS/);
    }
  });

  it("consumes the real named exports and Material records from a packed artifact", () => {
    // Existing ancestor peers satisfy this probe; isolated consumer protocols are checked separately.
    const temporary = mkdtempSync(join(root, "../../.app-frame-packed-"));
    try {
      const packed = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], { cwd: root, encoding: "utf8" }));
      execFileSync("tar", ["-xzf", join(temporary, packed[0].filename), "-C", temporary]);
      const atomEntry = pathToFileURL(join(temporary, "package/dist/atoms/index.js")).href;
      const blockEntry = pathToFileURL(join(temporary, "package/dist/blocks/index.js")).href;
      const script = `import * as atoms from ${JSON.stringify(atomEntry)}; import * as blocks from ${JSON.stringify(blockEntry)}; console.log(JSON.stringify({ handle: typeof atoms.ResizeHandle, materials: blocks.APP_FRAME_MATERIALS.map(entry => [entry.id, entry.component === blocks[entry.exportName]]) }));`;
      const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", cwd: root }));
      expect(result).toEqual({ handle: "function", materials: [["panel", true], ["drawer", true], ["resizable-pane", true], ["command-menu", true], ["app-navigation", true], ["page-bar", true], ["account-menu", true], ["grouped-table", true], ["relation-graph", true]] });
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  }, 30_000);

  it("imports every real server subset under react-server without exporting interactive additions", () => {
    const additions = ["ResizeHandle", "Panel", "Drawer", "ResizablePane", "APP_FRAME_MATERIALS", "CommandMenu", "useCommandMenuShortcut", "AppNavigation", "AccountMenu", "PageBar", "GroupedTable", "RelationGraph"];
    const entries = ["atoms", "blocks", "shell"].map(layer => pathToFileURL(join(root, `dist/${layer}/server.js`)).href);
    const script = `const modules = await Promise.all(${JSON.stringify(entries)}.map(entry => import(entry))); console.log(JSON.stringify(modules.map(module => ${JSON.stringify(additions)}.filter(name => name in module))));`;
    const result = JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", script], { encoding: "utf8", cwd: root }));
    expect(result).toEqual([[], [], []]);
  });
});

it("registers PageBar's complete authored contract and actual atom dependencies", () => {
  const entry = materials().find((record: any) => record.id === "page-bar");
  expect(entry).toMatchObject({
    layer: "blocks", exportName: "PageBar", component: (blocks as any).PageBar, source: "src/blocks/PageBar.tsx",
    regions: ["brand", "trail", "page-info", "actions", "width"],
    dependencies: [{ exportName: "Link", source: "src/atoms/Link.tsx" }, { exportName: "Menu", source: "src/atoms/Menu.tsx" }, { exportName: "Popover", source: "src/atoms/Popover.tsx" }, { exportName: "Button", source: "src/atoms/Button.tsx" }, { exportName: "Icon", source: "src/atoms/Icon.tsx" }],
    configs: [{ prop: "narrow", values: [false, true], default: false, source: "src/blocks/PageBar.tsx" }],
    authoredInputs: ["root", "page", "workspaces", "brand", "width", "onWidthChange", "labels", "reserveStart", "reserveEnd", "dir", "onHeightChange"],
  });
});
