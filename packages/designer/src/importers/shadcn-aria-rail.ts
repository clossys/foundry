import { importFeedbackRail } from "./feedback-rail.js";
import data from "./vendor/shadcn-aria-rail.data.json" with { type: "json" };
import adapter from "../catalog/adapters/shadcn@aria.json" with { type: "json" };
import slots from "../catalog/slots/components.json" with { type: "json" };
import { sha256 } from "../catalog-core/digest.js";
import { componentDescriptorHash, type ComponentCandidateDocument } from "../catalog-core/resolve-components.js";
import type { SourceBundle } from "../catalog-core/changeset-components.js";
import { rewriteShadcnAria, type SourceFile } from "./rewrite.js";

/** Current official Aria source additions; existing v1 fills keep their authenticated pin. */
export const SHADCN_ARIA_RAIL_ITEMS = ["sidebar", "command", "sheet", "empty", "item", "scroll-area", "dropdown-menu", "kbd", "sonner"] as const;
const leafOf = (item: string): string => item === "kbd" ? "keyboard" : item;
const exportsOf = (code: string): string[] => [...code.matchAll(/export\s*\{([^}]+)\}/g)].flatMap(match => match[1]!.split(",").map(x => x.trim()).filter(x => x && !x.startsWith("type ")));
const dependencies = (code: string): string[] => [...code.matchAll(/from\s*"@\/registry\/bases\/aria\/ui\/([a-z-]+)"/g)].map(match => match[1]!);
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
const utils = 'import { clsx, type ClassValue } from "clsx"\nimport { twMerge } from "tailwind-merge"\nexport function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }\n';

export function importShadcnAriaRail() {
  const byItem = new Map(data.files.map(file => [file.item, file]));
  for (const file of data.files) if (sha256(file.content) !== file.sha256) throw new Error(`shadcn-rail: source pin mismatch: ${file.path}`);
  const style = byItem.get("style")!, license = byItem.get("license")!;
  const source = "shadcn@aria", transform = "shadcn-aria-rewrite@2";
  const leafByItem = Object.fromEntries(SHADCN_ARIA_RAIL_ITEMS.map(item => [item, leafOf(item)]));
  const allFiles = new Map<string, SourceFile>();
  const fills: ComponentCandidateDocument[] = [], sourceBundles: SourceBundle[] = [];
  const candidates = [];
  const rewrites: Record<string, ReturnType<typeof rewriteShadcnAria>> = {};
  for (const item of SHADCN_ARIA_RAIL_ITEMS) {
    if (item === "sonner") continue;
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
      const result = rewriteShadcnAria({ item: name, leaf: privatePart ? name : leaf, files: [{ path: inputPath, content: upstream.content.replaceAll("@/registry/bases/aria/hooks/use-mobile", `${privatePart ? "../../" : "../"}_parts/rail-use-mobile/index`) }], styles: style.content, leafByItem, transformVersion: 2, retainRegistryButtonProps: true });
      result.reads.tokens.forEach(x => tokens.add(x)); result.reads.assets.forEach(x => assets.add(x)); result.reads.components.forEach(x => components.add(x));
      issues.push(...result.issues); notes.push(...result.notes ?? []);
      for (const file of result.files) {
        let content = file.content.replace(/(_parts\/)(?!rail-)([a-z-]+)\//g, "$1rail-$2/")
          .replaceAll('@/registry/bases/aria/hooks/use-mobile', `${privatePart ? "../../" : "../"}_parts/rail-use-mobile/index`);
        if (!/import\s+(?:\*\s+as\s+React|type\s+\*\s+as\s+React)/.test(content) && /\bReact\./.test(content)) content = 'import type * as React from "react"\n' + content;
        files.push({ ...file, content });
      }
    }
    if (files.some(file => file.content.includes("rail-utils/index"))) files.push({ path: "components/_parts/rail-utils/index.ts", content: utils });
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
    const descriptor = { slot, source, root: contract.contract.root, members: Object.keys(propMap), props: [], propMap, reads: { tokens: sorted(tokens), assets: sorted(assets), components: sorted(components) }, composes: sorted(components), impl: { kind: "source", entry: `components/${leaf}/${item}.tsx`, export: root }, ...(secondaryExports.length ? { secondaryExports } : {}), license: "MIT", pin, notice, transform, item, deps: [{ name: "react", version: "19.3.0", license: "MIT" }, { name: "react-aria-components", version: "1.21.1", license: "Apache-2.0" }, { name: "class-variance-authority", version: "0.7.1", license: "Apache-2.0" }, { name: "clsx", version: "2.1.1", license: "MIT" }, { name: "tailwind-merge", version: "3.7.0", license: "MIT" }], parts: [...closure].filter(name => name !== item).map(item => ({ item: `rail-${item}` })), outputSha256: unique.map(file => ({ path: file.path, sha256: sha256(file.content) })), blockers: issues, rac: { instance: "react-aria-components", range: "^1.21.1", peer: false } };
    const document = { $extensions: { "com.clossys.fill": { id: `${source}/${slot}`, slot, source, mode: "implementation", sourceAddress: `${adapter.pin.url}/blob/${data.commit}/${original.path}`, relation: "same-contract", builtOn: sorted(components), conforms: [], evidence: [], author: "third-party", trust: "pinned-upstream", license: "MIT", status: "draft", pin: { url: adapter.pin.url, commit: data.commit, sha256: original.sha256 }, unmapped: [] } }, components: { [leaf]: descriptor } } as unknown as ComponentCandidateDocument;
    fills.push(document);
    const fill = Object.values(document.components)[0]!;
    const descriptorHash = componentDescriptorHash(fill), upstreamFiles = pinned.map(({path,content}) => ({path,content}));
    const bundle = { slot, descriptorHash, transform, upstream: upstreamFiles, files: unique, blockers: issues };
    if (!issues.length) sourceBundles.push(bundle);
    candidates.push({ fill: `${source}/${slot}`, slot, descriptorHash, transform, upstreamFiles, outputFiles: unique, blockers: issues, status: issues.length ? "blocked" as const : "ready" as const });
    rewrites[item] = { transform, files: unique, outputSha256: descriptor.outputSha256, reads: descriptor.reads, parts: descriptor.parts.map(x=>x.item), issues, notes };
  }
  const feedback = importFeedbackRail(data);
  return { fills: [...fills, ...feedback.fills], sourceBundles: [...sourceBundles, ...feedback.sourceBundles], candidates: [...candidates, ...feedback.candidates], rewrites: {...rewrites,...feedback.rewrites}, files: [...allFiles.values(),...feedback.files] };
}
