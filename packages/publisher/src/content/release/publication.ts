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
import { checkConsumerPageConfig } from "../../web/pages/consumer-page-contract.js";
import type { ConsumerPageConfig } from "../../web/pages/consumer-page-contract.js";
import { isRegisteredContentRef } from "../../core/instance-binding.js";
import type { PublicationBinding, SectionFill } from "../../core/instance-binding.js";
import { isRegionPageRouteRegistration, normalizeRegionPageRoute, routeSourcePath } from "../../core/route-identities.js";
import type { RegionPageRouteRegistry } from "../../core/route-registry.js";
import { getEffectiveLayoutContract, getLayoutLeaf } from "../../layouts/index.js";

export interface PublicationConfigPin { readonly leaf: string; readonly config: string | null; readonly descriptorHash: string; readonly configHash: string; readonly sourceHash: string }
export interface PublicationCopyPin { readonly ref: CopyRef; readonly fingerprint: string }
/** Stored in CandidateContent.typeSettings.publication: the existing revision,
 * approval and review state machine owns these bytes. No parallel lifecycle. */
export interface PublicationSnapshot {
  readonly version: 1;
  readonly map: ContentMap;
  readonly bindings: ContentMapRouteOptions;
  readonly pageConfigs?: readonly ConsumerPageConfig[];
  readonly publication?: PublicationBinding;
  readonly layoutPin?: { readonly leaf: string; readonly config: string; readonly hash: string };
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
  readonly deckOutline: readonly { readonly entryId: string; readonly slot: string; readonly index: number; readonly section: string; readonly config: string | null; readonly key: string }[];
}
export interface CompiledPublication {
  readonly publicationId: string;
  /** Content identity before target number/owner/time exist; not a release ID. */
  readonly snapshotDigest: string;
  /** Historical authority is this complete revision snapshot, never mutable producer data. */
  readonly snapshot: PublicationSnapshot;
  readonly products: PublicationProducts;
  readonly evidence: { readonly libraryVersion: string; readonly configs: readonly PublicationConfigPin[]; readonly copy: Readonly<Record<string, unknown>>; readonly at: string; readonly timeZone: string; readonly layout?: PublicationSnapshot["layoutPin"] };
}
export type ReleasedPublication = Omit<CompiledPublication, "products"> & { readonly products: { readonly [K in keyof PublicationProducts]: { readonly releaseDigest: string; readonly value: PublicationProducts[K] } } };
function fail(message: string): never { throw new TypeError(`publication: ${message}`); }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function exact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean { return required.every(k => Object.hasOwn(value,k)) && Object.keys(value).every(k => required.includes(k) || optional.includes(k)); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim() === value && !!value; }
const HASH = /^[a-f0-9]{64}$/;
function assertSnapshot(value: unknown): asserts value is PublicationSnapshot {
  if (!isContentJson(value) || !object(value) || value.version !== 1 || !exact(value,["version","map","bindings","libraryVersion","configPins","copyPins"],["origin","pageConfigs","publication","layoutPin"]) || !text(value.libraryVersion) || !object(value.bindings) || !exact(value.bindings,["consumer","channel","brand"],["completeRoutes","planItems","registrations"]) || !Array.isArray(value.configPins) || !object(value.copyPins)) fail("invalid publication snapshot schema");
  checkedContentMap(value.map as unknown as ContentMap);
  const configIds = new Set<string>();
  for (const pin of value.configPins) {
    if (!object(pin) || !exact(pin,["leaf","config","descriptorHash","configHash","sourceHash"]) || !text(pin.leaf) || !/^(sections|frames)\./.test(pin.leaf) || pin.config !== null && !text(pin.config) || typeof pin.configHash !== "string" || !HASH.test(pin.configHash) || typeof pin.sourceHash !== "string" || !HASH.test(pin.sourceHash) || typeof pin.descriptorHash !== "string" || !/^(sha256:)?[a-f0-9]{64}$/.test(pin.descriptorHash)) fail("invalid config pin schema");
    const key = JSON.stringify([pin.leaf,pin.config]); if (configIds.has(key)) fail("duplicate config pin"); configIds.add(key);
  }
  for (const pin of Object.values(value.copyPins)) if (!object(pin) || !exact(pin,["ref","fingerprint"]) || !object(pin.ref) || !exact(pin.ref,["id","locale"],["values"]) || !text(pin.ref.id) || !text(pin.ref.locale) || typeof pin.fingerprint !== "string" || !HASH.test(pin.fingerprint)) fail("invalid Writer copy pin schema");
  const configs = value.pageConfigs ?? [];
  if (!Array.isArray(configs) || configs.some(config => checkConsumerPageConfig(config).length)) fail("invalid consumer config schema");
  if ((value.map as unknown as ContentMap).entries.some(entry => entry.pageConfig !== undefined && !configs.some(config => config.id === entry.pageConfig))) fail("missing referenced consumer page config");
  if (Object.hasOwn(value,"publication") !== Object.hasOwn(value,"layoutPin") || value.layoutPin !== undefined && (!object(value.layoutPin) || !exact(value.layoutPin,["leaf","config","hash"]) || !text(value.layoutPin.leaf) || !text(value.layoutPin.config) || typeof value.layoutPin.hash !== "string" || !HASH.test(value.layoutPin.hash))) fail("publication requires an exact layout contract pin");
}

