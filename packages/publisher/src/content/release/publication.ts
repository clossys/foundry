import { createHash } from "node:crypto";
import { libraryHash, resolve } from "@clossys/designer/catalog";
import type { CompositeEngineInput } from "@clossys/designer/catalog";
import { createCopyResolver, computeCopyFingerprint } from "@clossys/writer";
import type { CopyRef, CopyRegistry } from "@clossys/writer";
import { projectRoutes, projectNavigation, projectCommands, projectBreadcrumbs, projectOutline, projectSitemap } from "../../content-map/index.js";
import { checkedContentMap } from "../../content-map/check.js";
import type { ContentMap, ContentMapRouteOptions } from "../../content-map/index.js";
import { isContentJson } from "../json.js";
import type { ContentWriterContext } from "../composition.js";

export interface PublicationConfigPin { readonly leaf: string; readonly config: string; readonly descriptorHash: string; readonly configHash: string; readonly sourceHash: string }
export interface PublicationCopyPin { readonly ref: CopyRef; readonly fingerprint: string }
/** Stored in CandidateContent.typeSettings.publication: the existing revision,
 * approval and review state machine owns these bytes. No parallel lifecycle. */
export interface PublicationSnapshot {
  readonly version: 1;
  readonly map: ContentMap;
  readonly bindings: ContentMapRouteOptions;
  readonly origin?: string;
  readonly libraryVersion: string;
  readonly configPins: readonly PublicationConfigPin[];
  /** Structural labels use map/... or bindings/... JSON paths; construct CopyRefs
   * use their actual logical reference identity. No audience literal is exempt. */
  readonly copyPins: Readonly<Record<string, PublicationCopyPin>>;
}
export interface PublicationWriter extends ContentWriterContext { readonly at: string }
export interface PublicationProducts {
  readonly routes: ReturnType<typeof projectRoutes>;
  readonly nav: Readonly<Record<string, ReturnType<typeof projectNavigation>>>;
  readonly cmdk: ReturnType<typeof projectCommands>;
  readonly breadcrumbs: Readonly<Record<string, ReturnType<typeof projectBreadcrumbs>>>;
  readonly outline: ReturnType<typeof projectOutline>;
  readonly sitemap: ReturnType<typeof projectSitemap>;
  /** Metadata only. This never claims a construct renderer/exporter capability. */
  readonly deckOutline: readonly { readonly entryId: string; readonly slot: string; readonly index: number; readonly section: string; readonly config: string; readonly key: string }[];
}
export interface CompiledPublication {
  readonly publicationId: string;
  /** Content identity before target number/owner/time exist; not a release ID. */
  readonly snapshotDigest: string;
  readonly products: PublicationProducts;
  readonly evidence: { readonly libraryVersion: string; readonly configs: readonly PublicationConfigPin[]; readonly copy: Readonly<Record<string, unknown>> };
}
export type ReleasedPublication = Omit<CompiledPublication, "products"> & { readonly products: { readonly [K in keyof PublicationProducts]: { readonly releaseDigest: string; readonly value: PublicationProducts[K] } } };
function fail(message: string): never { throw new TypeError(`publication: ${message}`); }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
export function publicationDigest(value: unknown): string {
  if (!isContentJson(value)) fail("finite JSON required");
  const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : object(v) ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
  return createHash("sha256").update(canonical(value)).digest("hex");
}
function immutable<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(immutable); Object.freeze(value); } return value; }
/** Operational config stability is a current exact provenance/config/source pin.
 * Designer has no config lifecycle status; this does not promote producer drafts. */
export function publicationLibraryPins(engine: CompositeEngineInput): { readonly version: string; readonly configs: readonly PublicationConfigPin[] } {
  const profile = resolve(engine);
  if (profile.check.findings.some(row => row.severity === "error")) fail("Designer provenance or library checks failed");
  const configs: PublicationConfigPin[] = [];
  for (const row of Object.values(profile.surfaces?.fills ?? {})) {
    const doc = row.document;
    for (const entries of [doc.sections, doc.frames]) for (const entry of Object.values(entries ?? {})) {
      const e = entry as unknown as Record<string, unknown>;
      const registered = object(e.configs) ? e.configs : { default: {} };
      for (const [config, value] of Object.entries(registered)) configs.push({ leaf: e.slot as string, config, descriptorHash: row.descriptorHash, configHash: publicationDigest(value), sourceHash: publicationDigest({ outputHash: row.outputHash, apiHash: row.apiHash, inputsHash: row.inputsHash }) });
    }
  }
  return immutable({ version: libraryHash(engine.library), configs: configs.sort((a,b) => a.leaf.localeCompare(b.leaf) || a.config.localeCompare(b.config)) });
}
/** Strict production compilation. No resolver callbacks, target switches, approval
 * booleans or auto-repinning are accepted. All results are local immutable data. */
