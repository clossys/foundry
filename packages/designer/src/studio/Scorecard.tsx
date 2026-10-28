"use client";

import type { ReactElement } from "react";
import { Button } from "../components/Button.js";
import { Table } from "../components/Table.js";
import type { MatrixSummary } from "./matrix-model.js";
import type { StudioLabels } from "./types.js";
import { readStudioMessage, type StudioCopyBinding } from "./copy-binding.js";
import { StudioDataValue } from "./data-value.js";

/** Measured evidence only; targets deliberately have no counts. */
export function Scorecard({ summary, labels, copy, onClose, onIssue }: { summary: MatrixSummary; labels: StudioLabels; copy: StudioCopyBinding; onClose: () => void; onIssue: (slot: string) => void }): ReactElement {
  const text = labels.scorecard;
  return <section aria-label={text.title} className="flex min-w-0 flex-col gap-md rounded-surface border border-line-base bg-surface-base p-md" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <div className="flex items-center justify-between gap-sm"><h2 className="text-body">{text.title}</h2><Button variant="ghost" size="sm" onPress={onClose}>{text.close}</Button></div>
    <dl className="flex flex-wrap gap-md">
      <div><dt>{text.resolved}</dt><dd>{readStudioMessage(copy, "designer.scorecard.resolved-count", { resolved: summary.resolved, total: summary.total })}</dd></div>
      <div><dt>{text.checks}</dt><dd>{text.counts(summary.errors, summary.notices)}</dd></div>
    </dl>
    <Table aria-label={text.title} className="text-start text-body-s">
      <Table.Header><Table.Column id="category" isRowHeader>{text.title}</Table.Column><Table.Column id="checks">{text.checks}</Table.Column></Table.Header>
      <Table.Body>{summary.categories.map(category => <Table.Row key={category.id} id={category.id}>
        <Table.Cell>{text.categories[category.id]}</Table.Cell>
        <Table.Cell>{category.supported ? <>{text.counts(category.errors ?? 0, category.notices ?? 0)} <small><StudioDataValue kind="identifier" value={category.codes.join(", ")} /></small></> : text.target}</Table.Cell>
      </Table.Row>)}</Table.Body>
    </Table>
    <h3 className="text-body">{text.issues}</h3>
    {summary.issues.length ? <ul>{summary.issues.map(({ finding, slotId }, index) => <li key={`${finding.code}:${finding.subject}:${index}`}><Button variant="ghost" size="sm" isDisabled={slotId === undefined} onPress={() => { if (slotId) onIssue(slotId); }}>{readStudioMessage(copy, `designer.scorecard.finding.${finding.code}`)}</Button></li>)}</ul> : <p>{text.noIssues}</p>}
  </section>;
}
