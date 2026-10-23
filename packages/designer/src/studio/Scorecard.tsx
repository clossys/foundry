"use client";

import type { ReactElement } from "react";
import { Button } from "../atoms/Button.js";
import type { MatrixSummary } from "./matrix-model.js";
import type { StudioLabels } from "./types.js";

/** Measured evidence only; targets deliberately have no counts. */
export function Scorecard({ summary, labels, onClose, onIssue }: { summary: MatrixSummary; labels: StudioLabels; onClose: () => void; onIssue: (slot: string) => void }): ReactElement {
  const text = labels.scorecard;
  return <section aria-label={text.title} className="flex min-w-0 flex-col gap-md rounded-surface border border-line-base bg-surface-base p-md" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <div className="flex items-center justify-between gap-sm"><h2 className="text-body">{text.title}</h2><Button variant="ghost" size="sm" onPress={onClose}>{text.close}</Button></div>
    <dl className="flex flex-wrap gap-md">
      <div><dt>{text.decided}</dt><dd>{summary.decided}/{summary.total}</dd></div>
      <div><dt>{text.resolved}</dt><dd>{summary.resolved}/{summary.total}</dd></div>
      <div><dt>{text.checks}</dt><dd>{text.counts(summary.errors, summary.notices)}</dd></div>
    </dl>
    <table className="w-full text-start text-body-s"><tbody>{summary.categories.map(category => <tr key={category.id}>
      <th scope="row" className="text-start">{text.categories[category.id]}</th>
      <td>{category.supported ? <>{text.counts(category.errors ?? 0, category.notices ?? 0)} <small>{text.supported(category.codes)}</small></> : text.target}</td>
    </tr>)}</tbody></table>
    <h3 className="text-body">{text.issues}</h3>
    {summary.issues.length ? <ul>{summary.issues.map(({ finding, slotId }, index) => <li key={`${finding.code}:${finding.subject}:${index}`}><Button variant="ghost" size="sm" isDisabled={slotId === undefined} onPress={() => { if (slotId) onIssue(slotId); }}>{finding.message}</Button></li>)}</ul> : <p>{text.noIssues}</p>}
  </section>;
}
