import { readFile } from "node:fs/promises";
import { basename, dirname, extname, posix, relative, sep } from "node:path";
import { build, transform, type Plugin } from "esbuild";
import { libraryHash, resolve } from "@clossys/designer/catalog";
import type { CompositeEngineInput, CompositeResolved } from "@clossys/designer/catalog";
import { resolveAgent } from "../agents.js";
import { agentModule } from "./cells.js";
import { readStudioDesignerLibrary } from "./theme.js";
import { themeHash } from "./theme-default.js";
import { prepareStudioSelection } from "./selection-defaults.js";
import { selectionCss } from "./selection-css.js";
import { selectionShadcnTokens, type SelectionShadcnTokenContract } from "./selection-shadcn-tokens.js";

export interface StudioSelectionLeaf {
  leaf: string;
  source: "consumer" | "fallback" | "unavailable";
  fill?: string;
  hash?: string;
  message?: string;
}
export interface StudioSelection { hash: string; runtimeUrl?: string; profileUrl?: string; css?: string; cssHash?: string; leaves: StudioSelectionLeaf[]; message?: string }
const runtimes = new Map<string, string>();
const profiles = new Map<string, CompositeResolved>();
const pending = new Map<string, Promise<StudioSelection>>();
const preparedSelections = new Map<string, Promise<StudioSelection>>();
const SINGLETON = /^(?:react(?:\/(?:jsx-runtime|jsx-dev-runtime))?|react-dom(?:\/(?:client|server))?)$/;
interface ComponentModule { leaf: string; primary: string; secondary: Map<string, Record<string, string>> }

