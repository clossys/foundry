"use client";
import { useId, useMemo, useState, type ReactNode } from "react";
import { Badge } from "../../components/Badge.js";
import { Button } from "../../components/Button.js";
import { Switch } from "../../components/Switch.js";
import type { CatalogBrowserReference } from "../../blocks/catalog-browser/types.js";
import type { UsageEdgeKind, UsageEvidence, UsageGraph, UsageLayer } from "../../catalog-core/usage-graph.js";
import type { WiringException } from "../../catalog-core/wiring.js";
import { usageModel, type UsageGroup, type UsageNotLinked, type UsageRow } from "./model.js";
import { useUsageNavigation, type UsageHistory } from "./useUsageNavigation.js";
import { useUsageData } from "./committed-graph.js";
import { readStudioFinding, type StudioCopyBinding } from "../copy-binding.js";
import { StudioDataValue } from "../data-value.js";

/** All Usage copy. The panel has no words of its own: everything else it shows is graph data. */
export interface UsagePanelLabels {
  readonly title: string;
  readonly using: string;
  readonly usedWhere: string;
  readonly reads: string;
  readonly composes: string;
  readonly options: string;
  readonly owns: string;
  /** Wiring exceptions whose direct read is this element. */
  readonly exceptions: string;
  readonly transitive: string;
  readonly back: string;
  readonly usedNowhere: string;
  readonly notLinked: string;
  readonly loading: string;
  readonly none: string;
  readonly layer: Readonly<Record<UsageLayer, string>>;
  readonly kind: Readonly<Record<UsageEdgeKind, string>>;
  readonly evidence: Readonly<Record<UsageEvidence, string>>;
  /** The number of sites that evidence a row's edges. */
  readonly count: (count: number) => string;
}

export interface UsagePanelProps {
  readonly copy: StudioCopyBinding;
  /** The element whose usage is shown: a leaf id, a member id or a `pages.<route>` id. */
  readonly id: string;
  /** Host navigation: show this element (change tab and selection). The panel keeps the back stack. */
  readonly onNavigate: (id: string) => void;
  /** Elements the host can show. Others render as text, never as a control that does nothing. Omitted: every element. */
  readonly canNavigate?: (id: string) => boolean;
  /** The usage graph (B5). Omitted: the committed Foundry graph and its wiring exceptions are loaded. */
  readonly graph?: UsageGraph;
  /** Wiring exceptions recorded against the graph's sources (Owns and exception rows). */
  readonly exceptions?: readonly WiringException[];
  /** Provenance findings; WL5 findings for this element show as "not linked" rows. */
  readonly findings?: readonly UsageNotLinked[];
  /** A back stack kept by the host, so it survives this panel remounting. Omitted: the panel's own. */
  readonly history?: UsageHistory;
  readonly labels: UsagePanelLabels;
}

const DETAIL = "text-body-s text-ink-secondary";
const HEADING = "text-body font-body text-ink-primary";

function List({ title, children, none }: { title: string; children: ReactNode; none: string }) {
  const id = useId();
  return <section aria-labelledby={id} className="flex flex-col gap-xs">
    <h4 id={id} className={HEADING}>{title}</h4>
    {children ?? <p className={DETAIL}>{none}</p>}
  </section>;
}

/**
 * The Usage area (spec C1-C5, OWN-1): what an element uses and where it is used, read only from the usage
 * graph API. Frame-agnostic: every row is a `CatalogBrowserReference` followed through `onNavigate`, the
 * panel assumes no tab, and any frame or Inspector card can host it unchanged.
 */
