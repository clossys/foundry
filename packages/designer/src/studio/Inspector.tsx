"use client";

import type { ReactElement } from "react";
import { Button } from "../components/Button.js";
import { CandidatePromptDialog } from "../blocks/library-board/CandidatePromptDialog.js";
import type { CandidatePromptData } from "../blocks/library-board/candidate-prompt.js";
import type { Resolved, Tier } from "../catalog-core/index.js";
import type { UsageGraph } from "../catalog-core/usage-graph.js";
import { inspectorModel, type Candidate } from "./model.js";
import type { StudioLabels } from "./types.js";
import { readStudioFinding, type StudioCopyBinding } from "./copy-binding.js";
import { StudioCopyProvider } from "./copy-context.js";
import { StudioDataValue } from "./data-value.js";
import { usageModel } from "./usage/model.js";
import { StudioUsage, useStudioUsageData } from "./usage/StudioUsage.js";

const row = "flex min-w-0 flex-wrap justify-between gap-sm";

/** The prompts an inspector offers: hand a new or refreshed candidate to a coding agent. Nothing here writes. */
export interface InspectorPrompts { readonly create: CandidatePromptData; readonly refresh?: CandidatePromptData; readonly workflow?: import("./types.js").StudioCandidateWorkflow }

/**
 * The inspector's only change surface: the labels' read-only "how to change" line (the designer skill a coding
 * agent runs) and the Create/Refresh prompt dialogs, which copy a prompt and never write.
 */
export function InspectorChange({ labels, prompts }: { labels: StudioLabels; prompts?: InspectorPrompts }): ReactElement | null {
  if (!labels.howToChange && !prompts) return null;
  return <div data-studio-inspector-change="" className="flex min-w-0 flex-col gap-sm">
    {labels.howToChange ? <p className="text-body text-ink-secondary">{labels.howToChange}</p> : null}
    {prompts ? <div className="flex flex-wrap gap-sm">
      <CandidatePromptDialog trigger={<Button variant="ghost" size="sm">{labels.board.create}</Button>} data={prompts.create} labels={labels} {...(prompts.workflow ? { workflow: prompts.workflow } : {})} />
      {prompts.refresh ? <CandidatePromptDialog trigger={<Button variant="ghost" size="sm">{labels.board.refresh}</Button>} data={prompts.refresh} labels={labels} {...(prompts.workflow ? { workflow: prompts.workflow } : {})} /> : null}
    </div> : null}
  </div>;
}

/**
 * Read-only: focus changes the definition list, never the selection, and nothing here writes. A role token's Used
 * by, and the Usage area when the host supplies its labels, are read from the usage graph API only (spec C5).
 */
export function Inspector({ candidate, labels, copy, tier, graph, prompts }: {
  copy: StudioCopyBinding;
  candidate: Candidate; labels: StudioLabels;
  /** Create/Refresh prompt data for this leaf. Omitted: no prompt dialogs. */
  prompts?: InspectorPrompts;
  /** @deprecated Ignored: Used by is read from the usage graph, not from resolved aliases. */
  resolved?: Resolved;
  tier?: Tier;
  /** The usage graph. Omitted: the host snapshot's, else the committed Foundry graph. */
  graph?: UsageGraph;
}): ReactElement {
  const model = inspectorModel(candidate);
  const text = labels.inspector;
  const leaf = candidate.fill.slot;
  const usage = useStudioUsageData(graph, tier === "role");
  const usedBy = tier === "role" && usage ? usageModel(usage.graph, leaf).usedWhere.flatMap(group => group.rows.map(entry => entry.id)) : [];
  const facts: readonly (readonly [string, string | undefined])[] = [
    [text.source, model.source], [text.representedLeaf, candidate.fill.slot], [text.mode, model.mode], [text.relation, model.relation], [text.licence, model.license],
    [text.pin, model.pin], [text.trust, candidate.fill.trust], [text.status, model.status], [text.builtOn, model.builtOn.join(", ") || undefined], [text.evidence, model.evidence.join(", ") || undefined],
  ];
  return <StudioCopyProvider binding={copy}><div data-studio-inspector={candidate.source} className="flex min-w-0 flex-col gap-md">
    <dl className="flex flex-col gap-xs text-body">
      {facts.map(([name, value]) => <div key={name} className={row}><dt className="text-ink-secondary">{name}</dt><dd className="min-w-0 break-words text-ink-primary">{value === undefined ? text.none : <StudioDataValue kind="value" value={value}/>}</dd></div>)}
      <div><dt>{text.members}</dt><dd><dl className="flex flex-col gap-sm">{model.rows.map(entry => {
        const aliases = candidate.members.find(member => member.id === entry.member)?.member.alias;
        return <div key={entry.member}>
        <dt className="break-words">{<StudioDataValue kind="identifier" value={entry.member}/>}</dt><dd><dl>
          <div className={row}><dt>{text.light}</dt><dd>{<StudioDataValue kind="value" value={entry.light}/>}</dd></div>
          {entry.dark !== undefined ? <div className={row}><dt>{text.dark}</dt><dd>{<StudioDataValue kind="value" value={entry.dark}/>}</dd></div> : null}
          <div className={row}><dt>{text.via}</dt><dd>{<StudioDataValue kind="identifier" value={entry.via}/>}</dd></div>
          <div className={row}><dt>{text.alias} {text.light}</dt><dd>{aliases?.light === undefined ? text.none : <StudioDataValue kind="identifier" value={aliases.light}/>}</dd></div>
          {entry.dark !== undefined || aliases?.dark !== undefined ? <div className={row}><dt>{text.alias} {text.dark}</dt><dd>{aliases?.dark === undefined ? text.none : <StudioDataValue kind="identifier" value={aliases.dark}/>}</dd></div> : null}
        </dl></dd>
      </div>; })}</dl></dd></div>
      {tier === "role" ? <div><dt>{text.usedBy}</dt><dd aria-busy={!usage}>{usedBy.length ? <ul>{usedBy.map(id => <li key={id}><StudioDataValue kind="identifier" value={id}/></li>)}</ul> : usage ? text.none : null}</dd></div> : null}
      <div><dt>{text.findings}</dt><dd>{model.findings.length ? <ul>{model.findings.map((finding, index) => <li key={`${finding.code}:${finding.subject}:${index}`}>{readStudioFinding(copy, finding, `studio.inspector.finding.${finding.code}`)}</li>)}</ul> : text.none}</dd></div>
    </dl>
    {labels.usage ? <StudioUsage id={leaf} labels={labels.usage} {...(graph ? { graph } : {})} /> : null}
    <InspectorChange labels={labels} {...(prompts ? { prompts } : {})} />
  </div></StudioCopyProvider>;
}
