/**
 * Verbatim adoption for every agent (R03.2, R03.4): the provenance logic lifted from the Designer's
 * `scripts/check-provenance.mjs` (lineage of a candidate against the reference manifest and the
 * provenance rule) and the seed lookup and file hashes of `scripts/check-ref-verbatim.mjs`. Both
 * scripts now call this module (through `@clossys/producer`, resolved lazily as slot-pins.mjs does);
 * the R03 checks call it for all agents. Dependency-free (node:crypto only), so a plain Node script
 * can import the built file.
 *
 * Manifest: `{ registries: {<id>: ...}, items: [{registry, name, version, hash, type, files: [{path, sha256}]}] }`.
 * Rule (provenance.json): `{ consumerAssets: {slots: [<glob>]}, interactiveBackdrops: {slots: [<glob>], components: [<id>]}, classes: [{slots, sourceTypes?, sourceItems?}] }`.
 */
import { createHash } from "node:crypto";

export interface ManifestFile { readonly path: string; readonly sha256: string }
export interface ManifestItem { readonly registry: string; readonly name: string; readonly version: string; readonly hash?: string; readonly type?: string; readonly files?: readonly ManifestFile[] }
export interface ReferenceManifest { readonly registries?: Readonly<Record<string, unknown>>; readonly items?: readonly ManifestItem[] }
export interface ProvenanceRule {
  readonly consumerAssets?: { readonly slots?: readonly string[] };
  /** Slots where an interactive backdrop descriptor may stand, and the Foundry components it may name (foundry-build-0048 A4). */
  readonly interactiveBackdrops?: { readonly slots?: readonly string[]; readonly components?: readonly string[] };
  readonly classes?: readonly { readonly slots: string; readonly sourceTypes?: readonly string[]; readonly sourceItems?: readonly string[] }[];
}
export interface Reference { readonly registry?: string; readonly item?: string; readonly version?: string; readonly hash?: string }
export interface Lineage {
  readonly slot?: string;
  readonly mode?: string;
  readonly source?: Reference;
  readonly parts?: readonly Reference[];
  readonly partsHashed?: boolean;
  readonly unresolved?: readonly unknown[];
  /** An interactive-backdrop lineage: the candidate's source kind and the Foundry component its descriptor names. */
  readonly backdrop?: { readonly kind?: unknown; readonly component?: unknown };
}

/**
 * The lineage mode of an interactive backdrop descriptor (meta.source.kind interactive-backdrop, or any
 * candidate carrying meta.backdrop): no library item version, but data naming a Foundry component.
 */
export const INTERACTIVE_BACKDROP_MODE = "interactive-backdrop";

export const globMatch = (pattern: string, slot: string): boolean => (pattern.endsWith("*") ? slot.startsWith(pattern.slice(0, -1)) : pattern === slot);

export const sha256 = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** The tree hash check-ref-verbatim records: sha256 of sorted `<sha256>  <path>\n` lines. */
export const treeHash = (files: readonly { path: string; sha256: string }[]): string =>
  `sha256:${sha256([...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map(file => `${file.sha256}  ${file.path}\n`).join(""))}`;

/** One reference (the source, or a part) against the manifest: trusted registry, listed item, same hash. Returns the manifest row. */
function referenceFindings(label: string, at: string, ref: Reference | undefined, manifest: ReferenceManifest, findings: string[], { hashed = true } = {}): ManifestItem | undefined {
  const fields: readonly (keyof Reference)[] = hashed ? ["registry", "item", "version", "hash"] : ["registry", "item", "version"];
  const missing = fields.filter(field => typeof ref?.[field] !== "string" || ref[field] === "");
  if (missing.length) { findings.push(...missing.map(field => `${label}: ${at} has no ${field}`)); return undefined; }
  const key = `${ref!.registry}/${ref!.item}@${ref!.version}`;
  if (!manifest.registries?.[ref!.registry!]) { findings.push(`${label}: ${key} is from ${ref!.registry}, which is not a trusted registry (references/manifest.json)`); return undefined; }
  const found = (manifest.items ?? []).find(row => row.registry === ref!.registry && row.name === ref!.item && row.version === ref!.version);
  if (!found) { findings.push(`${label}: ${key} is not in the references manifest`); return undefined; }
  if (hashed && found.hash !== ref!.hash) findings.push(`${label}: ${key} hash ${ref!.hash} != manifest ${found.hash}`);
  return found;
}

