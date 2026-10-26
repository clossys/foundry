import { readFileSync } from "node:fs";
import { CatalogError } from "../../catalog-core/api.js";
import { stableStringify } from "../../catalog-core/stable.js";
import { sha256 } from "../../catalog-core/digest.js";
import { assertComponentDescriptor, assertComponentIdentifier, assertComponentPath, assertPackageSpecifier, componentDescriptorHash, sortedComponentIds, verifyComponentOutput } from "../../catalog-core/resolve-components.js";
import { componentSecondaryExports } from "../../catalog-core/component-secondary-exports.js";
import { inspectGlyph } from "../../catalog-assets/svg.js";
import { assertComponentImportClosure, emitComponents } from "../../catalog-core/emit-components.js";
import type { ComponentFile, ResolvedComponent, ResolvedComponents } from "../../catalog-core/resolve-components.js";
import type { ComponentEmitOptions } from "../../catalog-core/emit-components.js";
interface Binding { module: string; name: string; property?: string; value?: string | boolean; intrinsic?: true }

// Test-only production-template proposal. This is never a checked or adoptable artifact.
const nameOf = (slot: string): string => slot.slice(11).split("-").map(part => part[0]!.toUpperCase() + part.slice(1)).join("");
const quote = (value: unknown): string => JSON.stringify(value);
function relative(from: string, to: string): string {
  const a = from.split("/").slice(0, -1), b = to.split("/");
  while (a.length && b.length && a[0] === b[0]) { a.shift(); b.shift(); }
  return `${a.length ? "../".repeat(a.length) : "./"}${b.join("/").replace(/\.tsx?$/, ".js")}`;
}
function parseBinding(component: ResolvedComponent, member: string, pointer: string): Binding {
  const intrinsic = /\[data-(?:hovered|pressed|focus-visible)\]$/.test(pointer) && member.startsWith("state.");
  const clean = intrinsic ? pointer.replace(/\[data-(?:hovered|pressed|focus-visible)\]$/, "") : pointer;
  const match = /^(?:\.\/([A-Za-z0-9_/-]+)#)?([A-Z][A-Za-z0-9]*)(?:\.([a-z][A-Za-z0-9]*)(?:=([a-z0-9-]+))?)?$/.exec(clean);
  if (!match) throw new CatalogError(`components: unsupported propMap ${component.slot}.${member}`);
  assertComponentIdentifier(match[2]!);
  let module: string;
  if (component.impl.kind === "package") {
    const pin = component.descriptor.pin;
    module = match[1] ? `${pin!.package}/${match[1]}` : component.impl.module;
    assertPackageSpecifier(module);
  } else {
    if (match[1]) throw new CatalogError("components: source propMap cannot select a package subpath");
    module = component.impl.entry;
  }
  const value = match[4] === "true" ? true : match[4] === "false" ? false : match[4];
  return { module, name: match[2]!, ...(match[3] ? { property: match[3], value: value ?? true } : {}), ...(intrinsic ? { intrinsic: true } : {}) };
}
function leafModule(component: ResolvedComponent, packageExports: ResolvedComponents["packageExports"], files: readonly ComponentFile[], glyphModule?: ComponentEmitOptions["glyphModule"]): ComponentFile {
  const path = `components/${component.slot.slice(11)}/index.ts`;
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
    rows.push(`export function Icon({ asset, ...props }: WithAsset<ComponentProps<typeof ${impl}>>) {`);
    rows.push('  const glyph = glyphs[asset]; if (!glyph) throw new Error("Missing consumer glyph");');
    rows.push(`  return createElement(${impl}, { ...props, glyph });`, '}');
    return { path, content: rows.join("\n") + "\n" };
  }
  // A transparent alias is sufficient only when every contract member maps to the same export.
  const identity = bindings.every(({ binding }) => binding.module === base.module && binding.name === base.name && !binding.property);
  if (identity) return { path, content: rows.join("\n") + `\nexport { ${imports.get(`${base.module}#${base.name}`)} as ${name} };\n` };
  rows.unshift('import { createElement, forwardRef, type ComponentType } from "react";');
  const table: Record<string, Record<string, { target: string; property?: string; value?: string | boolean }>> = Object.create(null);
  for (const { member, binding } of bindings) {
    if (binding.intrinsic) continue;
    const parts = member.split(".");
    if (parts.length !== 2 || !/^[a-z][a-z0-9-]*$/.test(parts[0]!) || !/^[a-z][a-z0-9-]*$/.test(parts[1]!)) throw new CatalogError(`components: unsupported member dispatch ${member}`);
    const axis = parts[0]!, value = parts[1]!;
    table[axis] ??= Object.create(null) as Record<string, { target: string; property?: string; value?: string | boolean }>;
    table[axis]![value] = { target: imports.get(`${binding.module}#${binding.name}`)!, ...(binding.property ? { property: binding.property, value: binding.value } : {}) };
  }
  const targets = [...imports.values()].join(", ");
  rows.push(`const targets: Record<string, ComponentType<Record<string, unknown>>> = { ${targets} };`);
  rows.push(`const mappings: Record<string, Record<string, {target: string; property?: string; value?: unknown}>> = ${JSON.stringify(table, null, 2)};`);
  rows.push(`export const ${name} = forwardRef<unknown, Record<string, unknown>>(function ${name}(props, ref) {`);
  rows.push(`  const next = { ...props }; let target = ${quote(imports.get(`${base.module}#${base.name}`))};`);
  rows.push('  for (const [axis, choices] of Object.entries(mappings)) {');
  rows.push('    if (!(axis in next)) continue;');
  rows.push('    const key = String(next[axis]); if (!Object.hasOwn(choices, key)) throw new Error("Unsupported component member");');
  rows.push('    const mapping = choices[key]!;');
  rows.push('    delete next[axis];');
  rows.push('    if (mapping.target !== ' + quote(imports.get(`${base.module}#${base.name}`)) + ') target = mapping.target;');
  rows.push('    if (mapping.property) next[mapping.property] = mapping.value;');
  rows.push('  }');
  rows.push('  return createElement(targets[target]!, { ...next, ref });');
  rows.push('});');
  return { path, content: rows.join("\n") + "\n" };
}

export interface SourceMeasurement {
  status: "source-measurement-only";
  adoptable: false;
  files: readonly ComponentFile[];
  receipt: { status: "UNQUALIFIED"; templateSha256: string; selectionHash: string; files: readonly {path:string;sha256:string}[] };
}
export function sourceMeasurement(profile: ResolvedComponents, options: ComponentEmitOptions = {}): SourceMeasurement {
  if (!/^[a-z][a-z0-9-]*$/.test(profile.consumer) || !/^sha256:[a-f0-9]{64}$/.test(profile.selectionHash)) throw new CatalogError("components: invalid profile identity");
  const components = Object.values(profile.components).sort((a,b)=>a.slot<b.slot?-1:1);
  const names = new Set<string>();
    for (const component of components) { const name = nameOf(component.slot); assertComponentIdentifier(name); if (names.has(name)) throw new CatalogError("components: colliding contract names"); names.add(name); }
    const generated = components.map(component => leafModule(component, profile.packageExports, profile.files, options.glyphModule));
    const retained = profile.files.filter(file => !generated.some(generated => generated.path === file.path));
    // Never overwrite adopted bytes: an upstream index needs its own unambiguous materialization.
    if (retained.length !== profile.files.length) throw new CatalogError("components: generated entrypoint conflicts with materialized source");
    const root: string[] = [];
    for (const component of components) root.push(`export { ${nameOf(component.slot)} } from ${quote(`./components/${component.slot.slice(11)}/index.js`)};`);
    const assets = sortedComponentIds(components.flatMap(component => component.reads.assets));
    if (assets.length) {
      const glyphs = options.glyphModule;
      if (!glyphs || assets.some(asset => !(asset in glyphs.glyphs))) throw new CatalogError("components: glyph module is unavailable");
      assertComponentPath(glyphs.path, true);
      const glyphData = Object.fromEntries(Object.entries(glyphs.glyphs).sort(([a], [b]) => a < b ? -1 : 1).map(([asset, data]) => {
        if (!/^assets\.icon-[a-z0-9-]+$/.test(asset)) throw new CatalogError("components: invalid glyph asset id");
        inspectGlyph(data); return [asset, data];
      }));
      generated.push({ path: glyphs.path, content: `export const glyphs = ${JSON.stringify(glyphData, null, 2)} as const;\n` });
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

  const proposed = all.sort((a,b)=>a.path<b.path?-1:1);
  return {status:"source-measurement-only",adoptable:false,files:proposed,receipt:{status:"UNQUALIFIED",selectionHash:profile.selectionHash,templateSha256:sha256(readFileSync(new URL("../../catalog-core/emit-components.ts",import.meta.url),"utf8")),files:proposed.map(file=>({path:file.path,sha256:sha256(file.content)}))}};
}
export function assertSourceMeasurement(measurement: SourceMeasurement): void {
  if(measurement.status!=="source-measurement-only"||measurement.adoptable!==false||measurement.receipt.status!=="UNQUALIFIED")throw new Error("Measurement is never adoption or clearance");
  if(measurement.files.length!==measurement.receipt.files.length)throw new Error("Measurement source inventory changed");
  for(const [index,file] of measurement.files.entries())if(file.path!==measurement.receipt.files[index]?.path||sha256(file.content)!==measurement.receipt.files[index]?.sha256)throw new Error("Measurement source bytes changed");
  if(sha256(readFileSync(new URL("../../catalog-core/emit-components.ts",import.meta.url),"utf8"))!==measurement.receipt.templateSha256)throw new Error("Production emitter template changed");
}
/** Final reuse requires real guarded emission, then equality of the complete module graph. */
export function assertQualifiedFacadeEquality(measurement: SourceMeasurement, profile: ResolvedComponents, options: ComponentEmitOptions = {}): void {
  assertSourceMeasurement(measurement);
  if(profile.selectionHash!==measurement.receipt.selectionHash)throw new Error("Qualified selection differs from measurement");
  const emitted=emitComponents(profile,["component-index"],options);
  if(stableStringify(emitted)!==stableStringify(measurement.files))throw new Error("Qualified facade/provider/glyph graph differs from measurement");
}
