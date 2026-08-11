import type { CopyRef } from "@vespeneventures/copy";
import type { ChannelMeta, ComposeDocument, SurfaceChannelMeta, SurfaceDocument, SurfaceSlotBinding } from "./types.js";

/** Creates a registry address for a legacy literal while migrating it to copy ownership. */
export type LegacyCopyRefFactory = (text: string, path: string) => CopyRef;

function copyRefForText(factory: LegacyCopyRefFactory, value: string, path: string): CopyRef {
  const ref = factory(value, path);
  if (typeof ref?.id !== "string" || ref.id.length === 0) {
    throw new TypeError(`migrateComposeDocument: factory returned an invalid CopyRef for ${path}.`);
  }
  return ref;
}

function migrateMeta(meta: ChannelMeta, factory: LegacyCopyRefFactory): SurfaceChannelMeta {
  switch (meta.channel) {
    case "web":
      return {
        channel: "web",
        title: copyRefForText(factory, meta.title, "meta.title"),
        description: copyRefForText(factory, meta.description, "meta.description"),
        ...(meta.canonical === undefined ? {} : { canonical: meta.canonical }),
        ...(meta.robots === undefined ? {} : { robots: meta.robots }),
        ...(meta.keywords === undefined ? {} : { keywords: meta.keywords.map((value, index) => copyRefForText(factory, value, `meta.keywords.${index}`)) }),
        ...(meta.og === undefined
          ? {}
          : {
              og: {
                ...(meta.og.image === undefined ? {} : { image: meta.og.image }),
                ...(meta.og.type === undefined ? {} : { type: meta.og.type }),
                ...(meta.og.title === undefined ? {} : { title: copyRefForText(factory, meta.og.title, "meta.og.title") }),
                ...(meta.og.description === undefined ? {} : { description: copyRefForText(factory, meta.og.description, "meta.og.description") }),
              },
            }),
        ...(meta.twitter === undefined ? {} : { twitter: { ...meta.twitter } }),
        ...(meta.jsonLd === undefined ? {} : { jsonLd: meta.jsonLd }),
      };
    case "email":
      return { ...meta, subject: copyRefForText(factory, meta.subject, "meta.subject"), preheader: copyRefForText(factory, meta.preheader, "meta.preheader") };
    case "image":
      return { ...meta, alt: copyRefForText(factory, meta.alt, "meta.alt") };
    case "slides":
      return {
        channel: "slides",
        aspect: meta.aspect,
        ...(meta.notes === undefined
          ? {}
          : { notes: Object.fromEntries(Object.entries(meta.notes).map(([key, value]) => [key, copyRefForText(factory, value, `meta.notes.${key}`)])) }),
      };
    case "print":
      return meta;
  }
}

/**
 * Converts the deprecated `ComposeDocument` shape into a `SurfaceDocument`.
 * Existing `copyId` and `assetId` values retain their stable ids; legacy
 * literals are handed to the caller so it can register and return their
 * `CopyRef`. The function never invents copy identifiers itself.
 */
export function migrateComposeDocument(document: ComposeDocument, copyRefForLiteral: LegacyCopyRefFactory): SurfaceDocument {
  const bindings: SurfaceSlotBinding[] = document.bindings.map((binding, index) => {
    if (binding.copyId !== undefined) return { slot: binding.slot, copy: { id: binding.copyId } };
    if (binding.assetId !== undefined) return { slot: binding.slot, assetId: binding.assetId };
    if (binding.value !== undefined) return { slot: binding.slot, copy: copyRefForText(copyRefForLiteral, binding.value, `bindings.${index}.value`) };
    throw new TypeError(`migrateComposeDocument: bindings.${index} has no source.`);
  });
  return { id: document.id, channel: document.channel, meta: migrateMeta(document.meta, copyRefForLiteral), template: document.template, bindings, ...(document.layout === undefined ? {} : { layout: document.layout }) };
}
