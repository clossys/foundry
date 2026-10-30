import { useId } from "react";
import { DataTable, Panel, SectionHeader } from "@clossys/designer/blocks";
import type { PublisherPipelineItem } from "./pipeline.js";

export interface PublisherCheckMessages {
  readonly title: string;
  readonly tableLabel: string;
  readonly codeLabel: string;
  readonly statusLabel: string;
  readonly findingsLabel: string;
  /** @default "COUNT static findings" */
  readonly summary: (count: number) => string;
  readonly renderedPending: string;
}
interface Props {
  readonly item: PublisherPipelineItem;
  readonly id: string;
  readonly messages?: Partial<PublisherCheckMessages>;
}
interface FindingsSummaryProps {
  readonly count: number;
  /** @default "COUNT static findings" */
  readonly summary?: (count: number) => string;
}
function defaultSummary(count: number): string {
  return String(count) + " static findings";
}
function FindingsSummary({ count, summary = defaultSummary }: FindingsSummaryProps) {
  return <>{summary(count)}</>;
}
/** This panel consumes the exact pipeline evaluation; it never asks a second resolver. */
export function PublisherCheckResults({ item, id, messages }: Props) {
  const titleId = useId();
  /** @default 'Instance checks' */
  const title = messages?.title ?? "Instance checks";
  /** @default 'Instance checks' */
  const tableLabel = messages?.tableLabel ?? "Instance checks";
  /** @default 'Check' */
  const codeLabel = messages?.codeLabel ?? "Check";
  /** @default 'Status' */
  const statusLabel = messages?.statusLabel ?? "Status";
  /** @default 'Findings' */
  const findingsLabel = messages?.findingsLabel ?? "Findings";
  /** @default 'Whole-instance LK12 pending. Layout-only measurements do not qualify actual frame and section runtimes; complete pack closure and Ready remain pending.' */
  const renderedPending = messages?.renderedPending ?? "Whole-instance LK12 pending. Layout-only measurements do not qualify actual frame and section runtimes; complete pack closure and Ready remain pending.";
  return <Panel id={id} tabIndex={-1} role="region" aria-labelledby={titleId} header={<SectionHeader id={titleId} level={3} title={title} />}>
    <p>{item.binding.label} · <FindingsSummary count={item.findings.length} summary={messages?.summary} /></p>
    <p>{renderedPending}</p>
    <DataTable aria-label={tableLabel} rows={item.checks} rowKey={check => check.code} columns={[
      { id: "code", header: codeLabel, isRowHeader: true, cell: check => check.code },
      { id: "status", header: statusLabel, cell: check => check.status },
      { id: "findings", header: findingsLabel, cell: check => <ul>{check.findings.map((finding, index) => <li key={index}>{finding.path}: {finding.message}</li>)}</ul> },
    ]} />
  </Panel>;
}
