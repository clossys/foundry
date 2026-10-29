import inputSources from "./input-rail.sources.json" with { type: "json" };
import { importFeedbackRail } from "./feedback-rail.js";
import adaptations from "./vendor/shadcn-aria-rail.adapters.json" with { type: "json" };

import data from "./vendor/shadcn-aria-rail.data.json" with { type: "json" };
import adapter from "../catalog/adapters/shadcn@aria.json" with { type: "json" };
import slots from "../catalog/slots/components.json" with { type: "json" };
import { sha256 } from "../catalog-core/digest.js";
import { componentDescriptorHash, type ComponentCandidateDocument } from "../catalog-core/resolve-components.js";
import type { SourceBundle } from "../catalog-core/changeset-components.js";
import { rewriteShadcnAria, type SourceFile } from "./rewrite.js";

/** Current official Aria source additions; existing v1 fills keep their authenticated pin. */
export const SHADCN_ARIA_RAIL_ITEMS = ["sidebar", "command", "sheet", "empty", "item", "scroll-area", "dropdown-menu", "kbd"] as const;
export const SHADCN_ARIA_INPUT_LEAVES = ["text-field", "search-field", "tag-group", "toolbar", "link", "native-action"] as const;

const leafOf = (item: string): string => item === "kbd" ? "keyboard" : item;
const exportsOf = (code: string): string[] => [...code.matchAll(/export\s*\{([^}]+)\}/g)].flatMap(match => match[1]!.split(",").map(x => x.trim()).filter(x => x && !x.startsWith("type ")));
const dependencies = (code: string): string[] => [...code.matchAll(/from\s*"@\/registry\/bases\/aria\/ui\/([a-z-]+)"/g)].map(match => match[1]!);
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();