/** Pin existing package-owned layout contract/config bytes without promoting lifecycle. */
export function publicationLayoutPin(publication: PublicationBinding): NonNullable<PublicationSnapshot["layoutPin"]> {
  const leaf = getLayoutLeaf(publication.layout.leaf), effective = getEffectiveLayoutContract(publication.layout.leaf,publication.layout.config,publication.layout.members);
  return {leaf:publication.layout.leaf,config:publication.layout.config,hash:publicationDigest({leaf,effective})};
}
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
      const registered = object(e.configs) ? e.configs : {};
      configs.push({leaf:e.slot as string,config:null,descriptorHash:row.descriptorHash,configHash:publicationDigest({members:[],props:[]}),sourceHash:publicationDigest({outputHash:row.outputHash,apiHash:row.apiHash,inputsHash:row.inputsHash})});
      for (const [config, value] of Object.entries(registered)) configs.push({ leaf: e.slot as string, config, descriptorHash: row.descriptorHash, configHash: publicationDigest(value), sourceHash: publicationDigest({ outputHash: row.outputHash, apiHash: row.apiHash, inputsHash: row.inputsHash }) });
    }
  }
  return immutable({ version: libraryHash(engine.library), configs: configs.sort((a,b) => a.leaf.localeCompare(b.leaf) || String(a.config).localeCompare(String(b.config))) });
}
function deckOutline(map: ContentMap): PublicationProducts["deckOutline"] {
  return [...map.entries].sort((a,b) => a.order-b.order || a.id.localeCompare(b.id)).flatMap(row => Object.entries(row.constructs ?? {}).flatMap(([slot,fills]) => fills.map((fill,index) => ({entryId:row.id,slot,index,section:fill.section,config:fill.config ?? null,key:JSON.stringify([row.id,slot,index])}))));
}

/** Strict production compilation. No resolver callbacks, target switches, approval
 * booleans or auto-repinning are accepted. All results are local immutable data. */