/** Findings for one item version's lineage against the rule and the manifest. */
export function lineageFindings(label: string, lineage: Lineage, { rule, manifest }: { rule: ProvenanceRule; manifest: ReferenceManifest }): string[] {
  const findings: string[] = [];
  const { slot, mode, source } = lineage;
  const asset = (rule.consumerAssets?.slots ?? []).some(pattern => globMatch(pattern, slot ?? ""));
  if (mode === INTERACTIVE_BACKDROP_MODE) {
    const kind = lineage.backdrop?.kind;
    const component = lineage.backdrop?.component;
    if (kind !== INTERACTIVE_BACKDROP_MODE) return [`${label}: carries meta.backdrop but meta.source.kind is ${JSON.stringify(kind ?? null)}: only an ${INTERACTIVE_BACKDROP_MODE} candidate is a descriptor; every other kind stays under the verbatim rule`];
    if (!(rule.interactiveBackdrops?.slots ?? []).some(pattern => globMatch(pattern, slot ?? ""))) return [`${label}: interactive backdrop in ${slot}, which is not an interactiveBackdrops slot of the provenance rule`];
    if (typeof component !== "string" || !(rule.interactiveBackdrops?.components ?? []).includes(component)) return [`${label}: meta.backdrop.component ${JSON.stringify(component ?? null)} is not one of the Foundry interactive backdrop components (${(rule.interactiveBackdrops?.components ?? []).join(", ")})`];
    return findings;
  }
  if (mode === "original") {
    if (!asset) findings.push(`${label}: original item in ${slot}, which is not a consumer-asset slot; adopt or customize a trusted reference, or raise a NEED`);
    return findings;
  }
  if (mode !== "verbatim" && mode !== "customized") return [`${label}: lineage.mode ${JSON.stringify(mode)} is not verbatim, customized or original`];
  for (const ref of lineage.unresolved ?? []) findings.push(`${label}: lineage cites ${typeof ref === "string" ? ref : JSON.stringify(ref)}, which is not a reference-manifest row id (<registry>/<item>@<version>)`);
  if (!source) return [...findings, `${label}: ${mode} item has no lineage.source`];
  const found = referenceFindings(label, "lineage.source", source, manifest, findings);
  if (!found) return findings;
  for (const [index, part] of (lineage.parts ?? []).entries()) referenceFindings(label, `lineage.parts[${index}]`, part, manifest, findings, { hashed: lineage.partsHashed !== false || typeof part?.hash === "string" });
  const cls = (rule.classes ?? []).find(row => globMatch(row.slots, slot ?? ""));
  if (cls) {
    const typed = (cls.sourceTypes ?? []).includes(found.type ?? "");
    const named = (cls.sourceItems ?? []).includes(`${source.registry}/${source.item}`);
    if (!typed && !named) findings.push(`${label}: ${slot} must come from ${[...(cls.sourceTypes ?? []), ...(cls.sourceItems ?? [])].join(" or ")}; ${source.registry}/${source.item}@${source.version} is ${found.type}`);
  }
  return findings;
}

/** One `source.ref` entry as a reference-manifest row id, `<registry>/<item>@<version>`; anything else is null (unresolved). */
export function parseRef(ref: unknown): { registry: string; item: string; version: string } | null {
  if (typeof ref !== "string") return null;
  const m = /^([^/@{}\s]+)\/([^@{}\s]+)@([^@{}\s]+)$/.exec(ref);
  return m ? { registry: m[1]!, item: m[2]!, version: m[3]! } : null;
}

/** `source.ref` entries that all name the consumer's own Designer asset slots (`clossys/agents/designer/assets.<slot>[/candidates/<file>.json]`). */
export const CONSUMER_ASSET_REF = /^clossys\/agents\/designer\/assets\.[a-z0-9-]+(?:\/candidates\/[a-z0-9-]+-v[1-9][0-9]*\.json)?$/;
export const consumerOwnDerivation = (refs: unknown): boolean => Array.isArray(refs) && refs.length > 0 && refs.every(ref => typeof ref === "string" && CONSUMER_ASSET_REF.test(ref));

type Item = { meta?: { source?: { kind?: unknown; ref?: unknown; hash?: unknown }; backdrop?: unknown } } | null | undefined;

/**
 * Lineage of one Designer candidate (registry item): `original` stays original, `registry` is a
 * verbatim adoption, `derived` is customized; the first reference is the source, the rest are parts.
 * `composition` and `npm` candidates cite pinned slots or an npm package, not a registry item, and
 * are verified by check-ref-verbatim: null here. An interactive backdrop (the kind, or any candidate
 * carrying meta.backdrop) is a descriptor over a Foundry component: its lineage names the kind and
 * the component, which lineageFindings checks against the rule's interactiveBackdrops.
 */
