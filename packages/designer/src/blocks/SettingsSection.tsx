import { useId, type ReactNode } from "react";
import { cx } from "../selected-components/internal/cx.js";
import { FieldGroup, type FieldGroupLayout } from "./FieldGroup.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.settings", "foundry/sections.settings");

export interface SettingsSectionGroup {
  readonly id: string;
  readonly legend: ReactNode;
  readonly description?: ReactNode;
  readonly layout?: FieldGroupLayout;
  /** The group's own fields (Switch, Select, TextField...); values stay host-owned. */
  readonly children: ReactNode;
}
export interface SettingsSectionLabels {
  /** Read with a dirty group's legend, e.g. "Unsaved changes". */
  unsaved: string;
  /** Accessible name of the save-bar region. */
  saveBar: string;
}
export interface SettingsSectionProps {
  /** The section heading; also names the section landmark. */
  heading: ReactNode;
  description?: ReactNode;
  groups: readonly SettingsSectionGroup[];
  /** Ids of groups with unsaved changes. */
  dirty?: readonly string[];
  /** Save and discard actions; shown only while a group is dirty. */
  saveBar?: ReactNode;
  labels: SettingsSectionLabels;
  className?: string;
}

/** Groups of settings fields with unsaved-change markers and a save bar; persistence belongs to the host. */
export function SettingsSection({ heading, description, groups, dirty = [], saveBar, labels, className }: SettingsSectionProps) {
  const headingId = useId();
  for (const id of dirty) if (!groups.some(group => group.id === id)) throw new TypeError(`SettingsSection: unknown dirty group ${id}.`);
  return <section {...SECTION_STAMP} aria-labelledby={headingId} className={cx("flex min-w-0 flex-col gap-lg text-body text-ink-primary", className)}>
    <header className="flex flex-col gap-xs">
      <h2 id={headingId} className="m-0 text-h3 font-display leading-heading text-ink-primary">{heading}</h2>
      {description ? <p className="m-0 text-body-s text-ink-secondary">{description}</p> : null}
    </header>
    {groups.map(group => <FieldGroup key={group.id} layout={group.layout} description={group.description}
      className="rounded-surface border border-line-base bg-surface-raised p-md"
      legend={<span className="inline-flex flex-wrap items-baseline gap-sm"><span className="text-body font-medium text-ink-primary">{group.legend}</span>
        {dirty.includes(group.id) ? <>{" "}<span className="text-caption text-ink-secondary">{labels.unsaved}</span></> : null}</span>}>
      {group.children}
    </FieldGroup>)}
    {saveBar && dirty.length ? <div role="region" aria-label={labels.saveBar} className="sticky bottom-0 flex flex-wrap items-center justify-end gap-sm border-t border-line-base bg-surface-base py-sm">{saveBar}</div> : null}
  </section>;
}