export function compilePublication(snapshot: PublicationSnapshot, library: CompositeEngineInput, writer: PublicationWriter): CompiledPublication {
  assertSnapshot(snapshot);
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
  function copy(key: string, literal?: string, requested?: CopyRef): void {
    const pin = snapshot.copyPins[key];
    if (!pin || Object.keys(pin).some(k => !["ref","fingerprint"].includes(k)) || !pin.ref.locale) fail(`copy pin required: ${key}`);
    if (requested && (requested.id !== pin.ref.id || requested.locale !== undefined && requested.locale !== pin.ref.locale || publicationDigest(requested.values ?? {}) !== publicationDigest(pin.ref.values ?? {}))) fail(`copy pin differs from authored Writer reference: ${key}`);
    const value = resolver(pin.ref);
    if (!value || !value.approval || value.approval.approvedBy !== "owner" || value.approval.pendingOwnerReview) fail(`approved Writer copy required: ${key}`);
    const registry = [writer.registry, ...(writer.registries ?? [])].find(row => row.id === value.recordId && row.revision === value.revision && row.locale === value.locale) as CopyRegistry | undefined;
    const entry = registry?.entries.find(row => row.id === value.entryId);
    if (!entry || entry.status !== "approved" || pin.fingerprint !== computeCopyFingerprint(entry.text) || (literal !== undefined && literal !== value.text)) fail(`copy fingerprint/value drift: ${key}`);
    usedCopy.add(key); evidence[key] = { pin, resolution: value, entry };
  }
  const slots = library.catalog.surfaces?.slots ?? [];
  function selection(value: Record<string, unknown>, requireContent: boolean): void {
    const leaf = value.section as string, slot = slots.find(row => row.id === leaf);
    if (!slot || slot.layer !== "sections") fail(`unknown native Section: ${leaf}`);
    const contract = slot.contract;
    if (object(value.members) && Object.entries(value.members).some(([axis,member]) => !contract.members.names.includes(`${axis}.${member}`))) fail("unknown native Section member");
    if (requireContent) {
      if (!object(value.content)) fail("Section content required");
      for (const part of contract.slots) if (part.required && !Object.hasOwn(value.content,part.name)) fail(`missing native content slot: ${part.name}`);
      for (const [key,ref] of Object.entries(value.content)) if (!isRegisteredContentRef(ref) || !contract.slots.some(part => part.name === key && part.type === ref.kind)) fail("unknown native content slot or reference kind");
    }
  }
  function walk(value: unknown, path: string): void {
    if (Array.isArray(value)) { value.forEach((v,i) => walk(v, `${path}/${i}`)); return; }
    if (!object(value)) return;
    if (value.kind === "copy" && typeof value.ref === "string") { if (!isRegisteredContentRef(value)) fail("malformed copy ContentRef"); copy(value.ref); }
    // Consumer configs carry real Writer IDs, unlike logical runtime ContentRefs.
    if (typeof value.id === "string" && !Object.keys(value).some(k => !["id","locale","values"].includes(k))) { copy(path,undefined,value as unknown as CopyRef); return; }
    if (typeof value.section === "string" && value.section.startsWith("sections.")) {
      const key = JSON.stringify([value.section, value.config ?? null]);
      if (!seenConfigs.has(key)) fail(`unregistered or unpinned config: ${key}`);
      usedConfigs.add(key);
      selection(value,Object.hasOwn(value,"content"));
    }
    // Native registered route frame selections are part of the same pin set.
    if (typeof value.leaf === "string" && value.leaf.startsWith("frames.")) {
      const key = JSON.stringify([value.leaf, value.config ?? null]);
      if (!seenConfigs.has(key)) fail(`unregistered or unpinned frame config: ${key}`);
      usedConfigs.add(key);
    }
    for (const [key,v] of Object.entries(value)) {
      if (["title","label","description","group"].includes(key) && typeof v === "string") copy(`${path}/${key}`, v);
      if (key === "keywords" && Array.isArray(v)) v.forEach((text,index) => copy(`${path}/${key}/${index}`, text));
      walk(v, `${path}/${key}`);
    }
  }
  const configs = snapshot.pageConfigs ?? [];
  if (!Array.isArray(configs) || new Set(configs.map(row => row.id)).size !== configs.length || new Set(configs.map(row => row.namespace)).size !== configs.length) fail("unique consumer configs required");
  for (const [index,rawConfig] of configs.entries()) {
    const config = rawConfig as ConsumerPageConfig;
    if (checkConsumerPageConfig(config).length) fail("invalid consumer page config");
    const entries = snapshot.map.entries.filter(row => row.pageConfig === config.id);
    if (entries.length !== (config.item ? 2 : 1) || !entries.some(row => row.id === config.entryId) || config.item && !entries.some(row => row.id === config.item!.entryId)) fail("orphan/mismatched consumer config");
    copy(`pageConfigs/${index}/title`,entries.find(row => row.id === config.entryId)!.title,config.title);
    for (const entry of entries) {
      if (!entry.manifest || !entry.constructs) fail("consumer page requires native manifest and constructs");
      const fills = entry.constructs.main ?? [];
      const styles = [config.levels.l0.header,config.levels.l0.empty,config.levels.l1.band,config.levels.l1.header,config.levels.l2.table,...(config.item?.sections.map(row => row.fill) ?? [])].filter(Boolean);
      const checkStyles = (values: readonly SectionFill[]): void => values.forEach(fill => {
        if (!styles.some(style => style && style.section === fill.section && (style.config ?? null) === (fill.config ?? null) && publicationDigest(style.members ?? {}) === publicationDigest(fill.members ?? {}))) fail("consumer config and native construct selection disagree");
        checkStyles(fill.children ?? []);
      });
      checkStyles(fills);
      if (entry.id === config.item?.entryId && publicationDigest(fills.slice(1)) !== publicationDigest(config.item.sections.map(row => row.fill))) fail("consumer item construct bytes disagree");
    }
  }
  if (snapshot.map.entries.some(row => row.pageConfig !== undefined && !configs.some(config => config.id === row.pageConfig))) fail("missing consumer config bytes");
  const registrations = snapshot.bindings.registrations ?? [];
  if (snapshot.publication) {
    if (publicationDigest(publicationLayoutPin(snapshot.publication)) !== publicationDigest(snapshot.layoutPin)) fail("layout contract/config pin drift");
    if (getLayoutLeaf(snapshot.publication.layout.leaf)?.status !== "stable") fail("production publication requires a stable Publisher layout; draft/held layouts are not promoted");
  }
  for (const route of registrations) {
    if (!isRegionPageRouteRegistration(route)) fail("legacy assembly registration requires runtime qualification; use consumer region pages or complete source metadata");
    const registry = { version: 1, consumer: snapshot.bindings.consumer, publication: snapshot.publication, routes: registrations } as unknown as RegionPageRouteRegistry;
    const lowered = normalizeRegionPageRoute(registry,route), binding = lowered.composition.binding;
    if (!binding.layout) fail("registered region layout required");
    const layout = getEffectiveLayoutContract(binding.layout.leaf,binding.layout.config,binding.layout.members);
    if (!layout.slots.some(slot => slot.id === snapshot.publication?.mainSlot)) fail("publication main slot not in selected layout");
    const entry = snapshot.map.entries.find(row => row.id === route.routeId);
    if (!entry?.pageConfig || publicationDigest(entry.constructs?.main) !== publicationDigest(route.composition.binding.regions.main)) fail("region binding differs from consumer map constructs");
    for (const source of [route.entry,route.composition.source,route.composition.runtime]) if (!source || !exact(source as unknown as Record<string,unknown>,["file","export"]) || !routeSourcePath(source.file) || !/^[A-Za-z_$][\w$]*$/.test(source.export)) fail("invalid registered source export");
    for (const [slotName,fills] of Object.entries(binding.fills)) {
      const slot = layout.slots.find(row => row.id === slotName);
      if (!slot || fills.some(fill => !slot.accepts.includes(fill.section))) fail("Section outside selected layout slot contract");
    }
    // Canonical map validation covers every nested SectionFill/ref grammar.
    checkedContentMap({ ...snapshot.map, entries: [{ ...Object.fromEntries(Object.entries(entry).filter(([key]) => !["parentId","pageConfig","pin"].includes(key))), manifest: { l0: [] }, constructs: { ...binding.fills, ...Object.fromEntries(Object.entries(binding.frame.slotFills ?? {}).map(([key,value]) => [key,[value]])) } }] } as unknown as ContentMap);
  }
  walk(snapshot.map,"map"); walk(snapshot.bindings,"bindings"); walk(configs,"pageConfigs"); if (snapshot.publication) walk(snapshot.publication,"publication");
  // Root-page command groups display publicationId as their fallback label.
  if (snapshot.map.entries.some(row => (row.kind === "page" || row.kind === "section") && !row.parentId)) copy("map/publicationId",snapshot.map.publicationId);
  if (usedCopy.size !== Object.keys(snapshot.copyPins).length || usedConfigs.size !== snapshot.configPins.length) fail("unused pins are not publication evidence");
  const map = snapshot.map, pages = map.entries.filter(row => row.kind === "page" || row.kind === "section");
  const products: PublicationProducts = {
    routes: projectRoutes(map,snapshot.bindings), nav: Object.fromEntries(pages.map(row => [row.id,projectNavigation(map,row.id)])), cmdk: projectCommands(map), breadcrumbs: Object.fromEntries(pages.map(row => [row.id,projectBreadcrumbs(map,row.id)])), outline: projectOutline(map),
    sitemap: snapshot.bindings.channel === "site" ? projectSitemap(map,{ channel: "site", origin: snapshot.origin ?? fail("site origin required") }) : [],
    deckOutline: deckOutline(map),
  };
  const proof = { libraryVersion: pins.version, configs: snapshot.configPins, copy: evidence, at:writer.at, timeZone:writer.timeZone ?? "UTC", ...(snapshot.layoutPin ? {layout:snapshot.layoutPin} : {}) };
  return immutable(structuredClone({ publicationId: map.publicationId, snapshotDigest: publicationDigest({ snapshot, evidence: proof, products }), snapshot, products, evidence: proof }));
}
/** Stamp only after manifest hashing, avoiding a digest self-reference. */
export function stampPublication(value: CompiledPublication, releaseDigest: string): ReleasedPublication {
  if (!HASH.test(releaseDigest)) fail("invalid release digest");
  return immutable({ ...value, products: Object.fromEntries(Object.entries(value.products).map(([key,product]) => [key,{ releaseDigest,value:product }])) as ReleasedPublication["products"] });
}

