/**
 * The consumer side of a publication's install outputs (`outputs` on its `clossys.publication/1`
 * candidate): Publisher plans the files (`planSiteOutputs`); this module hands it the pinned
 * Writer copy per locale and the Designer's pinned mark. Nothing here writes copy or visuals.
 *
 * - Writer copy is keyed per locale from the pinned Writer rows. A key a locale does not hold
 *   stays missing: Publisher reports it, and the Writer drafts it. There is no locale fallback.
 * - The share mark is the pinned `assets.mark` (positive, else mono) as an svg data URL.
 */
import { join } from "node:path";
import { planSiteOutputs, type SiteOutputsPlan } from "@clossys/publisher/install";
import type { ContentMap, PublicationOutputs } from "@clossys/publisher/content-map";
import { pinnedBrand } from "../server/consumer-brand.js";
import { readWriter, writerKeyedCopy } from "./site-source.js";

/** The pinned Writer copy of one consumer, per locale. */
export interface WriterLocaleCopy {
  /** The Writer's source locale (`en` when pinned, else the first pinned locale). */
  readonly source: string;
  /** Every pinned locale, sorted. */
  readonly locales: readonly string[];
  /** Copy by key in one locale: records, aliases to them, and a record's context when no alias names it. */
  copy(locale: string): Readonly<Record<string, string>>;
}

export async function writerLocaleCopy(root: string): Promise<WriterLocaleCopy> {
  const writer = await readWriter(root);
  const rows = writer.native?.rows ?? [];
  const locales = [...new Set(rows.map(row => row.locale))].sort();
  const cache = new Map<string, Record<string, string>>();
  return {
    source: writer.locale,
    locales,
    copy(locale: string) {
      const cached = cache.get(locale);
      if (cached) return cached;
      const copy = writerKeyedCopy(writer, locale);
      cache.set(locale, copy);
      return copy;
    },
  };
}

/** The pinned Designer mark as the svg data URL a share card draws, or undefined when none is pinned. */
export function designerShareMark(root: string): string | undefined {
  const svg = pinnedBrand(join(root, "clossys")).mark?.light;
  return svg === undefined ? undefined : `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/** Plan a pinned publication's outputs from the consumer's pinned Writer copy and Designer mark. */
export async function planPublicationOutputs(root: string, map: ContentMap, outputs: PublicationOutputs): Promise<SiteOutputsPlan> {
  const writer = await writerLocaleCopy(root);
  const markSrc = outputs.share ? designerShareMark(root) : undefined;
  return planSiteOutputs({
    map, outputs, locale: writer.source,
    text: (key, locale) => { const copy = writer.copy(locale); return Object.hasOwn(copy, key) ? copy[key] : undefined; },
    ...(markSrc === undefined ? {} : { share: { markSrc } }),
  });
}
