/** Static production component rules; no React, Node, network or filesystem runtime. */
import candidate from "../catalog/fills/foundry/components.date-picker.json" with { type: "json" };
import materialization from "../catalog/rules/components.date-picker.json" with { type: "json" };
import fileTriggerCandidate from "../catalog/fills/shadcn@aria/components.file-trigger.json" with { type: "json" };
import fileTriggerRule from "../catalog/rules/components.file-trigger.json" with { type: "json" };
import { componentOf } from "./resolve-components.js";
import type { ComponentCandidate, ComponentCandidateDocument, ComponentRule } from "./resolve-components.js";
import { componentRacDeclaration } from "../importers/component-rac.js";
/** A composed template is installed as consumer source: it resolves the consumer's own react-aria-components install (CC3), never as a peer. */
const declared = (template: ComponentCandidate): ComponentCandidate => template.rac ? template : { ...template, rac: componentRacDeclaration(template, { peer: false }) };
export function loadComponentCompositionRules(): ComponentRule[] {
  return structuredClone([
    { ...materialization, template: declared(componentOf(candidate as unknown as ComponentCandidateDocument)) },
    { ...fileTriggerRule, template: declared(componentOf(fileTriggerCandidate as unknown as ComponentCandidateDocument)) },
  ]) as ComponentRule[];
}
