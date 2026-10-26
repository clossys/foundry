import adapter from "../catalog/adapters/rac-starter.json" with { type: "json" };
import slots from "../catalog/slots/components.json" with { type: "json" };
import { sha256 } from "../catalog-core/digest.js";
import { stableStringify } from "../catalog-core/stable.js";
import { componentDescriptorHash, type ComponentCandidateDocument, type ComponentFile } from "../catalog-core/resolve-components.js";
import type { ComponentTransform, SourceBundle } from "../catalog-core/changeset-components.js";
import { rewriteShadcnAria, type RewriteIssue, type SourceFile } from "./rewrite.js";

const SOURCE = "rac-starter";
export const RAC_STARTER_PIN = Object.freeze({ url: adapter.pin.url, commit: adapter.pin.commit });
export interface RacStarterInput {
  commit: string;
  upstream: { path: string; content: string }[];
  entries: Record<string, string>;
  closures: Record<string, string[]>;
  dependencies: { name: string; version: string; license: string }[];
  upstreamNotice: string;
}
interface CandidateBytes {
  fill: string; slot: string; descriptorHash: string; status: "ready" | "blocked";
  transform: string; upstreamFiles: ComponentFile[]; outputFiles: ComponentFile[];
  blockers: { code: string; message: string }[];
}
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
const root = "starters/tailwind/src/";
const transformId = "rac-starter-rewrite@1";

/** Single-slot declarations preserve explicit scalar compound predicates through
 * locked CVA. Defaults, slots and inherited variant overrides remain unsupported.
 */
const variantsSource = `import { cva } from "class-variance-authority";
import { twMerge } from "tailwind-merge";
type Selection = object;
interface Definition {
  base?: string;
  variants?: Record<string, Record<string, string>>;
  extend?: Styles;
  compoundVariants?: Record<string, string | boolean>[];
}
interface Styles { (selection?: Selection): string; keys: readonly string[] }
export function starterVariants(definition: Definition): Styles {
  const unsupported = Object.keys(definition).filter(key => !["base", "variants", "extend", "compoundVariants"].includes(key));
  if (unsupported.length) throw new Error("Unsupported starter style semantics: " + unsupported.join(","));
  const keys = Object.keys(definition.variants ?? {});
  if (definition.extend?.keys.some(key => keys.includes(key))) throw new Error("Unsupported starter variant override");
  const compounds = definition.compoundVariants;
  if (compounds !== undefined && (!Array.isArray(compounds) || compounds.some(clause => !clause || typeof clause !== "object" || Array.isArray(clause)
    || Object.entries(clause).some(([key, value]) => ["class", "className"].includes(key) ? typeof value !== "string" : !keys.includes(key) || !["string", "boolean"].includes(typeof value))))) throw new Error("Unsupported starter compound semantics");
  // CVA's static generic cannot describe runtime-declared boolean variant keys.
  // The scalar clauses above are validated, then forwarded without coercion.
  type CvaConfig = NonNullable<Parameters<typeof cva<Record<string, Record<string, string>>>>[1]>;
  const own = cva(definition.base, { variants: definition.variants, compoundVariants: compounds as CvaConfig["compoundVariants"] });
  const styles = (selection: Selection = {}) => {
    const values: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(selection));
    const selected: Record<string, string | boolean | null | undefined> = {};
    for (const key of [...keys, "class", "className"]) {
      const value = values[key];
      if (value !== undefined && value !== null && typeof value !== "string" && typeof value !== "boolean") throw new Error("Unsupported starter variant value");
      selected[key] = value;
    }
    const inherited = Object.fromEntries(Object.entries(values).filter(([key]) => key !== "class" && key !== "className"));
    return twMerge(definition.extend?.(inherited), own(selected as Parameters<typeof own>[0]));
  };
  styles.keys = [...(definition.extend?.keys ?? []), ...keys];
  return styles;
}
`;

function memberMap(leaf: string): Record<string, string> {
  // Public RAC prop forwarding is source evidence, not a runtime observation.
  if (leaf === "form") return { "validation.native": "Form.validationBehavior=native", "validation.aria": "Form.validationBehavior=aria" };
  if (leaf === "toolbar") return { "orientation.horizontal": "Toolbar.orientation=horizontal", "orientation.vertical": "Toolbar.orientation=vertical" };
  if (leaf === "number-field") return { format: "NumberField", step: "NumberField", "state.invalid": "NumberField.isInvalid" };
  if (leaf === "navigation-tree") return { expand: "NavigationTree", current: "NavigationTree" };
  if (leaf === "tree") return { selection: "Tree", expand: "Tree" };
  if (leaf === "tag-group") return { removable: "Tag", "selection.none": "TagGroup.selectionMode=none", "selection.single": "TagGroup.selectionMode=single", "selection.multiple": "TagGroup.selectionMode=multiple" };
  if (leaf === "color-picker") return { "part.area": "ColorArea", "part.wheel": "ColorWheel", "part.slider": "ColorSlider", "part.field": "ColorField", "part.swatch-picker": "ColorSwatchPicker" };
  throw new Error("rac-starter: undeclared leaf");
}

