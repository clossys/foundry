"use client";

import { useId, useState, type ReactNode } from "react";
import { Breadcrumb, Button, SemanticContent, Tooltip } from "../components/index.js";
import { ModuleFrame } from "./ModuleFrame.js";

export interface PageFrameBreadcrumb {
  id: string;
  label: string;
  href?: string;
}

export interface PageFrameAction {
  id: string;
  label: string;
  /** A host-resolved design-system icon node. */
  icon: ReactNode;
  /** The producer manifest decides which section slots start open. */
  defaultOpen?: boolean;
  module: {
    sectionId: string;
    label: string;
    children: ReactNode;
    defaultExpanded?: boolean;
  };
}

export interface PageFrameManifest {
  id: string;
  breadcrumbs: readonly PageFrameBreadcrumb[];
  /** Every declared action controls exactly its own section slot. */
  actions: readonly PageFrameAction[];
}

export interface PageFrameProps {
  manifest: PageFrameManifest;
  navigationKey?: string | number;
  breadcrumbLabel: string;
  actionsLabel: string;
  modulesLabel: string;
  children: ReactNode;
  openModuleIds?: readonly string[];
  defaultOpenModuleIds?: readonly string[];
  onOpenModuleIdsChange?: (ids: readonly string[]) => void;
  onNavigate?: (href: string) => void;
  mainId?: string;
  mainBusy?: boolean;
  stage?: "full" | "padded";
  className?: string;
  headerSurface?: "solid" | "transparent" | "glass";
}

function validateManifest(manifest: PageFrameManifest) {
  for (const entries of [manifest.breadcrumbs, manifest.actions, manifest.actions.map(action => ({ id: action.module.sectionId }))]) {
    const ids = new Set<string>();
    for (const entry of entries) {
      if (!entry.id || ids.has(entry.id)) throw new TypeError("PageFrame requires unique, nonempty manifest identifiers");
      ids.add(entry.id);
    }
  }
}

/** The page header contains only its manifest breadcrumb trail and module action icons. */
export function PageFrame(props: PageFrameProps) {
  validateManifest(props.manifest);
  return <PageContent key={props.navigationKey ?? props.manifest.id} {...props} />;
}

function PageContent({ manifest, breadcrumbLabel, actionsLabel, modulesLabel, children, openModuleIds, defaultOpenModuleIds,
  onOpenModuleIdsChange, onNavigate, mainId, mainBusy, stage = "padded", className, headerSurface = "solid" }: PageFrameProps) {
  const instance = useId();
  const [ownOpenIds, setOwnOpenIds] = useState<readonly string[]>(() => defaultOpenModuleIds ?? manifest.actions.filter(action => action.defaultOpen).map(action => action.module.sectionId));
  const declaredIds = manifest.actions.map(action => action.module.sectionId);
  const openIds = declaredIds.filter(id => (openModuleIds ?? ownOpenIds).includes(id));
  const moduleDomId = (id: string) => `${instance}-module-${id}`;
  const toggle = (id: string) => {
    const next = openIds.includes(id) ? openIds.filter(open => open !== id) : declaredIds.filter(candidate => candidate === id || openIds.includes(candidate));
    if (openModuleIds === undefined) setOwnOpenIds(next);
    onOpenModuleIdsChange?.(next);
  };
  const BreadcrumbItem = Breadcrumb.Item;
  return <SemanticContent as="div" data-page-id={manifest.id} className={["frame-page flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", className].filter(Boolean).join(" ")}>
    <SemanticContent as="div" data-page-frame-header="" className={["frame-page-header sticky top-0 z-sticky flex min-w-0 items-center justify-between gap-sm border-b border-line-base px-md py-sm", { solid: "bg-surface-raised", transparent: "bg-transparent", glass: "bg-surface-glass" }[headerSurface]].join(" ")}
      onClickCapture={event => {
        if (!onNavigate || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const anchor = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
        if (!anchor || anchor.hasAttribute("download") || anchor.target && anchor.target !== "_self") return;
        const href = anchor.getAttribute("href");
        if (!href) return;
        event.preventDefault(); onNavigate(href);
      }}>
      <SemanticContent as="div" className="min-w-0 flex-1 overflow-hidden">
        <Breadcrumb aria-label={breadcrumbLabel}>
          {manifest.breadcrumbs.map(crumb => <BreadcrumbItem key={crumb.id} href={crumb.href}>{crumb.label}</BreadcrumbItem>)}
        </Breadcrumb>
      </SemanticContent>
      <SemanticContent as="div" role="group" aria-label={actionsLabel} className="flex shrink-0 items-center gap-xs">
        {manifest.actions.map(action => <Tooltip key={action.id} trigger={
          <Button variant="ghost" size="md" data-page-action={action.id} aria-label={action.label}
            aria-pressed={openIds.includes(action.module.sectionId)} aria-controls={openIds.includes(action.module.sectionId) ? moduleDomId(action.module.sectionId) : undefined}
            onPress={() => toggle(action.module.sectionId)} className="aspect-square shrink-0 p-0" style={{ inlineSize: "var(--ui-layout-tap-target)", blockSize: "var(--ui-layout-tap-target)" }}>
            <SemanticContent as="span" aria-hidden="true" className="inline-flex items-center justify-center">{action.icon}</SemanticContent>
          </Button>
        }>{action.label}</Tooltip>)}
      </SemanticContent>
    </SemanticContent>
    <SemanticContent as="div" className="frame-page-layout flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <SemanticContent as="main" id={mainId} tabIndex={-1} aria-busy={mainBusy || undefined} data-page-frame-stage=""
        className={stage === "full" ? "frame-page-stage frame-main-bleed focus-ring-inset flex min-h-0 min-w-0 flex-1 flex-col overflow-auto" : "frame-page-stage frame-main-gap frame-main-bleed focus-ring-inset flex min-h-0 min-w-0 flex-1 flex-col gap-lg overflow-auto p-lg"}>
        {children}
      </SemanticContent>
      {openIds.length > 0 && <SemanticContent as="aside" data-page-frame-modules="" aria-label={modulesLabel}
        className="frame-page-modules flex min-h-0 min-w-0 shrink-0 basis-[var(--frame-module-width)] flex-col gap-md overflow-auto border-s border-line-base bg-surface-sunken p-md">
        {manifest.actions.filter(action => openIds.includes(action.module.sectionId)).map(action => <SemanticContent as="div" key={action.module.sectionId} id={moduleDomId(action.module.sectionId)}>
          <ModuleFrame id={action.module.sectionId} label={action.module.label} defaultExpanded={action.module.defaultExpanded}>{action.module.children}</ModuleFrame>
        </SemanticContent>)}
      </SemanticContent>}
    </SemanticContent>
  </SemanticContent>;
}
