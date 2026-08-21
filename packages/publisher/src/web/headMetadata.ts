/**
 * Turns a `ComposeDocument`'s `WebMeta` into this package's own
 * `WebHeadMetadata` — plain data, no framework type, and with `jsonLd`
 * upgraded from `WebMeta`'s `Record<string, unknown>[]` into ready-to-embed,
 * `<script>`-safe strings. See `internal/jsonLd.ts` for why the escaping
 * step exists and what it defends against.
 */

import type { WebMeta } from "../core/index.js";
import { serializeJsonLd } from "./internal/jsonLd.js";
import type { WebHeadMetadata } from "./types.js";

export function buildWebHeadMetadata(meta: WebMeta): WebHeadMetadata {
  const head: WebHeadMetadata = {
    title: meta.title,
    description: meta.description,
    jsonLd: (meta.jsonLd ?? []).map(serializeJsonLd),
  };

  if (meta.canonical !== undefined) head.canonical = meta.canonical;
  if (meta.robots !== undefined) head.robots = meta.robots;
  if (meta.keywords !== undefined) head.keywords = [...meta.keywords];

  if (meta.og !== undefined) {
    head.openGraph = {
      ...(meta.og.title !== undefined ? { title: meta.og.title } : {}),
      ...(meta.og.description !== undefined ? { description: meta.og.description } : {}),
      ...(meta.og.image !== undefined ? { image: meta.og.image } : {}),
      ...(meta.og.type !== undefined ? { type: meta.og.type } : {}),
    };
  }

  if (meta.twitter !== undefined) {
    head.twitter = {
      ...(meta.twitter.card !== undefined ? { card: meta.twitter.card } : {}),
      ...(meta.twitter.site !== undefined ? { site: meta.twitter.site } : {}),
    };
  }

  return head;
}
