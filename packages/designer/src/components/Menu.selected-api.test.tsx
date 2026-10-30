import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from "node:util";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { loadCatalogBundles } from "../catalog-bundles.js";
import { loadCatalog } from "../catalog-core/index.js";
import { applyLibraryChange, libraryHash, resolve as resolveValues } from "../catalog-core/api.js";
import { emittedTokenProperties } from "../catalog-core/emit.js";
import { loadComponentRegistry } from "../catalog-core/component-registry.js";
import { DEFAULT_COMPONENT_PICKS } from "../catalog-core/component-defaults.js";
import { loadComponentCompositionRules } from "../catalog-core/component-compositions.js";
import { applyComponentLibraryChange } from "../catalog-core/changeset-components.js";
import { componentDescriptorHash, componentLibraryHash, componentOf, resolveComponents } from "../catalog-core/resolve-components.js";
import type { ComponentCandidate, ComponentFile, ComponentLibrary, ComponentResolutionInput, ResolvedComponents } from "../catalog-core/resolve-components.js";
import { emitComponents } from "../catalog-core/emit-components.js";
import { isObservationPending } from "../catalog-core/check-components.js";
import { componentSecondaryExports } from "../catalog-core/component-secondary-exports.js";
import { declaredNames, packageRoot, resolveRuntime, resolveType, staticImports } from "./__fixtures__/selected-module-harness/inventory.js";
import { menuCaller } from "./__fixtures__/selected-module-harness/menu-caller.js";

/**
 * API-M1: the selected Menu's inline/popup presentation and its three command-result parts
 * (MenuGroup/MenuLabel/MenuItem) through the REAL consumer path.
 * Real consumer token/glyph values, real adoption of the generated fills with their
 * materialized source bundles, the real resolver/check (no observations supplied, so
 * the profile is honestly runtime-pending, never observations-pass) and the real
 * emitter. Package exports are independently inspected installed artifacts. The
 * @clossys/designer leaf (Icon/GlyphProvider) is this workspace's built dist, not
 * the packed archive; browser focus/geometry/forced-colour measurement is not
 * claimed here (jsdom only).
 */
const THREE = [{ name: "MenuGroup", export: "DropdownMenuGroup" }, { name: "MenuItem", export: "DropdownMenuItem" }, { name: "MenuLabel", export: "DropdownMenuLabel" }] as const;
const COHORT = [["components.button", DEFAULT_COMPONENT_PICKS["components.button"]!], ["components.card", DEFAULT_COMPONENT_PICKS["components.card"]!], ["components.table", DEFAULT_COMPONENT_PICKS["components.table"]!], ["components.icon", "foundry"], ["components.menu", "shadcn@aria"]] as const;
const packageDirectory = resolve(import.meta.dirname, "../..");
const repository = resolve(packageDirectory, "../..");
const packageJson = resolve(packageDirectory, "package.json");
const lock = resolve(repository, "package-lock.json");
const DESIGNER = "@clossys/designer/components";

/**
 * The consumer adopts, per token slot, the first preferred source that offers every member the selected cohort
 * reads from that slot (Foundry first, then Tailwind's defaults); asset slots take the first preferred offer.
 */
