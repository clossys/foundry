// @vitest-environment node
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import * as React from "react";
import { createElement, forwardRef, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CalendarDate } from "@internationalized/date";
import { synthetic, syntheticSource } from "./__fixtures__/component-engine/synthetic.js";
import { applyComponentLibraryChange, materializeSourceFill } from "./changeset-components.js";
import { assertComponentIdentifier, assertPackageSpecifier, componentLibraryHash, componentMaterializationReport, resolveComponents } from "./resolve-components.js";
import type { ComponentCandidateDocument } from "./resolve-components.js";
import { assertComponentImportClosure, componentMemberBinding, emitComponents } from "./emit-components.js";
import { stableStringify } from "./stable.js";
import { sha256 } from "./digest.js";
import { componentSourceHash } from "./check-components.js";

// Explicit local regeneration (UPDATE_COMPONENT_EMIT_GOLDENS=1) writes only a golden whose emitted bytes are passed.
const golden = (name: string, emitted?: string) => {
  const path = resolve(import.meta.dirname, "__golden__/components", name);
  if (emitted !== undefined && process.env.UPDATE_COMPONENT_EMIT_GOLDENS === "1") writeFileSync(path, emitted);
  return readFileSync(path, "utf8");
};
// Synthetic codegen goldens are written only by the emitter: UPDATE_COMPONENT_CODEGEN_GOLDENS=1.
const codegenGolden = (name: string, actual: string) => {
  if (process.env.UPDATE_COMPONENT_CODEGEN_GOLDENS === "1") writeFileSync(resolve(import.meta.dirname, "__golden__/components", name), actual);
  return golden(name, actual);
};
const packageExports = { "test-kit/components": ["Button"], "react-aria-components": ["Button"] };
const looseSurfaces = 'declare module "test-kit/components" { export const Button: import("react").ComponentType<Record<string, unknown>>; }\ndeclare module "react-aria-components" { export const Button: import("react").ComponentType<Record<string, unknown>>; }\n';
function typecheckSynthetic(files: readonly { path: string; content: string }[], surfaces = looseSurfaces): readonly string[] {
  const root = resolve(import.meta.dirname, "__synthetic_codegen__");
  const virtual = new Map(files.filter(file => /\.tsx?$/.test(file.path)).map(file => [resolve(root, file.path), file.content]));
  virtual.set(resolve(root, "surfaces.d.ts"), surfaces);
  const options: ts.CompilerOptions = { noEmit: true, jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [] };
  const host = ts.createCompilerHost(options);
  const originalFile = host.fileExists.bind(host), originalRead = host.readFile.bind(host), originalSource = host.getSourceFile.bind(host), originalDirectory = host.directoryExists!.bind(host);
  host.fileExists = path => virtual.has(path) || originalFile(path);
  host.readFile = path => virtual.get(path) ?? originalRead(path);
  host.directoryExists = path => path.startsWith(root) || originalDirectory(path);
  host.getSourceFile = (path, languageVersion, onError, create) => virtual.has(path) ? ts.createSourceFile(path, virtual.get(path)!, languageVersion) : originalSource(path, languageVersion, onError, create);
  const program = ts.createProgram([...virtual.keys()], options, host);
  return ts.getPreEmitDiagnostics(program).map(item => ts.flattenDiagnosticMessageText(item.messageText, "\n"));
}
function packageProfile() {
  const input = synthetic();
  const library = applyComponentLibraryChange(input.catalog, input.library, { baseHash: componentLibraryHash(input.library), changes: [{ op: "adopt", slot: input.candidate.slot, source: input.candidate.source }] });
  return resolveComponents({ catalog: input.catalog, library, values: input.check, evidence: input.check, packageExports });
}
describe("SYNTHETIC component code generation; no shipped conformance claims", () => {
  it("matches the all-package synthetic golden and parses every emitted TypeScript module", () => {
    const profile = packageProfile(); expect(profile.check.ok).toBe(true);
    const files = emitComponents(profile, ["component-index"]);
    expect(stableStringify(files)).toBe(codegenGolden("synthetic-package.json", stableStringify(files)));
    for (const file of files) expect(ts.transpileModule(file.content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true }).diagnostics).toEqual([]);
    expect(typecheckSynthetic(files)).toEqual([]);
  });
  it("matches a labeled mixed synthetic golden; source and package origins remain separate", async () => {
    const input = syntheticSource();
    const pkg = synthetic();
    const badge = structuredClone(pkg.doc);
    badge.$extensions["com.clossys.fill"].id = "test-kit/components.badge"; badge.$extensions["com.clossys.fill"].slot = "components.badge";
    badge.components = { badge: { ...pkg.candidate, slot: "components.badge" } };
    const catalog = { ...input.catalog, slots: [...input.catalog.slots, { ...input.catalog.slots[0]!, id: "components.badge" }], fills: [badge, input.doc] };
    const bundle = await materializeSourceFill(input.candidate, async () => input.upstream.content, [{ id: "synthetic@1", run: () => ({ files: [input.file, input.notice], blockers: [] }) }]);
    const library = applyComponentLibraryChange(catalog, input.library, { baseHash: componentLibraryHash(input.library), changes: [{ op: "adopt", slot: input.candidate.slot, source: input.candidate.source }, { op: "adopt", slot: "components.badge", source: "test-kit" }] }, [bundle]);
    const evidence = { ...input.check, observations: { ...input.check.observations, "components.badge": pkg.check.observations["components.button"] } };
    const profile = resolveComponents({ catalog, library, values: input.check, evidence, packageExports });
    expect(profile.check.ok).toBe(true);
    const files = emitComponents(profile, ["component-index"]);
    expect(stableStringify(files)).toBe(codegenGolden("synthetic-mixed.json", stableStringify(files)));
    expect(typecheckSynthetic(files)).toEqual([]);
    for (let seed = 1; seed <= 5; seed++) {
      let state = seed;
      const shuffle = <T,>(items: readonly T[]): T[] => {
        const result = [...items];
        for (let index = result.length - 1; index > 0; index--) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; const other = state % (index + 1); [result[index], result[other]] = [result[other]!, result[index]!]; }
        return result;
      };
      const permuted = resolveComponents({ catalog: { ...catalog, slots: shuffle(catalog.slots), fills: shuffle(catalog.fills) }, library: { ...library, fills: shuffle(library.fills), files: shuffle(library.files) }, values: input.check, evidence, packageExports });
      expect(emitComponents(permuted, ["component-index"])).toEqual(files);
    }
  });
  it("identifier guard rejects generated-code injection", () => {
    expect(() => assertComponentIdentifier('Button;throw Error("injected")')).toThrow(/identifier/);
  });
  it("specifier guard rejects generated-code injection", () => {
    expect(() => assertPackageSpecifier('test-kit/components";throw Error("injected")')).toThrow(/specifier/);
  });
  it("accepts one trailing comma in a named import list and refuses any other empty binding", () => {
    const file = (content: string) => [{ path: "components/button/button.tsx", content }];
    const observed = { "react-aria-components": ["Button", "Link"] };
    expect(() => assertComponentImportClosure(file('import {\n  Button,\n  type Link,\n} from "react-aria-components";'), observed)).not.toThrow();
    expect(() => assertComponentImportClosure(file('import { Button,, Link } from "react-aria-components";'), observed)).toThrow(/unavailable named import {2}from/);
    expect(() => assertComponentImportClosure(file('import { , } from "react-aria-components";'), observed)).toThrow(/unavailable named import {2}from/);
  });
  it("exempts type-only bindings of a listed package from the runtime inventory and keeps value bindings fail-closed", () => {
    const file = (content: string) => [{ path: "components/button/button.tsx", content }];
    // Runtime inventories are Object.keys of the module: erased type names never appear in them.
    const runtime = { "class-variance-authority": ["cva", "cx"], "react-aria-components": ["Button"] };
    expect(() => assertComponentImportClosure(file('import type { VariantProps } from "class-variance-authority";'), runtime)).not.toThrow();
    expect(() => assertComponentImportClosure(file('import { cva, type VariantProps } from "class-variance-authority";\nimport {\n  Button as ButtonPrimitive,\n  type ButtonProps as Props,\n} from "react-aria-components";'), runtime)).not.toThrow();
    expect(() => assertComponentImportClosure(file('export type { ButtonProps } from "react-aria-components";'), runtime)).not.toThrow();
    // The package itself must still be an observed dependency.
    expect(() => assertComponentImportClosure(file('import type { ClassValue } from "clsx";'), runtime)).toThrow(/unavailable named import ClassValue from clsx/);
    expect(() => assertComponentImportClosure(file('import { type ClassValue } from "clsx";'), runtime)).toThrow(/unavailable named import ClassValue from clsx/);
    // A value binding stays checked against runtime names, beside or without a type binding.
    expect(() => assertComponentImportClosure(file('import { VariantProps } from "class-variance-authority";'), runtime)).toThrow(/unavailable named import VariantProps from class-variance-authority/);
    expect(() => assertComponentImportClosure(file('import { type VariantProps, cvb } from "class-variance-authority";'), runtime)).toThrow(/unavailable named import cvb from class-variance-authority/);
    expect(() => assertComponentImportClosure(file('import { typeVariants } from "class-variance-authority";'), runtime)).toThrow(/unavailable named import typeVariants from class-variance-authority/);
    expect(() => assertComponentImportClosure(file('import type { 1Bad } from "class-variance-authority";'), runtime)).toThrow(/unavailable named import 1Bad/);
  });
  it("admits a namespace import only of an observed package dependency", () => {
    const file = (content: string) => [{ path: "components/button/button.tsx", content }];
    expect(() => assertComponentImportClosure(file('import * as React from "react";\nimport type * as Types from "react";'), { react: [] })).not.toThrow();
    expect(() => assertComponentImportClosure(file('import * as React from "react";'), {})).toThrow(/unsupported import syntax/);
    expect(() => assertComponentImportClosure([...file('import * as Parts from "../_parts/utils/index.js";'), { path: "components/_parts/utils/index.ts", content: "export function cn() {}" }], { react: [] })).toThrow(/unsupported import syntax/);
    expect(() => assertComponentImportClosure(file('import React from "react";'), { react: [] })).toThrow(/unsupported import syntax/);
    expect(() => assertComponentImportClosure(file('import * as React, { useState } from "react";'), { react: ["useState"] })).toThrow(/unsupported import syntax/);
  });
  it("closes named imports and rejects unsupported mapping grammar or unavailable observations", () => {
    expect(() => assertComponentImportClosure([{ path: "components/calendar/calendar.tsx", content: 'import { buttonVariants } from "../button/index.js";' }, { path: "components/button/index.ts", content: 'export { Button } from "test-kit/components";' }], packageExports)).toThrow(/unavailable named import/);
    const profile = packageProfile();
    profile.components["components.button"]!.descriptor.propMap = { "variant.primary": "Button[arbitrary()]" };
    profile.components["components.button"]!.propMap = profile.components["components.button"]!.descriptor.propMap;
    expect(() => emitComponents(profile, ["component-index"])).toThrow(/unsupported propMap/);
    const missing = packageProfile(); missing.check = { ok: false, findings: [] };
    expect(() => emitComponents(missing, ["component-index"])).toThrow(/checks failed/);
    expect(JSON.parse(emitComponents(missing, ["components-consumption"])[0]!.content).status).toBe("blocked");
  });
  it("dispatches a compound sub-part (Export.Part) and serves CSS pseudo-class states intrinsically", () => {
    const profile = packageProfile(), button = profile.components["components.button"]!;
    const axis = button.descriptor.members.find(member => member.includes("."))!;
    expect(componentMemberBinding(button, "scope.group", "./components#Button.Group")).toEqual({ module: "test-kit/components", name: "Button", part: "Group" });
    expect(componentMemberBinding(button, "presentation.inline", "./components#Button.Inline.size=sm")).toEqual({ module: "test-kit/components", name: "Button", part: "Inline", property: "size", value: "sm" });
    for (const [member, pseudo] of [["state.hover", ":hover"], ["state.pressed", ":active"], ["state.focus-visible", ":focus-visible"]] as const) {
      expect(componentMemberBinding(button, member, `./components#Button${pseudo}`)).toEqual({ module: "test-kit/components", name: "Button", intrinsic: true });
    }
    // A pseudo-class is an interaction state only: it never binds a non-state member, and a part is never lower-case.
    expect(() => componentMemberBinding(button, "variant.primary", "./components#Button:hover")).toThrow(/unsupported propMap/);
    expect(() => componentMemberBinding(button, "scope.group", "./components#Button.group.Group")).toThrow(/unsupported propMap/);
    button.descriptor.propMap = { ...button.descriptor.propMap, [axis]: "./components#Button.Group" };
    button.propMap = button.descriptor.propMap;
    const index = emitComponents(profile, ["component-index"]).find(file => file.path === "components/button/index.ts")!.content;
    expect(index).toContain('"Impl0.Group": Impl0.Group');
    expect(index).toContain('"target": "Impl0.Group"');
    expect(ts.transpileModule(index, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true }).diagnostics).toEqual([]);
  });
  it("typechecks a dispatch index over a real generic compound component without erasing its props", () => {
    const profile = packageProfile(), button = profile.components["components.button"]!;
    const axis = button.descriptor.members.find(member => member.includes("."))!;
    button.descriptor.propMap = { ...button.descriptor.propMap, [axis]: "./components#Button.Group" };
    button.propMap = button.descriptor.propMap;
    const files = emitComponents(profile, ["component-index"]);
    expect(files.find(file => file.path === "components/button/index.ts")!.content).toContain('"Impl0.Group": Impl0.Group');
    // Typed like a real library export: generic, with required props and a static sub-component.
    const surfaces = `declare module "test-kit/components" {
  import type { ForwardRefExoticComponent, ReactElement, RefAttributes } from "react";
  interface ButtonProps<T extends object> { label: string; items?: readonly T[]; ground?: "base" | "inverse"; size?: "md"; state?: "hover"; variant?: "primary" }
  export const Button: (<T extends object = object>(props: ButtonProps<T> & RefAttributes<HTMLButtonElement>) => ReactElement) & { Group: ForwardRefExoticComponent<{ orientation: "horizontal" | "vertical" } & RefAttributes<HTMLDivElement>> };
}
`;
    expect(typecheckSynthetic(files, surfaces)).toEqual([]);
  });
  it("emits a runtime-pending selection with the same code and never reports it as observations-pass", () => {
    const observed = packageProfile(), input = synthetic();
    const library = applyComponentLibraryChange(input.catalog, input.library, { baseHash: componentLibraryHash(input.library), changes: [{ op: "adopt", slot: input.candidate.slot, source: input.candidate.source }] });
    const pending = resolveComponents({ catalog: input.catalog, library, values: input.check, evidence: { ...input.check, observations: {} }, packageExports });
    expect(pending.check.ok).toBe(true);
    expect(pending.check.findings.length).toBeGreaterThan(0);
    expect(pending.check.findings.every(finding => finding.severity === "notice")).toBe(true);
    const status = (profile: typeof observed) => JSON.parse(emitComponents(profile, ["components-consumption"])[0]!.content).status;
    expect(status(pending)).toBe("runtime-pending");
    expect(status(observed)).toBe("observations-pass");
    expect(emitComponents(pending, ["component-index"])).toEqual(emitComponents(observed, ["component-index"]));
  });
  it.each(["select", "combo-box", "calendar", "popover", "checkbox"])("owns exactly one %s facade in a checker-approved SYNTHETIC selected layout", async leaf => {
    // Synthetic Button protocol under the selected path layout: this proves the
    // generator's ownership/dispatch algorithm, never these real components.
    const input = syntheticSource(), slot = `components.${leaf}`;
    const name = leaf.split("-").map(part => part[0]!.toUpperCase() + part.slice(1)).join("");
    const file = { path: `components/${leaf}/${leaf}.tsx`, content: `import { Button } from "react-aria-components"; export { Button as ${name}${leaf === "calendar" ? ", Button as RangeCalendar" : ""} };\n` };
    const candidate = input.candidate;
    candidate.slot = slot; candidate.impl = { kind: "source", entry: file.path, export: name };
    candidate.propMap = Object.fromEntries(candidate.members.map(member => [member, `${name}.${member.replace(".", "=")}`]));
    const contract = structuredClone(input.catalog.slots[0]!); contract.id = slot;
    if (leaf === "calendar") {
      candidate.members = [...candidate.members, "selection.single", "selection.range"];
      candidate.propMap = { ...candidate.propMap, "selection.single": name, "selection.range": "RangeCalendar" };
      if (contract.contract.members.mode === "closed") contract.contract.members.names = [...candidate.members];
    }
    candidate.outputSha256 = [file, input.notice].map(file => ({ path: file.path, sha256: sha256(file.content) }));
    input.doc.components = { [leaf]: candidate };
    Object.assign(input.doc.$extensions["com.clossys.fill"], { id: `test-kit/${slot}`, slot });
    const catalog = { ...input.catalog, slots: [contract] };
    const observed = input.check.observations["components.button"]!;
    observed.files = [file, input.notice]; observed.sourceHash = componentSourceHash(observed.files); observed.outputSha256 = candidate.outputSha256;
    const checks = { ...input.check, slots: [contract], fills: [candidate], observations: { [slot]: observed } };
    const bundle = await materializeSourceFill(candidate, async () => input.upstream.content, [{ id: "synthetic@1", run: () => ({ files: [file, input.notice], blockers: [] }) }]);
    const library = applyComponentLibraryChange(catalog, input.library, { baseHash: componentLibraryHash(input.library), changes: [{ op: "adopt", slot, source: candidate.source }] }, [bundle]);
    const profile = resolveComponents({ catalog, library, values: checks, evidence: checks, packageExports });
    expect(profile.check.ok, JSON.stringify(profile.check.findings)).toBe(true);
    const files = emitComponents(profile, ["component-index"]), path = `components/${leaf}/index.ts`;
    expect(files.filter(file => file.path === path)).toHaveLength(1);
    if (leaf === "calendar") {
      expect(files.find(file => file.path === path)!.content).toContain('"range"');
      expect(files.find(file => file.path === path)!.content).toContain("RangeCalendar as Impl");
    }
    const withStoredIndex = { ...profile, files: [...profile.files, { path, content: `export { ${name} } from "./${leaf}.js";` }] };
    expect(() => emitComponents(withStoredIndex, ["component-index"])).toThrow(/generated entrypoint conflicts/);
  });
  it("still refuses unobserved namespace, wildcard syntax and unavailable selected subparts", () => {
    const path = "components/select/select.tsx";
    expect(() => assertComponentImportClosure([{ path, content: 'import * as React from "react"; export const Select = React.Fragment;' }], { "react-dom": ["Fragment"] })).toThrow(/unsupported import syntax/);
    expect(() => assertComponentImportClosure([{ path, content: 'export * from "react";' }], { react: ["Fragment"] })).toThrow(/wildcard/);
    expect(() => assertComponentImportClosure([
      { path: "components/calendar/calendar.tsx", content: 'import { SelectTrigger } from "../select/index.js";' },
      { path: "components/select/index.ts", content: 'export { Select } from "test-kit/components";' },
    ], { "test-kit/components": ["Select"] })).toThrow(/unavailable named import SelectTrigger/);
  });
});

