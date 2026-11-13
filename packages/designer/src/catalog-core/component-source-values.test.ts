// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { componentSourceValues } from "./component-source-values.js";
import { componentSecondaryExports } from "./component-secondary-exports.js";
import { secondaryFixture } from "./__fixtures__/component-engine/secondary-exports.js";
import { sha256 } from "./digest.js";
import { assertComponentImportClosure } from "./emit-components.js";
import { assertComponentNamespaceClosure } from "./component-source-values.js";
import { componentSourceProof } from "./component-source-proofs.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import * as ReactRuntime from "react";
import { verifyComponentOutput, componentLibraryHash } from "./resolve-components.js";
import { applyComponentLibraryChange, materializeSourceFill } from "./changeset-components.js";
import { checkComponentProfile, componentSourceHash } from "./check-components.js";
import { componentProfile } from "./__fixtures__/components/profile.js";

const pinned = "daaf156ee00ed91cc7e6bdd937c1b4973152d141";
// Item is held outside the general importer fixture roster: source-value proof
// does not add it to that importer's approved source manifest or slot mapping.
const raw = (item: string) => JSON.parse(readFileSync(new URL(`../importers/__fixtures__/shadcn-aria/${item === "item" ? "source-values/" : ""}${item}.json`, import.meta.url), "utf8")) as { repository: string; commit: string; files: { path: string; content: string }[] };
const source = (item: string) => raw(item).files[0]!.content;
const button = source("button"), sidebar = source("sidebar"), item = source("item");
const expected = {
  button: ["Button", "LinkButton"],
  item: ["Item", "ItemMedia", "ItemContent", "ItemActions", "ItemGroup", "ItemSeparator", "ItemTitle", "ItemDescription", "ItemHeader", "ItemFooter"],
  sidebar: ["Sidebar", "SidebarContent", "SidebarFooter", "SidebarGroup", "SidebarGroupAction", "SidebarGroupContent", "SidebarGroupLabel", "SidebarHeader", "SidebarInput", "SidebarInset", "SidebarMenu", "SidebarMenuAction", "SidebarMenuBadge", "SidebarMenuButton", "SidebarMenuItem", "SidebarMenuSkeleton", "SidebarMenuSub", "SidebarMenuSubButton", "SidebarMenuSubItem", "SidebarProvider", "SidebarRail", "SidebarSeparator", "SidebarTrigger"],
};
const admit = (content: string, name = "LinkButton") => {
  // An unregistered path and whitespace changes force the actual parser fallback.
  const input = secondaryFixture([{ name: "PublicPart", export: name }], content);
  input.candidate.slot = "components.unregistered";
  input.candidate.impl = { kind: "source", entry: "components/unregistered/source.tsx", export: "Primary" };
  return componentSecondaryExports(input.candidate, [{ ...input.file, path: "components/unregistered/source.tsx" }]);
};