function consumerValues(reads: readonly string[]) {
  const values = loadCatalog();
  const order = ["foundry", "tailwind-default"];
  const offered = (slot: string) => values.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === slot && doc.$extensions["com.clossys.fill"].mode !== "reference");
  const covers = (doc: (typeof values.fills)[number], slot: string) => {
    const group = (doc as unknown as { tokens?: Record<string, Record<string, unknown>> }).tokens?.[slot.slice("tokens.".length)] ?? {};
    return reads.filter(id => id.startsWith(`${slot}.`)).every(id => Object.hasOwn(group, id.slice(slot.length + 1)));
  };
  const changes = values.slots.filter(slot => slot.layer === "tokens" || slot.id.startsWith("assets.icon-")).flatMap(slot => {
    const docs = offered(slot.id), sources = docs.filter(doc => slot.layer !== "tokens" || covers(doc, slot.id)).map(doc => doc.$extensions["com.clossys.fill"].source);
    const source = order.find(name => sources.includes(name)) ?? sources[0] ?? docs[0]?.$extensions["com.clossys.fill"].source;
    return source ? [{ op: "adopt" as const, slot: slot.id, source }] : [];
  });
  let library = { source: { kind: "consumer", author: "consumer", id: "selected-api" }, fills: [], adoptedAt: "2026-10-27" } as unknown as Parameters<typeof applyLibraryChange>[1];
  library = applyLibraryChange(values, library, { baseHash: libraryHash(library), changes });
  const profile = resolveValues({ catalog: values, library });
  const literal = (id: string, mode: "light" | "dark"): string => {
    let member = profile.members[id]!;
    while (member.alias[mode] ?? member.alias.light) member = profile.members[(member.alias[mode] ?? member.alias.light)!]!;
    return member.css[mode] ?? member.css.light;
  };
  const tokens = Object.fromEntries([...emittedTokenProperties(profile)].map(([id, output]) => [id, { property: output.property, light: literal(id, "light"), ...(profile.members[id]!.value.dark === undefined ? {} : { dark: literal(id, "dark") }) }]));
  const assets = [...new Set(Object.values(profile.members).filter(member => member.slot.startsWith("assets.")).map(member => member.slot))].sort();
  // Same glyph derivation as the composite emitter: the consumer's own glyph members.
  const glyphs = Object.fromEntries(Object.values(profile.members).filter(member => member.$type === "glyph" && member.slot.startsWith("assets.icon-")).map(member => [member.slot, member.value.light]));
  return { tokens, assets, glyphs };
}
const publicNames = (source: string): string[] => {
  const ast = ts.createSourceFile("leaf.ts", source, ts.ScriptTarget.Latest, true);
  return ast.statements.flatMap(statement => {
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) return statement.exportClause.elements.map(item => item.name.text);
    if ((ts.isVariableStatement(statement) || ts.isFunctionDeclaration(statement)) && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) return ts.isVariableStatement(statement) ? statement.declarationList.declarations.map(item => item.name.getText(ast)) : [statement.name!.text];
    return [];
  }).sort();
};
const file = (files: readonly ComponentFile[], path: string): string => files.find(row => row.path === path)!.content;
/**
 * The C0 compiler and materializer modules use esbuild, whose invariant rejects jsdom's TextEncoder/Uint8Array realm
 * (see icons/tree-shake.test.ts). Load and run them with Node's own encoder in place, so the same file
 * keeps jsdom for the rendered caller. No compiler behavior is replaced.
 */
async function withNodeEncoder<T>(run: () => Promise<T>): Promise<T> {
  const previous = { TextEncoder: globalThis.TextEncoder, TextDecoder: globalThis.TextDecoder, Uint8Array: globalThis.Uint8Array };
  // jsdom's realm also owns the global Uint8Array; Node's encoder returns Node's (Buffer's) Uint8Array.
  Object.assign(globalThis, { TextEncoder: NodeTextEncoder, TextDecoder: NodeTextDecoder, Uint8Array: Object.getPrototypeOf(Buffer.prototype).constructor });
  try { return await run(); }
  finally { Object.assign(globalThis, previous); }
}
const loadCompiler = () => withNodeEncoder(async () => ({ ...await import("./__fixtures__/selected-module-harness/compile.js"), ...await import("./__fixtures__/selected-module-harness/materialize.js") }));
/**
 * Runtime evidence executes the exact C0 browser bundle compileFixture writes (one asserted React and RAC
 * instance, the real designer dist), imported into this jsdom realm. The bundle is self-contained, so the
 * test runner resolves no module of it; nothing is stubbed.
 */
