/**
 * Publisher "specimen" format: a one-slot page that renders exactly one element record.
 *
 * These types are the renderer's own minimal view of an element record. The full record
 * schema is owned elsewhere; it reaches the renderer only through `SpecimenRecordSource`
 * (see `source.ts`), so a schema change touches one adapter, not the renderer.
 */

/** Which specimen renderer a record uses. Data, media and flow render a stub for now. */
export const SPECIMEN_KINDS = ["visual", "text", "data", "media", "flow"] as const;
export type SpecimenKind = typeof SPECIMEN_KINDS[number];

/** Where the element sits inside the specimen page. */
export const SPECIMEN_CONTAINERS = ["canvas", "section-in-frame", "page"] as const;
export type SpecimenContainer = typeof SPECIMEN_CONTAINERS[number];

/** Text roles the text specimen sets with the theme's typography. */
export const SPECIMEN_TEXT_ROLES = ["display", "heading", "subheading", "body", "label", "caption"] as const;
export type SpecimenTextRole = typeof SPECIMEN_TEXT_ROLES[number];

/** One piece of copy and the limits of the slot it fills. */
export interface SpecimenCopy {
  readonly text: string;
  readonly role?: SpecimenTextRole;
  readonly maxChars?: number;
  readonly maxLines?: number;
}

/** The record's `preview.json`, as the renderer reads it. */
export interface SpecimenPreview {
  /** Props passed to a visual element. `{ "$copy": "<key>" }` resolves to that copy's text. */
  readonly fixtures?: Readonly<Record<string, unknown>>;
  /** Sample or pinned copy, keyed by copy key. */
  readonly copy?: Readonly<Record<string, SpecimenCopy>>;
  readonly container?: SpecimenContainer;
  /** Default theme id, used when the URL asks only for `light` or `dark`. */
  readonly theme?: string;
  /** Default width in CSS pixels. */
  readonly width?: number;
  /** Visual only: the payload file to mount (registry `path`) and its export name. */
  readonly entry?: string;
  readonly export?: string;
}

/** One file of a payload, in shadcn registry-item form (`files[]`). */
export interface SpecimenFile {
  readonly path: string;
  readonly content: string;
  readonly type?: string;
}

/** The renderer's minimal element record: id, version, kind, payload, preview. */
export interface SpecimenRecord {
  readonly id: string;
  readonly version: number;
  readonly kind: SpecimenKind;
  /** The payload: shadcn registry-item files for code, or the cell text for copy. */
  readonly payload: { readonly path: string; readonly files: readonly SpecimenFile[]; readonly raw: string };
  readonly preview: SpecimenPreview;
  /** sha256 of the record's own files (element.json, preview.json, payload). */
  readonly contentHash: string;
}

/** A theme as shadcn's registry `cssVars`: variables by shadcn name, without the leading `--`. */
export interface SpecimenTheme {
  readonly id: string;
  readonly theme?: Readonly<Record<string, string>>;
  readonly light: Readonly<Record<string, string>>;
  readonly dark?: Readonly<Record<string, string>>;
  readonly contentHash: string;
}

/** The one adapter between a record store and the renderer. */
export interface SpecimenRecordSource {
  /** One record; the highest version when `version` is omitted. */
  read(id: string, version?: number): Promise<SpecimenRecord | undefined>;
  /** A theme by id; the source's default theme when `id` is omitted. */
  theme(id?: string): Promise<SpecimenTheme | undefined>;
}

/** Parsed `/__specimen` query. */
export interface SpecimenQuery {
  readonly element: string;
  readonly version?: number;
  /** `light`, `dark`, `<theme-id>`, or `<theme-id>:light|dark`. */
  readonly theme?: string;
  readonly width?: number;
}
