import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from "node:util";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { loadCatalogBundles } from "../catalog-bundles.js";
import { loadCatalog } from "../catalog-core/index.js";
import { applyLibraryChange, libraryHash, resolve as resolveValues } from "../catalog-core/api.js";
import { emittedTokenProperties } from "../catalog-core/emit.js";
import { loadComponentRegistry } from "../catalog-core/component-registry.js";
import { loadComponentCompositionRules } from "../catalog-core/component-compositions.js";
import { applyComponentLibraryChange } from "../catalog-core/changeset-components.js";
import { componentDescriptorHash, componentLibraryHash, componentOf, resolveComponents } from "../catalog-core/resolve-components.js";
import type { ComponentCandidate, ComponentFile, ComponentLibrary, ComponentResolutionInput, ResolvedComponents } from "../catalog-core/resolve-components.js";
import { emitComponents } from "../catalog-core/emit-components.js";
import { isObservationPending } from "../catalog-core/check-components.js";
import { componentSecondaryExports } from "../catalog-core/component-secondary-exports.js";
import { declaredNames, packageRoot, resolveRuntime, resolveType, staticImports } from "./__fixtures__/selected-module-harness/inventory.js";
import { calendarCaller } from "./__fixtures__/selected-module-harness/calendar-caller.js";

/**
 * API-S1: the five Calendar-caption Select parts through the REAL consumer path.
 * Real consumer token/glyph values, real adoption of the generated fills with their
 * materialized source bundles, the real resolver/check (no observations supplied, so
 * the profile is honestly runtime-pending, never observations-pass) and the real
 * emitter. Package exports are independently inspected installed artifacts. The
 * @clossys/designer leaf (Icon/GlyphProvider) is this workspace's built dist, not
 * the packed archive; browser focus/geometry/forced-colour measurement is not
 * claimed here (jsdom only).
 */
const FIVE = ["SelectContent", "SelectGroup", "SelectItem", "SelectTrigger", "SelectValue"] as const;
const COHORT = [["components.button", "foundry"], ["components.icon", "foundry"], ["components.select", "shadcn@aria"], ["components.calendar", "shadcn@aria"]] as const;
const packageDirectory = resolve(import.meta.dirname, "../..");
const repository = resolve(packageDirectory, "../..");
const packageJson = resolve(packageDirectory, "package.json");
const lock = resolve(repository, "package-lock.json");
const DESIGNER = "@clossys/designer/components";

function consumerValues() {
  const values = loadCatalog();
  const order = ["foundry", "tailwind-default"];
  const offers = (slot: string) => values.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === slot && doc.$extensions["com.clossys.fill"].mode !== "reference").map(doc => doc.$extensions["com.clossys.fill"].source);
  const changes = values.slots.filter(slot => slot.layer === "themes" || slot.id.startsWith("assets.icon-")).flatMap(slot => {
    const sources = offers(slot.id); const source = order.find(name => sources.includes(name)) ?? sources[0];
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
const compileCaller = () => callerBuild ??= compileHost("harness/calendar-caller.tsx", calendarCaller);
/** Hold real animation frames across close so DOM removal cannot accidentally stand in for focus return. */
function holdCloseAnimationFrames() {
  const requestFrame = globalThis.requestAnimationFrame.bind(globalThis);
  const pending: FrameRequestCallback[] = [];
  let held = true;
  const spy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(callback => requestFrame(time => {
    if (held) pending.push(callback);
    else callback(time);
  }));
  onTestFinished(() => spy.mockRestore());
  return async () => {
    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(pending.length).toBeGreaterThan(0);
    });
    expect(document.activeElement).toBe(document.body);
    held = false;
    spy.mockRestore();
    for (const callback of pending) requestFrame(callback);
  };
}
/** Exports the selected leaf and entry namespaces from one bundle, so identity is judged inside one module graph. */
const identityHost = (leaf: string, entry: string) => `import * as leaf from "../${leaf.replace(/\.tsx?$/, ".js")}";\nimport * as entry from "../${entry.replace(/\.tsx?$/, ".js")}";\nexport { entry, leaf };\n`;

let input: ComponentResolutionInput, profile: ResolvedComponents, emitted: ComponentFile[], artifacts: { specifier: string; version: string; root: string; names: string[] }[];
let glyphModule: { path: string; glyphs: Record<string, unknown> };
const temp = mkdtempSync(resolve(repository, ".selected-api-calendar-"));