/** No code from the source snapshot is evaluated during verification or rewriting. */
export function importRacStarter(input: RacStarterInput) {
  if (input.commit !== RAC_STARTER_PIN.commit) throw new Error("rac-starter: commit differs from admitted source");
  if (input.upstreamNotice !== "absent-at-pinned-commit") throw new Error("rac-starter: NOTICE status differs");
  for (const key of ["entries", "closures", "dependencies"] as const) if (stableStringify(input[key]) !== stableStringify(adapter[key])) throw new Error(`rac-starter: pinned source ${key} declaration differs`);
  const expected = new Map(adapter.pin.files.map(file => [file.path, file.sha256]));
  if (input.upstream.length !== expected.size || new Set(input.upstream.map(file => file.path)).size !== expected.size) throw new Error("rac-starter: pinned source closure differs");
  for (const file of input.upstream) if (sha256(file.content) !== expected.get(file.path)) throw new Error(`rac-starter: pinned source hash differs for ${file.path}`);
  const fills: ComponentCandidateDocument[] = [], candidates: CandidateBytes[] = [], sourceBundles: SourceBundle[] = [];
  const outputBySlot = new Map<string, ComponentFile[]>();
  for (const leaf of Object.keys(input.entries).sort()) {
    const name = input.entries[leaf]!, slot = `components.${leaf}`;
    const contract = slots.find(value => value.id === slot)?.contract;
    if (!contract || !input.closures[leaf]?.includes(`${root}${name}.tsx`)) throw new Error("rac-starter: unknown or incomplete source entry");
    const componentRoot = `rac:${name}` as const;
    if (contract.root !== componentRoot) throw new Error("rac-starter: root differs from the existing leaf contract");
    const closure = input.closures[leaf]!;
    const closureFiles = closure.map(path => {
      const file = input.upstream.find(file => file.path === path);
      if (!file) throw new Error("rac-starter: pinned source closure member absent");
      return file;
    });
    // The source materializer accepts extension-bearing code/metadata paths.
    // Keep upstream LICENSE at its real path in the authenticated adapter and
    // complete closure; its exact bytes are also bound by the output receipt.
    // Do not invent LICENSE.md or weaken the engine's upstream path grammar.
    const upstreamFiles = closureFiles.filter(file => file.path !== "LICENSE");
    const external = new Set<string>(), components = new Set<string>();
    const issues: RewriteIssue[] = [];
    const files: SourceFile[] = [];
    let needsVariants = false;
    for (const original of closureFiles.filter(file => file.path.startsWith(root))) {
      const stem = original.path.slice(root.length).replace(/\.tsx?$/, "");
      // These are whole selected leaves, not copied private implementations.
      if (leaf === "color-picker" && ["Dialog", "Popover"].includes(stem) || leaf === "tree" && stem === "Checkbox") continue;
      let content = original.content;
      content = content.replace(/from\s*(['"])react-aria-components\/[A-Za-z]+\1/g, 'from "react-aria-components"');
      for (const [local, target] of [["Dialog", "dialog"], ["Popover", "popover"], ["Checkbox", "checkbox"]] as const) {
        const pattern = new RegExp(`from\\s*(['"])\\./${local}\\1`, "g");
        if ((leaf === "color-picker" && local !== "Checkbox" || leaf === "tree" && local === "Checkbox") && pattern.test(content)) {
          pattern.lastIndex = 0; content = content.replace(pattern, `from "../${target}/index.js"`); components.add(`components.${target}`);
        }
      }
      // Field.tsx contains contextual Label/Group/Input helpers, not the selected Field wrapper.
      content = content.replace(/from\s*(['"])\.\/Field\1/g, 'from "./Field.context.js"');
      content = content.replace(/from\s*(['"])(\.\/[A-Za-z][A-Za-z0-9]*)\1/g, 'from "$2.js"');
      if (/from\s*['"]tailwind-variants['"]/.test(content)) {
        needsVariants = true;
        content = content.replace(/import\s*\{\s*tv\s*\}\s*from\s*['"]tailwind-variants['"];?/g, 'import { starterVariants as tv } from "../_parts/rac-starter-variants/index.js";');
        for (const key of ["defaultVariants", "slots"]) if (new RegExp(`\\b${key}\\s*:`).test(content)) issues.push({ code: "K9", file: original.path, value: key, message: `Unsupported starter ${key} style semantics require an exact locked-CVA representation` });
      }
      files.push({ path: original.path === `${root}Field.tsx` ? `${root}Field.context.tsx` : original.path, content });
    }
    if (leaf === "color-picker") {
      const entry = files.find(file => file.path.endsWith("/ColorPicker.tsx"))!;
      for (const part of ["ColorArea", "ColorWheel", "ColorSlider", "ColorField", "ColorSwatchPicker"]) entry.content += `\nexport { ${part} } from "./${part}.js";\n`;
    }
    const rewrite = rewriteShadcnAria({ item: leaf, leaf, files, styles: "", leafByItem: {} });
    issues.push(...rewrite.issues);
    const output = rewrite.files.map(file => ({ ...file }));
    if (needsVariants) { output.push({ path: "components/_parts/rac-starter-variants/index.ts", content: variantsSource }); external.add("class-variance-authority"); external.add("tailwind-merge"); }
    for (const file of output) for (const match of file.content.matchAll(/from\s*['"]([^'"]+)['"]/g)) if (!match[1]!.startsWith(".")) external.add(match[1]!);
    const license = input.upstream.find(file => file.path === "LICENSE")!;
    output.push({ path: adapter.notice, content: license.content });
    for (const dep of rewrite.reads.components) components.add(dep);
    const deps = input.dependencies.filter(dep => external.has(dep.name));
    for (const name of external) if (!input.dependencies.some(dep => dep.name === name)) issues.push({ code: "K9", file: `${root}${input.entries[leaf]}.tsx`, value: name, message: "Output import has no existing locked dependency" });
    const propMap = memberMap(leaf);
    const blockers = [...new Map(issues.map(issue => [JSON.stringify(issue), { code: issue.code, message: `${issue.file}: ${issue.value}: ${issue.message}` }])).values()];
    const descriptor = {
      slot, source: SOURCE, root: componentRoot, members: Object.keys(propMap).sort(), props: [], propMap,
      reads: { tokens: rewrite.reads.tokens, assets: rewrite.reads.assets, components: [...components].sort() }, composes: [...components].sort(),
      impl: { kind: "source" as const, entry: `components/${leaf}/${name}.tsx`, export: name }, license: "Apache-2.0",
      pin: { ...RAC_STARTER_PIN, files: upstreamFiles.map(file => ({ path: file.path, sha256: sha256(file.content) })).sort((a, b) => a.path.localeCompare(b.path)) },
      transform: transformId, notice: adapter.notice, deps, outputSha256: output.map(file => ({ path: file.path, sha256: sha256(file.content) })).sort((a, b) => a.path.localeCompare(b.path)), blockers,
      ...(leaf === "tag-group" ? { secondaryExports: [{ name: "Tag", export: "Tag" }] } : {}),
    };
    const doc: ComponentCandidateDocument = { $extensions: { "com.clossys.fill": {
      id: `${SOURCE}/${slot}`, slot, source: SOURCE, mode: "implementation", sourceAddress: `${RAC_STARTER_PIN.url}/blob/${RAC_STARTER_PIN.commit}/${root}${name}.tsx`,
      relation: "same-contract", builtOn: [...components].sort(), conforms: [], evidence: [], author: "third-party", trust: "pinned-upstream", license: "Apache-2.0", status: "draft",
      pin: { ...RAC_STARTER_PIN, sha256: sha256(upstreamFiles.find(file => file.path === `${root}${name}.tsx`)!.content) },
    } }, components: { [leaf]: descriptor } };
    fills.push(doc); outputBySlot.set(slot, output);
    const descriptorHash = componentDescriptorHash(descriptor);
    candidates.push({ fill: doc.$extensions["com.clossys.fill"].id, slot, descriptorHash, status: blockers.length ? "blocked" : "ready", transform: transformId, upstreamFiles, outputFiles: output, blockers });
    if (!blockers.length) sourceBundles.push({ slot, descriptorHash, transform: transformId, upstream: upstreamFiles, files: output, blockers: [] });
  }
  const transform: ComponentTransform = { id: transformId, run: (fill, upstream) => {
    const candidate = candidates.find(row => row.slot === fill.slot && row.descriptorHash === componentDescriptorHash(fill));
    if (!candidate || stableStringify(upstream) !== stableStringify([...candidate.upstreamFiles].sort((a, b) => a.path.localeCompare(b.path)))) throw new Error("rac-starter: transform source or descriptor differs");
    return { files: structuredClone(outputBySlot.get(fill.slot)!), blockers: candidate.blockers };
  } };
  return { fills, candidates, sourceBundles, transform, upstreamNotice: input.upstreamNotice };
}

export function generatedRacStarterFiles(input: RacStarterInput): Record<string, string> {
  return Object.fromEntries(importRacStarter(input).fills.map(doc => [`${doc.$extensions["com.clossys.fill"].slot}.json`, stableStringify(doc) + "\n"]));
}
