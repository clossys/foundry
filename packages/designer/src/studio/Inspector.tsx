"use client";

import type { ReactElement } from "react";
import { Button } from "../components/Button.js";
import type { Resolved, Tier } from "../catalog-core/index.js";
import { inspectorModel, type Candidate } from "./model.js";
import type { StudioLabels } from "./types.js";

const row = "flex min-w-0 flex-wrap justify-between gap-sm";

/** Focus changes the definition list, never the selection. Alias use is read from the real resolved graph only. */
export function Inspector({ candidate, labels, canReset, onReset, resolved, tier }: {
  candidate: Candidate; labels: StudioLabels; canReset: boolean; onReset: () => void; resolved?: Resolved; tier?: Tier;
}): ReactElement {
  const model = inspectorModel(candidate);
  const text = labels.inspector;
  const ids = new Set(candidate.members.map(member => member.id));
  const usedBy = tier === "role" ? Object.entries(resolved?.members ?? {}).filter(([, member]) => Object.values(member.alias).some(alias => ids.has(alias))).map(([id]) => id) : [];
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
      {tier === "role" ? <div><dt>{text.usedBy}</dt><dd>{usedBy.length ? <ul>{usedBy.map(id => <li key={id}>{id}</li>)}</ul> : text.none}</dd></div> : null}
      <div><dt>{text.findings}</dt><dd>{model.findings.length ? <ul>{model.findings.map((finding, index) => <li key={`${finding.code}:${finding.subject}:${index}`}>{finding.message}</li>)}</ul> : text.none}</dd></div>
    </dl>
    <div><Button variant="secondary" size="sm" isDisabled={!canReset} onPress={onReset}>{labels.resetToDefault}</Button></div>
  </div>;
}
