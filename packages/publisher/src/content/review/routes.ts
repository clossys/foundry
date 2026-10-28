import type { ContentCandidate, ContentSlot } from "../model.js";
import type { ReviewContext } from "./types.js";

/** Consumer-neutral LF-0 board policy; registration evidence stays in snapshots. */
const BOARD_FRAMES: Readonly<Record<string, string>> = {
  "websites/site": "frames.site-shell", "websites/demo": "frames.site-shell",
  "websites/admin": "frames.app-shell", "websites/app": "frames.app-shell", "websites/auth": "frames.auth-shell",
  "documents/docs": "frames.document", "presentations/decks": "frames.deck", "videos/clips": "frames.video",
  "messages/email": "frames.message", "social/posts": "frames.social",
};

/** Decode once before canonicalizing, rejecting syntax that changes URL scope. */
function routePath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || /[\s\u0000-\u001f\u007f?#\\]/u.test(value)) return undefined;
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return undefined; }
  if (decoded.startsWith("//") || /[\s\u0000-\u001f\u007f?#\\]/u.test(decoded)) return undefined;
  const segments: string[] = [];
  for (const segment of decoded.slice(1).split("/")) {
    if (segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  const normalized = `/${segments.join("/")}`.replace(/\/+$/, "") || "/";
  return normalized.startsWith("//") ? undefined : normalized;
}

type RedirectTarget = { readonly kind: "local"; readonly path: string } | { readonly kind: "external" };
function redirectTarget(value: unknown): RedirectTarget | undefined {
  if (typeof value !== "string" || !value || /[\s\u0000-\u001f\u007f\\]/u.test(value)) return undefined;
  if (value.startsWith("/")) {
    const path = routePath(value);
    return path === undefined ? undefined : { kind: "local", path };
  }
  if (!/^https?:\/\//i.test(value)) return undefined;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password) return undefined;
    return { kind: "external" };
  } catch { return undefined; }
}

/** Review declared routes and redirect evidence without fetching remote URLs. */
export function reviewRoutes(ctx: ReviewContext): void {
  const { registry, candidate, slot } = ctx;
  const candidatePath = `registry.candidates[${registry.candidates.indexOf(candidate)}]`;
  const registeredSlots = registry.slots.filter(current => current && typeof current === "object");
  const slots = new Set(registeredSlots.map(slot => slot.id));
  if (Array.isArray(candidate.links)) candidate.links.forEach((link, index) => {
    if (!link || !slots.has(link.toSlotId)) ctx.add("links", `${candidatePath}.links[${index}].toSlotId`, "missing-link-slot", `Link target slot is not registered: ${link?.toSlotId ?? "missing"}`);
  });

  const paths = new Map<ContentSlot, string>();
  const namespaces = new Map<string, ContentSlot[]>();
  registry.slots.forEach((current, index) => {
    if (!current || typeof current !== "object") return;
    if (current.route === undefined) return;
    const path = routePath(current.route);
    if (path === undefined) {
      ctx.add("url-collision", `registry.slots[${index}].route`, "route-path", "Slot routes must be valid root-relative paths without query, fragment, or backslash"); return;
    }
    paths.set(current, path);
    // An unbound slot supplies no evidence of a shared deploy namespace.
    if (typeof current.deployTarget !== "string" || !current.deployTarget.trim()) return;
    const namespace = JSON.stringify([current.deployTarget, path]);
    const matches = namespaces.get(namespace) ?? [];
    if (matches.length) ctx.add("url-collision", `registry.slots[${index}].route`, "url-collision", `Route ${path} collides within deploy target ${current.deployTarget}`);
    matches.push(current); namespaces.set(namespace, matches);
  });

  const composition = candidate.composition;
  if (composition) {
    const expected = BOARD_FRAMES[`${slot.l1}/${slot.l2}`];
    if (expected && composition.frame?.frameId !== expected) ctx.add("frame-per-l2", `${candidatePath}.composition.frame.frameId`, "frame-per-l2", `Board ${slot.l1}/${slot.l2} requires frame ${expected}`);
    if (expected) {
      const libraries = ctx.input.libraries.filter(library => library?.consumerId === registry.workspace?.consumerId && library?.version === composition.libraryVersion);
      if (libraries.length !== 1 || !Array.isArray(libraries[0]?.frames) || !libraries[0]!.frames.some(frame => frame?.id === expected)) {
        ctx.need("frame", "designer", `${composition.libraryVersion}:${expected}`, `Register required frame ${expected} for board ${slot.l1}/${slot.l2} in library version ${composition.libraryVersion}.`);
      }
    }
  }

  if (slot.kind === "redirect") {
    if (composition !== undefined) ctx.add("redirect", `${candidatePath}.composition`, "redirect-composition", "Redirect slots cannot have a composition");
    if (candidate.redirectTarget === undefined) ctx.add("redirect", `${candidatePath}.redirectTarget`, "redirect-target-required", "Redirect slots require a redirect target");
  } else if (candidate.redirectTarget !== undefined) {
    ctx.add("redirect", `${candidatePath}.redirectTarget`, "redirect-kind", "Only redirect slots may declare a redirect target");
  }

  type Node = { readonly slot: ContentSlot; readonly candidate: ContentCandidate; readonly path: string };
  const nodes = new Map<string, Node>();
  registeredSlots.forEach(current => {
    if (current.id === slot.id) return;
    const active = registry.candidates.filter(peer => peer?.id === current.activeCandidateId && peer?.slotId === current.id && peer?.state === "active");
    if (active.length === 1) {
      const peer = active[0]!;
      nodes.set(current.id, { slot: current, candidate: peer, path: `registry.candidates[${registry.candidates.indexOf(peer)}]` });
    }
  });
  nodes.set(slot.id, { slot, candidate, path: candidatePath });
  const edges = new Map<string, string>();
  for (const [id, node] of nodes) {
    if (node.candidate.redirectTarget === undefined) continue;
    const target = redirectTarget(node.candidate.redirectTarget);
    if (!target) {
      if (node.candidate === candidate) ctx.add("redirect", `${node.path}.redirectTarget`, "redirect-target", "Redirect target must be a root-relative path or an HTTP(S) URL without credentials");
      continue;
    }
    if (node.slot.kind !== "redirect" || target.kind === "external") continue;
    if (paths.get(node.slot) === target.path) {
      ctx.add("redirect", `${node.path}.redirectTarget`, "redirect-self", "Redirect target resolves to the same canonical route");
      edges.set(id, id); continue;
    }
    const matches = typeof node.slot.deployTarget === "string"
      ? namespaces.get(JSON.stringify([node.slot.deployTarget, target.path])) ?? [] : [];
    if (matches.length !== 1) {
      if (node.candidate === candidate) ctx.add("redirect", `${node.path}.redirectTarget`, "unresolved-redirect-target", `Local redirect target must resolve to exactly one registered route in the same deploy target: ${target.path}`);
      continue;
    }
    edges.set(id, matches[0]!.id);
  }

  const completed = new Set<string>();
  for (const id of nodes.keys()) {
    const chain: string[] = [];
    const positions = new Map<string, number>();
    let current: string | undefined = id;
    while (current !== undefined && !completed.has(current)) {
      const position = positions.get(current);
      if (position !== undefined) {
        for (const member of chain.slice(position)) {
          const node = nodes.get(member)!;
          ctx.add("redirect", `${node.path}.redirectTarget`, "redirect-cycle", "Declared current redirect routes contain a cycle");
        }
        break;
      }
      positions.set(current, chain.length); chain.push(current); current = edges.get(current);
    }
    chain.forEach(member => completed.add(member));
  }
}