const importBundle = (url: string) => import(/* @vite-ignore */ url) as Promise<Record<string, unknown>>;
async function compileHost(path: string, content: string) {
  const { compileFixture, strictConfig, writeFixture, assertManifest } = await loadCompiler();
  const host = [{ path, content }, { path: "package.json", content: '{"private":true,"type":"module"}\n' }];
  host.push({ path: "tsconfig.json", content: strictConfig([...emitted, ...host].filter(row => /\.tsx?$/.test(row.path)).map(row => row.path)) });
  const manifest = writeFixture(temp, emitted, host, {}, "emitted");
  assertManifest(manifest);
  const compiled = await withNodeEncoder(() => compileFixture(manifest, [path]));
  return { manifest, compiled, bundle: pathToFileURL(resolve(manifest.root, "bundle.js")).href };
}
let callerBuild: ReturnType<typeof compileHost> | undefined;
const compileCaller = () => callerBuild ??= compileHost("harness/menu-caller.tsx", menuCaller);
/** Exports the selected leaf and entry namespaces from one bundle, so identity is judged inside one module graph. */
const identityHost = (leaf: string, entry: string) => `import * as leaf from "../${leaf.replace(/\.tsx?$/, ".js")}";\nimport * as entry from "../${entry.replace(/\.tsx?$/, ".js")}";\nexport { entry, leaf };\n`;

let input: ComponentResolutionInput, profile: ResolvedComponents, emitted: ComponentFile[], artifacts: { specifier: string; version: string; root: string; names: string[] }[];
let glyphModule: { path: string; glyphs: Record<string, unknown> };
const temp = mkdtempSync(resolve(repository, ".selected-api-menu-"));

beforeAll(async () => {
  const bundles = loadCatalogBundles(), registry = loadComponentRegistry();
  const values = consumerValues(bundles.componentFills.map(componentOf).filter(fill => COHORT.some(([slot, source]) => fill.slot === slot && fill.source === source)).flatMap(fill => fill.reads.tokens));
  const catalog = { slots: registry.slots, fills: bundles.componentFills, rules: loadComponentCompositionRules() };
  const empty: ComponentLibrary = { source: { id: "selected-api", kind: "consumer", author: "consumer", license: "MIT" }, adoptedAt: "2026-10-27", fills: [], files: [] };
  const library = applyComponentLibraryChange(catalog, empty, { baseHash: componentLibraryHash(empty), changes: COHORT.map(([slot, source]) => ({ op: "adopt" as const, slot, source })) }, bundles.sourceBundles);
  const specifiers = new Set([...library.files, { path: "harness/menu-caller.tsx", content: menuCaller }].filter(row => /\.tsx?$/.test(row.path))
    .flatMap(row => staticImports(row.path, row.content)).map(edge => edge.specifier).filter(name => !name.startsWith(".") && name !== DESIGNER));
  // Independent installed-artifact inspection (C0 inventory primitives): Node's own runtime resolution and
  // namespace keys, TypeScript's declared exports, and a unique lock integrity for each third-party package.
  const locked = (JSON.parse(readFileSync(lock, "utf8")) as { packages: Record<string, { version?: string; integrity?: string }> }).packages;
  const inspect = async (specifier: string) => {
    const entry = resolveRuntime(specifier, packageJson), { root, data } = packageRoot(entry);
    const types = declaredNames(resolveType(specifier, packageJson));
    const runtime = Object.keys(await import(pathToFileURL(entry).href) as Record<string, unknown>);
    if (specifier !== DESIGNER) {
      const integrities = new Set(Object.entries(locked).filter(([path, row]) => (path === `node_modules/${String(data.name)}` || path.endsWith(`/node_modules/${String(data.name)}`)) && row.version === data.version).map(([, row]) => row.integrity));
      if (integrities.size !== 1 || integrities.has(undefined)) throw new Error(`installed artifact is not uniquely bound by the lock: ${specifier}`);
    }
    return { specifier, version: String(data.version), root, names: [...new Set([...runtime, ...types.values, ...types.types])].sort() };
  };
  artifacts = [];
  for (const specifier of [...specifiers, DESIGNER].sort()) artifacts.push(await inspect(specifier));
  const packageExports = Object.fromEntries(artifacts.map(row => [row.specifier, row.names] as const));
  const rac = artifacts.find(row => row.specifier === "react-aria-components")!;
  input = { catalog, library, values: { tokens: values.tokens, assets: values.assets }, evidence: { observations: {}, installedRac: { version: rac.version, instance: rac.root } }, packageExports } as unknown as ComponentResolutionInput;
  profile = resolveComponents(input);
  glyphModule = { path: "adapters/glyphs.ts", glyphs: values.glyphs };
  emitted = emitComponents(profile, ["component-index", "components-consumption"], { glyphModule: glyphModule as never });
}, 600_000);
// jsdom implements no Element.scrollTo; RAC scrolls the focused item into view in an animation frame.
const elementScrollTo = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTo");
beforeAll(() => { if (!elementScrollTo) Object.defineProperty(Element.prototype, "scrollTo", { configurable: true, writable: true, value() {} }); });
afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
  if (!elementScrollTo) Reflect.deleteProperty(Element.prototype, "scrollTo");
});