export function candidateLineage(slot: string, item: Item): Lineage | null {
  const source = item?.meta?.source ?? {};
  const meta = item?.meta;
  if (source.kind === INTERACTIVE_BACKDROP_MODE || (!!meta && typeof meta === "object" && Object.hasOwn(meta, "backdrop"))) {
    const backdrop = meta?.backdrop;
    const component = backdrop && typeof backdrop === "object" && !Array.isArray(backdrop) ? (backdrop as { component?: unknown }).component : undefined;
    return { slot, mode: INTERACTIVE_BACKDROP_MODE, backdrop: { kind: source.kind, component } };
  }
  if (source.kind === "original") return { slot, mode: "original" };
  if (source.kind === "composition" || source.kind === "npm") return null;
  // Derived only from the consumer's own Designer asset slots: the consumer's own artwork, an original.
  if (source.kind === "derived" && consumerOwnDerivation(source.ref)) return { slot, mode: "original" };
  const mode = source.kind === "registry" ? "verbatim" : source.kind === "derived" ? "customized" : source.kind as string | undefined;
  // Lineage cites reference-manifest row ids (and the consumer's own asset slots) only; anything else is unresolved.
  const cited: unknown[] = Array.isArray(source.ref) ? source.ref : [];
  const unresolved = cited.filter(ref => !parseRef(ref) && !(typeof ref === "string" && CONSUMER_ASSET_REF.test(ref)));
  const [first, ...parts] = cited.map(parseRef).filter((ref): ref is NonNullable<ReturnType<typeof parseRef>> => !!ref);
  // `source.hash` is the first reference's manifest hash; a further ref is a part named by registry, item and version.
  const ref = first ? { ...first, hash: typeof source.hash === "string" ? source.hash : undefined } as Reference : undefined;
  return { slot, ...(mode !== undefined ? { mode } : {}), ...(ref ? { source: ref } : {}), parts, partsHashed: false, unresolved };
}

/** The manifest item a candidate's `source.ref` names (the seed), as check-ref-verbatim finds it. */
export function seedItem(manifest: ReferenceManifest, refs: unknown): ManifestItem | undefined {
  const list = Array.isArray(refs) ? refs : typeof refs === "string" ? [refs] : [];
  return (manifest.items ?? []).find(row => list.includes(`${row.registry}/${row.name}@${row.version}`));
}

/**
 * Byte-exact seed files (R03.4): every `meta.refVerbatim.files` mapping `{<payload path>: <reference
 * path>}` names a seed file whose manifest sha256 equals the candidate file's bytes. A payload file
 * the mapping does not name is an added file (a variant or wrapper composing the seed), allowed.
 */
export function verbatimFindings(label: string, item: unknown, manifest: ReferenceManifest): string[] {
  const doc = item && typeof item === "object" ? item as { files?: unknown; meta?: { source?: { ref?: unknown }; refVerbatim?: { files?: unknown } } } : {};
  const mapping = doc.meta?.refVerbatim?.files;
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping) || !Object.keys(mapping).length) return [`${label}: adopts a seed but meta.refVerbatim.files maps no file to it`];
  const seed = seedItem(manifest, doc.meta?.source?.ref);
  if (!seed) return [`${label}: source.ref names no reference-manifest item`];
  const files = new Map((Array.isArray(doc.files) ? doc.files : []).filter((file): file is { path: string; content: string } => !!file && typeof file.path === "string" && typeof file.content === "string").map(file => [file.path, file.content]));
  const seedFiles = new Map((seed.files ?? []).map(file => [file.path, file.sha256]));
  const findings: string[] = [];
  for (const [payload, reference] of Object.entries(mapping as Record<string, unknown>)) {
    const content = files.get(payload);
    if (content === undefined) { findings.push(`${label}: maps ${payload}, which the candidate does not ship`); continue; }
    const want = typeof reference === "string" ? seedFiles.get(reference) : undefined;
    if (!want) { findings.push(`${label}: maps ${payload} to ${String(reference)}, which ${seed.registry}/${seed.name}@${seed.version} does not list`); continue; }
    if (sha256(content) !== want) findings.push(`${label}: ${payload} is not byte-exact to ${seed.registry}/${seed.name}@${seed.version} ${reference as string}`);
  }
  return findings;
}
