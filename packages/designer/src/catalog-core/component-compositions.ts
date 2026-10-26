/** Static production component rules; no React, Node, network or filesystem runtime. */
import candidate from "../catalog/fills/foundry/components.date-picker.json" with { type: "json" };
import materialization from "../catalog/rules/components.date-picker.json" with { type: "json" };
import fileTriggerCandidate from "../catalog/fills/shadcn@aria/components.file-trigger.json" with { type: "json" };
import fileTriggerRule from "../catalog/rules/components.file-trigger.json" with { type: "json" };
import { componentOf } from "./resolve-components.js";
import type { ComponentCandidateDocument, ComponentRule } from "./resolve-components.js";
export function loadComponentCompositionRules(): ComponentRule[] {
  return structuredClone([
    { ...materialization, template: componentOf(candidate as unknown as ComponentCandidateDocument) },
    { ...fileTriggerRule, template: componentOf(fileTriggerCandidate as unknown as ComponentCandidateDocument) },
  ]) as ComponentRule[];
}