async function inspectedSourceExports(source: string, module: string): Promise<string[]> {
  const parsed = (await transform(source, { loader: module.endsWith(".tsx") ? "tsx" : "ts", jsx: "automatic", legalComments: "none" })).code;
  const names = [...parsed.matchAll(/\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map(match => match[1]!);
  for (const match of parsed.matchAll(/\bexport\s*\{([^}]+)\}/g)) names.push(...match[1]!.split(",").map(name => name.trim().split(/\s+as\s+/).pop()!).filter(Boolean));
  return names;
}

/** Selected source may share React, RAC and Designer contexts with its host. */
function projectionPlugin(files: ReadonlyMap<string, string>, root: string, componentModules: ReadonlyMap<string, ComponentModule>, iconAssets: Readonly<Record<string, string>>): Plugin {
  const designerRoot = resolveAgent("designer").packageRoot;
  const designerModule = (path: string, owner: string) => ({ path: JSON.stringify([owner, path]), namespace: "studio-designer" });
  const sharedContext = new Map<string, boolean>();
  const selectedOwner = (path: string) => /^(components|sections|frames)\/([^/]+)\//.exec(path)?.slice(1).join(".") ?? "studio";
  return {
    name: "studio-selected-library",
    setup(context) {
      context.onResolve({ filter: SINGLETON }, args => ({ path: args.path, namespace: "studio-singleton" }));
      context.onLoad({ filter: /.*/, namespace: "studio-singleton" }, async args => {
        const namespace = await import(args.path);
        const keys = Object.keys(namespace).filter(key => key !== "default" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key));
        return { loader: "js", contents: `const host = globalThis.__studioDesignerRuntime[${JSON.stringify(args.path)}];\nif (!host) throw new Error("Studio runtime dependency unavailable");\n${keys.map(key => `export const ${key} = host[${JSON.stringify(key)}];`).join("\n")}\n${"default" in namespace ? "export default host.default;" : ""}` };
      });
      context.onResolve({ filter: /.*/ }, async args => {
        if (args.pluginData?.ordinaryPackage) return undefined;
        if (args.namespace === "studio-designer") {
          const [owner, importer] = JSON.parse(args.importer) as [string, string];
          const resolved = await context.resolve(args.path, { resolveDir: dirname(importer), kind: args.kind, pluginData: { ordinaryPackage: true } });
          if (resolved.errors.length || resolved.external) return resolved;
          const inside = relative(designerRoot, resolved.path);
          if (!inside.startsWith(".." + sep) && !inside.startsWith("..") && !inside.startsWith("node_modules" + sep)) {
            const name = basename(resolved.path).replace(/\.(?:client|server)\.[^.]+$/, "").replace(/\.[^.]+$/, "");
            const component = componentModules.get(name);
            if (component && component.leaf !== owner && files.has(`components/${component.leaf.slice(11)}/index.ts`)) return { path: JSON.stringify([component.leaf, resolved.path]), namespace: "studio-selected-component" };
            let context = sharedContext.get(resolved.path);
            if (context === undefined) { context = /\bcreateContext\s*\(/.test(await readFile(resolved.path, "utf8")); sharedContext.set(resolved.path, context); }
            if (context) return designerModule(resolved.path, "shared-context");
            return designerModule(resolved.path, owner);
          }
          return resolved;
        }
        if (args.namespace === "studio-selected-component") {
          const [leaf, original] = JSON.parse(args.importer) as [string, string];
          if (args.path === "studio-original") return designerModule(original, leaf);
          if (args.path === "studio-selected") return { path: `components/${leaf.slice(11)}/index.ts`, namespace: "studio-projection" };
          if (args.path === "studio-dialog") return { path: "studio-compat/dialog.ts", namespace: "studio-projection" };
          if (args.path === "studio-tooltip") return { path: "studio-compat/tooltip.ts", namespace: "studio-projection" };
        }
        if (args.kind === "entry-point" || args.namespace === "studio-projection" && args.path.startsWith(".")) {
          const name = posix.normalize(args.kind === "entry-point" ? args.path : posix.join(posix.dirname(args.importer), args.path));
          const candidates = [name, name.replace(/\.js$/, ".ts"), name.replace(/\.js$/, ".tsx"), ...[".ts", ".tsx", ".js", "/index.ts", "/index.tsx", "/index.js"].map(suffix => name + suffix)];
          const path = candidates.find(candidate => files.has(candidate));
          if (!path) throw new Error("Selected library import does not resolve");
          return { path, namespace: "studio-projection" };
        }
        if (args.namespace !== "studio-projection") return undefined;
        const options = { kind: args.kind, pluginData: { ordinaryPackage: true } };
        const consumer = await context.resolve(args.path, { ...options, resolveDir: root });
        const resolved = consumer.errors.length ? await context.resolve(args.path, { ...options, resolveDir: designerRoot }) : consumer;
        if (!resolved.errors.length && args.path.startsWith("@clossys/designer/")) return designerModule(resolved.path, selectedOwner(args.importer));
        return resolved;
      });
      context.onLoad({ filter: /.*/, namespace: "studio-designer" }, async args => {
        const [, path] = JSON.parse(args.path) as [string, string];
        return { contents: await readFile(path, "utf8"), loader: extname(path) === ".json" ? "json" : "js", resolveDir: dirname(path) };
      });
      context.onLoad({ filter: /.*/, namespace: "studio-selected-component" }, args => {
        const [leaf, original] = JSON.parse(args.path) as [string, string];
        const name = basename(original).replace(/\.(?:client|server)\.[^.]+$/, "").replace(/\.[^.]+$/, "");
        const component = componentModules.get(name)!;
        const selectedName = leaf.slice(11).split("-").map(part => part[0]!.toUpperCase() + part.slice(1)).join("");
        if (leaf === "components.dialog" && files.has("studio-compat/dialog.ts")) return { loader: "js", contents: 'export * from "studio-original";\nexport { Dialog } from "studio-dialog";' };
        if (leaf === "components.tooltip" && files.has("studio-compat/tooltip.ts")) return { loader: "js", contents: 'export * from "studio-original";\nexport { Tooltip } from "studio-tooltip";' };
        if (leaf === "components.icon") return { loader: "js", contents: `import { createElement, forwardRef } from "react";\nimport { Icon as Selected } from "studio-selected";\nexport * from "studio-original";\nconst assets = ${JSON.stringify(iconAssets)};\nexport const Icon = forwardRef(({ glyph, asset, ...props }, ref) => { const selected = asset ?? assets[JSON.stringify(glyph)]; if (!selected) throw new Error("NEED: selected Icon asset is unavailable"); return createElement(Selected, {...props, asset:selected, ref}); });` };
        const rows = ['export * from "studio-original";', `export { ${selectedName} as ${component.primary} } from "studio-selected";`];
        if (component.secondary.size) {
          rows.push('import { createElement, forwardRef } from "react";', `import { ${selectedName} as Selected } from "studio-selected";`);
          for (const [secondary, props] of component.secondary) rows.push(`export const ${secondary} = forwardRef((props, ref) => createElement(Selected, {...props, ...${JSON.stringify(props)}, ref}));`);
        }
        return { loader: "js", contents: rows.join("\n") };
      });
      // Selected source styles are compiled separately and bound with the runtime.
      context.onLoad({ filter: /\.css$/, namespace: "studio-projection" }, () => ({ contents: "", loader: "js" }));
      context.onLoad({ filter: /.*/, namespace: "studio-projection" }, args => ({ contents: files.get(args.path)!, loader: extname(args.path) === ".tsx" ? "tsx" : extname(args.path) === ".jsx" ? "jsx" : extname(args.path) === ".json" ? "json" : "ts", resolveDir: root }));
    },
  };
}

/** Compile checked, emitted adapters, preserving the selected library's owned source. */
export async function compileSelection(root: string, input: CompositeEngineInput, leaves: StudioSelectionLeaf[], hash: string): Promise<StudioSelection> {
  const packageExports: Record<string, readonly string[]> = { ...input.componentOptions?.packageExports };
  const modules = new Set<string>();
  for (const fill of input.library.components.fills) {
    const component = Object.values(fill.components)[0]!;
    if (component.impl.kind === "package") {
      modules.add(component.impl.module);
      for (const pointer of Object.values(component.propMap)) {
        const subpath = /^\.\/([^#]+)#/.exec(pointer)?.[1];
        if (subpath && component.pin?.package) modules.add(`${component.pin.package}/${subpath}`);
      }
    }
  }
  for (const file of [...input.library.components.files, ...(input.library.surfaces?.files ?? [])]) {
    for (const match of file.content.matchAll(/\b(?:import|export)\s[^;]*?\bfrom\s*["']([^"']+)["']/g)) {
      const module = match[1]!;
      if (!module.startsWith(".") && !module.endsWith(".css")) modules.add(module);
    }
  }
  for (const module of modules) packageExports[module] = Object.keys(await import(module));
  input = { ...input, componentOptions: { ...input.componentOptions, packageExports } };
  const profile = resolve(input);
  const componentModules = new Map<string, ComponentModule>();
  for (const document of input.catalog.components.fills) {
    const component = Object.values(document.components)[0]!;
    if (component.impl.kind !== "package" || !component.impl.module.startsWith("@clossys/designer/") || componentModules.has(component.impl.export)) continue;
    const secondary = new Map<string, Record<string, string>>();
    for (const [member, pointer] of Object.entries(component.propMap)) {
      const parts = member.split(".");
      const target = /^(?:\.\/[^#]+#)?([A-Z][A-Za-z0-9]*)/.exec(pointer)?.[1];
      if (target && target !== component.impl.export && parts.length === 2) secondary.set(target, { [parts[0]!]: parts[1]! });
    }
    componentModules.set(component.impl.export, { leaf: component.slot, primary: component.impl.export, secondary });
  }
  // These emitters check the selected executable portions. Unselected whole-library
  // assets are not prerequisites for rendering a Studio page.
  const components = await agentModule("designer", "catalog-core/emit-components.js");
  const surfaces = await agentModule("designer", "catalog-core/surface-emit.js");
  const glyphs = Object.fromEntries(Object.values(profile.values.members).filter(member => member.$type === "glyph" && member.slot.startsWith("assets.icon-")).map(member => [member.slot, member.value.light]));
  const iconAssets: Record<string, string> = Object.fromEntries(Object.entries(glyphs).map(([asset, glyph]) => [JSON.stringify(glyph), asset]));
  const collectGlyphs = (value: unknown, asset: string): void => {
    if (!value || typeof value !== "object") return;
    const token = value as Record<string, unknown>;
    if (token.$type === "glyph") { iconAssets[JSON.stringify(token.$value)] = asset; return; }
    for (const child of Object.values(token)) collectGlyphs(child, asset);
  };
  for (const fill of input.catalog.values.fills) if (fill.$extensions["com.clossys.fill"].slot.startsWith("assets.icon-")) collectGlyphs((fill as any).assets, fill.$extensions["com.clossys.fill"].slot);
  const files = new Map<string, string>(components.emitComponents(profile.components, ["component-index"], { glyphModule: { path: "adapters/glyphs.ts", glyphs } }).map((file: { path: string; content: string }) => [file.path, file.content]));
  if (profile.surfaces) for (const file of surfaces.emitSurfaces(profile.surfaces, ["surface-index"])) files.set(file.path, file.contents);
  let tree = "export const tree = {};\n";
  if (files.has("components/navigation-tree/index.ts")) {
    const navigation = profile.components.components["components.navigation-tree"];
    if (navigation?.impl.kind === "package") {
      const module = navigation.impl.module;
      const secondary = ["NavigationTreeItem", "NavigationTreeItemContent"];
      if (secondary.some(name => !profile.components.packageExports[module]?.includes(name))) throw new Error("Selected NavigationTree secondary exports are unavailable");
      tree = `import * as selectedTree from "./components/navigation-tree/index.ts";\nimport { NavigationTreeItem, NavigationTreeItemContent } from ${JSON.stringify(module)};\nexport const tree = { ...selectedTree, NavigationTreeItem, NavigationTreeItemContent };\n`;
    } else tree = 'import * as tree from "./components/navigation-tree/index.ts";\nexport { tree };\n';
  }
  let disclosure = "export const disclosure = {};\n";
  const selectedDisclosure = profile.components.components["components.disclosure"];
  if (selectedDisclosure) {
    if (selectedDisclosure.descriptor.props.includes("title")) disclosure = 'import { Disclosure as SelectedDisclosure } from "./components/disclosure/index.ts";\nexport const disclosure = { Disclosure: SelectedDisclosure };\n';
    else {
      const module = selectedDisclosure.impl.kind === "source" ? selectedDisclosure.impl.entry : selectedDisclosure.impl.module;
      let names: string[];
      if (selectedDisclosure.impl.kind === "package") names = [...profile.components.packageExports[module] ?? []];
      else {
        const source = files.get(module);
        if (!source) throw new Error("Selected disclosure source is unavailable");
        names = await inspectedSourceExports(source, module);
      }
      if (!["AccordionItem", "AccordionTrigger", "AccordionContent"].every(name => names.includes(name))) throw new Error("NEED: selected disclosure does not expose its composition API");
      disclosure = `import { createElement, useId } from "react";\nimport { Disclosure as SelectedDisclosure } from "./components/disclosure/index.ts";\nimport { AccordionItem, AccordionTrigger, AccordionContent } from ${JSON.stringify(selectedDisclosure.impl.kind === "source" ? "./" + module : module)};\nfunction Disclosure({ title, children, ...props }) { const id = useId(); return createElement(SelectedDisclosure, null, createElement(AccordionItem, {id,...props}, createElement(AccordionTrigger, null, title), createElement(AccordionContent, null, children))); }\nexport const disclosure = { Disclosure };\n`;
    }
  }
  const selectedDialog = profile.components.components["components.dialog"];
  if (selectedDialog) {
    let dialog = 'export { Dialog } from "../components/dialog/index.ts";\n';
    if (!selectedDialog.descriptor.props.includes("trigger")) {
      const module = selectedDialog.impl.kind === "source" ? selectedDialog.impl.entry : selectedDialog.impl.module;
      const names = selectedDialog.impl.kind === "source" ? await inspectedSourceExports(files.get(module) ?? "", module) : profile.components.packageExports[module] ?? [];
      if (!["DialogTrigger", "DialogTitle", "DialogContent"].every(name => names.includes(name))) throw new Error("NEED: selected Dialog does not expose its composition API");
      const request = selectedDialog.impl.kind === "source" ? "../" + module : module;
      dialog = `import { createElement } from "react";\nimport { Dialog as SelectedDialog } from "../components/dialog/index.ts";\nimport { DialogTrigger, DialogTitle } from ${JSON.stringify(request)};\nfunction DialogRoot({ trigger, children, size, overlayClassName, modalClassName, modalStyle, ...props }) { const content = createElement(SelectedDialog, props, children); return trigger == null ? content : createElement(DialogTrigger, {isOpen:props.isOpen, defaultOpen:props.defaultOpen, onOpenChange:props.onOpenChange}, trigger, content); }\nexport const Dialog = Object.assign(DialogRoot, { Heading: DialogTitle });\n`;
    }
    files.set("studio-compat/dialog.ts", dialog);
  }
  const selectedTooltip = profile.components.components["components.tooltip"];
  if (selectedTooltip) {
    let tooltip = 'export { Tooltip } from "../components/tooltip/index.ts";\n';
    if (!selectedTooltip.descriptor.props.includes("trigger")) {
      const module = selectedTooltip.impl.kind === "source" ? selectedTooltip.impl.entry : selectedTooltip.impl.module;
      const names = selectedTooltip.impl.kind === "source" ? await inspectedSourceExports(files.get(module) ?? "", module) : profile.components.packageExports[module] ?? [];
      if (!names.includes("TooltipTrigger")) throw new Error("NEED: selected Tooltip does not expose its composition API");
      const timing = Object.fromEntries(["tokens.behavior-timing.tooltip-delay", "tokens.behavior-timing.tooltip-close"].map(id => {
        const value = profile.values.members[id]?.value.light;
        if (!value) throw new Error("NEED: selected Tooltip behavior timing is unavailable");
        return [id, value];
      }));
      const request = selectedTooltip.impl.kind === "source" ? "../" + module : module;
      tooltip = `import { createElement } from "react";\nimport { Tooltip as SelectedTooltip } from "../components/tooltip/index.ts";\nimport { TooltipTrigger } from ${JSON.stringify(request)};\nconst behaviorTiming = ${JSON.stringify(timing)};\nexport function Tooltip({ trigger, children, triggerAction, ...props }) { return createElement(TooltipTrigger, {behaviorTiming, trigger:triggerAction}, trigger, createElement(SelectedTooltip, props, children)); }\n`;
    }
    files.set("studio-compat/tooltip.ts", tooltip);
  }
  let table = "export const table = {};\n";
  const selectedTable = profile.components.components["components.table"];
  if (selectedTable) {
    const module = selectedTable.impl.kind === "source" ? "./" + selectedTable.impl.entry : selectedTable.impl.module;
    table = `import * as tableParts from ${JSON.stringify(module)};\nimport { Table as SelectedTable } from "./components/table/index.ts";\nexport const table = {...tableParts, Table:SelectedTable};\n`;
  }
  files.set("studio-entry.ts", 'export * as components from "./component-index.ts";\n' + (files.has("surface-index.ts") ? 'export * as surfaces from "./surface-index.ts";\n' : "export const surfaces = {};\n") + tree + disclosure + table + (selectedDialog ? 'export * as dialog from "./studio-compat/dialog.ts";\n' : "export const dialog = {};\n") + (selectedTooltip ? 'export * as tooltip from "./studio-compat/tooltip.ts";\n' : "export const tooltip = {};\n"));
  const tokenContract: SelectionShadcnTokenContract = (await agentModule("designer", "catalog-core/token-contract.js")).tokenContract;
  const shadcnTokens = selectionShadcnTokens(profile.values, tokenContract);
  const css = await selectionCss(files, undefined, shadcnTokens);
  const bundled = await build({ entryPoints: ["studio-entry.ts"], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", jsx: "automatic", minify: true, define: { "process.env.NODE_ENV": '"production"' }, sourcemap: false, legalComments: "none", logLevel: "silent", plugins: [projectionPlugin(files, root, componentModules, iconAssets)] });
  const code = bundled.outputFiles?.[0]?.text;
  if (!code) throw new Error("Selected runtime was not emitted");
  const runtimeHash = themeHash(code);
  runtimes.set(runtimeHash, code);
  profiles.set(hash, JSON.parse(JSON.stringify(profile)) as CompositeResolved);
  while (runtimes.size > 32) runtimes.delete(runtimes.keys().next().value!);
  while (profiles.size > 32) profiles.delete(profiles.keys().next().value!);
  return { hash, runtimeUrl: `/api/selection/runtime.js?hash=${encodeURIComponent(runtimeHash)}`, profileUrl: `/api/selection/profile?hash=${encodeURIComponent(hash)}`, css, cssHash: themeHash(css), leaves };
}

export function selectionRuntime(hash: string): string | undefined { return runtimes.get(hash); }
export function selectionProfile(hash: string): CompositeResolved | undefined { return profiles.get(hash); }

/** The API reads a real compiler projection; missing selected leaves retain explicit NEEDs. */
export async function studioSelection(root: string): Promise<StudioSelection> {
  let leaves: StudioSelectionLeaf[] = [];
  let hash = themeHash("Designer selection unavailable");
  try {
    const stored = await readStudioDesignerLibrary(root);
    const key = `${root}\n${stored ? libraryHash(stored.library) + "\n" + JSON.stringify(stored.activeIds) : "missing"}`;
    const existing = preparedSelections.get(key);
    if (existing) return await existing;
    const generation = (async (): Promise<StudioSelection> => {
    const prepared = await prepareStudioSelection(stored);
    leaves = prepared.leaves;
    hash = libraryHash(prepared.input.library);
    let compiled = pending.get(hash);
    if (!compiled) {
      compiled = compileSelection(root, prepared.input, leaves, hash);
      pending.set(hash, compiled);
      while (pending.size > 32) pending.delete(pending.keys().next().value!);
      compiled.catch(() => { pending.delete(hash); });
    }
    // Adoption state may change while producing byte-identical adapters.
    return { ...await compiled, leaves };
    })();
    preparedSelections.set(key, generation);
    while (preparedSelections.size > 32) preparedSelections.delete(preparedSelections.keys().next().value!);
    generation.catch(() => { preparedSelections.delete(key); });
    return await generation;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Producer Designer selection failed:", message);
    return { hash, leaves: leaves.map(leaf => ({ ...leaf, source: "unavailable", message })), message };
  }
}