/** Validate immutable historical compilation without consulting today's mutable libraries. */
export function assertCompiledPublication(value: unknown): asserts value is CompiledPublication {
  if (!isContentJson(value) || !object(value) || !exact(value,["publicationId","snapshotDigest","snapshot","products","evidence"]) || !text(value.publicationId) || typeof value.snapshotDigest !== "string" || !HASH.test(value.snapshotDigest) || !object(value.snapshot) || !object(value.products) || !object(value.evidence)) fail("malformed historical compilation");
  const snapshot = value.snapshot as unknown as PublicationSnapshot;
  assertSnapshot(snapshot);
  if (snapshot.map.publicationId !== value.publicationId || !exact(value.products,["routes","nav","cmdk","breadcrumbs","outline","sitemap","deckOutline"]) || !exact(value.evidence,["libraryVersion","configs","copy","at","timeZone"],["layout"]) || value.evidence.libraryVersion !== snapshot.libraryVersion || !Array.isArray(value.evidence.configs) || !object(value.evidence.copy) || typeof value.evidence.at !== "string" || !Number.isFinite(Date.parse(value.evidence.at)) || !text(value.evidence.timeZone)) fail("historical publication identity/products/evidence malformed");
  if (Object.hasOwn(value.evidence,"layout") !== Object.hasOwn(snapshot,"layoutPin") || snapshot.layoutPin && publicationDigest(snapshot.layoutPin) !== publicationDigest(value.evidence.layout)) fail("historical layout pin differs");
  if (publicationDigest({ snapshot,evidence:value.evidence,products:value.products }) !== value.snapshotDigest) fail("historical snapshot digest mismatch");
  if (publicationDigest(projectRoutes(snapshot.map,snapshot.bindings)) !== publicationDigest(value.products.routes) || publicationDigest(projectCommands(snapshot.map)) !== publicationDigest(value.products.cmdk) || publicationDigest(projectOutline(snapshot.map)) !== publicationDigest(value.products.outline)) fail("historical projection differs from snapshot");
  const pages = snapshot.map.entries.filter(row => row.kind === "page" || row.kind === "section");
  if (publicationDigest(Object.fromEntries(pages.map(row => [row.id,projectNavigation(snapshot.map,row.id)]))) !== publicationDigest(value.products.nav) || publicationDigest(Object.fromEntries(pages.map(row => [row.id,projectBreadcrumbs(snapshot.map,row.id)]))) !== publicationDigest(value.products.breadcrumbs)) fail("historical navigation differs");
  const site = snapshot.bindings.channel === "site" ? projectSitemap(snapshot.map,{channel:"site",origin:snapshot.origin!}) : [];
  if (publicationDigest(site) !== publicationDigest(value.products.sitemap) || publicationDigest(deckOutline(snapshot.map)) !== publicationDigest(value.products.deckOutline)) fail("historical sitemap/deck outline malformed");
  if (publicationDigest(snapshot.configPins) !== publicationDigest(value.evidence.configs) || publicationDigest(Object.keys(snapshot.copyPins).sort()) !== publicationDigest(Object.keys(value.evidence.copy).sort())) fail("historical pin evidence differs");
  for (const [key,proof] of Object.entries(value.evidence.copy)) {
    if (!object(proof) || !exact(proof,["pin","resolution","entry"]) || !object(proof.entry) || !object(proof.entry.approval) || proof.entry.status !== "approved" || proof.entry.approval.approvedBy !== "owner" || proof.entry.approval.pendingOwnerReview || typeof proof.entry.text !== "string" || publicationDigest(proof.pin) !== publicationDigest(snapshot.copyPins[key]) || snapshot.copyPins[key]!.fingerprint !== computeCopyFingerprint(proof.entry.text) || proof.entry.approval.textFingerprint !== snapshot.copyPins[key]!.fingerprint || !object(proof.resolution)) fail("historical copy evidence malformed");
    const resolution = proof.resolution;
    if (!exact(resolution,["ref","text","recordId","revision","locale","source","entryId"],["servedLocale","chain","approval"]) || !text(resolution.recordId) || !text(resolution.revision) || !text(resolution.locale) || !object(resolution.source) || proof.entry.id !== resolution.entryId || publicationDigest(resolution.ref) !== publicationDigest(snapshot.copyPins[key]!.ref)) fail("historical resolution identity malformed");
    const registry = { id:resolution.recordId,revision:resolution.revision,locale:resolution.servedLocale ?? resolution.locale,source:resolution.source,entries:[proof.entry] } as unknown as CopyRegistry;
    const resolved = createCopyResolver(registry,{target:"production",now:new Date(value.evidence.at as string),timeZone:value.evidence.timeZone as string})(snapshot.copyPins[key]!.ref);
    if (!resolved || resolved.text !== resolution.text || resolved.entryId !== resolution.entryId || publicationDigest(resolved.approval) !== publicationDigest(resolution.approval)) fail("historical canonical copy proof refused");
  }
}
