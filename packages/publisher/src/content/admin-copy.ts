import type { CopyRef } from "@clossys/writer";
import type { CopyField } from "./composition.js";
import type { ContentSlot, ContentWorkspace } from "./model.js";

/** Canonical WR-META binding references; approval and locale coverage belong to the host resolver. */
export const ADMIN_PAGE_COPY_REFS = {
  designer: {
    title: { id: "st.2zj7yrtkfr" },
    description: { id: "st.abbasfn5h4" },
    shareTitle: { id: "st.2zj7yrtkfr" },
    shareDescription: { id: "st.abbasfn5h4" },
    navLabel: { id: "st.2zj7yrtkfr" },
  },
  writer: {
    title: { id: "st.m22sa9p9y4" },
    description: { id: "st.6zznbwptfh" },
    shareTitle: { id: "st.m22sa9p9y4" },
    shareDescription: { id: "st.6zznbwptfh" },
    navLabel: { id: "st.m22sa9p9y4" },
  },
  publisher: {
    title: { id: "st.cy7122qr1d" },
    description: { id: "st.2tw3ay17tc" },
    shareTitle: { id: "st.cy7122qr1d" },
    shareDescription: { id: "st.2tw3ay17tc" },
    navLabel: { id: "st.cy7122qr1d" },
  },
} as const;
export type AdminPageName = keyof typeof ADMIN_PAGE_COPY_REFS;

/** Agent input for candidate-add; these are references, never approved or resolved text. */
export function adminPageMeta(page: AdminPageName, locale: string): CopyField[] {
  const refs = ADMIN_PAGE_COPY_REFS[page];
  return [["title", refs.title], ["description", refs.description], ["share-title", refs.shareTitle], ["share-text", refs.shareDescription]]
    .map(([key, ref]) => ({ key: key as string, locale, source: "writer" as const, ref: ref as CopyRef }));
}

export function adminPageForRoute(route: string | undefined): AdminPageName | undefined {
  return (["designer", "writer", "publisher"] as const).find(page => route === `/agents/${page}`);
}

/** Admin placement and app ownership also cover home, account, and admin sign-in routes. */
export function isAdminContentRoute(slot: Pick<ContentSlot, "l1" | "l2" | "route" | "deployTarget">,
  workspace: Pick<ContentWorkspace, "deployTargets">): boolean {
  return slot.l1 === "websites" && slot.l2 === "admin"
    || adminPageForRoute(slot.route) !== undefined
    || workspace.deployTargets.some(target => target.id === slot.deployTarget && target.app === "admin");
}

/** Add only missing words to existing links; destination/order and explicit host bindings stay owned by the host. */
export function adminNavigationCopy(nodes: readonly unknown[]): readonly unknown[] {
  return nodes.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const node = value as Record<string, unknown>;
    const page = adminPageForRoute(typeof node.href === "string" ? node.href : undefined);
    return { ...node, ...(page && node.label === undefined ? { label: ADMIN_PAGE_COPY_REFS[page].navLabel } : {}),
      ...(Array.isArray(node.children) ? { children: adminNavigationCopy(node.children) } : {}) };
  });
}
