"use client";

import { useId, useRef, useState } from "react";
import { NativeAction } from "../components/NativeAction.js";
import { Link } from "../components/Link.js";
import { SemanticContent } from "../components/SemanticContent.js";
import { buttonLinkClassName } from "../components/button-classes.js";

export interface SiteMegaLink {
  readonly label: string;
  readonly href: string;
  readonly isCurrent?: boolean;
}
export interface SiteMegaGroup {
  readonly id: string;
  readonly label: string;
  readonly columns: readonly { readonly heading: string; readonly links: readonly SiteMegaLink[] }[];
  readonly featured?: SiteMegaLink & { readonly description?: string };
}

/** Nonmodal APG disclosure navigation: normal links keep their native Tab order. */
export function SiteMegaNavigation({ groups, mobile = false }: { readonly groups: readonly SiteMegaGroup[]; readonly mobile?: boolean }) {
  const prefix = useId();
  const [open, setOpen] = useState<string>();
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  if (new Set(groups.map(group => group.id)).size !== groups.length) throw new TypeError("Mega navigation identities must be unique");
  return <SemanticContent as="div" className="site-header-nav-links flex flex-wrap items-center gap-sm"
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(undefined); }}>
    {groups.map((group, index) => {
      const panelId = `${prefix}-${index}`;
      const expanded = mobile || open === group.id;
      return <SemanticContent as="div" key={group.id} className="relative"
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(current => current === group.id ? undefined : current); }}
        onKeyDown={event => {
          if (event.key === "Escape" && open === group.id) {
            event.preventDefault(); event.stopPropagation(); setOpen(undefined); triggers.current.get(group.id)?.focus();
          }
        }}>
        {mobile ? <SemanticContent as="h2" className="text-body font-medium">{group.label}</SemanticContent>
          : <NativeAction type="button" ref={node => { if (node) triggers.current.set(group.id, node); else triggers.current.delete(group.id); }}
            className={buttonLinkClassName("ghost", "sm")} aria-expanded={expanded} aria-controls={panelId}
            onClick={() => setOpen(open === group.id ? undefined : group.id)}>{group.label}</NativeAction>}
        <SemanticContent as="div" id={panelId} hidden={!expanded} data-mega-popover=""
          className={mobile ? "flex flex-col gap-md" : "absolute z-[var(--ui-z-popover)] rounded-panel border border-line-base bg-surface-raised p-lg text-ink-primary"}>
          <SemanticContent as="div" className="flex flex-wrap gap-lg">
            {group.columns.map((column, columnIndex) => <SemanticContent as="section" key={columnIndex} className="flex flex-col gap-sm">
              <SemanticContent as="h3" className="m-0 text-body-s font-medium">{column.heading}</SemanticContent>
              {column.links.map(link => <Link key={link.href} variant="standalone" href={link.href}
                aria-current={link.isCurrent ? "page" : undefined} onPress={() => setOpen(undefined)}>{link.label}</Link>)}
            </SemanticContent>)}
            {group.featured ? <SemanticContent as="div" className="rounded-panel bg-surface-sunken p-md">
              <Link variant="standalone" href={group.featured.href} onPress={() => setOpen(undefined)}>{group.featured.label}</Link>
              {group.featured.description ? <SemanticContent as="p" className="text-body-s text-ink-secondary">{group.featured.description}</SemanticContent> : null}
            </SemanticContent> : null}
          </SemanticContent>
        </SemanticContent>
      </SemanticContent>;
    })}
  </SemanticContent>;
}
