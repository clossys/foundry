import { useId, type ReactNode } from "react";
import { Badge } from "../../components/preview-runtime/components/badge/badge.js";
import { Button } from "../../components/Button.js";
import { DetailView } from "../DetailView.js";
import { EmptyState } from "../EmptyState.js";
import { SectionHeader } from "../SectionHeader.js";
import type {
  CatalogBrowserCatalog, CatalogBrowserConfig, CatalogBrowserEntry, CatalogBrowserKind,
  CatalogBrowserLabels, CatalogBrowserLifecycle, CatalogBrowserReference,
} from "./types.js";

const LIFECYCLE_VARIANT: Readonly<Record<CatalogBrowserLifecycle, "secondary" | "default" | "outline">> = {
  draft: "secondary", stable: "default", deprecated: "outline", parked: "secondary",
};
const HEADING = "text-body font-body text-ink-primary";

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return <section aria-labelledby={id} className="flex flex-col gap-sm">
    <h5 id={id} className={HEADING}>{title}</h5>
    {children}
  </section>;
}

function References({ title, references, catalogs, onSelect }: {
  title: string; references: readonly CatalogBrowserReference[]; catalogs: readonly CatalogBrowserCatalog[];
  onSelect: (reference: CatalogBrowserReference) => void;
}) {
  if (!references.length) return null;
  return <Section title={title}>
    <ul className="flex flex-wrap gap-sm">
      {references.map(reference => {
        const target = catalogs.find(catalog => catalog.kind === reference.catalog)?.entries.find(entry => entry.id === reference.entryId);
        const name = reference.label ?? target?.label ?? reference.entryId;
        return <li key={`${reference.catalog}\u0000${reference.entryId}`}>
          {target ? <Button variant="quiet" size="sm" trailingIcon={null} onPress={() => onSelect(reference)}>{name}</Button> :
            <span className="text-body-s text-ink-secondary">{name}</span>}
        </li>;
      })}
    </ul>
  </Section>;
}

/** The entry detail template: identity, live preview or not-built state, metadata, states, usage and relations. */
export function EntryDetail<E extends CatalogBrowserEntry>({ entry, catalog, catalogs, binding, labels, config, onSelect }: {
  entry: E; catalog: CatalogBrowserCatalog<string, E>; catalogs: readonly CatalogBrowserCatalog[];
  binding: CatalogBrowserKind<E>; labels: CatalogBrowserLabels; config: CatalogBrowserConfig;
  onSelect: (reference: CatalogBrowserReference) => void;
}) {
  const l1 = catalog.groups.find(group => group.id === entry.l1)!;
  const l2 = l1.children.find(group => group.id === entry.l2)!;
  const notBuilt = binding.notBuilt?.(entry);
  const states = binding.states?.(entry) ?? [];
  const usage = binding.usage?.(entry);
  const fields = [
    { label: labels.id, value: <code>{entry.id}</code> },
    { label: labels.group, value: `${l1.label} / ${l2.label}` },
    { label: labels.lifecycleField, value: labels.lifecycle[entry.lifecycle] },
    ...(binding.fields?.(entry) ?? []),
    ...(entry.notes?.length ? [{ label: labels.notes, value: <ul className="flex flex-col gap-xs">{entry.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>, span: 2 as const }] : []),
  ];
  return <article className="style-nova flex min-w-0 flex-col gap-lg">
    <SectionHeader level={4} eyebrow={`${binding.label} / ${l1.label} / ${l2.label}`} title={entry.label}
      description={<code>{entry.id}</code>}
      actions={<>
        <Badge variant={LIFECYCLE_VARIANT[entry.lifecycle]}>{labels.lifecycle[entry.lifecycle]}</Badge>
        {notBuilt !== undefined ? <Badge variant="outline">{labels.notBuilt}</Badge> : null}
        {(binding.badges?.(entry) ?? []).map((badge, index) => <Badge key={index} variant={badge.tone === "danger" ? "destructive" : "secondary"}>{badge.label}</Badge>)}
      </>} />
    <Section title={labels.livePreview}>
      {notBuilt !== undefined ? <EmptyState role="status" title={labels.notBuilt} description={notBuilt} /> :
        <div data-catalog-browser-preview="" className="min-w-0 rounded-control border border-line-base p-lg">
          {binding.preview(entry, { kind: catalog.kind, config })}
        </div>}
    </Section>
    <Section title={labels.metadata}><DetailView fields={fields} /></Section>
    {states.length ? <Section title={labels.states}>
      <ul className="flex flex-wrap gap-sm">{states.map(state => <li key={state}><Badge>{state}</Badge></li>)}</ul>
    </Section> : null}
    {usage !== undefined && usage !== null ? <Section title={labels.usage}><div className="text-body text-ink-secondary">{usage}</div></Section> : null}
    <References title={labels.builtFrom} references={binding.builtFrom?.(entry) ?? []} catalogs={catalogs} onSelect={onSelect} />
    <References title={labels.usedBy} references={binding.usedBy?.(entry) ?? []} catalogs={catalogs} onSelect={onSelect} />
  </article>;
}
