"use client";

import type { ReactElement } from "react";
import { Button } from "../atoms/Button.js";
import { inspectorModel, type Candidate } from "./model.js";
import type { StudioLabels } from "./types.js";

const row = "flex min-w-0 flex-wrap justify-between gap-sm";

/** The focused card's fill in full. Focus decides what it shows; it never selects. */
export function Inspector({ candidate, labels, canReset, onReset }: {
  candidate: Candidate; labels: StudioLabels; canReset: boolean; onReset: () => void;
}): ReactElement {
  const model = inspectorModel(candidate);
  const text = labels.inspector;
  const facts: readonly (readonly [string, string | undefined])[] = [
    [text.source, model.source], [text.mode, model.mode], [text.relation, model.relation], [text.licence, model.license],
    [text.pin, model.pin], [text.status, model.status], [text.builtOn, model.builtOn.join(", ") || undefined], [text.evidence, model.evidence.join(", ") || undefined],
  ];
  return (
    <div data-studio-inspector={candidate.source} className="flex min-w-0 flex-col gap-md">
      <dl className="flex flex-col gap-xs text-body">
        {facts.filter(([, value]) => value !== undefined).map(([name, value]) => (
          <div key={name} className={row}><dt className="text-ink-secondary">{name}</dt><dd className="min-w-0 break-words text-ink-primary">{value}</dd></div>
        ))}
      </dl>
      <table className="w-full min-w-0 text-start text-body-s">
        <caption className="text-start text-ink-secondary">{text.members}</caption>
        <thead>
          <tr className="text-start text-ink-secondary">
            <th scope="col" className="text-start font-body">{text.members}</th>
            <th scope="col" className="text-start font-body">{text.light}</th>
            <th scope="col" className="text-start font-body">{text.dark}</th>
            <th scope="col" className="text-start font-body">{text.via}</th>
            <th scope="col" className="text-start font-body">{text.alias}</th>
          </tr>
        </thead>
        <tbody>
          {model.rows.map((entry) => (
            <tr key={entry.member}>
              <th scope="row" className="text-start font-body break-words">{entry.member}</th>
              <td className="break-words">{entry.light}</td>
              <td className="break-words">{entry.dark}</td>
              <td>{entry.via}</td>
              <td className="break-words">{entry.alias}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {model.findings.length > 0 ? (
        <section className="flex flex-col gap-xs">
          <h3 className="text-body font-body text-ink-secondary">{text.findings}</h3>
          <ul className="flex flex-col gap-xs text-body-s">
            {model.findings.map((finding) => <li key={`${finding.code}:${finding.subject}:${finding.message}`}>{finding.message}</li>)}
          </ul>
        </section>
      ) : null}
      <div><Button variant="secondary" size="sm" isDisabled={!canReset} onPress={onReset}>{labels.resetToDefault}</Button></div>
    </div>
  );
}
