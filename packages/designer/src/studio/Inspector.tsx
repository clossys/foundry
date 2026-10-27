"use client";

import type { ReactElement } from "react";
import { Button } from "../components/Button.js";
import type { Resolved, Tier } from "../catalog-core/index.js";
import type { UsageGraph } from "../catalog-core/usage-graph.js";
import { inspectorModel, type Candidate } from "./model.js";
import type { StudioLabels } from "./types.js";
import { usageModel } from "./usage/model.js";
import { StudioUsage, useStudioUsageData } from "./usage/StudioUsage.js";

const row = "flex min-w-0 flex-wrap justify-between gap-sm";

/**
 * Focus changes the definition list, never the selection. A role token's Used by, and the Usage area when the host
 * supplies its labels, are read from the usage graph API only (spec C5).
 */
export function Inspector({ candidate, labels, canReset, onReset, tier, graph }: {
  candidate: Candidate; labels: StudioLabels; canReset: boolean; onReset: () => void;
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
  return <div data-studio-inspector={candidate.source} className="flex min-w-0 flex-col gap-md">
    <dl className="flex flex-col gap-xs text-body">
      {facts.map(([name, value]) => <div key={name} className={row}><dt className="text-ink-secondary">{name}</dt><dd className="min-w-0 break-words text-ink-primary">{value ?? text.none}</dd></div>)}
      <div><dt>{text.members}</dt><dd><dl className="flex flex-col gap-sm">{model.rows.map(entry => {
        const aliases = candidate.members.find(member => member.id === entry.member)?.member.alias;
        return <div key={entry.member}>
        <dt className="break-words">{entry.member}</dt><dd><dl>
          <div className={row}><dt>{text.light}</dt><dd>{entry.light}</dd></div>
          {entry.dark !== undefined ? <div className={row}><dt>{text.dark}</dt><dd>{entry.dark}</dd></div> : null}
          <div className={row}><dt>{text.via}</dt><dd>{entry.via}</dd></div>
          <div className={row}><dt>{text.alias} {text.light}</dt><dd>{aliases?.light ?? text.none}</dd></div>
          {entry.dark !== undefined || aliases?.dark !== undefined ? <div className={row}><dt>{text.alias} {text.dark}</dt><dd>{aliases?.dark ?? text.none}</dd></div> : null}
        </dl></dd>
      </div>; })}</dl></dd></div>
      {tier === "role" ? <div><dt>{text.usedBy}</dt><dd aria-busy={!usage}>{usedBy.length ? <ul>{usedBy.map(id => <li key={id}>{id}</li>)}</ul> : usage ? text.none : null}</dd></div> : null}
      <div><dt>{text.findings}</dt><dd>{model.findings.length ? <ul>{model.findings.map((finding, index) => <li key={`${finding.code}:${finding.subject}:${index}`}>{finding.message}</li>)}</ul> : text.none}</dd></div>
    </dl>
    {labels.usage ? <StudioUsage id={leaf} labels={labels.usage} {...(graph ? { graph } : {})} /> : null}
    <div><Button variant="secondary" size="sm" isDisabled={!canReset} onPress={onReset}>{labels.resetToDefault}</Button></div>
  </div>;
}
