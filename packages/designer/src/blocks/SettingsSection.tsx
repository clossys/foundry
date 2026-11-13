import { useId, type ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { componentLeaf } from "../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");
type FieldModule = typeof import("../components/preview-runtime/components/field/field.js");
const FieldSet = componentLeaf<FieldModule["FieldSet"]>("components.field", "FieldSet");
const FieldLegend = componentLeaf<FieldModule["FieldLegend"]>("components.field", "FieldLegend");
const FieldDescription = componentLeaf<FieldModule["FieldDescription"]>("components.field", "FieldDescription");
const FieldGroup = componentLeaf<FieldModule["FieldGroup"]>("components.field", "FieldGroup");

/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.settings", "foundry/sections.settings");

export interface SettingsSectionGroup {
  readonly id: string;
  readonly legend: ReactNode;
  readonly description?: ReactNode;
  /** `multi` lays the group's fields out in two columns from tablet up. */
  readonly layout?: "single" | "multi";
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
  return <SemanticContent as="section" {...SECTION_STAMP} aria-labelledby={headingId} className={cx("flex min-w-0 flex-col gap-lg text-body text-ink-primary", className)}>
    <header className="flex flex-col gap-xs">
      <SemanticContent as="h2" id={headingId} className="m-0 text-h3 font-display leading-heading text-ink-primary">{heading}</SemanticContent>
      {description ? <SemanticContent as="p" className="m-0 text-body-s text-ink-secondary">{description}</SemanticContent> : null}
    </header>
    {groups.map(group => {
      const descriptionId = group.description ? `${headingId}-${group.id}-description` : undefined;
      return <FieldSet key={group.id} aria-describedby={descriptionId} className="rounded-surface border border-line-base bg-surface-raised p-md">
        <FieldLegend><SemanticContent as="span" className="inline-flex flex-wrap items-baseline gap-sm"><SemanticContent as="span" className="text-body font-medium text-ink-primary">{group.legend}</SemanticContent>
          {dirty.includes(group.id) ? <>{" "}<SemanticContent as="span" className="text-caption text-ink-secondary">{labels.unsaved}</SemanticContent></> : null}</SemanticContent></FieldLegend>
        {group.description ? <FieldDescription id={descriptionId}>{group.description}</FieldDescription> : null}
        <FieldGroup className={group.layout === "multi" ? "grid tablet:grid-cols-2" : undefined}>{group.children}</FieldGroup>
      </FieldSet>;
    })}
    {saveBar && dirty.length ? <SemanticContent as="div" role="region" aria-label={labels.saveBar} className="sticky bottom-0 flex flex-wrap items-center justify-end gap-sm border-t border-line-base bg-surface-base py-sm">{saveBar}</SemanticContent> : null}
  </SemanticContent>;
}