export function importShadcnAriaRail() {
  const byItem = new Map(data.files.map(file => [file.item, file]));
  const adapted = new Map(adaptations.files.map(file => [file.item, file]));
  if (adaptations.upstreamCommit !== data.commit) throw new Error("shadcn-rail: adaptation commit mismatch");
  for (const file of adaptations.files) if (byItem.get(file.item)?.sha256 !== file.inputSha256) throw new Error(`shadcn-rail: adaptation input mismatch ${file.path}`);
  for (const file of data.files) if (sha256(file.content) !== file.sha256) throw new Error(`shadcn-rail: source pin mismatch: ${file.path}`);
  const style = byItem.get("style")!, license = byItem.get("license")!;
  const source = "shadcn@aria", transform = "shadcn-aria-rewrite@2";
  const leafByItem = Object.fromEntries(SHADCN_ARIA_RAIL_ITEMS.map(item => [item, leafOf(item)]));
  const allFiles = new Map<string, SourceFile>();
  const fills: ComponentCandidateDocument[] = [], sourceBundles: SourceBundle[] = [];
  const candidates = [];
  const rewrites = new Map<string, ReturnType<typeof rewriteShadcnAria>>();
  for (const item of SHADCN_ARIA_RAIL_ITEMS) {
    const leaf = leafOf(item), slot = `components.${leaf}`, original = byItem.get(item)!;
    const closure = new Set<string>();
    const visit = (name: string): void => {
      if (closure.has(name)) return;
      closure.add(name);
      const file = byItem.get(name); if (!file) throw new Error(`shadcn-rail: missing dependency ${name}`);
      for (const dep of dependencies(file.content)) if (!Object.hasOwn(leafByItem, dep)) visit(dep);
      if (file.content.includes('/hooks/use-mobile"')) closure.add("use-mobile");
    };
    visit(item);
    const files: SourceFile[] = [];
    const tokens = new Set<string>(), assets = new Set<string>(), components = new Set<string>();
    const issues: ReturnType<typeof rewriteShadcnAria>["issues"][number][] = [];
    const notes: NonNullable<ReturnType<typeof rewriteShadcnAria>["notes"]>[number][] = [];
    for (const name of closure) {
      const upstream = byItem.get(name)!;
      if (name === "use-mobile") {
        const content = upstream.content.replace('const MOBILE_BREAKPOINT = 768', `function mobileBreakpoint() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--breakpoint-mobile-lg").trim()
  const match = /^(\\d+(?:\\.\\d+)?)(px|rem)$/.exec(raw)
  if (!match) throw new Error("Missing mobile breakpoint token")
  return Number(match[1]) * (match[2] === "rem" ? parseFloat(getComputedStyle(document.documentElement).fontSize) : 1)
}`).replace('    const mql =', '    const MOBILE_BREAKPOINT = mobileBreakpoint()\n    const mql =');
        files.push({ path: "components/_parts/rail-use-mobile/index.ts", content });
        tokens.add("tokens.breakpoint.mobile-lg"); continue;
      }
      const privatePart = name !== item;
      const inputPath = privatePart ? `components/_parts/rail-${name}/${name}.tsx` : upstream.path;
      const result = rewriteShadcnAria({ item: name, leaf: privatePart ? name : leaf, files: [{ path: inputPath, content: (item === "kbd" ? upstream.content : adapted.get(name)!.content).replaceAll("@/registry/bases/aria/hooks/use-mobile", `${privatePart ? "../../" : "../"}_parts/rail-use-mobile/index`) }], styles: style.content, leafByItem, transformVersion: 2, retainRegistryButtonProps: true });
      result.reads.tokens.forEach(x => tokens.add(x)); result.reads.assets.forEach(x => assets.add(x)); result.reads.components.forEach(x => components.add(x));
      issues.push(...result.issues); notes.push(...result.notes ?? []);
      for (const file of result.files) {
        let content = file.content.replace(/(_parts\/)(?!rail-)([a-z-]+)\//g, "$1rail-$2/")
          .replaceAll('@/registry/bases/aria/hooks/use-mobile', `${privatePart ? "../../" : "../"}_parts/rail-use-mobile/index`);
        if (!/import\s+(?:\*\s+as\s+React|type\s+\*\s+as\s+React)/.test(content) && /\bReact\./.test(content)) content = 'import type * as React from "react"\n' + content;
        files.push({ ...file, content });
      }
    }
    if (files.some(file => file.content.includes("rail-utils/index"))) files.push(
      { path: "components/_parts/rail-utils/index.ts", content: adaptations.utility },
      { path: "components/_parts/rail-utils/types.ts", content: adaptations.utilityTypes },
      { path: "components/_parts/rail-utils/copy.ts", content: adaptations.copySource });
    if (files.some(file => file.path === "components/_parts/rail-utils/index.ts")) files.push(
      { path: "components/_parts/rail-utils/types.ts", content: adaptations.utilityTypes },
      { path: "components/_parts/rail-utils/copy.ts", content: adaptations.copySource });
    for (const name of closure) if (name !== item && name !== "use-mobile") files.push({ path: `components/_parts/rail-${name}/index.ts`, content: `export { ${exportsOf(byItem.get(name)!.content).join(", ")} } from "./${name}"\n` });
    const notice = "notices/SHADCN-ARIA-RAIL.md";
    files.push({ path: notice, content: `# Third-party notice\n\nSource: ${adapter.pin.url}\nCommit: ${data.commit}\nTransform: ${transform}\n\n${license.content}` });
    const unique = [...new Map(files.map(file => [file.path, file])).values()].sort((a,b) => a.path.localeCompare(b.path));
    for (const file of unique) {
      const previous = allFiles.get(file.path); if (previous && previous.content !== file.content) throw new Error(`shadcn-rail: conflicting output ${file.path}`);
      allFiles.set(file.path, file);
    }
    const pinned = [...closure].map(name => byItem.get(name)!).concat(style, license);
    const pin = { url: adapter.pin.url, commit: data.commit, files: pinned.map(file => ({ path: file.path, sha256: file.sha256 })).sort((a,b) => a.path.localeCompare(b.path)) };
    const names = exportsOf(original.content), root = names.find(name => name.toLowerCase() === item.replaceAll("-", "")) ?? names[0]!;
    const contract = slots.find(row => row.id === slot)!;
    const propMap = item === "kbd" ? { "scope.single": "Kbd", "scope.chord": "KbdGroup" } : {};
    // Only component anatomy values enter the generated leaf facade; hooks stay private to the source module.
    const secondaryExports = names.filter(name => name !== root && /^[A-Z][A-Za-z0-9]*$/.test(name)).map(name => ({ name, export: name }));
    const descriptor = { slot, source, root: contract.contract.root, members: Object.keys(propMap), props: [], propMap, reads: { tokens: sorted(tokens), assets: sorted(assets), components: sorted(components) }, composes: sorted(components), impl: { kind: "source", entry: `components/${leaf}/${item}.tsx`, export: root }, ...(secondaryExports.length ? { secondaryExports } : {}), license: "MIT", pin, notice, transform, item, deps: [...adaptations.host.map(row => row.dependency), { name: "react", version: "19.3.0", license: "MIT" }, { name: "react-aria-components", version: "1.21.1", license: "Apache-2.0" }, { name: "tailwind-merge", version: "3.7.0", license: "MIT" }], parts: [...closure].filter(name => name !== item).map(item => ({ item: `rail-${item}` })), outputSha256: unique.map(file => ({ path: file.path, sha256: sha256(file.content) })), blockers: issues, ...(leaf === "native-action" ? {} : { rac: { instance: "react-aria-components", range: "^1.21.1", peer: false } }) };
    const document = { $extensions: { "com.clossys.fill": { id: `${source}/${slot}`, slot, source, mode: "implementation", sourceAddress: `${adapter.pin.url}/blob/${data.commit}/${original.path}`, relation: "same-contract", builtOn: sorted(components), conforms: [], evidence: [], author: "third-party", trust: "pinned-upstream", license: "MIT", status: "draft", pin: { url: adapter.pin.url, commit: data.commit, sha256: original.sha256 }, unmapped: [] } }, components: { [leaf]: descriptor } } as unknown as ComponentCandidateDocument;
    fills.push(document);
    const fill = Object.values(document.components)[0]!;
    const descriptorHash = componentDescriptorHash(fill), upstreamFiles = pinned.map(({path,content}) => ({path,content}));
    const bundle = { slot, descriptorHash, transform, upstream: upstreamFiles, files: unique, blockers: issues };
    if (!issues.length) sourceBundles.push(bundle);
    candidates.push({ fill: `${source}/${slot}`, slot, descriptorHash, transform, upstreamFiles, outputFiles: unique, blockers: issues, status: issues.length ? "blocked" as const : "ready" as const });
    rewrites.set(item, { transform, files: unique, outputSha256: descriptor.outputSha256, reads: descriptor.reads, parts: descriptor.parts.map(x=>x.item), issues, notes });
  }
  const inputs = importInputLeaves(), feedback = importFeedbackRail(data);
  return { fills: [...fills, ...inputs.fills, ...feedback.fills], sourceBundles: [...sourceBundles, ...inputs.sourceBundles, ...feedback.sourceBundles], candidates: [...candidates, ...inputs.candidates, ...feedback.candidates], rewrites: { ...Object.fromEntries(rewrites), ...inputs.rewrites, ...feedback.rewrites }, files: [...allFiles.values(), ...inputs.files, ...feedback.files] };

}

/** The package shares its existing guarded helper; emitted consumers bind its existing public export. */
export function railPackageFile(file: SourceFile): SourceFile {
  let content = file.content;
  for (const host of adaptations.host) if (host.file === file.path) {
    if (!content.includes(host.consumerImport)) throw new Error("shadcn-rail: host binding source mismatch");
    content = content.replace(host.consumerImport, host.packageImport);
  }
  if (file.path === "components/grid-list/grid-list.tsx") content = content.replace('"../checkbox/index"', '"../Checkbox"');
  if (file.path === "components/toast/sonner.tsx") content = content.replace('"../button/index"', '"../Button"');
  return { ...file, content: content.replace(/((?:from\s*|import\s*)["'])(\.[^"']+)(["'])/g,
    (_match, before: string, specifier: string, after: string) => before + specifier + (/\.(js|json)$/.test(specifier) ? "" : ".js") + after) };
}

/** Owned RAC wiring; all visual bytes come from the authenticated Aria registry parts. */

function importInputLeaves() {
  const byItem = new Map(data.files.map(file => [file.item, file]));
  const style = byItem.get("style")!, license = byItem.get("license")!;
  const all = new Map<string, SourceFile>();
  const fills: ComponentCandidateDocument[] = [], sourceBundles: SourceBundle[] = [], candidates = [];
  const rewrites = new Map<string, ReturnType<typeof rewriteShadcnAria>>();
  for (const leaf of SHADCN_ARIA_INPUT_LEAVES) {
    const spec = inputSources[leaf], closure = new Set<string>();
    const visit = (item: string): void => {
      if (closure.has(item)) return; closure.add(item);
      if (item === "native-button-variants") return;
      const file = byItem.get(item); if (!file) throw new Error(`shadcn-inputs: missing part ${item}`);
      dependencies(file.content).forEach(visit);
    };
    spec.parts.forEach(visit);
    const files: SourceFile[] = [], tokens = new Set<string>(), assets = new Set<string>();
    const issues: ReturnType<typeof rewriteShadcnAria>["issues"][number][] = [];
    for (const item of closure) {
      const original = byItem.get(item === "native-button-variants" ? "button" : item)!;
      let source = adaptations.files.find(file => file.item === (item === "native-button-variants" ? "button" : item))!.content;
      if (item === "native-button-variants") {
        const start = source.indexOf("const buttonVariants_DEFINITION"), end = source.indexOf("\nfunction Button", start);
        if (start < 0 || end < 0) throw new Error("shadcn-inputs: lowered button variants source changed");
        source = 'import { classNames, type ClassValue } from "./classes"\n' + source.slice(start, end) + '\nexport { buttonVariants }\n';
      }
      // Exact style restyles remain visible token bindings, never literal scanner exceptions.
      source = source.replace(/(?<![a-z-])mt-px/g, "mt-(--spacing-xs)").replace(/(?<![a-z-])mx-px/g, "mx-(--spacing-xs)").replace(/(?<![a-z-])my-px/g, "my-(--spacing-xs)");
      const result = rewriteShadcnAria({ item: item === "native-button-variants" ? "button" : item, leaf: item === "native-button-variants" ? "button" : item, files: [{ path: `components/_parts/rail-${item}/${item}.tsx`, content: source }], styles: style.content, leafByItem: {}, transformVersion: 2, retainRegistryButtonProps: true });
      result.reads.tokens.forEach(token => tokens.add(token)); result.reads.assets.forEach(asset => assets.add(asset)); issues.push(...result.issues);
      if (source.includes("--spacing-xs")) tokens.add("tokens.spacing.xs");
      for (const file of result.files) {
        let content = file.content.replace(/(_parts\/)(?!rail-)([a-z-]+)\//g, "$1rail-$2/")
          .replace(/(?<![a-z-])(?:ml-|mr-|pl-|pr-|left-|right-|text-left|text-right|border-l-|border-r-|rounded-l-|rounded-r-)/g, atom => ({ "ml-": "ms-", "mr-": "me-", "pl-": "ps-", "pr-": "pe-", "left-": "start-", "right-": "end-", "text-left": "text-start", "text-right": "text-end", "border-l-": "border-s-", "border-r-": "border-e-", "rounded-l-": "rounded-s-", "rounded-r-": "rounded-e-" })[atom]!);
        if (!/import\s+(?:\*\s+as\s+React|type\s+\*\s+as\s+React)/.test(content) && /\bReact\./.test(content)) content = 'import type * as React from "react"\n' + content;
        files.push({ ...file, content });
      }
      files.push({ path: `components/_parts/rail-${item}/index.ts`, content: `export { ${exportsOf(source).join(", ")} } from "./${item}"\n` });

    }
    if (files.some(file => file.content.includes("rail-utils/index"))) files.push(
      { path: "components/_parts/rail-utils/index.ts", content: adaptations.utility },
      { path: "components/_parts/rail-utils/types.ts", content: adaptations.utilityTypes },
      { path: "components/_parts/rail-utils/copy.ts", content: adaptations.copySource });
    const entry = `components/${leaf}/${leaf}.tsx`;
    for (const file of files) { file.path = file.path.replaceAll("rail-", "rail-u1-"); file.content = file.content.replaceAll("rail-", "rail-u1-"); file.path = file.path.replace("rail-u1-utils", "rail-utils"); file.content = file.content.replaceAll("rail-u1-utils", "rail-utils"); }
    const hasCopy = ["search-field", "tag-group"].includes(leaf);
    const copyImport = 'import { inputCopy, INPUT_COPY_REFS, type InputCopyResolver } from "../_parts/rail-u1-copy/index";\n';
    files.push({ path: entry, content: (hasCopy ? copyImport : "") + spec.code.trimStart().replaceAll("rail-", "rail-u1-") });
    if (hasCopy) files.push({ path: "components/_parts/rail-u1-copy/index.ts", content: inputCopySource });
    if (leaf === "native-action") {
      for (const file of files) {
        file.path = file.path.replace("components/_parts/rail-u1-native-button-variants/native-button-variants.tsx", "components/native-action/button-variants.tsx");
        file.content = file.content.replaceAll("../_parts/rail-u1-native-button-variants/index", "./button-variants");
      }
      files.splice(0, files.length, ...files.filter(file => !file.path.startsWith("components/_parts/")));
      const start = adaptations.utility.indexOf("function flatten"), end = adaptations.utility.indexOf("export function cn", start);
      files.push({ path: "components/native-action/classes.ts", content: 'import type { ClassValue } from "./types"\nexport type { ClassValue } from "./types"\n' + adaptations.utility.slice(start, end) });
      files.push({ path: "components/native-action/types.ts", content: adaptations.utilityTypes });
    }
    const notice = leaf === "native-action" ? "notices/native-action.md" : "notices/SHADCN-ARIA-INPUTS.md";
    files.push({ path: notice, content: `# Third-party notice\n\nSource: ${adapter.pin.url}\nCommit: ${data.commit}\nTransform: shadcn-aria-rewrite@2\n\n${license.content}` });
    const unique = [...new Map(files.map(file => [file.path, file])).values()].sort((a,b) => a.path.localeCompare(b.path));
    for (const file of unique) {
      const previous = all.get(file.path); if (previous && previous.content !== file.content) throw new Error(`shadcn-inputs: conflicting part ${file.path}`);
      all.set(file.path, file);
    }
    const upstream = [...closure].map(item => byItem.get(item === "native-button-variants" ? "button" : item)!).concat(style, license);
    const pin = { url: adapter.pin.url, commit: data.commit, files: upstream.map(file => ({ path: file.path, sha256: file.sha256 })).sort((a,b) => a.path.localeCompare(b.path)) };
    const composedInputs = leaf === "native-action" ? ["components.button"] : [];
    const descriptor = { slot: `components.${leaf}`, source: "shadcn@aria", root: slots.find(slot => slot.id === `components.${leaf}`)!.contract.root, members: Object.keys(spec.members), props: [], propMap: spec.members, reads: { tokens: sorted(tokens), assets: sorted(assets), components: composedInputs }, composes: composedInputs, impl: { kind: "source", entry, export: spec.name }, license: "MIT", pin, notice, transform: "shadcn-aria-rewrite@2", item: leaf, deps: [{ name: "react", version: "19.3.0", license: "MIT" }, ...(leaf === "native-action" ? [] : [{ name: "react-aria-components", version: "1.21.1", license: "Apache-2.0" }]), ...adaptations.host.map(row => row.dependency)], outputSha256: unique.map(file => ({ path: file.path, sha256: sha256(file.content) })), blockers: issues, ...(leaf === "native-action" ? {} : { rac: { instance: "react-aria-components", range: "^1.21.1", peer: false } }) };
    const document = { $extensions: { "com.clossys.fill": { id: `shadcn@aria/components.${leaf}`, slot: descriptor.slot, source: "shadcn@aria", mode: "implementation", sourceAddress: `${adapter.pin.url}/blob/${data.commit}/${upstream[0]!.path}`, relation: "same-contract", builtOn: [], conforms: [], evidence: [], author: "third-party", trust: "pinned-upstream", license: "MIT", status: "draft", pin: { url: adapter.pin.url, commit: data.commit, sha256: upstream[0]!.sha256 }, unmapped: [], ...(composedInputs.length ? { originKinds: ["composed"] } : {}) } }, components: { [leaf]: descriptor } } as unknown as ComponentCandidateDocument;
    fills.push(document);
    const descriptorHash = componentDescriptorHash(Object.values(document.components)[0]!);
    const bundle = { slot: descriptor.slot, descriptorHash, transform: descriptor.transform, upstream: upstream.map(({path,content})=>({path,content})), files: unique, blockers: issues };
    if (!issues.length) sourceBundles.push(bundle);
    candidates.push({ fill: `shadcn@aria/${descriptor.slot}`, slot: descriptor.slot, descriptorHash, transform: descriptor.transform, upstreamFiles: bundle.upstream, outputFiles: unique, blockers: issues, status: issues.length ? "blocked" as const : "ready" as const });
    rewrites.set(leaf, { transform: "shadcn-aria-rewrite@2", files: unique, outputSha256: descriptor.outputSha256, reads: descriptor.reads, parts: [...closure], issues });
  }
  return { fills, sourceBundles, candidates, rewrites: Object.fromEntries(rewrites), files: [...all.values()] };
}

/** Structural presentation seam, matching Banner.copy; locale/approval/ICU stay host-owned. */
const inputCopySource = `
export const INPUT_COPY_REFS = { searchClear: { id: "st.kcathn07y7" }, tagRemove: { id: "st.cxp8286800" } } as const;
type Ref = { id: string; values?: Readonly<Record<string, string | number | boolean>> };
export type InputCopyResolver = (ref: Ref) => { ref: Ref; text: string } | undefined;
export function inputCopy(copy: InputCopyResolver | undefined, key: keyof typeof INPUT_COPY_REFS, explicit?: string, values?: Ref["values"]): string {
  if (explicit?.trim()) return explicit;
  const ref = { ...INPUT_COPY_REFS[key], ...(values ? { values } : {}) };
  const resolved = copy?.(ref);
  if (!resolved || resolved.ref.id !== ref.id || !resolved.text.trim()) throw new TypeError("Input copy requires host resolution or explicit labels");
  return resolved.text;
}
`;
