import type { InstanceFinding, InstanceRegistries } from "../../../core/instance-binding.js";
import { getEffectiveLayoutContract } from "../../../layouts/resolve.js";
import type { PublisherPipelineItem, PublishStageStatus } from "../pipeline.js";

export const ASSEMBLY_OWNERS = ["Tokens", "Components", "Sections", "Frames", "Layouts", "Content", "Format"] as const;
export type AssemblyOwner = typeof ASSEMBLY_OWNERS[number];
/** The host resolves its own Designer routes; Publisher never constructs query routes. */
export interface AssemblyOwnerTarget {
  readonly owner: AssemblyOwner;
  readonly references: readonly string[];
  readonly instanceId: string;
}
export type AssemblyOwnerHref = (target: AssemblyOwnerTarget) => string | undefined;
export interface AssemblyNode extends AssemblyOwnerTarget {
  readonly status: PublishStageStatus;
  readonly summary: string;
  readonly detail: string;
  readonly findings: readonly InstanceFinding[];
}

/** Project supplied assembly evidence only. Registration never asserts rendered qualification. */
export function deriveItemAssembly(item: PublisherPipelineItem, registries: InstanceRegistries): readonly AssemblyNode[] {
  const { binding, findings } = item;
  const fills = [...Object.values(binding.fills).flat(), ...Object.values(binding.frame.slotFills ?? {})];
  const sections = [...new Set(fills.map(fill => fill.section + (fill.config ? ` · ${fill.config}` : "")))];
  const hostContent = Object.values(binding.frame.content ?? {});
  const content = [...new Set([...fills.flatMap(fill => Object.values(fill.content)), ...hostContent].map(ref => `${ref.kind} · ${ref.ref}`))];
  let tokenRefs: string[] = [];
  let layoutResolved = false;
  try {
    const leaf = registries.layouts.find(leaf => leaf.id === binding.layout.leaf);
    if (leaf) {
      const contract = getEffectiveLayoutContract(leaf, binding.layout.config, binding.layout.members);
      // These are concrete references. allowedReads is only permission, not dependency evidence.
      tokenRefs = [...new Set(contract.reflow.map(step => step.at))];
      layoutResolved = true;
    }
  } catch { /* LK2 retains the refusal; do not recover a different layout config. */ }
  const missingTokens = tokenRefs.filter(id => !registries.tokens.some(token => token.id === id));
  const stage = (name: string) => item.stages.find(stage => stage.name === name);
  const node = (owner: AssemblyOwner, references: readonly string[], status: PublishStageStatus, summary: string, detail: string, related: readonly InstanceFinding[] = []): AssemblyNode =>
    ({ owner, references, status, summary, detail, findings: related, instanceId: binding.instanceId });
  const fromStage = (owner: AssemblyOwner, name: string, references: readonly string[], summary: string, detail: string) => {
    const evidence = stage(name);
    const related = findings.filter(finding => owner === "Frames"
      ? finding.path === "frame" || finding.path.startsWith("frame.") && !finding.path.startsWith("frame.slotFills")
      : owner === "Sections" ? (finding.path.startsWith("fills.") || finding.path.startsWith("frame.slotFills")) && finding.code !== "LK10"
      : finding.code === "LK10");
    const combined = [...new Set([...(evidence?.findings ?? []), ...related])];
    const failing = combined.filter(finding => !(owner === "Content" && item.inputRequests.some(request => request.slot === finding.path)));
    return node(owner, references, failing.length ? "failed" : evidence?.status ?? "pending", summary, [...(evidence?.pending ?? []), detail].filter(Boolean).join(" · "), combined);
  };
  const format = registries.formats.find(format => format.id === binding.format);
  const formatFindings = findings.filter(finding => finding.code === "LK16");
  const layoutFindings = findings.filter(finding => finding.path === "layout" || finding.path.startsWith("layout."));
  const layoutStatus = layoutFindings.length ? "failed" : stage("Layout")?.status ?? "pending";
  const contentNode = fromStage("Content", "Content", content, `${content.length} content references`,
    "Typed reference bindings only; placeholder references do not qualify audience content" +
    (hostContent.length ? " · Frame host content required-slot, value and hash verification pending" : ""));
  return [
    node("Tokens", tokenRefs, missingTokens.length ? "failed" : layoutResolved && tokenRefs.length ? "passed" : "pending",
      missingTokens.length ? `${missingTokens.length} missing token references` : `${tokenRefs.length} referenced breakpoint tokens`,
      !layoutResolved ? "Effective layout unavailable; token references cannot be derived" : missingTokens.length ? missingTokens.join(", ") : "Registration only; renderer reads are checked by LK11, rendered values remain unverified"),
    node("Components", [], "pending", "Component inputs not supplied", "The instance contract supplies no component dependency graph; no component edges or qualification are inferred"),
    fromStage("Sections", "Fills", sections, `${fills.length} section fills`, "Consumer fill checks only; section runtime qualification is not supplied"),
    fromStage("Frames", "Frame", [binding.frame.leaf, ...(binding.frame.config ? [binding.frame.config] : [])], binding.frame.leaf, "Consumer frame binding; runtime qualification is not supplied"),
    node("Layouts", [binding.layout.leaf, binding.layout.config], layoutStatus, `${binding.layout.leaf} · ${binding.layout.config}`,
      [...(stage("Layout")?.pending ?? []), "Effective layout config and supplied renderer source"].join(" · "), layoutFindings),
    { ...contentNode, status: hostContent.length && contentNode.status === "passed" ? "pending" : contentNode.status },
    node("Format", [binding.format], formatFindings.length ? "failed" : format?.status === "built" ? "passed" : "pending",
      format?.label ?? binding.format, format ? `${format.id} · ${format.status} configuration; LK16 checks the supplied format, composition and frame binding` : "Format does not resolve in the supplied registry", formatFindings),
  ];
}