beforeAll(async () => {
  const values = consumerValues();
  const bundles = loadCatalogBundles(), registry = loadComponentRegistry();
  const catalog = { slots: registry.slots, fills: bundles.componentFills, rules: loadComponentCompositionRules() };
  const empty: ComponentLibrary = { source: { id: "selected-api", kind: "consumer", author: "consumer", license: "MIT" }, adoptedAt: "2026-10-27", fills: [], files: [] };
  const library = applyComponentLibraryChange(catalog, empty, { baseHash: componentLibraryHash(empty), changes: COHORT.map(([slot, source]) => ({ op: "adopt" as const, slot, source })) }, bundles.sourceBundles);
  const specifiers = new Set([...library.files, { path: "harness/calendar-caller.tsx", content: calendarCaller }].filter(row => /\.tsx?$/.test(row.path))
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
// jsdom implements no Element.scrollTo; RAC scrolls the focused option into view in an animation frame.
const elementScrollTo = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTo");
beforeAll(() => { if (!elementScrollTo) Object.defineProperty(Element.prototype, "scrollTo", { configurable: true, writable: true, value() {} }); });
afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
  if (!elementScrollTo) Reflect.deleteProperty(Element.prototype, "scrollTo");
});

describe("API-S1 selected Select parts through the generated leaf API (real resolver/emitter; jsdom, no browser claim)", () => {
  it("S1-1 resolves a checked, runtime-pending cohort whose adopted Select descriptor carries exactly five approvals", () => {
    expect(profile.check.ok).toBe(true);
    expect(profile.check.findings.length).toBeGreaterThan(0);
    expect(profile.check.findings.every(isObservationPending)).toBe(true);
    expect(JSON.parse(file(emitted, "components-consumption.json")).status).toBe("runtime-pending");
    const select = profile.components["components.select"]!;
    expect(select.origin).toMatchObject({ kind: "adopted", source: "shadcn@aria", sha256: componentDescriptorHash(select.descriptor) });
    expect(select.descriptor.secondaryExports).toEqual(FIVE.map(name => ({ name, export: name })));
    expect(componentSecondaryExports(select.descriptor, profile.files)).toEqual(FIVE.map(name => ({ name, export: name })));
    for (const slot of ["components.button", "components.icon", "components.calendar"]) expect(profile.components[slot]!.descriptor.secondaryExports, slot).toBeUndefined();
  });
  it("S1-1 publishes the five parts at the select leaf only, as direct same-entry reexports", () => {
    const leaf = file(emitted, "components/select/index.ts");
    expect(publicNames(leaf)).toEqual(["Select", ...FIVE].sort());
    for (const name of FIVE) expect(leaf).toContain(`export { ${name} } from "./select";`);
    expect(publicNames(file(emitted, "component-index.ts"))).toEqual(["Button", "Calendar", "Icon", "LibraryProvider", "Select"]);
    expect(publicNames(file(emitted, "components/calendar/index.ts"))).toEqual(["Calendar"]);
    expect(publicNames(file(emitted, "components/button/index.ts"))).toEqual(["Button"]);
  });
  it("S1-1 each leaf part is the selected entry's own runtime value, and no unapproved part is reachable", async () => {
    const identity = await compileHost("harness/identity.ts", identityHost("components/select/index.ts", "components/select/select.tsx"));
    expect({ diagnostics: identity.compiled.diagnostics, closure: identity.compiled.closureError, bundle: identity.compiled.bundle.errors }).toEqual({ diagnostics: [], closure: undefined, bundle: [] });
    expect(identity.compiled.status).toBe("compiled");
    const { leaf, entry } = await importBundle(identity.bundle) as { leaf: Record<string, unknown>; entry: Record<string, unknown> };
    expect(Object.keys(leaf).sort()).toEqual(["Select", ...FIVE].sort());
    for (const name of FIVE) {
      expect(typeof entry[name], name).toBe("function");
      expect(leaf[name], name).toBe(entry[name]);
    }
    for (const name of ["SelectList", "SelectInput", "SelectLabel", "SelectPopover", "SelectSeparator", "SelectEmpty"]) {
      expect(typeof entry[name], name).toBe("function");
      expect(leaf[name], name).toBeUndefined();
    }
  }, 120_000);
  it("S1-1 the approval adds only the five leaf lines: root and every other emitted byte are unchanged", () => {
    const library = structuredClone(input.library);
    const doc = library.fills.find(row => componentOf(row).slot === "components.select")!;
    const fill = doc.components.select! as ComponentCandidate & { origin: unknown };
    delete fill.secondaryExports;
    fill.origin = { kind: "authored", license: "MIT" };
    const without = emitComponents(resolveComponents({ ...input, library }), ["component-index"], { glyphModule: glyphModule as never });
    const withFive = emitted.filter(row => row.path !== "components-consumption.json");
    expect(without.map(row => row.path)).toEqual(withFive.map(row => row.path));
    for (const row of withFive) if (row.path !== "components/select/index.ts") expect(file(without, row.path), row.path).toBe(row.content);
    // The authored control is stamped with its own fill identity; that one stamp line is the only other difference.
    const stamp = (line: string) => line.startsWith("const stamp = ");
    const before = file(without, "components/select/index.ts").split("\n"), after = file(emitted, "components/select/index.ts").split("\n");
    expect(after.filter(line => !before.includes(line) && !stamp(line)).sort()).toEqual(FIVE.map(name => `export { ${name} } from "./select";`).sort());
    expect(before.filter(line => !after.includes(line) && !stamp(line))).toEqual([]);
    expect(after.filter(stamp)).toHaveLength(before.filter(stamp).length);
  });
  it("S1-2 the exact C0 calendar caller typechecks strictly, closes and bundles against the emitted graph", async () => {
    const { manifest, compiled } = await compileCaller();
    expect(compiled.diagnostics.map(row => `${row.file?.slice(manifest.root.length) ?? ""} ${row.message}`)).toEqual([]);
    expect(compiled.closureError).toBeUndefined();
    expect(compiled.bundle.errors).toEqual([]);
    expect(compiled.status).toBe("compiled");
    const callerEdges = compiled.edges.filter(edge => edge.from.endsWith("harness/calendar-caller.tsx") && edge.specifier === "../components/select/index.js");
    expect(callerEdges.flatMap(edge => edge.names.map(name => name.name)).sort()).toEqual(["Select", ...FIVE].sort());
  }, 120_000);
  it("S1-2 the exact caller renders one RAC Select collection: controlled string/numeric keys, disabled option, textValue, events, Escape and focus return", async () => {
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
    const trigger = screen.getByRole("button", { name: /January/ });
    expect(trigger).toHaveAttribute("data-slot", "select-trigger");
    expect(screen.getByRole("grid", { name: /Date/ })).toBeInTheDocument();
    expect(screen.getByRole("grid", { name: /Range/ })).toBeInTheDocument();
    // Keyboard-driven, as the repository's own Select tests are: RAC's mouse press does not open a Select under jsdom.
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    const listbox = await screen.findByRole("listbox");
    expect(screen.getAllByRole("listbox")).toHaveLength(1);
    expect(listbox).toHaveAttribute("data-slot", "select-list");
    const group = within(listbox).getByRole("group", { name: "Months" });
    expect(within(group).getAllByRole("option").map(option => option.textContent)).toEqual(["January", "February", "March"]);
    expect(within(group).getByRole("option", { name: "March" })).toHaveAttribute("aria-disabled", "true");
    expect(within(group).getByRole("option", { name: "January" })).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(within(group).getByRole("option", { name: "January" }));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(within(group).getByRole("option", { name: "February" }));
    await user.keyboard("{ArrowDown}");
    // The disabled March option is skipped, so focus stays on February and nothing is selected.
    expect(document.activeElement).toBe(within(group).getByRole("option", { name: "February" }));
    expect(events.filter(event => event.event === "selection")).toEqual([]);
    const releaseEnterFrames = holdCloseAnimationFrames();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    await releaseEnterFrames();
    expect(events.filter(event => event.event === "selection")).toEqual([{ event: "selection", key: "2", keyType: "string" }]);
    const updated = screen.getByRole("button", { name: /February/ });
    expect(updated).toBe(trigger);
    // RAC restores focus in an animation frame after unmount; this bundle's React is outside act().
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    await user.keyboard("{ArrowDown}");
    await screen.findByRole("listbox");
    const releaseEscapeFrames = holdCloseAnimationFrames();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    await releaseEscapeFrames();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(events.filter(event => event.event === "selection")).toHaveLength(1);
    await user.keyboard("{ArrowDown}");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowUp}");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(events.filter(event => event.event === "selection").at(-1)).toEqual({ event: "selection", key: 1, keyType: "number" });
    expect(screen.getByRole("button", { name: /January/ })).toBe(trigger);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(events.filter(event => event.event === "open").map(event => event.open)).toEqual([true, false, true, false, true, false]);
  }, 30_000);
  it("S1-4 keeps adoption, output and check refusals; no observations are fabricated", () => {
    const tampered = structuredClone(input.library);
    tampered.files = tampered.files.map(row => row.path === "components/select/select.tsx" ? { ...row, content: `${row.content} ` } : row);
    expect(() => resolveComponents({ ...input, library: tampered })).toThrow(/output hash differs/);
    const widened = structuredClone(input.library);
    const fill = widened.fills.find(row => componentOf(row).slot === "components.select")!.components.select!;
    fill.secondaryExports = [...fill.secondaryExports!, { name: "SelectList", export: "SelectList" }];
    expect(() => resolveComponents({ ...input, library: widened })).toThrow(/hand-edit requires authored origin/);
    const stale = structuredClone(profile);
    stale.components["components.select"]!.descriptor.secondaryExports = [...FIVE.map(name => ({ name, export: name })), { name: "SelectList", export: "SelectList" }];
    expect(() => emitComponents(stale, ["component-index"], { glyphModule: glyphModule as never })).toThrow(/secondary export descriptor differs from adoption/);
    const failed = structuredClone(profile); failed.check.ok = false;
    expect(() => emitComponents(failed, ["component-index"], { glyphModule: glyphModule as never })).toThrow(/checks failed/);
    expect(input.evidence?.observations).toEqual({});
  });
});