export function UsagePanel({ id, copy, onNavigate, canNavigate, graph: supplied, exceptions, findings, history, labels }: UsagePanelProps) {
  const data = useUsageData(supplied);
  const [transitive, setTransitive] = useState(false);
  const navigation = useUsageNavigation(id, onNavigate, history);
  const owned = exceptions ?? data?.exceptions;
  const model = useMemo(() => data ? usageModel(data.graph, id, { transitive, ...(owned ? { exceptions: owned } : {}), ...(findings ? { findings } : {}) }) : undefined,
    [data, id, transitive, owned, findings]);
  const reference = (entry: UsageRow): CatalogBrowserReference => ({ catalog: entry.layer, entryId: entry.leaf, label: entry.id });
  const rows = (list: readonly UsageRow[]) => list.length ? <ul className="flex flex-col gap-xs">{list.map(entry => {
    const target = reference(entry), navigable = canNavigate?.(target.entryId) ?? true;
    return <li key={entry.id} data-usage-row={entry.id} className="flex flex-wrap items-baseline gap-sm">
      {navigable ? <Button variant="quiet" size="sm" trailingIcon={null} onPress={() => navigation.select(target.entryId)}><StudioDataValue kind="identifier" value={target.label} /></Button> : <span className={DETAIL}><StudioDataValue kind="identifier" value={target.label} /></span>}
      {entry.fill ? <span className={DETAIL}><StudioDataValue kind="source" value={entry.fill.source} /></span> : null}
      {entry.kinds?.map(kind => <Badge key={kind}>{labels.kind[kind]}</Badge>)}
      {entry.evidence?.map(evidence => <Badge key={evidence} variant="info">{labels.evidence[evidence]}</Badge>)}
      {entry.count !== undefined ? <span className={DETAIL}>{labels.count(entry.count)}</span> : null}
    </li>;
  })}</ul> : undefined;
  const groups = (list: readonly UsageGroup[]) => list.length ? <>{list.map(group => <section key={group.layer} aria-label={labels.layer[group.layer]} data-usage-layer={group.layer} className="flex flex-col gap-xs">
    <h5 className={DETAIL}>{labels.layer[group.layer]}</h5>{rows(group.rows)}
  </section>)}</> : undefined;
  const exceptionRows = (list: readonly WiringException[]) => list.length ? <ul className="flex flex-col gap-xs">{list.map(exception => <li key={`${exception.file}\u0000${exception.elementId}\u0000${exception.name}`} data-usage-exception={exception.name} className="flex flex-wrap items-baseline gap-sm">
    <StudioDataValue kind="identifier" value={exception.name} /><Badge variant="warning"><StudioDataValue kind="value" value={exception.reasonCode} /></Badge><span className={DETAIL}><StudioDataValue kind="identifier" value={exception.owner} /></span><span className={DETAIL}><StudioDataValue kind="value" value={exception.expiry} /></span><Badge><StudioDataValue kind="status" value={exception.status} /></Badge>
  </li>)}</ul> : undefined;
  return <section data-studio-usage={id} aria-label={labels.title} className="flex flex-col gap-sm">
    <div className="flex flex-wrap items-center gap-sm">
      <h3 className={HEADING}>{labels.title}</h3>
      <Button variant="ghost" size="sm" isDisabled={!navigation.canGoBack} onPress={navigation.back}>{labels.back}</Button>
      <Switch isSelected={transitive} onChange={setTransitive}>{labels.transitive}</Switch>
    </div>
    {!model ? <p role="status" className={DETAIL}>{labels.loading}</p> : <>
      {model.usedNowhere ? <p data-usage-used-nowhere=""><Badge variant="warning">{labels.usedNowhere}</Badge></p> : null}
      {model.notLinked.map(finding => <p key={`${finding.code}\u0000${finding.subject}\u0000${finding.message}`} data-usage-not-linked={finding.code} className="flex flex-wrap items-baseline gap-sm">
        <Badge variant="danger">{labels.notLinked}</Badge><StudioDataValue kind="identifier" value={finding.code} /><span className={DETAIL}><StudioDataValue kind="identifier" value={finding.subject} /></span><span className={DETAIL}>{readStudioFinding(copy, finding, `studio.usage.finding.${finding.code}`)}</span>
      </p>)}
      <List title={labels.using} none={labels.none}>{groups(model.using)}</List>
      <List title={labels.usedWhere} none={labels.none}>{groups(model.usedWhere)}</List>
      <List title={labels.reads} none={labels.none}>{rows(model.reads)}</List>
      <List title={labels.composes} none={labels.none}>{rows(model.composes)}</List>
      <List title={labels.options} none={labels.none}>{model.options.length ? <ul className="flex flex-wrap gap-sm">{model.options.map(option => <li key={option} className={DETAIL}><StudioDataValue kind="value" value={option} /></li>)}</ul> : undefined}</List>
      <List title={labels.owns} none={labels.none}>{exceptionRows(model.owns)}</List>
      {model.exceptions.length ? <List title={labels.exceptions} none={labels.none}>{exceptionRows(model.exceptions)}</List> : null}
    </>}
  </section>;
}
