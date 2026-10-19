"use client";

import { Avatar } from "../atoms/Avatar.js";
import { Button } from "../atoms/Button.js";
import { Icon } from "../atoms/Icon.js";
import { Menu } from "../atoms/Menu.js";
import { Tooltip } from "../atoms/Tooltip.js";
import { Check } from "../icons/Check.js";
import { ChevronUp } from "../icons/ChevronUp.js";
import type { AccountMenuProps } from "./account-menu-types.js";
export type { AccountMenuProps } from "./account-menu-types.js";

/** Host-owned account data composed into a client menu; no identity or persistence service. */
export function AccountMenu({ actor, sections, contextLabel, triggerLabel, collapsed = false, onClose, onRoute }: AccountMenuProps) {
  const populated = sections.filter(section => section.entries.length > 0);
  if (populated.length === 0) return null;
  const label = triggerLabel ?? actor.name;
  const keyFor = (sectionId: string, entryId: string) => JSON.stringify([sectionId, entryId]);
  const trigger = <Button variant="ghost" aria-label={label}
    className={collapsed ? "icon-control-md border-0 bg-transparent p-0" : "border-0 bg-transparent w-full justify-start gap-sm text-start"}
    style={({ isFocusVisible }) => ({ outlineStyle: isFocusVisible ? "auto" : undefined })}>
    <span aria-hidden="true"><Avatar alt={actor.name} src={actor.image} /></span>
    {!collapsed && <>
      <span className="flex min-w-0 flex-1 flex-col text-start">
        <span className="truncate">{actor.name}</span>
        {contextLabel && <span className="truncate text-caption text-ink-muted">{contextLabel}</span>}
      </span>
      <Icon glyph={ChevronUp} decorative size="sm" />
    </>}
  </Button>;
  return <Menu trigger={collapsed ? <Tooltip trigger={trigger} delay={0}>{label}</Tooltip> : trigger}
    onOpenChange={open => { if (!open) onClose?.(); }}>
    {populated.map((section, index) => <Menu.Section key={section.id}
      aria-label={section.label ?? actor.name}
      heading={index === 0 ? <span className="flex flex-col gap-xs">
        <span>{actor.name}</span>
        {actor.secondaryText && <span>{actor.secondaryText}</span>}
        {contextLabel && <span>{contextLabel}</span>}
        {section.label && <span>{section.label}</span>}
      </span> : section.label}
      selectionMode={section.kind === "preferences" ? "multiple" : "none"}
      selectedKeys={section.kind === "preferences" ? section.entries.filter(entry => entry.checked).map(entry => keyFor(section.id, entry.id)) : undefined}
      shouldCloseOnSelect={section.kind === "preferences" ? false : undefined}
      onSelectionChange={section.kind === "preferences" ? keys => {
        for (const entry of section.entries) {
          const checked = keys === "all" || keys.has(keyFor(section.id, entry.id));
          if (checked !== entry.checked) entry.onCheckedChange(checked);
        }
      } : undefined}>
      {section.entries.map(entry => <Menu.Item key={keyFor(section.id, entry.id)} id={keyFor(section.id, entry.id)}
        textValue={entry.label} isDisabled={entry.isDisabled} isDestructive={entry.kind === "destructive"}
        href={entry.kind === "link" ? entry.href : undefined}
        onAction={entry.kind === "link" ? () => onRoute?.(entry) : entry.kind === "preference" ? undefined : entry.onAction}>
        {entry.kind === "preference" && entry.checked && <Icon glyph={Check} decorative size="sm" />}
        {entry.label}
      </Menu.Item>)}
    </Menu.Section>)}
  </Menu>;
}
