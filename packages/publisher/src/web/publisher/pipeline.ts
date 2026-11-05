import { derivePublisherDeliveryState } from "../../planning/configuration.js";
import { inspectInstanceChecks, checkInstancePack } from "../../core/instance-binding.check.js";
import type { ConsumerInstanceLibrary, FlowInstanceBinding as InstanceBinding, InstanceCheckCode, InstanceFinding, InstanceRegistries } from "../../core/instance-binding.js";
import type { LayoutCompilerPort } from "../../core/layout-source.js";

import { applyProductionSettings, requiredContentQuestions } from "./production-settings.js";
import type { ProductionSettingsByItem, PublisherInputRequest } from "./production-settings.js";

export const PUBLISH_STAGES = ["Configure", "Frame", "Layout", "Fills", "Content", "Checks", "Ready", "Export", "Deploy"] as const;
export type PublishStage = typeof PUBLISH_STAGES[number];
export type PublishStageStatus = "passed" | "failed" | "pending" | "concept-only" | "unknown";
export interface PublishStageEvidence {
  readonly name: PublishStage;
  readonly status: PublishStageStatus;
  readonly findings: readonly InstanceFinding[];
  readonly pending: readonly string[];
}
export interface PublisherLane {
  readonly id: string;
  readonly label: string;
  readonly instanceIds: readonly string[];
}
/** Presentation grouping never enters the closed InstanceBinding contract. */
export const STANDARD_WEBSITE_LANES: readonly PublisherLane[] = [
  { id: "landing", label: "Landing", instanceIds: ["standard.home"] },
  { id: "document", label: "Document", instanceIds: ["standard.about", "standard.terms", "standard.privacy"] },
  { id: "contact", label: "Contact", instanceIds: ["standard.contact"] },
  { id: "showcase", label: "Showcase", instanceIds: ["standard.showcase"] },
  { id: "status", label: "Status", instanceIds: ["standard.not-found", "standard.error"] },
];
export interface PublisherCheckEvidence {
  readonly code: InstanceCheckCode | "LK12";
  readonly status: "passed" | "failed" | "pending";
  readonly findings: readonly InstanceFinding[];
}
const INSTANCE_CHECKS: readonly PublisherCheckEvidence["code"][] = ["LK1", "LK2", "LK3", "LK4", "LK5", "LK6", "LK7", "LK8", "LK9", "LK10", "LK11", "LK12", "LK13", "LK14", "LK15", "LK16"];
export interface PublisherPipelineItem {
  readonly key: string;
  readonly binding: InstanceBinding;
  readonly sourceBinding: InstanceBinding;
  readonly sourceFindings: readonly InstanceFinding[];
  readonly configured: boolean;
  readonly inputRequests: readonly PublisherInputRequest[];
  readonly state: "to do" | "needs input" | "failed" | "pending" | "ready";
  readonly stages: readonly PublishStageEvidence[];
  readonly column: PublishStage;
  readonly findings: readonly InstanceFinding[];
  /** Actual static execution; LK12 and complete pack closure stay pending. */
  readonly checks: readonly PublisherCheckEvidence[];
  readonly staticCoverage: "complete" | "short-circuited" | "unavailable";
  readonly unavailableChecks: readonly InstanceCheckCode[];
  /** No requested states leaves applicability to the host; it is not a failure or clearance. */
  readonly stateCoverage: "not-requested" | "checked" | "unavailable";
  /** Layout-only harness results cannot change this whole-instance obligation. */
  readonly wholeInstanceLK12: "pending";
}
export interface PublisherPackPipeline {
  readonly items: readonly PublisherPipelineItem[];
  readonly findings: readonly InstanceFinding[];
  readonly frameLeaves: readonly { readonly surface: "site" | "app"; readonly leaves: readonly string[] }[];
  readonly readyCount: number;
}
function findingStage(finding: InstanceFinding): PublishStage {
  if (finding.code === "LK1") return finding.path.startsWith("layout") ? "Layout" : "Frame";
  if (finding.code === "LK2" || finding.code === "LK16") return "Layout";
  if (finding.code === "LK10") return "Content";
  if (finding.code === "LK7" && finding.path === "frame") return "Frame";
  if (finding.code === "LK7" && finding.path === "layout") return "Layout";
  if (["LK3", "LK4", "LK5", "LK6", "LK7", "LK13"].includes(finding.code)) return "Fills";
  return "Checks";
}

