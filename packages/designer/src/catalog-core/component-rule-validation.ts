/** Shared structural rule proof. Runtime measurements remain independent. */
import { CatalogError } from "./api.js";
import { sha256 } from "./digest.js";
import { stableStringify } from "./stable.js";
import { assertComponentDescriptor, assertComponentFiles, componentDescriptorHash, componentOf, sortedComponentIds, verifyComponentOutput } from "./resolve-components.js";
import type { ComponentCandidate, ComponentLibrary, ComponentOrigin, ComponentRule } from "./resolve-components.js";
export interface ComponentCompositionContext { rules: readonly ComponentRule[]; library: ComponentLibrary }
const sameIds = (a: readonly string[], b: readonly string[]) => a.length === new Set(a).size && b.length === new Set(b).size && stableStringify(sortedComponentIds(a)) === stableStringify(sortedComponentIds(b));

/** Full selected dependency closure, including shared files and provenance. */
export function hashComponentInputClosure(library: ComponentLibrary, inputs: readonly string[]): string {
  assertComponentFiles(library.files);
  if (new Set(inputs).size !== inputs.length) throw new CatalogError("components: duplicate rule input");
  const active = new Set<string>(), visited = new Set<string>();
  const descriptors = new Map<string, ComponentCandidate>();
  const files = new Map<string, { path: string; content: string }>();
  const walk = (slot: string): void => {
    if (active.has(slot)) throw new CatalogError("components: cyclic rule input closure");
    if (visited.has(slot)) return;
    const matches = library.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === slot);
    if (matches.length !== 1) throw new CatalogError(`components: rule input missing or duplicate ${slot}`);
    const fill = componentOf(matches[0]!);
    active.add(slot);
    if (fill.impl.kind === "source") {
      verifyComponentOutput(fill, library.files);
      for (const receipt of fill.outputSha256!) {
        const file = library.files.find(file => file.path === receipt.path)!;
        const previous = files.get(file.path);
        if (previous && previous.content !== file.content) throw new CatalogError("components: conflicting shared input bytes");
        files.set(file.path, file);
      }
      if (library.files.some(file => file.path.startsWith(`components/${slot.slice(11)}/`) && !fill.outputSha256!.some(receipt => receipt.path === file.path))) throw new CatalogError("components: unreceipted rule input bytes");
    } else if (fill.impl.kind === "package" && library.files.some(file => file.path.startsWith(`components/${slot.slice(11)}/`))) throw new CatalogError("components: package input cannot own copied bytes");
    for (const child of sortedComponentIds([...fill.reads.components, ...fill.composes])) walk(child);
    descriptors.set(slot, fill); active.delete(slot); visited.add(slot);
  };
  for (const slot of [...inputs].sort()) walk(slot);
  return sha256(stableStringify({
    descriptors: [...descriptors].sort(([a], [b]) => a.localeCompare(b)).map(([slot, descriptor]) => ({ slot, descriptor })),
    files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
  }));
}
export function validateComponentRuleTemplate(rule: ComponentRule): void {
  assertComponentDescriptor(rule.template);
  if (rule.template.slot !== rule.slot || rule.inputs.includes(rule.slot) || new Set(rule.inputs).size !== rule.inputs.length) throw new CatalogError("components: invalid rule inputs or template slot");
  assertComponentFiles(rule.files);
  if (rule.template.impl.kind === "source") {
    verifyComponentOutput(rule.template, rule.files);
    if (rule.files.length !== rule.template.outputSha256?.length) throw new CatalogError("components: unreceipted rule output bytes");
    const leaf = `components/${rule.slot.slice(11)}/`;
    if (rule.files.some(file => !(file.path.startsWith(leaf) || file.path === rule.template.notice) || file.path === `${leaf}index.ts`)) throw new CatalogError("components: rule output must own its leaf and unique notice only");
    if (rule.template.notice !== `notices/${rule.slot.slice(11)}.md`) throw new CatalogError("components: rule requires a unique leaf notice");
    if (rule.kind === "compose" && (!sameIds(rule.inputs, rule.template.composes) || !sameIds(rule.inputs, rule.template.reads.components))) throw new CatalogError("components: composed rule direct inputs differ from reads");
  } else if (rule.files.length) throw new CatalogError("components: package rule cannot copy output bytes");
}
export function validateInstalledComponentRule(fill: ComponentCandidate & { origin?: ComponentOrigin }, context: ComponentCompositionContext): ComponentRule {
  const origin = fill.origin;
  if (!origin || (origin.kind !== "composed" && origin.kind !== "derived")) throw new CatalogError("components: registered rule origin required");
  const matches = context.rules.filter(rule => rule.id === origin.rule && rule.slot === fill.slot && rule.kind === (origin.kind === "composed" ? "compose" : "derive"));
  if (matches.length !== 1) throw new CatalogError("components: unknown or ambiguous registered rule");
  const rule = matches[0]!; validateComponentRuleTemplate(rule);
  const ids = origin.kind === "composed" ? origin.reads : origin.inputs;
  if (!sameIds(ids, rule.inputs)) throw new CatalogError("components: rule input set differs");
  if (componentDescriptorHash(fill) !== componentDescriptorHash({ ...rule.template, source: context.library.source.id })) throw new CatalogError("components: rule output hand-edit requires authored origin");
  const installed = context.library.fills.filter(doc => componentOf(doc).slot === fill.slot);
  if (installed.length !== 1 || stableStringify(componentOf(installed[0]!)) !== stableStringify(fill)) throw new CatalogError("components: rule output differs from consumer library");
  if (fill.impl.kind === "source") {
    verifyComponentOutput(fill, context.library.files);
    if (context.library.files.some(file => file.path.startsWith(`components/${fill.slot.slice(11)}/`) && !fill.outputSha256!.some(receipt => receipt.path === file.path))) throw new CatalogError("components: unreceipted owned rule output");
  }
  if (hashComponentInputClosure(context.library, ids) !== origin.inputsHash) throw new CatalogError("components: stale rule inputs");
  return rule;
}