const ENTRY = "components/menu/dropdown-menu.tsx", LEAF = "components/menu/index.ts";
const reexport = (row: { name: string; export: string }) => `export { ${row.export} as ${row.name} } from "./dropdown-menu";`;

describe("API-M1 selected Menu presentation and parts through the generated leaf API (real resolver/emitter; jsdom, no browser claim)", () => {
  it("M6/M3 resolves a checked, runtime-pending cohort whose adopted Menu carries exactly the three part approvals and the accepted presentation axis", () => {
    expect(profile.check.ok).toBe(true);
    for (const leaf of ["button", "table", "card", "menu"]) expect(profile.components[`components.${leaf}`]!.origin, leaf).toMatchObject({ kind: "adopted", source: "shadcn@aria" });
    expect(profile.check.findings.every(isObservationPending)).toBe(true);
    expect(JSON.parse(file(emitted, "components-consumption.json")).status).toBe("runtime-pending");
    const menu = profile.components["components.menu"]!;
    expect(menu.origin).toMatchObject({ kind: "adopted", source: "shadcn@aria", sha256: componentDescriptorHash(menu.descriptor) });
    expect(menu.descriptor.impl).toEqual({ kind: "source", entry: ENTRY, export: "DropdownMenu" });
    expect(menu.descriptor.secondaryExports).toEqual(THREE);
    expect(componentSecondaryExports(menu.descriptor, profile.files)).toEqual(THREE);
    expect(menu.descriptor.members).toEqual(["presentation.inline", "presentation.popup", "selection.multiple", "selection.none", "selection.single"]);
    expect(menu.propMap).toMatchObject({ "presentation.inline": "InlineMenu", "presentation.popup": "DropdownMenu" });
    for (const slot of ["components.button", "components.icon"]) expect(profile.components[slot]!.descriptor.secondaryExports, slot).toBeUndefined();
  });
  it("M3 publishes only the three parts at the menu leaf; no InlineMenu, trigger, submenu, separator or shortcut export, and the root is unchanged", () => {
    const leaf = file(emitted, LEAF);
    expect(publicNames(leaf)).toEqual(["Menu", "MenuGroup", "MenuItem", "MenuLabel"]);
    for (const row of THREE) expect(leaf).toContain(reexport(row));
    expect(publicNames(file(emitted, "component-index.ts"))).toEqual(["Button", "Card", "Icon", "LibraryProvider", "Menu", "Table"]);
  });
  it("M3 each leaf part is the selected entry's own runtime value; unapproved entry values stay unreachable", async () => {
    const identity = await compileHost("harness/identity.ts", identityHost(LEAF, ENTRY));
    expect({ diagnostics: identity.compiled.diagnostics, closure: identity.compiled.closureError, bundle: identity.compiled.bundle.errors }).toEqual({ diagnostics: [], closure: undefined, bundle: [] });
    expect(identity.compiled.status).toBe("compiled");
    const { leaf, entry } = await importBundle(identity.bundle) as { leaf: Record<string, unknown>; entry: Record<string, unknown> };
    expect(Object.keys(leaf).sort()).toEqual(["Menu", "MenuGroup", "MenuItem", "MenuLabel"]);
    for (const row of THREE) {
      expect(typeof entry[row.export], row.export).toBe("function");
      expect(leaf[row.name], row.name).toBe(entry[row.export]);
    }
    for (const name of ["InlineMenu", "DropdownMenu", "DropdownMenuTrigger", "DropdownMenuSeparator", "DropdownMenuShortcut", "DropdownMenuSub", "DropdownMenuSubTrigger", "DropdownMenuSubContent"]) {
      expect(typeof entry[name], name).toBe("function");
      expect(leaf[name], name).toBeUndefined();
    }
  }, 120_000);
  it("M3 the approval adds only the three leaf lines: root and every other emitted byte are unchanged", () => {
    const library = structuredClone(input.library);
    const fill = library.fills.find(row => componentOf(row).slot === "components.menu")!.components.menu! as ComponentCandidate & { origin: unknown };
    delete fill.secondaryExports;
    fill.origin = { kind: "authored", license: "MIT" };
    const without = emitComponents(resolveComponents({ ...input, library }), ["component-index"], { glyphModule: glyphModule as never });
    const withThree = emitted.filter(row => row.path !== "components-consumption.json");
    expect(without.map(row => row.path)).toEqual(withThree.map(row => row.path));
    for (const row of withThree) if (row.path !== LEAF) expect(file(without, row.path), row.path).toBe(row.content);
    // The authored control is stamped with its own fill identity; that one stamp line is the only other difference.
    const stamp = (line: string) => line.startsWith("const stamp = ");
    const before = file(without, LEAF).split("\n"), after = file(emitted, LEAF).split("\n");
    expect(after.filter(line => !before.includes(line) && !stamp(line)).sort()).toEqual(THREE.map(reexport).sort());
    expect(before.filter(line => !after.includes(line) && !stamp(line))).toEqual([]);
    expect(after.filter(stamp)).toHaveLength(before.filter(stamp).length);
  });
  it("M2 the exact C0 menu caller typechecks strictly, closes and bundles against the emitted graph", async () => {
    const { manifest, compiled } = await compileCaller();
    expect(compiled.diagnostics.map(row => `${row.file?.slice(manifest.root.length) ?? ""} ${row.message}`)).toEqual([]);
    expect(compiled.closureError).toBeUndefined();
    expect(compiled.bundle.errors).toEqual([]);
    expect(compiled.status).toBe("compiled");
    const callerEdges = compiled.edges.filter(edge => edge.from.endsWith("harness/menu-caller.tsx") && edge.specifier === "../components/menu/index.js");
    expect(callerEdges.flatMap(edge => edge.names.map(name => name.name)).sort()).toEqual(["Menu", "MenuGroup", "MenuItem", "MenuLabel"]);
  }, 120_000);
  it("M2/M4 inline renders one RAC Menu with no Popover; popup keeps its anchored Popover, grouped heading, selection events, Escape and focus return", async () => {
    const user = userEvent.setup();
    document.body.innerHTML = '<div id="root"></div>';
    const { compiled, bundle } = await compileCaller();
    expect(compiled.status).toBe("compiled");
    // The bundle carries its own (asserted single) React, which testing-library's act cannot flush.
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
    onTestFinished(() => { Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true); });
    await importBundle(bundle);
    await waitFor(() => expect(document.getElementById("root")!.childElementCount).toBeGreaterThan(0));
    const events = (window as unknown as { callerEvents: Record<string, unknown>[] }).callerEvents;
    const root = document.getElementById("root")!;
    // Inline: present without any trigger, inside the caller's own tree, with no Popover ancestor.
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    const inline = screen.getByRole("menu", { name: "Inline actions" });
    expect(root.contains(inline)).toBe(true);
    expect(inline).toHaveAttribute("data-slot", "command-list");
    expect(inline.closest("[data-placement]")).toBeNull();
    expect(inline.closest('[data-slot="dropdown-menu-content"]')).toBeNull();
    // RAC builds the collection after the first commit; wait for it rather than for an act flush.
    const group = await within(inline).findByRole("group");
    expect(within(group).getByText("Actions")).toHaveAttribute("data-slot", "dropdown-menu-label");
    const inlineItems = within(group).getAllByRole("menuitemcheckbox");
    expect(inlineItems.map(item => item.textContent)).toEqual(["First", "Second"]);
    expect(inlineItems.map(item => item.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    for (const item of inlineItems) expect(item).toHaveAttribute("data-slot", "dropdown-menu-item");
    // Keyboard-driven, as the repository's own RAC tests are: RAC's mouse press does not reach a bundled RAC under jsdom.
    inlineItems[0]!.focus();
    await waitFor(() => expect(inlineItems[0]).toHaveAttribute("data-focused"));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(inlineItems[1]);
    await user.keyboard(" ");
    await waitFor(() => expect(events.filter(event => event.event === "selection")).toHaveLength(1));
    expect(events.filter(event => event.event === "selection").at(-1)).toEqual({ event: "selection", keys: ["one", 2] });
    expect(within(group).getAllByRole("menuitemcheckbox").map(item => item.getAttribute("aria-checked"))).toEqual(["true", "true"]);
    // Popup (presentation omitted): one anchored Popover around one RAC Menu, portalled out of the caller tree.
    const trigger = screen.getByRole("button", { name: "Open actions" });
    trigger.focus();
    // The bundled React commits asynchronously (no act); press only once RAC has observed the focus.
    await waitFor(() => expect(trigger).toHaveAttribute("data-focused"));
    await user.keyboard("{Enter}");
    const menus = () => [...document.querySelectorAll<HTMLElement>('[role="menu"]')];
    await waitFor(() => expect(menus()).toHaveLength(2));
    const popup = menus().find(menu => menu !== inline)!;
    // While the popup is open RAC hides the rest of the page from assistive technology: it is the only accessible menu.
    expect(screen.getAllByRole("menu")).toEqual([popup]);
    // RAC labels a triggered Menu by its trigger as well as its own aria-label.
    expect(popup).toHaveAttribute("aria-label", "Default popup");
    expect(popup.getAttribute("aria-labelledby")?.split(" ")).toContain(trigger.id);
    expect(root.contains(popup)).toBe(false);
    const popover = popup.closest('[data-slot="dropdown-menu-content"]')!;
    expect(popover).not.toBeNull();
    expect(popover).toHaveAttribute("data-placement");
    expect(await within(popup).findByRole("group")).toBeInTheDocument();
    expect(within(popup).getAllByRole("menuitem").map(item => item.textContent)).toEqual(["First", "Second"]);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(popup).not.toBeInTheDocument());
    expect(screen.getAllByRole("menu")).toEqual([inline]);
    // FocusScope restores focus to the trigger after the popover unmounts.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(events.filter(event => event.event === "popup").map(event => event.open)).toEqual([true, false]);
    // Explicit popup presentation dispatches to the same popup root.
    const explicitTrigger = screen.getByRole("button", { name: "Explicit popup" });
    explicitTrigger.focus();
    await waitFor(() => expect(explicitTrigger).toHaveAttribute("data-focused"));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(menus()).toHaveLength(2));
    const explicit = menus().find(menu => menu !== inline)!;
    expect(screen.getAllByRole("menu")).toEqual([explicit]);
    expect(explicit).toHaveAttribute("aria-label", "Explicit popup");
    expect(explicit.closest('[data-slot="dropdown-menu-content"]')).not.toBeNull();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(explicit).not.toBeInTheDocument());
    expect(screen.getAllByRole("menu")).toEqual([inline]);
    await waitFor(() => expect(document.activeElement).toBe(explicitTrigger));
  }, 30_000);
  it("M5 keeps adoption, output and check refusals; no observations are fabricated", () => {
    const tampered = structuredClone(input.library);
    tampered.files = tampered.files.map(row => row.path === ENTRY ? { ...row, content: `${row.content} ` } : row);
    expect(() => resolveComponents({ ...input, library: tampered })).toThrow(/output hash differs/);
    const widened = structuredClone(input.library);
    const fill = widened.fills.find(row => componentOf(row).slot === "components.menu")!.components.menu!;
    fill.secondaryExports = [...fill.secondaryExports!, { name: "InlineMenu", export: "InlineMenu" }];
    expect(() => resolveComponents({ ...input, library: widened })).toThrow(/hand-edit requires authored origin/);
    const stale = structuredClone(profile);
    stale.components["components.menu"]!.descriptor.secondaryExports = [...THREE, { name: "MenuTrigger", export: "DropdownMenuTrigger" }];
    expect(() => emitComponents(stale, ["component-index"], { glyphModule: glyphModule as never })).toThrow(/secondary export descriptor differs from adoption/);
    const failed = structuredClone(profile); failed.check.ok = false;
    expect(() => emitComponents(failed, ["component-index"], { glyphModule: glyphModule as never })).toThrow(/checks failed/);
    expect(input.evidence?.observations).toEqual({});
  });
});