/** Display projection of actual checks, with missing and short-circuited proof kept pending. */
export function derivePackPipeline(instances: readonly InstanceBinding[], library: ConsumerInstanceLibrary, registries: InstanceRegistries, compiler?: LayoutCompilerPort, settings: ProductionSettingsByItem = {}, requests: Readonly<Record<string, readonly PublisherInputRequest[]>> = {}): PublisherPackPipeline {
  const effective = instances.map(binding => applyProductionSettings(binding, settings[binding.instanceId]));
  const pack = checkInstancePack(effective, library, registries, compiler);
  const sourcePack = checkInstancePack(instances, library, registries, compiler);
  const items: PublisherPipelineItem[] = effective.map((binding, index) => {
    const sourceBinding = instances[index]!;
    const configured = settings[sourceBinding.instanceId] !== undefined;
    const sourceFindings = sourcePack.findings.filter(finding => finding.path === `instances.${index}` || finding.path.startsWith(`instances.${index}.`))
      .map(finding => ({ ...finding, path: finding.path.slice(`instances.${index}`.length + 1) || "instance" }));
    const inspection = inspectInstanceChecks(binding, library, registries, compiler);
    const checked = inspection.result;
    const closure = pack.findings.filter(finding => finding.code === "LK15" && (finding.path === `instances.${index}` || finding.path.startsWith(`instances.${index}.`)))
      .map(finding => ({ ...finding, path: finding.path.slice(`instances.${index}`.length + 1) || "instance" }));
    const findings = [...checked.findings, ...closure];
    const inputRequests = [...requiredContentQuestions(findings), ...(requests[sourceBinding.instanceId] ?? [])];
    const awaitingOnlyContent = checked.findings.length > 0 && checked.findings.every(finding => finding.code === "LK10" && finding.message === "Required content ref is missing");
    const checks: readonly PublisherCheckEvidence[] = INSTANCE_CHECKS.map(code => {
      const related = findings.filter(finding => finding.code === code);
      return { code, findings: configured ? related : [], status: !configured ? "pending" : related.length ? "failed" :
        code === "LK12" || code === "LK15" || !inspection.completed || inspection.unavailableChecks.includes(code) ? "pending" : "passed" };
    });
    const stages = PUBLISH_STAGES.map((name): PublishStageEvidence => {
      if (name === "Configure") return { name, status: configured ? "passed" : "pending", findings: [], pending: configured ? [] : ["to do: apply production settings"] };
      if (!configured) return { name, status: "pending", findings: [], pending: ["Waiting for Configure"] };
      if (name === "Export" || name === "Deploy") {
        const selected = settings[sourceBinding.instanceId];
        const state = derivePublisherDeliveryState(selected ? { format: selected.format, deliveries: selected.deliveries ?? [] } : undefined, registries);
        return { name, status: name === "Export" ? state.export : state.deploy, findings: [], pending: [] };
      }
      const stageFindings = findings.filter(finding => findingStage(finding) === name);
      const unanswered = stageFindings.filter(finding => finding.code === "LK10" && finding.message === "Required content ref is missing" || awaitingOnlyContent && finding.code === "LK15" && finding.message === "Pack member fails static instance checks");
      const pending: string[] = [];
      if (unanswered.length) pending.push("needs input: required content references before pack closure");
      if (name === "Checks") pending.push("LK12 rendered responsive evidence is unavailable");
      if (name !== "Ready" && !inspection.completed) pending.push("Static checks short-circuited; remaining proof is unavailable");
      if (name === "Content" && inspection.unavailableChecks.includes("LK10")) pending.push("LK10 needs registered section contracts before content can be checked");
      if (name === "Ready") pending.push("Requires every stage, including LK12, to pass");
      return { name, findings: stageFindings, pending, status: stageFindings.length > unanswered.length ? "failed" : pending.length ? "pending" : "passed" };
    });
    // Whole-instance LK12 is deliberately unavailable in PU7. Ready still derives
    // from the preceding stages, so later evidence cannot bypass a pending input.
    const readiness = stages.filter(stage => ["Configure", "Frame", "Layout", "Fills", "Content", "Checks"].includes(stage.name));
    const ready = stages.find(stage => stage.name === "Ready")!;
    if (readiness.every(stage => stage.status === "passed")) stages[stages.indexOf(ready)] = { ...ready, status: "passed", pending: [] };
    const column = !configured ? "Configure" : stages.find(stage => stage.status === "failed")?.name ?? stages.find(stage => stage.status === "pending")?.name ?? "Ready";
    const state = !configured ? "to do" : inputRequests.length ? "needs input" : stages.some(stage => stage.status === "failed") ? "failed" : column === "Ready" ? "ready" : "pending";
    return { key: JSON.stringify([binding.instanceId, index]), binding, sourceBinding, sourceFindings, configured, inputRequests, state, stages, column, findings, checks,
      staticCoverage: !inspection.completed ? "short-circuited" : inspection.unavailableChecks.length ? "unavailable" : "complete",
      stateCoverage: !binding.states?.length ? "not-requested" : !inspection.completed || inspection.unavailableChecks.includes("LK14") ? "unavailable" : "checked",
      unavailableChecks: inspection.unavailableChecks, wholeInstanceLK12: "pending" };
  });
  const frameLeaves = (["site", "app"] as const).filter(surface => effective.some(binding => binding.surface === surface))
    .map(surface => ({ surface, leaves: [...new Set(effective.filter(binding => binding.surface === surface).map(binding => binding.frame.leaf))] }));
  return { items, findings: pack.findings, frameLeaves, readyCount: items.filter(item => item.column === "Ready").length };
}