describe("real pinned upstream source-value admission", () => {
  it.each(["button", "item", "sidebar"] as const)("classifies every %s UI function independently of CVA/context/helper values", name => {
    const fixture = raw(name), content = source(name);
    expect(fixture.repository).toBe("https://github.com/shadcn-ui/ui");
    expect(fixture.commit).toBe(pinned);
    expect(fixture.files[0]!.path).toBe(`apps/v4/registry/bases/aria/ui/${name}.tsx`);
    const ast = ts.createSourceFile(`${name}.tsx`, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    expect((ast as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics).toEqual([]);
    const concrete = new Set(ast.statements.filter(ts.isFunctionDeclaration).filter(node => node.body).map(node => node.name!.text));
    const exported = ast.statements.filter(ts.isExportDeclaration).flatMap(node => node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements.map(binding => binding.name.text) : []);
    const ui = exported.filter(name => /^[A-Z]/.test(name) && concrete.has(name)).sort();
    expect(ui).toEqual([...expected[name]].sort());
    const parsed = componentSourceValues(content);
    expect([...parsed.exports].filter(name => /^[A-Z]/.test(name) && parsed.functions.has(name)).sort()).toEqual(ui);
    for (const name of ui) expect(admit(content, name)).toEqual([{ name: "PublicPart", export: name }]);
    expect(componentSourceValues(`\n${content}\n `).functions).toEqual(parsed.functions);
    expect(admit(`\n${content}\n `, ui[0])).toHaveLength(1);
  });
  it("records the faithful Item source digest, never a rewritten definition", () => {
    expect(Buffer.byteLength(item)).toBe(4414);
    expect(sha256(item)).toBe("24f60eb69fe9631d8e58fc4eddda0a12b20c20f079f64aae94c92f81085a8302");
  });
  it.each([
    [button, "buttonVariants"], [item, "itemVariants"], [item, "itemMediaVariants"],
    [sidebar, "SidebarContext"], [sidebar, "sidebarMenuButtonVariants"], [sidebar, "useSidebar"],
  ])("does not promote non-UI values to a secondary component", (content, name) => {
    expect(() => admit(content!, name)).toThrow(/secondary/);
  });
  it("refuses exported CVA and context constants even with component-shaped names", () => {
    const cva = button.replaceAll("buttonVariants", "ButtonVariants");
    expect(() => admit(cva, "ButtonVariants")).toThrow(/secondary/);
    const context = sidebar + "\nexport { SidebarContext }\n";
    expect(componentSourceValues(context).exports.has("SidebarContext")).toBe(true);
    expect(() => admit(context, "SidebarContext")).toThrow(/secondary/);
  });
  it.each([
    ["unknown top-level call", button + "\narbitrary()"],
    ["class", button + "\nclass Extra {}"],
    ["ambient", button.replace("function LinkButton", "declare function LinkButton")],
    ["dynamic import", button + '\nconst loaded = import("other")'],
    ["dynamic import in a function", button.replace("return (", 'return import("other") || (')],
    ["mutable", button.replace("const buttonVariants", "let buttonVariants")],
    ["wrong CVA package", button.replace('from "class-variance-authority"', 'from "other"')],
    ["wrong CVA export", button.replace("{ cva,", "{ pretend as cva,")],
    ["shadowed CVA", button.replace("function LinkButton({", "function LinkButton(cva, {")],
    ["redeclared CVA", button.replace("const buttonVariants", "const cva = 1\nconst buttonVariants")],
    ["shadowed CVA value", button.replace("function LinkButton({", "function LinkButton(buttonVariants, {")],
    ["wrong initializer", button.replace("= cva(", "= arbitrary(")],
    ["computed CVA", button.replace("= cva(", '= cva["call"](')],
    ["non-static CVA option", button.replace('default: "cn-button-variant-default"', "default: arbitrary()")],
    ["spread CVA", button.replace("variants: {", "...other, variants: {")],
    ["removed function", button.replace("function LinkButton", "function PrivateButton")],
    ["reexport", button.replace("export { Button, LinkButton, buttonVariants }", 'export { LinkButton } from "other"')],
    ["wildcard", button.replace("export { Button, LinkButton, buttonVariants }", 'export * from "other"')],
    ["wrong React origin", sidebar.replace('from "react"', 'from "other"')],
    ["wrong context factory", sidebar.replace("React.createContext<", "React.makeContext<")],
    ["computed context factory", sidebar.replace("React.createContext<", 'React["createContext"]<')],
    ["shadowed React parameter", sidebar.replace("function useSidebar()", "function useSidebar(React)")],
    ["shadowed React local", sidebar.replace("const context = React.useContext", "const React = other\n  const context = React.useContext")],
    ["wrong context hook", sidebar.replace("React.useContext(SidebarContext)", "React.useState(SidebarContext)")],
    ["wrong context reference", sidebar.replace("React.useContext(SidebarContext)", "React.useContext(OtherContext)")],
    ["shadowed context", sidebar.replace("function useSidebar()", "function useSidebar(SidebarContext)")],
    ["wrong provider reference", sidebar.replaceAll("SidebarContext.Provider", "OtherContext.Provider")],
  ])("refuses %s without a hash waiver", (_label, content) => {
    expect(() => admit(content, content.includes("function Sidebar") ? "SidebarTrigger" : "LinkButton")).toThrow(/secondary/);
  });
  it("authenticates aliased CVA and named React factory/hook bindings", () => {
    expect(admit(button.replace("{ cva,", "{ cva as variants,").replace("= cva(", "= variants("))).toHaveLength(1);
    const content = 'import { createContext as make, useContext as read } from "react"; type Props = { open: boolean }; const Context = make<Props | null>(null); function ButtonTrigger() { return read(Context); } export { ButtonTrigger };';
    expect(admit(content, "ButtonTrigger")).toHaveLength(1);
    expect(() => admit(content.replace('from "react"', 'from "other"'), "ButtonTrigger")).toThrow(/secondary/);
  });
  it("admits an aliased React namespace without granting unknown value evaluation", () => {
    expect(admit(sidebar.replaceAll("React", "R"), "SidebarTrigger")).toHaveLength(1);
    for (const expression of ["React.Missing()", "React.missing()", 'React["useState"]()', "React /* comment */ [key]()", "React?.useState()", "take(React)"]) {
      const content = button.replace("return (", `return ${expression} || (`);
      expect(content).not.toBe(button);
      expect(() => admit(content)).toThrow(/secondary|namespace/);
    }
    for (const body of ["const Alias = React; return Alias.useState();", "const { useState } = React; return useState();", String.raw`return Re\u0061ct["useState"]();`]) {
      expect(() => admit(button + `\nfunction Extra() { ${body} }`)).toThrow(/secondary|namespace/);
    }
  });
  it("keeps explicit namespace value type queries erased and independently export-checked", () => {
    const content = 'import type * as R from "react"; type Part = typeof R.Fragment; function ButtonTrigger() { return null; } export { ButtonTrigger };';
    const ast = ts.createSourceFile("query.ts", content, ts.ScriptTarget.Latest, true);
    expect(ast.statements.filter(ts.isTypeAliasDeclaration).every(node => ts.isTypeQueryNode(node.type))).toBe(true);
    const emitted = ts.transpileModule(content, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
    expect(emitted).not.toMatch(/R\.|from "react"/);
    expect(admit(content, "ButtonTrigger")).toHaveLength(1);
    const files = [{ path: "components/context/context.tsx", content }];
    expect(() => assertComponentImportClosure(files, { react: ["Fragment"] })).not.toThrow();
    expect(() => assertComponentImportClosure(files, { react: [] })).toThrow(/namespace member Fragment/);
  });
  it("preserves finite generic function annotations without erasing their runtime body", () => {
    const content = 'import type * as R from "react"; function ButtonTrigger<T extends R.ElementType = R.ElementType>(props: R.ComponentProps<T>) { return null; } export { ButtonTrigger };';
    expect(admit(content, "ButtonTrigger")).toHaveLength(1);
    expect(() => admit(content.replace("return null", "return R.Missing()"), "ButtonTrigger")).toThrow(/secondary|namespace/);
  });
  it.each([
    ["evaluated CVA base", button.replace('"cn-button group/button', 'arbitrary() + "cn-button group/button')],
    ["computed CVA key", button.replace("variants: {", "[key]: {")],
    ["CVA getter", button.replace("variants: {", "get variants() { return {").replace("    },\n    defaultVariants:", "    } },\n    defaultVariants:")],
    ["CVA option reference", button.replace('default: "cn-button-variant-default"', "default: other")],
    ["context default call", sidebar.replace(">(null)", ">(arbitrary())")],
    ["context default evaluation", sidebar.replace(">(null)", ">(null ?? arbitrary())")],
    ["context factory alias escape", sidebar.replace("React.createContext<", '(0, React.createContext)<')],
    ["context factory optional call", sidebar.replace("React.createContext<", 'React.createContext?.<')],
    ["context factory unknown export", sidebar.replace("React.createContext<", "React.Missing<")],
  ])("keeps %s outside the finite CVA/context grammar", (_label, content) => {
    expect(content === button || content === sidebar).toBe(false);
    const ast = ts.createSourceFile("mutation.tsx", content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    expect((ast as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics).toEqual([]);
    expect(() => admit(content, content.includes("function Sidebar") ? "SidebarTrigger" : "LinkButton")).toThrow(/secondary|namespace/);
  });
  it("keeps real Button helper imports in the selected local closure", () => {
    const path = "components/button/button.tsx", helper = { path: "components/_parts/utils/index.ts", content: "export function cn() {}" };
    const content = button.replace('from "cn"', 'from "../_parts/utils/index"');
    const observed = { react: [], "class-variance-authority": ["cva"], "react-aria-components": ["Button", "Link"] };
    expect(() => assertComponentImportClosure([{ path, content }, helper], observed)).not.toThrow();
    expect(() => assertComponentImportClosure([{ path, content: content.replace("../_parts/utils/index", "../_parts/missing/index") }, helper], observed)).toThrow(/missing import/);
    expect(() => assertComponentImportClosure([{ path, content }, { ...helper, content: "export function other() {}" }], observed)).toThrow(/unavailable named import cn/);
  });
  it("cannot adopt a bundle after changing the real upstream commit", async () => {
    const input = secondaryFixture([{ name: "LinkButton", export: "LinkButton" }], button);
    input.candidate.pin = { url: "https://github.com/shadcn-ui/ui", commit: pinned, files: [{ path: raw("button").files[0]!.path, sha256: sha256(button) }] };
    const bundle = await materializeSourceFill(input.candidate, async () => button, [{ id: "synthetic@1", run: () => ({ files: [input.file, input.notice], blockers: [] }) }]);
    input.candidate.pin.commit = "0".repeat(40);
    expect(() => applyComponentLibraryChange(input.catalog, input.library, { baseHash: componentLibraryHash(input.library), changes: [{ op: "adopt", slot: input.candidate.slot, source: input.candidate.source }] }, [bundle])).toThrow(/stale|bundle/);
  });
  it.each([
    ["base", button.replace("cn-button group/button", "cn-button bg-red-500 group/button")],
    ["variant", button.replace('default: "cn-button-variant-default"', 'default: "bg-red-500"')],
  ])("keeps %s class mutations behind output hashes and the independent class check", (_label, mutant) => {
    const input = secondaryFixture([{ name: "LinkButton", export: "LinkButton" }], button);
    const files = [input.file, input.notice];
    expect(() => verifyComponentOutput(input.candidate, files)).not.toThrow();
    input.file.content = mutant;
    expect(() => verifyComponentOutput(input.candidate, files)).toThrow(/output hash/);
    input.candidate.outputSha256 = files.map(file => ({ path: file.path, sha256: sha256(file.content) }));
    expect(() => verifyComponentOutput(input.candidate, files)).not.toThrow();
    expect(admit(mutant)).toHaveLength(1); // Function classification is not class approval.
    const findings = (content: string) => {
      const profile = componentProfile();
      const files = [{ path: "components/button/button.tsx", content }];
      profile.observations = { ...profile.observations, "components.button": { ...profile.observations["components.button"]!, files, sourceHash: componentSourceHash(files) } };
      return checkComponentProfile(profile).findings.filter(finding => finding.code === "K4" && finding.message.includes("bg-red-500"));
    };
    expect(findings(button)).toEqual([]);
    expect(findings(mutant)).toContainEqual(expect.objectContaining({ code: "K4", message: "Utility bg-red-500 has no bound consumer token" }));
  });
});

// E1: real stock sources are read by the TypeScript AST through a byte-keyed proof;
// every mutation of those bytes loses the proof and is refused by the bounded grammar.
describe("stock namespace closure reads stock source with the TypeScript AST", () => {
  const stockFiles = loadCatalogBundles().sourceBundles.flatMap(bundle => bundle.files);
  const stock = (path: string) => stockFiles.find(file => file.path === path)!.content;
  const observed = { react: Object.keys(ReactRuntime).sort() };
  const namespacesOf = (content: string) => new Map([...content.matchAll(/\bimport\s+(type\s+)?\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["']/g)].map(match => [match[2]!, { module: match[3]!, erased: !!match[1] }]));
  const close = (path: string, content: string, namespaces = namespacesOf(content)) => assertComponentNamespaceClosure(content, namespaces, observed, path);
  const paths = ["components/command/command.tsx", "components/toggle-group/toggle-group.tsx", "components/combo-box/combobox.tsx", "components/_parts/rail-use-mobile/index.ts"];
  it.each(paths)("admits the unmodified stock %s (indexed types, generic annotations, regex literals)", path => {
    expect(() => close(path, stock(path))).not.toThrow();
  });
  // Since GATES-RED O2 (371778efe) the bounded grammar reads indexed access types, so it can read some stock files
  // (command, toggle-group) by itself. A byte change still always loses the proof; files the grammar cannot read are
  // then refused outright, and a grammar-readable mutant is admitted only on its own grammar reads, so an injected
  // unavailable namespace member is refused either way.
  const grammarReads = (content: string) => { try { assertComponentNamespaceClosure(content, namespacesOf(content), observed); return true; } catch { return false; } };
  it.each(paths)("refuses any byte change to stock %s, even one the compiler reads unchanged", path => {
    const content = stock(path), readable = grammarReads(content);
    expect(componentSourceProof(path, content)).toBeDefined();
    for (const mutant of [`${content}\n`, ` ${content}`]) {
      expect(mutant).not.toBe(content);
      expect(componentSourceProof(path, mutant)).toBeUndefined();
      if (readable) expect(() => close(path, mutant)).not.toThrow();
      else expect(() => close(path, mutant)).toThrow(/components:/);
    }
    const injected = `${content}\nexport function Extra() { return React.Missing() }\n`;
    expect(componentSourceProof(path, injected)).toBeUndefined();
    expect(() => close(path, injected)).toThrow(/components:/);
  });
  it("refuses stock bytes whose caller inventory disagrees with the proof", () => {
    const path = "components/command/command.tsx", content = stock(path);
    expect(() => close(path, content, new Map())).toThrow(/namespace import syntax/);
    expect(() => close(path, content, new Map([["React", { module: "react", erased: true }]]))).toThrow(/namespace import syntax/);
    expect(() => close(path, content, new Map([["React", { module: "other", erased: false }]]))).toThrow(/namespace import syntax/);
  });
  it("binds a proof to its script kind: stock .tsx bytes read as .ts have no proof", () => {
    for (const path of paths.filter(path => path.endsWith(".tsx"))) {
      const content = stock(path);
      expect(componentSourceProof(path, content), path).toBeDefined();
      expect(componentSourceProof(path.replace(/\.tsx$/, ".ts"), content), path).toBeUndefined();
      // Without the proof only the bounded grammar remains: it refuses what it cannot read.
      if (!grammarReads(content)) expect(() => close(path.replace(/\.tsx$/, ".ts"), content)).toThrow(/components:/);
    }
  });
  it("still refuses a proven runtime read the module does not export", () => {
    const path = "components/_parts/rail-use-mobile/index.ts", content = stock(path);
    expect(() => assertComponentNamespaceClosure(content, namespacesOf(content), { react: ["useState"] }, path)).toThrow(/namespace member useEffect/);
  });
});