// A Select-shaped synthetic leaf: the same checker-approved package profile renamed, so the stamping
// wrapper is exercised over an export that carries a compound static (Select.Item).
function selectProfile(identity: boolean) {
  const profile = packageProfile(), button = profile.components["components.button"]!;
  const select = JSON.parse(JSON.stringify(button).replaceAll("components.button", "components.select").replaceAll("Button", "Select")) as typeof button;
  if (identity) { select.descriptor.propMap = Object.fromEntries(Object.keys(select.propMap).map(member => [member, "./components#Select"])); select.propMap = select.descriptor.propMap; }
  delete profile.components["components.button"]; profile.components["components.select"] = select;
  (profile as { packageExports: Record<string, readonly string[]> }).packageExports = { ...profile.packageExports, "test-kit/components": ["Select"] };
  return profile;
}
function loadIndex(content: string, kit: Record<string, unknown>): Record<string, unknown> {
  const { outputText } = ts.transpileModule(content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  const modules: Record<string, unknown> = { react: React, "test-kit/components": kit }, exports: Record<string, unknown> = {};
  new Function("require", "exports", outputText)((id: string) => { if (!Object.hasOwn(modules, id)) throw new Error(`unexpected import ${id}`); return modules[id]; }, exports);
  return exports;
}
describe("provenance stamping wrapper (D1, D2)", () => {
  it.each([["identity", true], ["dispatch", false]] as const)("%s index stamps data-ds-*, forwards ref and keeps Select.Item", (_label, identity) => {
    const files = emitComponents(selectProfile(identity), ["component-index"]);
    const index = files.find(file => file.path === "components/select/index.ts")!.content;
    expect(index).toContain(identity ? "const target = Impl0 satisfies" : "const targets = { Impl0 } satisfies");
    expect(index).not.toMatch(/use client|useState|useContext|useEffect/);
    expect(index).not.toMatch(/from "\.[^"]*\.(?:js|ts|tsx)"/);
    const Item = (props: { children?: ReactNode }) => createElement("li", { role: "option" }, props.children);
    const refs: unknown[] = [];
    const Impl = Object.assign(forwardRef<HTMLUListElement, Record<string, unknown>>(function Impl(props, ref) { refs.push(ref); return createElement("ul", { ...props, ref }); }), { Item });
    const { Select } = loadIndex(index, { Select: Impl }) as { Select: React.ForwardRefExoticComponent<Record<string, unknown>> & { Item: typeof Item; render: (props: object, ref: unknown) => React.ReactElement<{ ref?: unknown }> } };
    expect(Select.Item).toBe(Item);
    const ref = { current: null };
    const html = renderToStaticMarkup(createElement(Select, { ref, ...(identity ? {} : { variant: "primary" }) }, createElement(Select.Item, null, "One")));
    for (const attr of ['data-ds-layer="components"', 'data-ds-leaf="components.select"', 'data-ds-fill="test-kit/components.select"']) expect(html).toContain(attr);
    expect(html).toMatch(/^<ul [^>]*><li role="option">One<\/li><\/ul>$/);
    expect(refs).toContain(ref);
    expect(Select.render({}, ref).props.ref).toBe(ref);
  });
  it("typechecks one emitted wrapped index with a ref and Select.Item usage: 0 diagnostics", () => {
    const surfaces = `declare module "test-kit/components" {
  import type { ForwardRefExoticComponent, ReactNode, RefAttributes } from "react";
  interface SelectProps { label: string; ground?: "base" | "inverse"; size?: "md"; state?: "hover"; variant?: "primary"; children?: ReactNode }
  export const Select: ForwardRefExoticComponent<SelectProps & RefAttributes<HTMLDivElement>> & { Item: (props: { id: string; children?: ReactNode }) => ReactNode };
}
`;
    const usage = { path: "usage.ts", content: 'import { createElement, createRef } from "react";\nimport { Select } from "./component-index";\nconst ref = createRef<HTMLDivElement>();\nexport const usage = createElement(Select, { ref, label: "Pick" }, createElement(Select.Item, { id: "a" }, "A"));\n// @ts-expect-error the wrapped identity export keeps the implementation props\nexport const wrong = createElement(Select, { label: 1 });\n' };
    expect(typecheckSynthetic([...emitComponents(selectProfile(true), ["component-index"]), usage], surfaces)).toEqual([]);
    const dispatchUsage = { path: "usage.ts", content: 'import { createElement, createRef } from "react";\nimport { Select } from "./component-index";\nexport const usage = createElement(Select, { ref: createRef<HTMLDivElement>(), variant: "primary" }, createElement(Select.Item, { id: "a" }, "A"));\n' };
    expect(typecheckSynthetic([...emitComponents(selectProfile(false), ["component-index"]), dispatchUsage], surfaces)).toEqual([]);
  });
});
// A DateField-shaped synthetic leaf (2b P1): the checker-approved package profile renamed, with the given
// propMap and the implementation's real props, so a member axis can share its name with a real prop.
function dateFieldProfile(propMap: Record<string, string>) {
  const profile = packageProfile(), button = profile.components["components.button"]!;
  const field = JSON.parse(JSON.stringify(button).replaceAll("components.button", "components.date-field").replaceAll("Button", "DateField")) as typeof button;
  field.descriptor.propMap = propMap; field.propMap = propMap;
  (field.descriptor as { props: readonly string[] }).props = ["className", "granularity", "isInvalid", "label", "value"];
  delete profile.components["components.button"]; profile.components["components.date-field"] = field;
  (profile as { packageExports: Record<string, readonly string[]> }).packageExports = { ...profile.packageExports, "test-kit/components": ["DateField"] };
  return profile;
}
const root = "./components#DateField";
describe("bare-root member axes named after a real prop (2b P1)", () => {
  it("DateField value={CalendarDate} reaches the implementation: a value.date/value.time bare-root axis never dispatches the value prop", () => {
    const files = emitComponents(dateFieldProfile({ "value.date": root, "value.time": root, granularity: root, "state.invalid": `${root}.isInvalid` }), ["component-index"]);
    const index = files.find(file => file.path === "components/date-field/index.ts")!.content;
    expect(index).not.toContain('"value": {');
    const seen: Record<string, unknown>[] = [];
    const Impl = forwardRef<HTMLDivElement, Record<string, unknown>>(function Impl(props, ref) { seen.push(props); return createElement("div", { ref, "data-ds-leaf": props["data-ds-leaf"] }, String(props.value)); });
    const { DateField } = loadIndex(index, { DateField: Impl }) as { DateField: React.ComponentType<Record<string, unknown>> };
    const value = new CalendarDate(2026, 10, 26);
    expect(renderToStaticMarkup(createElement(DateField, { label: "Due", value, state: "invalid" }))).toBe('<div data-ds-leaf="components.date-field">2026-10-26</div>');
    expect(seen[0]!.value).toBe(value);
    expect(seen[0]!.isInvalid).toBe(true);
    expect(seen[0]).not.toHaveProperty("state");
  });
  it("refuses an axis that is both a real prop and a dispatch axis", () => {
    expect(() => emitComponents(dateFieldProfile({ "value.date": root, "value.time": `${root}.granularity=minute` }), ["component-index"])).toThrow(/member axis value is a real prop of DateField/);
  });
  it("the committed foundry DateField fill has no member axis named after one of its props", () => {
    const doc = JSON.parse(readFileSync(resolve(import.meta.dirname, "../catalog/fills/foundry/components.date-field.json"), "utf8")) as ComponentCandidateDocument;
    const fill = doc.components["date-field"]!;
    expect(fill.members.filter(member => member.includes(".") && fill.props.includes(member.split(".")[0]!))).toEqual([]);
    expect(fill.members).toEqual(expect.arrayContaining(["content.date", "content.time"]));
  });
});
describe("real source materialization remains blocked", () => {
  it("reports 24 of 26 descriptors blocked and refuses real button, select and calendar adoption", () => {
    const directory = resolve(import.meta.dirname, "../catalog/fills/shadcn@aria");
    const fills = readdirSync(directory).filter(path => path !== "components.coverage.json").map(path => JSON.parse(readFileSync(resolve(directory, path), "utf8")) as ComponentCandidateDocument);
    const input = synthetic();
    const report = componentMaterializationReport({ ...input.catalog, fills });
    expect(stableStringify(report)).toBe(golden("real-blocked.json"));
    expect(report.blockedCount).toBe(24); expect(report.descriptorCount).toBe(26);
    for (const slot of ["components.button", "components.select", "components.calendar"]) {
      const catalog = { ...input.catalog, slots: [{ ...input.catalog.slots[0]!, id: slot }], fills };
      expect(() => applyComponentLibraryChange(catalog, input.library, { baseHash: componentLibraryHash(input.library), changes: [{ op: "adopt", slot, source: "shadcn@aria" }] })).toThrow(/blocked materialization/);
    }
  });
});
