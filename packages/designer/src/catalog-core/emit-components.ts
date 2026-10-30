import { CatalogError } from "./api.js";
import { stableStringify } from "./stable.js";
import { assertComponentDescriptor, assertComponentIdentifier, assertComponentPath, assertPackageSpecifier, componentDescriptorHash, sortedComponentIds, verifyComponentOutput } from "./resolve-components.js";
import { componentSecondaryExports } from "./component-secondary-exports.js";
import { isObservationPending } from "./check-components.js";
import { inspectGlyph } from "../catalog-assets/svg.js";
import { dsAttrs, type DsAttrs } from "./provenance-attrs.js";
import type { ComponentFile, ResolvedComponent, ResolvedComponents } from "./resolve-components.js";

export type ComponentEmitTarget = "component-index" | "notices" | "components-consumption";
export interface ComponentEmitOptions {
  /** Generated S2 module, with its exact export inventory supplied by the integration caller. */
  glyphModule?: { path: string; glyphs: Readonly<Record<string, unknown>> };
}
/** One contract member bound to its implementation export, as the emitted component index dispatches it. */
export interface ComponentMemberBinding { module: string; name: string; part?: string; property?: string; value?: string | boolean; intrinsic?: true }
type Binding = ComponentMemberBinding;
const nameOf = (slot: string): string => slot.slice(11).split("-").map(part => part[0]!.toUpperCase() + part.slice(1)).join("");
const quote = (value: unknown): string => JSON.stringify(value);
function relative(from: string, to: string): string {
  const a = from.split("/").slice(0, -1), b = to.split("/");
  while (a.length && b.length && a[0] === b[0]) { a.shift(); b.shift(); }
  // Extensionless: bundler resolvers (Turbopack, jiti) find a .ts/.tsx module by extension search only.
  return `${a.length ? "../".repeat(a.length) : "./"}${b.join("/").replace(/\.tsx?$/, "")}`;
}
function exportedNames(code: string): string[] {
  if (/\bexport\s*\*/.test(code)) throw new CatalogError("components: wildcard exports require an explicit inspected surface");
  const names = [...code.matchAll(/\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map(match => match[1]!);
  for (const group of code.matchAll(/\bexport\s*\{([^}]+)\}/g)) for (const item of group[1]!.split(",")) {
    const name = item.trim().replace(/^type\s+/, "").split(/\s+as\s+/).at(-1);
    if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
  }
  return sortedComponentIds(names);
}
function targetPath(from: string, specifier: string, paths: ReadonlySet<string>): string | undefined {
  if (!/^(?:\.\.?\/)+(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+$/.test(specifier)) throw new CatalogError("components: unsafe relative module specifier");
  const parts = from.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === ".") continue;
    if (part === "..") { if (!parts.length) throw new CatalogError("components: import escapes library"); parts.pop(); }
    else parts.push(part);
  }
  const path = parts.join("/");
  return [path, `${path}.ts`, `${path}.tsx`, path.replace(/\.js$/, ".ts"), path.replace(/\.js$/, ".tsx")].find(path => paths.has(path));
}
/** Static, named imports only. Unsupported syntax stays an error rather than an inferred surface. */
export function assertComponentImportClosure(files: readonly ComponentFile[], packageExports: ResolvedComponents["packageExports"]): void {
  const paths = new Set(files.map(file => file.path));
  for (const file of files.filter(file => /\.tsx?$/.test(file.path))) {
    // Comments can contain import-looking text; strip them without modifying quoted module text.
    const commentless = file.content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // Namespace types are erased. Lowercase member reads (React hooks/factories)
    // still require observed runtime exports, just like named value imports.
    const code = commentless.replace(/\bimport\s+(type\s+)?\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["']\s*;?/g, (statement, erased: string | undefined, local: string, specifier: string) => {
      if (specifier.startsWith(".")) throw new CatalogError(`components: unsupported import syntax in ${file.path}`);
      assertPackageSpecifier(specifier);
      if (!Object.hasOwn(packageExports, specifier)) throw new CatalogError(`components: unsupported import syntax in ${file.path}`);
      const escaped = local.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\b${escaped}\\s*\\[`).test(commentless)) throw new CatalogError(`components: unsupported computed namespace read in ${file.path}`);
      for (const read of commentless.matchAll(new RegExp(`\\b${escaped}\\s*\\.\\s*([a-z_$][\\w$]*)`, "g"))) {
        if (erased || !packageExports[specifier]!.includes(read[1]!)) throw new CatalogError(`components: unavailable namespace member ${read[1]} from ${specifier}`);
      }
      return "";
    });
    if (/\b(?:import|require)\s*\(/.test(code) || /\bimport\s+(?!type\s*\{|\{)[^;\n]*\bfrom\b/.test(code) || /\bimport\s*["']/.test(code)) throw new CatalogError(`components: unsupported import syntax in ${file.path}`);
    for (const match of code.matchAll(/\b(?:import|export)\s+(type\s+)?\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
      const specifier = match[3]!, typeOnlyStatement = match[1] !== undefined;
      let names: readonly string[];
      let listed = true;
      if (specifier.startsWith(".")) {
        const path = targetPath(file.path, specifier, paths);
        if (!path) throw new CatalogError(`components: missing import ${specifier}`);
        names = exportedNames(files.find(file => file.path === path)!.content);
      } else {
        assertPackageSpecifier(specifier);
        names = packageExports[specifier] ?? [];
        listed = Object.hasOwn(packageExports, specifier);
      }
      // One trailing comma closes a multi-line list in valid source; any other empty binding is refused.
      for (const binding of match[2]!.replace(/,\s*$/, "").split(",")) {
        const typeOnly = typeOnlyStatement || /^\s*type\s+/.test(binding);
        const imported = binding.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0];
        // A package type binding is erased at compile time and checked by the compiler, so a runtime
        // inventory cannot hold it; the package itself must still be observed. Value bindings stay closed.
        const available = typeOnly && !specifier.startsWith(".") ? listed : names.includes(imported ?? "");
        if (!imported || !/^[A-Za-z_$][\w$]*$/.test(imported) || !available) throw new CatalogError(`components: unavailable named import ${imported} from ${specifier}`);
      }
    }
    if (/\bexport\s*\*/.test(code)) throw new CatalogError("components: wildcard source exports are unsupported");
    const remaining = code.replace(/\bimport\s+(?:type\s+)?\{[^}]+\}\s*from\s*["'][^"']+["']\s*;?/g, "");
    if (/\bimport\b/.test(remaining)) throw new CatalogError("components: unverified import syntax");
  }
}
/**
 * Parse one propMap pointer. The emitted component index and the Studio specimen renderer share
 * this rule, so a specimen dispatches each member exactly as the generated adapter would.
 */
export function componentMemberBinding(component: ResolvedComponent, member: string, pointer: string): ComponentMemberBinding { return parseBinding(component, member, pointer); }
// Interaction states the implementation sets itself: RAC data attributes, or CSS pseudo-classes on a native element.
const INTRINSIC_STATE = /(?:\[data-(?:hovered|pressed|focus-visible)\]|:(?:hover|active|focus-visible))$/;
/** Export, Export.Part (a static compound sub-component), then optionally .prop or .prop=value. */
function parseBinding(component: ResolvedComponent, member: string, pointer: string): Binding {
  const intrinsic = INTRINSIC_STATE.test(pointer) && member.startsWith("state.");
  const clean = intrinsic ? pointer.replace(INTRINSIC_STATE, "") : pointer;
  const match = /^(?:\.\/([A-Za-z0-9_/-]+)#)?([A-Z][A-Za-z0-9]*)(?:\.([A-Z][A-Za-z0-9]*))?(?:\.([a-z][A-Za-z0-9]*)(?:=([a-z0-9-]+))?)?$/.exec(clean);
  if (!match) throw new CatalogError(`components: unsupported propMap ${component.slot}.${member}`);
  assertComponentIdentifier(match[2]!);
  if (match[3]) assertComponentIdentifier(match[3]);
  let module: string;
  if (component.impl.kind === "package") {
    const pin = component.descriptor.pin;
    module = match[1] ? `${pin!.package}/${match[1]}` : component.impl.module;
    assertPackageSpecifier(module);
  } else {
    if (match[1]) throw new CatalogError("components: source propMap cannot select a package subpath");
    module = component.impl.entry;
  }
  const value = match[5] === "true" ? true : match[5] === "false" ? false : match[5];
  return { module, name: match[2]!, ...(match[3] ? { part: match[3] } : {}), ...(match[4] ? { property: match[4], value: value ?? true } : {}), ...(intrinsic ? { intrinsic: true } : {}) };
}
/**
 * Whether a selection's emitted code includes the consumer glyph module: a selected leaf reads an asset,
 * or the asset Icon adapter is selected, whose leaf imports that module whatever else is selected.
 */
export function emitsGlyphModule(components: readonly { slot: string; reads: { assets: readonly string[] } }[]): boolean {
  return components.some(component => component.slot === "components.icon" || component.reads.assets.length > 0);
}
/** The selected fill a component stamp names: the adopted catalog fill, otherwise the consumer's own fill. */
export function componentFillId(component: Pick<ResolvedComponent, "slot" | "origin">, consumer: string): string {
  return component.origin.kind === "adopted" ? component.origin.fill : `${consumer}/${component.slot}`;
}
// Server-safe stamping (D2): no hooks, context or client directive. Statics (Select.Item) are hoisted from the
// implementation except React's own keys, so the wrapper keeps the export's compound surface.
function stampRows(stamp: DsAttrs): string[] {
  return [
    `const stamp = ${JSON.stringify(stamp)} as const;`,
    'const reactKeys = new Set(["$$typeof", "render", "type", "compare", "displayName", "propTypes", "defaultProps", "contextType", "contextTypes", "childContextTypes", "getDefaultProps", "getDerivedStateFromProps", "getDerivedStateFromError", "mixins", "length", "name", "prototype", "arguments", "caller"]);',
    'function statics(impl: unknown): Record<string, unknown> {',
    '  const hoisted: Record<string, unknown> = {};',
    '  if (typeof impl === "function" || (typeof impl === "object" && impl !== null)) for (const key of Object.getOwnPropertyNames(impl)) if (!reactKeys.has(key)) hoisted[key] = (impl as Record<string, unknown>)[key];',
    '  return hoisted;',
    '}',
  ];
}
function leafModule(component: ResolvedComponent, packageExports: ResolvedComponents["packageExports"], files: readonly ComponentFile[], fill: string, glyphModule?: ComponentEmitOptions["glyphModule"]): ComponentFile {
  const path = `components/${component.slot.slice(11)}/index.ts`;
  const stamp = dsAttrs("components", component.slot, fill);
  const name = nameOf(component.slot); assertComponentIdentifier(name);
  assertComponentDescriptor(component.descriptor);
  if (component.descriptor.secondaryExports !== undefined) {
    if (component.origin.kind === "adopted" && componentDescriptorHash(component.descriptor) !== component.origin.sha256) throw new CatalogError("components: secondary export descriptor differs from adoption");
    verifyComponentOutput(component.descriptor, files);
  }
  const secondaries = componentSecondaryExports(component.descriptor, files);
  if (component.slot !== component.descriptor.slot || stableStringify(component.impl) !== stableStringify(component.descriptor.impl) || stableStringify(component.propMap) !== stableStringify(component.descriptor.propMap)) throw new CatalogError("components: resolved descriptor differs");
  const base: Binding = { module: component.impl.kind === "package" ? component.impl.module : component.impl.entry, name: component.impl.export };
  const bindings = Object.entries(component.propMap).sort(([a], [b]) => a < b ? -1 : 1).map(([member, pointer]) => ({ member, binding: parseBinding(component, member, pointer) }));
  const imports = new Map<string, string>();
  for (const binding of [base, ...bindings.map(item => item.binding)]) {
    if (component.impl.kind === "package" && !packageExports[binding.module]?.includes(binding.name)) throw new CatalogError(`components: unavailable package export ${binding.name}`);
    const key = `${binding.module}#${binding.name}`;
    if (!imports.has(key)) imports.set(key, `Impl${imports.size}`);
  }
  const rows: string[] = [];
  for (const [key, local] of imports) {
    const [module, imported] = key.split("#") as [string, string];
    if (component.impl.kind === "package") assertPackageSpecifier(module);
    else assertComponentPath(module);
    rows.push(`import { ${imported} as ${local} } from ${quote(component.impl.kind === "package" ? module : relative(path, module))};`);
  }
  for (const row of secondaries) rows.push(`export { ${row.export}${row.export === row.name ? "" : ` as ${row.name}`} } from ${quote(relative(path, base.module))};`);
  if (component.slot === "components.icon") {
    if (!glyphModule) throw new CatalogError("components: asset Icon adapter requires glyphs");
    if (!component.descriptor.props.includes("glyph")) throw new CatalogError("components: unsupported asset Icon adapter mapping");
    rows.unshift('import { createElement, type ComponentProps } from "react";', `import { glyphs } from ${quote(relative(path, glyphModule.path))};`);
    const impl = imports.get(`${base.module}#${base.name}`)!;
    rows.push('type WithAsset<Props> = Props extends unknown ? Omit<Props, "glyph" | "children"> & { asset: keyof typeof glyphs } : never;');
    rows.push(`const stamp = ${JSON.stringify(stamp)} as const;`);
    rows.push(`export function Icon({ asset, ...props }: WithAsset<ComponentProps<typeof ${impl}>>) {`);
    rows.push('  const glyph = glyphs[asset]; if (!glyph) throw new Error("Missing consumer glyph");');
    rows.push(`  return createElement(${impl}, { ...props, ...stamp, glyph });`, '}');
    return { path, content: rows.join("\n") + "\n" };
  }
  // When every contract member maps to the same export, the stamping wrapper keeps that export's own type.
  const identity = bindings.every(({ binding }) => binding.module === base.module && binding.name === base.name && !binding.part && !binding.property);
  const baseLocal = imports.get(`${base.module}#${base.name}`)!;
  rows.unshift('import { createElement, forwardRef, type ComponentType } from "react";');
  rows.push(...stampRows(stamp));
  if (identity) {
    rows.push(`const target = ${baseLocal} satisfies ((props: never) => unknown) | (new (props: never) => unknown);`);
    rows.push(`const Stamped = forwardRef<unknown, Record<string, unknown>>(function ${name}(props, ref) {`);
    rows.push('  return createElement(target as unknown as ComponentType<Record<string, unknown>>, { ...props, ...stamp, ref });');
    rows.push('});');
    rows.push(`export const ${name} = Object.assign(Stamped, statics(${baseLocal})) as unknown as typeof ${baseLocal};`);
    return { path, content: rows.join("\n") + "\n" };
  }
  const table: Record<string, Record<string, { target: string; property?: string; value?: string | boolean }>> = Object.create(null);
  const partTargets = new Set<string>();
  const passThrough = new Set<string>();
  for (const { member, binding } of bindings) {
    if (binding.intrinsic) continue;
    const parts = member.split(".");
    const bareRoot = binding.module === base.module && binding.name === base.name && !binding.part && !binding.property;
    // A single-axis capability member mapped to the root export itself is served by that root: nothing to dispatch.
    if (parts.length === 1 && bareRoot) continue;
    // So is a bare-root member whose axis is one of the export's real props (DateField `value`): the caller's
    // prop value (a CalendarDate) is never a member key, so it reaches the root untouched.
    if (parts.length === 2 && bareRoot && component.descriptor.props.includes(parts[0]!)) { passThrough.add(parts[0]!); continue; }
    if (parts.length !== 2 || !/^[a-z][a-z0-9-]*$/.test(parts[0]!) || !/^[a-z][a-z0-9-]*$/.test(parts[1]!)) throw new CatalogError(`components: unsupported member dispatch ${member}`);
    const axis = parts[0]!, value = parts[1]!;
    // A compound sub-part dispatches to a static property of its imported export (Disclosure.Group).
    const target = `${imports.get(`${binding.module}#${binding.name}`)!}${binding.part ? `.${binding.part}` : ""}`;
    if (binding.part) partTargets.add(target);
    table[axis] ??= Object.create(null) as Record<string, { target: string; property?: string; value?: string | boolean }>;
    table[axis]![value] = { target, ...(binding.property ? { property: binding.property, value: binding.value } : {}) };
  }
  // One name cannot be both the caller's own prop and a dispatch key.
  for (const axis of passThrough) if (table[axis]) throw new CatalogError(`components: member axis ${axis} is a real prop of ${name} and cannot also dispatch`);
  const targets = [...imports.values(), ...[...partTargets].sort().map(target => `${quote(target)}: ${target}`)].join(", ");
  // `satisfies` checks that every target is a function or class component without erasing its real type:
  // a `never` parameter admits any props type, generics and statics included. Dispatch opens the props
  // only at createElement, where the mapping table has already chosen the target.
  rows.push(`const targets = { ${targets} } satisfies Record<string, ((props: never) => unknown) | (new (props: never) => unknown)>;`);
  rows.push(`const mappings: Record<string, Record<string, {target: string; property?: string; value?: unknown}>> = ${JSON.stringify(table, null, 2)};`);
  rows.push('type Statics<T> = Omit<T, "$$typeof" | "render" | "type" | "compare" | "displayName" | "propTypes" | "defaultProps">;');
  rows.push(`const Dispatch = forwardRef<unknown, Record<string, unknown>>(function ${name}(props, ref) {`);
  rows.push(`  const next = { ...props }; let target = ${quote(imports.get(`${base.module}#${base.name}`))};`);
  // Each axis is read from the caller's props, never from `next`: one member's mapped property may share
  // a later axis's name (a shape member mapped to the impl's size prop), and that output is not an input.
  rows.push('  for (const [axis, choices] of Object.entries(mappings)) {');
  rows.push('    if (!(axis in props)) continue;');
  rows.push('    const key = String(props[axis]); if (!Object.hasOwn(choices, key)) throw new Error("Unsupported component member");');
  rows.push('    const mapping = choices[key]!;');
  rows.push('    delete next[axis];');
  rows.push('    if (mapping.target !== ' + quote(imports.get(`${base.module}#${base.name}`)) + ') target = mapping.target;');
  rows.push('    if (mapping.property) next[mapping.property] = mapping.value;');
  rows.push('  }');
  rows.push('  return createElement((targets as Record<string, unknown>)[target] as ComponentType<Record<string, unknown>>, { ...next, ...stamp, ref });');
  rows.push('});');
  rows.push(`export const ${name} = Object.assign(Dispatch, statics(${baseLocal})) as unknown as typeof Dispatch & Statics<typeof ${baseLocal}>;`);
  return { path, content: rows.join("\n") + "\n" };
}
/**
 * Code generation is refused while checks fail. A selection whose observations are absent is
 * runtime-pending: its code is emitted and its consumption status is `runtime-pending`, never
 * `observations-pass`, which requires every fill observed with no pending finding.
 */
export function emitComponents(profile: ResolvedComponents, targets: readonly ComponentEmitTarget[], options: ComponentEmitOptions = {}): ComponentFile[] {
  if (!/^[a-z][a-z0-9-]*$/.test(profile.consumer) || !/^sha256:[a-f0-9]{64}$/.test(profile.selectionHash)) throw new CatalogError("components: invalid profile identity");
  const files: ComponentFile[] = [];
  const components = Object.values(profile.components).sort((a, b) => a.slot < b.slot ? -1 : 1);
  const consumption = { version: 1, consumer: profile.consumer, selectionHash: profile.selectionHash, status: !profile.check.ok ? "blocked" : profile.check.findings.some(isObservationPending) ? "runtime-pending" : "observations-pass", findings: profile.check.findings, leaves: components.map(component => ({ slot: component.slot, originKind: component.originKind, reads: component.reads })), reverseComposes: Object.fromEntries(components.map(component => [component.slot, components.filter(parent => parent.reads.components.includes(component.slot)).map(parent => parent.slot)])) };
  for (const target of [...new Set(targets)]) {
    if (target === "components-consumption") { files.push({ path: "components-consumption.json", content: stableStringify(consumption) }); continue; }
    if (target === "notices") { files.push({ path: "notices/components.json", content: stableStringify({ version: 1, consumer: profile.consumer, origins: components.map(component => ({ slot: component.slot, origin: component.origin })) }) }); continue; }
    if (target !== "component-index") throw new CatalogError("components: unknown emit target");
    if (!profile.check.ok) throw new CatalogError("components: checks failed; code generation refused");
    const names = new Set<string>();
    for (const component of components) { const name = nameOf(component.slot); assertComponentIdentifier(name); if (names.has(name)) throw new CatalogError("components: colliding contract names"); names.add(name); }
    const generated = components.map(component => leafModule(component, profile.packageExports, profile.files, componentFillId(component, profile.consumer), options.glyphModule));
    const retained = profile.files.filter(file => !generated.some(generated => generated.path === file.path));
    // Never overwrite adopted bytes: an upstream index needs its own unambiguous materialization.
    if (retained.length !== profile.files.length) throw new CatalogError("components: generated entrypoint conflicts with materialized source");
    const root: string[] = [];
    for (const component of components) root.push(`export { ${nameOf(component.slot)} } from ${quote(`./components/${component.slot.slice(11)}/index`)};`);
    const assets = sortedComponentIds(components.flatMap(component => component.reads.assets));
    if (emitsGlyphModule(components)) {
      const glyphs = options.glyphModule;
      if (!glyphs || assets.some(asset => !(asset in glyphs.glyphs))) throw new CatalogError("components: glyph module is unavailable");
      assertComponentPath(glyphs.path, true);
      const glyphData = Object.fromEntries(Object.entries(glyphs.glyphs).sort(([a], [b]) => a < b ? -1 : 1).map(([asset, data]) => {
        if (!/^assets\.icon-[a-z0-9-]+$/.test(asset)) throw new CatalogError("components: invalid glyph asset id");
        inspectGlyph(data); return [asset, data];
      }));
      generated.push({ path: glyphs.path, content: `export const glyphs = ${JSON.stringify(glyphData, null, 2)} as const;\n` });
    }
    // Only a leaf that reads an asset needs the registered provider; the Icon adapter passes its glyph directly.
    if (assets.length) {
      const glyphs = options.glyphModule!;
      const providerModule = components.find(component => component.impl.kind === "package" && component.descriptor.pin?.package === "@clossys/designer")?.descriptor.pin?.package;
      if (!providerModule) throw new CatalogError("components: registered glyph provider package is unavailable");
      const module = `${providerModule}/components`;
      if (!profile.packageExports[module]?.includes("GlyphProvider")) throw new CatalogError("components: GlyphProvider export is unavailable");
      root.unshift('import { createElement, type ReactNode } from "react";', `import { GlyphProvider } from ${quote(module)};`, `import { glyphs } from ${quote(relative("component-index.ts", glyphs.path))};`);
      root.push('export function LibraryProvider({ children }: { children: ReactNode }) { return createElement(GlyphProvider, { glyphs, children }); }');
    } else {
      root.unshift('import { Fragment, createElement, type ReactNode } from "react";');
      root.push('export function LibraryProvider({ children }: { children: ReactNode }) { return createElement(Fragment, null, children); }');
    }
    const all = [...retained, ...generated, { path: "component-index.ts", content: root.join("\n") + "\n" }];
    assertComponentImportClosure(all, { ...profile.packageExports, react: sortedComponentIds([...(profile.packageExports.react ?? []), "Fragment", "createElement", "forwardRef", "ReactNode", "ComponentType", "ComponentProps"]) });
    files.push(...all);
  }
  const unique = new Map<string, ComponentFile>();
  for (const file of files) { const previous = unique.get(file.path); if (previous && previous.content !== file.content) throw new CatalogError("components: conflicting emitted files"); unique.set(file.path, file); }
  return [...unique.values()].sort((a, b) => a.path < b.path ? -1 : 1);
}
