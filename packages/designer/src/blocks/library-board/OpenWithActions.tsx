"use client";
import { useEffect, useState, type ReactNode } from "react";

import { ChevronDown } from "../../icons/ChevronDown.js";
import { ExternalLink } from "../../icons/ExternalLink.js";
import { type StudioOpenContext } from "./open-context.js";
import { componentLeaf } from "../../runtime/component-leaf.js";
import { MenuItem, MenuSeparator, MenuTrigger, PopupMenu } from "../shell-menu.js";

const Button = componentLeaf<import("../../runtime/component-leaf.js").ButtonLeaf>("components.button");
const Icon = componentLeaf<typeof import("../../components/Icon.js").Icon>("components.icon");
const SemanticContent = componentLeaf<typeof import("../../components/SemanticContent.js").SemanticContent>("components.semantic-content");

export interface StudioOpenTarget {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Undefined means this context can only be copied, for example an overlong URL. */
  href(context: StudioOpenContext): string | undefined;
}
export type StudioLaunchResult = "dispatched" | "unavailable" | "failed";
export type StudioActionNotice = { kind: "copied"; target?: string } | { kind: "copy-failed" } | { kind: "link-copied" };
export interface StudioActionsProps {
  /** Exact data-only prompt for a candidate dialog; projectPath remains routing context only. */
  promptContext: StudioOpenContext;
  projectPath: string;
  taskPrompt: string;
  viewHref: string;
  openWithTargets: readonly StudioOpenTarget[];
  labels: { openIn: string; chooseTarget: string; copyPrompt: string; copyLink: string };
  /** Submit to the host frame's existing toast region; Studio creates no viewport. */
  onNotice(notice: StudioActionNotice): void;
  /** Host integration may know a target is unavailable. Browser dispatch alone cannot prove opening. */
  launch?: (href: string, target: StudioOpenTarget) => StudioLaunchResult | Promise<StudioLaunchResult>;
  compact?: boolean;
  storageKey?: string;
}
const LAST_TARGET = "foundry.studio.open-target";
export function OpenWithActions({ promptContext, projectPath, taskPrompt, viewHref, openWithTargets, labels, onNotice, launch, compact = false, storageKey = LAST_TARGET }: StudioActionsProps) {
  const [last, setLast] = useState<string>();
  useEffect(() => { try { setLast(localStorage.getItem(storageKey) ?? undefined); } catch { setLast(undefined); } }, [storageKey]);
  const selected = openWithTargets.find(target => target.id === last) ?? openWithTargets[0];
  const context = () => promptContext;
  const copy = async (text: string, notice: StudioActionNotice) => {
    try { await navigator.clipboard.writeText(text); onNotice(notice); }
    catch { onNotice({ kind: "copy-failed" }); }
  };
  const open = async (target: StudioOpenTarget) => {
    const current = context();
    setLast(target.id); try { localStorage.setItem(storageKey, target.id); } catch { /* Storage is optional. */ }
    let result: StudioLaunchResult = "unavailable";
    try {
      const href = target.href(current);
      if (href) {
        if (launch) result = await launch(href, target);
        else { window.location.assign(href); result = "dispatched"; }
      }
    } catch { result = "failed"; }
    if (result !== "dispatched") await copy(current.prompt, { kind: "copied", target: target.label });
  };
  // Stock anatomy (E2): the selected DropdownMenuTrigger opens the selected DropdownMenu.
  const menu = <MenuTrigger>
    <Button variant="ghost" aria-label={compact ? labels.openIn : labels.chooseTarget}>{compact ? <Icon glyph={ExternalLink} decorative /> : <Icon glyph={ChevronDown} decorative />}</Button>
    <PopupMenu>
      {openWithTargets.map(target => <MenuItem key={target.id} id={target.id} textValue={target.label} onAction={() => { void open(target); }}>{target.icon}{target.label}</MenuItem>)}
      {openWithTargets.length ? <MenuSeparator /> : null}
      <MenuItem id="copy-prompt" onAction={() => { void copy(context().prompt, { kind: "copied" }); }}>{labels.copyPrompt}</MenuItem>
      <MenuItem id="copy-link" onAction={() => { void copy(viewHref, { kind: "link-copied" }); }}>{labels.copyLink}</MenuItem>
    </PopupMenu>
  </MenuTrigger>;
  return <SemanticContent as="div" className="flex shrink-0 items-center gap-xs" data-studio-actions="">
    {!compact ? <Button variant="secondary" onPress={() => { if (selected) void open(selected); else void copy(context().prompt, { kind: "copied" }); }}>{selected?.icon}{labels.openIn}{selected ? ` ${selected.label}` : ""}</Button> : null}
    {menu}
  </SemanticContent>;
}
