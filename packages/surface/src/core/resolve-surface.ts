import type { CopyRef, CopyResolution, CopyResolver } from "@vespeneventures/copy";
import { validateSurfaceDocument } from "./validate.js";
import type { ComposeDocument, SurfaceChannelMeta, SurfaceDocument } from "./types.js";

export type SurfaceResolutionReason = "invalid-surface" | "unresolved-copy" | "unsupported-node";

/** A canonical surface could not be safely lowered into a renderer input. */
export class SurfaceResolutionError extends Error {
  constructor(
    readonly reason: SurfaceResolutionReason,
    message: string,
  ) {
    super(message);
    this.name = "SurfaceResolutionError";
  }
}

export interface ResolvedSurfaceDocument {
  /** Compatibility input for the existing deterministic channel renderers. */
  document: ComposeDocument;
  /** Every CopyRegistry resolution used to create `document`, for provenance. */
  resolutions: CopyResolution[];
}

/**
 * Resolves a canonical `SurfaceDocument` through a real `CopyResolver`.
 * It fails closed: invalid references, missing/draft/unapproved registry
 * entries, and caller-owned `node` bindings all refuse rather than being
 * replaced with literals or silently omitted. `node` remains on the authored
 * contract for a future direct web composition path; it cannot be truthfully
 * represented by the legacy string renderer input.
 */
export function resolveSurfaceDocument(surface: SurfaceDocument, resolver: CopyResolver): ResolvedSurfaceDocument {
  const findings = validateSurfaceDocument(surface);
  if (findings.some((finding) => finding.severity === "error")) {
    throw new SurfaceResolutionError("invalid-surface", `resolveSurfaceDocument refused invalid surface "${surface.id}": ${findings.map((finding) => finding.message).join("; ")}`);
  }
  if (typeof resolver !== "function") {
    throw new SurfaceResolutionError("unresolved-copy", `resolveSurfaceDocument needs a CopyResolver for surface "${surface.id}".`);
  }

  const resolutions: CopyResolution[] = [];
  const text = (ref: CopyRef, path: string): string => {
    const resolution = resolver(ref);
    if (resolution === undefined || typeof resolution.text !== "string" || resolution.text.trim().length === 0) {
      throw new SurfaceResolutionError("unresolved-copy", `resolveSurfaceDocument could not resolve CopyRef "${ref.id}" at ${path} for surface "${surface.id}".`);
    }
    resolutions.push(resolution);
    return resolution.text;
  };

  const bindings = surface.bindings.map((binding, index) => {
    if (binding.copy !== undefined) return { slot: binding.slot, value: text(binding.copy, `bindings.${index}.copy`) };
    if (binding.assetId !== undefined) return { slot: binding.slot, assetId: binding.assetId };
    throw new SurfaceResolutionError("unsupported-node", `resolveSurfaceDocument cannot lower caller-owned node binding at bindings.${index}; render that web node through a direct surface-web composition.`);
  });

  const meta = resolveMeta(surface.meta, text);
  return {
    document: { id: surface.id, channel: surface.channel, meta, template: surface.template, bindings, ...(surface.layout === undefined ? {} : { layout: surface.layout }) },
    resolutions,
  };
}

function resolveMeta(meta: SurfaceChannelMeta, text: (ref: CopyRef, path: string) => string): ComposeDocument["meta"] {
  switch (meta.channel) {
    case "web":
      return {
        channel: "web",
        title: text(meta.title, "meta.title"),
        description: text(meta.description, "meta.description"),
        ...(meta.canonical === undefined ? {} : { canonical: meta.canonical }),
        ...(meta.robots === undefined ? {} : { robots: meta.robots }),
        ...(meta.keywords === undefined ? {} : { keywords: meta.keywords.map((ref, index) => text(ref, `meta.keywords.${index}`)) }),
        ...(meta.og === undefined
          ? {}
          : {
              og: {
                ...(meta.og.title === undefined ? {} : { title: text(meta.og.title, "meta.og.title") }),
                ...(meta.og.description === undefined ? {} : { description: text(meta.og.description, "meta.og.description") }),
                ...(meta.og.image === undefined ? {} : { image: meta.og.image }),
                ...(meta.og.type === undefined ? {} : { type: meta.og.type }),
              },
            }),
        ...(meta.twitter === undefined ? {} : { twitter: { ...meta.twitter } }),
        ...(meta.jsonLd === undefined ? {} : { jsonLd: meta.jsonLd }),
      };
    case "email":
      return { channel: "email", subject: text(meta.subject, "meta.subject"), preheader: text(meta.preheader, "meta.preheader"), ...(meta.replyTo === undefined ? {} : { replyTo: meta.replyTo }), ...(meta.listUnsubscribe === undefined ? {} : { listUnsubscribe: meta.listUnsubscribe }) };
    case "image":
      return { channel: "image", width: meta.width, height: meta.height, format: meta.format, ...(meta.scale === undefined ? {} : { scale: meta.scale }), alt: text(meta.alt, "meta.alt") };
    case "slides":
      return { channel: "slides", aspect: meta.aspect, ...(meta.notes === undefined ? {} : { notes: Object.fromEntries(Object.entries(meta.notes).map(([key, ref]) => [key, text(ref, `meta.notes.${key}`)])) }) };
    case "print":
      return meta;
  }
}
