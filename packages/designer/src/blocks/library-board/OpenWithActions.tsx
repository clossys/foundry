"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "../../components/Button.js";
import { Menu } from "../../components/Menu.js";
import { Tooltip } from "../../components/Tooltip.js";
import { Icon } from "../../components/Icon.js";
import { ChevronDown } from "../../icons/ChevronDown.js";
import { ExternalLink } from "../../icons/ExternalLink.js";
import { type StudioOpenContext } from "./open-context.js";

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
  const menu = <Menu trigger={<Button variant="ghost" aria-label={compact ? labels.openIn : labels.chooseTarget}>{compact ? <Icon glyph={ExternalLink} decorative /> : <Icon glyph={ChevronDown} decorative />}</Button>}>
    {openWithTargets.map(target => <Menu.Item key={target.id} id={target.id} onAction={() => { void open(target); }}>{target.icon}{target.label}</Menu.Item>)}
    {openWithTargets.length ? <Menu.Separator /> : null}
    <Menu.Item id="copy-prompt" onAction={() => { void copy(context().prompt, { kind: "copied" }); }}>{labels.copyPrompt}</Menu.Item>
    <Menu.Item id="copy-link" onAction={() => { void copy(viewHref, { kind: "link-copied" }); }}>{labels.copyLink}</Menu.Item>
  </Menu>;
  return <div className="flex shrink-0 items-center gap-xs" data-studio-actions="">
    {!compact ? <Button variant="secondary" onPress={() => { if (selected) void open(selected); else void copy(context().prompt, { kind: "copied" }); }}>{selected?.icon}{labels.openIn}{selected ? ` ${selected.label}` : ""}</Button> : null}
    {compact ? <Tooltip trigger={menu}>{labels.openIn}</Tooltip> : menu}
  </div>;
}
