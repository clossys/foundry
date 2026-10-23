"use client";

import type { ReactElement } from "react";
import { RadioGroup } from "../atoms/RadioGroup.js";
import { Select } from "../atoms/Select.js";
import { TOKENS } from "../tokens/tokens.js";
import { Tabs } from "../atoms/Tabs.js";
import { CandidateCard } from "./CandidateCard.js";
import type { Candidate, Scope } from "./model.js";
import type { StudioLayout } from "./use-layout.js";
import type { StudioLabels } from "./types.js";

const SCOPES = ["member", "slot", "node"] as const;

/** The scope control, the member or placement-node picker, and the cards as one Use radio group. */
export function CandidateStage({ labels, layout, scope, onScope, target, targets, onTarget, candidates, focusedSource, onFocusSource, onUse }: {
  labels: StudioLabels; layout: StudioLayout; scope: Scope; onScope: (scope: Scope) => void; target: string; targets: readonly string[];
  onTarget: (target: string) => void; candidates: readonly Candidate[]; focusedSource: string | undefined; onFocusSource: (source: string) => void;
  onUse: (source: string) => void;
}): ReactElement {
  const selected = candidates.find((candidate) => candidate.selected)?.source ?? null;
  const cards = candidates.map((candidate) => (
    <CandidateCard key={candidate.source} candidate={candidate} target={target} labels={labels} focused={candidate.source === focusedSource} onFocusSource={onFocusSource} />
  ));
  return (
    <section aria-label={labels.stageLabel} className="flex min-w-0 flex-col gap-md">
      <div className="flex flex-wrap items-end gap-md">
        <RadioGroup label={labels.scope.label} orientation="horizontal" value={scope} onChange={(value) => onScope(value as Scope)}>
          {SCOPES.map((entry) => <RadioGroup.Radio key={entry} value={entry}>{labels.scope[entry]}</RadioGroup.Radio>)}
        </RadioGroup>
        {scope === "slot" ? null : (
          <Select
            label={scope === "member" ? labels.scope.memberPicker : labels.scope.nodePicker}
            options={targets.map((entry) => ({ id: entry, label: entry, textValue: entry }))}
            selectedKey={target}
            onSelectionChange={(key) => { if (key !== null) onTarget(String(key)); }}
          />
        )}
      </div>
      <p className="text-caption text-ink-secondary">{labels.scope.explanation}</p>
      {candidates.length === 0 ? <p data-studio-empty="" className="text-body text-ink-secondary">{labels.noFill}</p> : (
        <RadioGroup
          label={labels.useGroup}
          value={selected}
          onChange={onUse}
          className="min-w-0"
        >
          {layout === "narrow" ? (
            <Tabs selectedKey={focusedSource ?? candidates[0]?.source} onSelectionChange={(key) => onFocusSource(String(key))}>
              <Tabs.List aria-label={labels.stageLabel}>
                {candidates.map((candidate) => <Tabs.Tab key={candidate.source} id={candidate.source}>{candidate.source}</Tabs.Tab>)}
              </Tabs.List>
              {candidates.map((candidate, at) => <Tabs.Panel key={candidate.source} id={candidate.source}>{cards[at]}</Tabs.Panel>)}
            </Tabs>
          ) : (
            <div data-studio-cards="" className="grid grid-flow-col min-w-0 gap-md overflow-x-auto"
              style={{ gridTemplateColumns: `repeat(${Math.min(candidates.length, 4)}, minmax(0, 1fr))`, gridAutoColumns: `calc((100% - 3 * var(--spacing-md, ${TOKENS["--spacing-md"]!.value})) / 4)` }}>
              {cards}
            </div>
          )}
        </RadioGroup>
      )}
    </section>
  );
}
