"use client";

import { Fragment } from "react";

import { ChevronUp } from "../icons/ChevronUp.js";
import type { AccountMenuProps, AccountMenuSection } from "./account-menu-types.js";
import { avatarInitials } from "../components/Avatar.server.js";
import { componentLeaf } from "../runtime/component-leaf.js";
import { Avatar, AvatarFallback, AvatarImage, MenuGroup, MenuItem, MenuLabel, MenuSeparator, ShellMenu } from "./shell-menu.js";

const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");
const Button = componentLeaf<typeof import("../components/Button.js").Button>("components.button");
const Icon = componentLeaf<typeof import("../components/Icon.js").Icon>("components.icon");

export type { AccountMenuProps } from "./account-menu-types.js";

/** The same destination boundary used by Items; no identity or routing service. */
function isSanctionedHref(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value) || value.includes("\\")) return false;
  if (value.startsWith("#")) return true;
  if (value.startsWith("/")) return !value.startsWith("//");
  if (value.toLowerCase().startsWith("mailto:")) return value.slice(7).trim().length > 0;
  try { const url = new URL(value); return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password; } catch { return false; }
}

/** Host-owned account data composed into a client menu; no identity or persistence service. */
export function AccountMenu({ actor, sections, contextLabel, triggerLabel, collapsed = false, onClose, onRoute, menuContent, controls }: AccountMenuProps) {
  if (new Set(sections.map(section => section.id)).size !== sections.length) {
    throw new TypeError("AccountMenu: section IDs must be unique within the menu.");
  }
  for (const section of sections) {
    if (new Set(section.entries.map(entry => entry.id)).size !== section.entries.length) {
      throw new TypeError("AccountMenu: entry IDs must be unique within their section.");
    }
  }
  const populated = sections.map(section => ({ ...section, entries: section.entries.filter(entry => !entry.isDisabled) }) as AccountMenuSection).filter(section => section.entries.length > 0);
  if (populated.length === 0 && menuContent == null && controls == null) return null;
  if (!actor.name.trim() || populated.some(section => section.entries.some(entry => !entry.label.trim()))) {
    throw new TypeError("AccountMenu: actor name and entry labels must be non-empty.");
  }
  if (populated.some(section => section.entries.some(entry => entry.kind === "link" && !isSanctionedHref(entry.href)))) {
    throw new TypeError("AccountMenu: href must be an anchor, one-origin path, HTTP(S) URL or explicit mail link.");
  }
  if (populated.some(section => section.kind === "preferences" && !section.label.trim())) {
    throw new TypeError("AccountMenu: preference sections need a non-empty label.");
  }
  const label = triggerLabel?.trim() ? triggerLabel : actor.name;
  const keyFor = (sectionId: string, entryId: string) => JSON.stringify([sectionId, entryId]);
  const trigger = <Button variant="ghost" aria-label={collapsed ? label : actor.name}
    className={collapsed ? "icon-control-md border-0 bg-transparent p-0 forced-colors:focus-visible:outline forced-colors:focus-visible:outline-solid" : "control-h-lg border-0 bg-transparent w-full min-w-0 justify-start gap-sm py-sm whitespace-normal text-start forced-colors:focus-visible:outline forced-colors:focus-visible:outline-solid"}>
    <SemanticContent as="span" aria-hidden="true" className="shrink-0"><Avatar>
      {actor.image ? <AvatarImage src={actor.image} alt="" /> : null}
      <AvatarFallback>{avatarInitials(actor.name)}</AvatarFallback>
    </Avatar></SemanticContent>
    {!collapsed && <>
      <SemanticContent as="span" className="flex min-w-0 flex-1 flex-col text-start">
        <SemanticContent as="span" className="break-words whitespace-normal">{actor.name}</SemanticContent>
        {contextLabel && <SemanticContent as="span" className="break-words whitespace-normal text-caption text-ink-muted">{contextLabel}</SemanticContent>}
      </SemanticContent>
      <Icon glyph={ChevronUp} decorative size="sm" className="shrink-0" />
    </>}
  </Button>;
  const entriesFor = (section: AccountMenuSection) => section.entries.map(entry => <MenuItem key={keyFor(section.id, entry.id)} id={keyFor(section.id, entry.id)}
    textValue={entry.label} isDisabled={entry.isDisabled} variant={entry.kind === "destructive" ? "destructive" : "default"}
    href={entry.kind === "link" ? entry.href : undefined}
    onAction={entry.kind === "preference" ? undefined : () => { if (entry.kind === "link") onRoute?.(entry); else entry.onAction(); }}>
    {entry.label}
  </MenuItem>);
  const identity = (section: AccountMenuSection) => <SemanticContent as="span" className="flex min-w-0 flex-col gap-xs"
    style={{ maxInlineSize: "min(var(--ui-layout-sidebar-w), calc(100vw - 2 * var(--spacing-2xl)))" }}>
    <SemanticContent as="span" className="break-words whitespace-normal">{actor.name}</SemanticContent>
    {actor.secondaryText && <SemanticContent as="span" className="truncate">{actor.secondaryText}</SemanticContent>}
    {contextLabel && <SemanticContent as="span" className="truncate">{contextLabel}</SemanticContent>}
    {section.label?.trim() && <SemanticContent as="span" className="truncate">{section.label}</SemanticContent>}
  </SemanticContent>;
  const content = <>
    {menuContent}
    {populated.map((section, index) => index > 0 && !section.label?.trim()
      ? <Fragment key={section.id}><MenuSeparator />{entriesFor(section)}</Fragment>
      : <MenuGroup key={section.id}
        aria-label={section.label?.trim() ? section.label : index === 0 ? actor.name : undefined}
        selectionMode={section.kind === "preferences" ? "multiple" : "none"}
        selectedKeys={section.kind === "preferences" ? section.entries.filter(entry => entry.checked).map(entry => keyFor(section.id, entry.id)) : undefined}
        shouldCloseOnSelect={section.kind === "preferences" ? false : undefined}
        onSelectionChange={section.kind === "preferences" ? keys => {
          for (const entry of section.entries) {
            const checked = keys === "all" || keys.has(keyFor(section.id, entry.id));
            if (checked !== entry.checked) entry.onCheckedChange(checked);
          }
        } : undefined}>
        {index === 0 ? <MenuLabel>{identity(section)}</MenuLabel> : <MenuLabel>{section.label}</MenuLabel>}
        {entriesFor(section)}
      </MenuGroup>)}
  </>;
  const onOpenChange = (open: boolean) => { if (!open) onClose?.(); };
  // The collapsed trigger keeps its accessible name; its hover tooltip waits on an owner tooltip-timing placement.
  return <ShellMenu trigger={trigger} label={actor.name} controls={controls} onOpenChange={onOpenChange}>{content}</ShellMenu>;
}