export function compilePublication(snapshot: PublicationSnapshot, library: CompositeEngineInput, writer: PublicationWriter): CompiledPublication {
  if (!isContentJson(snapshot) || !object(snapshot) || snapshot.version !== 1 || Object.keys(snapshot).some(k => !["version","map","bindings","origin","libraryVersion","configPins","copyPins"].includes(k))) fail("invalid snapshot");
  if (!object(writer) || Object.keys(writer).some(k => !["registry","registries","manifest","timeZone","at"].includes(k)) || !Number.isFinite(Date.parse(writer.at))) fail("explicit production Writer context and time required");
  checkedContentMap(snapshot.map);
  const pins = publicationLibraryPins(library);
  if (snapshot.libraryVersion !== pins.version || snapshot.bindings.consumer !== library.library.source.id) fail("library version/consumer drift");
  if (!Array.isArray(snapshot.configPins) || !object(snapshot.copyPins)) fail("explicit copy and config pins required");
  const seenConfigs = new Set<string>(), usedConfigs = new Set<string>();
  for (const pin of snapshot.configPins) {
    const key = JSON.stringify([pin.leaf,pin.config]);
    if (seenConfigs.has(key) || !pins.configs.some(row => publicationDigest(row) === publicationDigest(pin))) fail("config provenance/pin drift");
    seenConfigs.add(key);
  }
  const resolver = createCopyResolver(writer.registry, { target: "production", now: new Date(writer.at), ...(writer.registries ? { registries: writer.registries } : {}), ...(writer.manifest ? { manifest: writer.manifest } : {}), timeZone: writer.timeZone ?? "UTC" });
  const usedCopy = new Set<string>(), evidence: Record<string, unknown> = {};
  function copy(key: string, literal?: string): void {
    const pin = snapshot.copyPins[key];
    if (!pin || Object.keys(pin).some(k => !["ref","fingerprint"].includes(k)) || !pin.ref.locale) fail(`copy pin required: ${key}`);
    const value = resolver(pin.ref);
    if (!value || !value.approval || value.approval.approvedBy !== "owner" || value.approval.pendingOwnerReview) fail(`approved Writer copy required: ${key}`);
    const registry = [writer.registry, ...(writer.registries ?? [])].find(row => row.id === value.recordId && row.revision === value.revision && row.locale === value.locale) as CopyRegistry | undefined;
    const entry = registry?.entries.find(row => row.id === value.entryId);
    if (!entry || entry.status !== "approved" || pin.fingerprint !== computeCopyFingerprint(entry.text) || (literal !== undefined && literal !== value.text)) fail(`copy fingerprint/value drift: ${key}`);
    usedCopy.add(key); evidence[key] = { pin, resolution: value, approval: entry.approval, status: entry.status };
  }
  function walk(value: unknown, path: string): void {
    if (Array.isArray(value)) { value.forEach((v,i) => walk(v, `${path}/${i}`)); return; }
    if (!object(value)) return;
    if (value.kind === "copy" && typeof value.ref === "string") copy(value.ref);
    if (typeof value.section === "string" && value.section.startsWith("sections.")) {
      const key = JSON.stringify([value.section, value.config ?? "default"]);
      if (!seenConfigs.has(key)) fail(`unregistered or unpinned config: ${key}`);
      usedConfigs.add(key);
    }
    // Native registered route frame selections are part of the same pin set.
    if (typeof value.leaf === "string" && value.leaf.startsWith("frames.")) {
      const key = JSON.stringify([value.leaf, value.config ?? "default"]);
      if (!seenConfigs.has(key)) fail(`unregistered or unpinned frame config: ${key}`);
      usedConfigs.add(key);
    }
    for (const [key,v] of Object.entries(value)) {
      if (["title","label","description"].includes(key) && typeof v === "string") copy(`${path}/${key}`, v);
      if (key === "keywords" && Array.isArray(v)) v.forEach((text,index) => copy(`${path}/${key}/${index}`, text));
      walk(v, `${path}/${key}`);
    }
  }
  walk(snapshot.map,"map"); walk(snapshot.bindings,"bindings");
  if (usedCopy.size !== Object.keys(snapshot.copyPins).length || usedConfigs.size !== snapshot.configPins.length) fail("unused pins are not publication evidence");
  const map = snapshot.map, pages = map.entries.filter(row => row.kind === "page" || row.kind === "section");
  const ordered = [...map.entries].sort((a,b) => a.order - b.order || a.id.localeCompare(b.id));
  const products: PublicationProducts = {
    routes: projectRoutes(map,snapshot.bindings), nav: Object.fromEntries(pages.map(row => [row.id,projectNavigation(map,row.id)])), cmdk: projectCommands(map), breadcrumbs: Object.fromEntries(pages.map(row => [row.id,projectBreadcrumbs(map,row.id)])), outline: projectOutline(map),
    sitemap: snapshot.bindings.channel === "site" ? projectSitemap(map,{ channel: "site", origin: snapshot.origin ?? fail("site origin required") }) : [],
    deckOutline: ordered.flatMap(row => Object.entries(row.constructs ?? {}).flatMap(([slot,fills]) => fills.map((fill,index) => ({ entryId: row.id,slot,index,section:fill.section,config:fill.config ?? "default",key: JSON.stringify([row.id,slot,index]) })))),
  };
  const proof = { libraryVersion: pins.version, configs: snapshot.configPins, copy: evidence };
  return immutable(structuredClone({ publicationId: map.publicationId, snapshotDigest: publicationDigest({ snapshot, evidence: proof, products }), products, evidence: proof }));
}
/** Stamp only after manifest hashing, avoiding a digest self-reference. */
export function stampPublication(value: CompiledPublication, releaseDigest: string): ReleasedPublication {
  return immutable({ ...value, products: Object.fromEntries(Object.entries(value.products).map(([key,product]) => [key,{ releaseDigest,value:product }])) as ReleasedPublication["products"] });
}
