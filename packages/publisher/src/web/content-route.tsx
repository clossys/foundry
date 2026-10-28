import { Fragment, createElement } from "react";
import { createCopyResolver } from "@clossys/writer";
import type { ReactElement } from "react";
import { AuthFrame } from "@clossys/designer/frames";
import { EmptyState, LogoHero, SectionHeader } from "@clossys/designer/blocks/server";
import { PAGE_META_KEY, resolveCopy, validateCopyFields } from "../content/composition.js";
import type { CompositionSection, CopyFinding, CopyResolutionReport, ResolveCopyOptions } from "../content/composition.js";
import { isContentJson } from "../content/json.js";
import { validateConsumerLibrarySnapshots } from "../content/library.js";
import { checkPageMetadata, robotsFor } from "../content/metadata.js";
import { selectContentRoute } from "./content-route-binding.js";
import type { ContentRouteInput, ContentRouteMetadata, ContentRouteNeed, PreparedContentRoute } from "./content-route-types.js";

export { bindContentRoute } from "./content-route-binding.js";
export type * from "./content-route-types.js";

/** Missing design or Writer inputs prevent the complete route from rendering. */
export class ContentRouteNeedsError extends Error {
  readonly needs: readonly ContentRouteNeed[];

  constructor(needs: readonly ContentRouteNeed[]) {
    super(needs.map(need => need.detail).join("; "));
    this.name = "ContentRouteNeedsError";
    this.needs = needs;
  }
}

/** Resolve one active content route using closed adapters for actual Designer exports. */
export function prepareContentRoute(input: ContentRouteInput): PreparedContentRoute {
  const selection = selectContentRoute(input.registry, input.slotId, input.locale);
  const { slot, candidate, locale } = selection;
  const composition = candidate.composition!;
  if (typeof input.raisedAt !== "string" || !input.raisedAt.trim() || !Number.isFinite(Date.parse(input.raisedAt))) throw new TypeError("Content route requires a caller-supplied raisedAt instant");
  const needs: ContentRouteNeed[] = [];
  const add = (kind: ContentRouteNeed["kind"], target: ContentRouteNeed["target"], ref: string, detail: string) => {
    const id = `content-route:${JSON.stringify([slot.id, locale, kind, target, ref, detail])}`;
    if (!needs.some(need => need.id === id)) needs.push({ id, kind, target, slotId: slot.id, ref, detail, raisedAt: input.raisedAt });
  };

  const copyFindings: CopyFinding[] = [];
  const recordCopy = (report: CopyResolutionReport): CopyResolutionReport["copy"] => {
    copyFindings.push(...report.findings);
    for (const finding of report.findings) if (finding.severity === "error") {
      add("copy", "writer", finding.path, `Writer copy is required: ${finding.path} (${finding.rule})`);
    }
    return report.copy;
  };
  const writer = input.writer;
  const writerValid = writer === undefined || isContentJson(writer) && writer !== null && typeof writer === "object" && !Array.isArray(writer)
    && Object.keys(writer).every(key => ["registry", "registries", "manifest", "timeZone"].includes(key)) && Object.hasOwn(writer, "registry");
  if (!writerValid) add("copy", "writer", "writer", "Writer context requires finite registry, registries, manifest, and timeZone values");
  const copyOptions: ResolveCopyOptions = writerValid && writer !== undefined ? {
    resolver: createCopyResolver(writer.registry, {
      ...(writer.registries === undefined ? {} : { registries: writer.registries }),
      ...(writer.manifest === undefined ? {} : { manifest: writer.manifest }),
      timeZone: writer.timeZone ?? "UTC", now: new Date(input.raisedAt),
    }),
  } : {};
  const pageCopy = recordCopy(resolveCopy({ pageMeta: candidate.pageMeta }, locale, { ...copyOptions, requirePageMeta: true }))[PAGE_META_KEY] ?? {};
  const canonicalPolicy = slot.meta?.canonical;
  const canonical = typeof canonicalPolicy === "string"
    ? locale === input.registry.workspace.defaultLocale ? canonicalPolicy : undefined
    : canonicalPolicy?.[locale];
  const metadata: ContentRouteMetadata = {
    ...(pageCopy.title === undefined ? {} : { title: pageCopy.title }),
    ...(pageCopy.description === undefined ? {} : { description: pageCopy.description }),
    robots: robotsFor(slot),
    ...(canonical === undefined ? {} : { canonical }),
  };
  for (const finding of checkPageMetadata({ ...slot, locales: [locale] }, { ...candidate, pageMeta: candidate.pageMeta?.filter(field => field.locale === locale) }, undefined, copyOptions)) {
    add("copy", "writer", finding.path, `Writer page metadata is required: ${finding.path} (${finding.rule})`);
  }

  const libraryFindings = validateConsumerLibrarySnapshots(input.libraries);
  for (const finding of libraryFindings) add("config", "designer", finding.path, `Consumer library registration is invalid: ${finding.path} (${finding.rule})`);
  const library = libraryFindings.length ? undefined : input.libraries.find(entry => entry.consumerId === input.registry.workspace.consumerId && entry.version === composition.libraryVersion);
  if (!library) add("config", "designer", composition.libraryVersion, `Consumer library version is unavailable: ${composition.libraryVersion}`);
  const frame = composition.frame;
  const frameRegistration = library?.frames.find(entry => entry.id === frame.frameId);
  if (!frameRegistration) add("frame", "designer", frame.frameId, `Frame is not registered in the selected consumer library: ${frame.frameId}`);
  else if (!frameRegistration.configIds.includes(frame.configId)) add("config", "designer", frame.configId, `Frame config is not registered: ${frame.frameId}/${frame.configId}`);
  if (frame.frameId !== "frames.auth-shell") {
    if (frame.frameId === "frames.app-shell") add("config", "designer", frame.configId, `Frame requires a closed chrome configuration binding: ${frame.frameId}/${frame.configId}`);
    else add("frame", "designer", frame.frameId, `Designer frame export is unavailable: ${frame.frameId}`);
  } else if (frame.configId !== "default") add("config", "designer", frame.configId, `Frame config adapter is unavailable: ${frame.frameId}/${frame.configId}`);

  const frameFields = input.frameCopy ?? [];
  const frameCopyFindings = validateCopyFields(frameFields, "frameCopy", ["skipLabel"]);
  for (const finding of frameCopyFindings) add("copy", "writer", finding.path, `Writer frame copy is invalid: ${finding.path} (${finding.rule})`);
  // Frame copy uses the same validated, read-only Writer projection as section copy.
  const frameCopy = frameCopyFindings.length ? {} : recordCopy(resolveCopy({ composition: { ...composition, sections: [{ key: "$frame", sectionId: frame.frameId, configId: frame.configId, intent: "continues", fields: frameFields }] } }, locale, copyOptions)).$frame ?? {};
  if (frame.frameId === "frames.auth-shell" && !frameCopy.skipLabel?.trim()) add("copy", "writer", "frame.skipLabel", `Writer frame copy is required for ${locale}: skipLabel`);

  const assetsValid = isContentJson(input.assets ?? []) && Array.isArray(input.assets ?? []) && (input.assets ?? []).every(asset =>
    asset && typeof asset === "object" && Object.keys(asset).every(key => ["assetId", "libraryVersion", "src"].includes(key))
    && typeof asset.assetId === "string" && Boolean(asset.assetId.trim()) && typeof asset.libraryVersion === "string" && Boolean(asset.libraryVersion.trim())
    && typeof asset.src === "string" && Boolean(asset.src.trim()));
  if (!assetsValid) add("asset", "designer", "assets", "Asset bindings require finite assetId, libraryVersion, and src values");
  const assets = assetsValid ? input.assets ?? [] : [];
  const assetIdentities = new Set<string>();
  for (const asset of assets) {
    const identity = JSON.stringify([asset.assetId, asset.libraryVersion]);
    if (assetIdentities.has(identity)) add("asset", "designer", asset.assetId, `Asset binding is ambiguous: ${asset.assetId}/${asset.libraryVersion}`);
    assetIdentities.add(identity);
  }

  const pinnedSection = (section: CompositionSection, visiting: ReadonlySet<string>): CompositionSection | undefined => {
    if (!section.ref) return section;
    const ref = section.ref;
    const identity = JSON.stringify([ref.candidateId, ref.revision, ref.sectionKey]);
    if (visiting.has(identity)) { add("section", "designer", identity, "Pinned section reference is cyclic"); return undefined; }
    const historical = input.registry.candidates.find(entry => entry.id === ref.candidateId)?.history.find(entry => entry.revision === ref.revision)?.content.composition;
    const target = historical?.sections.find(entry => entry.key === ref.sectionKey);
    if (!historical || !target) { add("section", "designer", identity, "Pinned candidate revision and section key are unavailable"); return undefined; }
    if (historical.libraryVersion !== composition.libraryVersion) { add("section", "designer", identity, "Pinned section library version differs from the selected composition"); return undefined; }
    if (section.sectionId !== target.sectionId || section.configId !== target.configId) { add("section", "designer", identity, "Pinned section and config identities differ from the selected section"); return undefined; }
    return pinnedSection(target, new Set([...visiting, identity]));
  };
  const sectionNodes: ReactElement[] = [];
  for (const occurrence of composition.sections) {
    const section = pinnedSection(occurrence, new Set());
    if (!section) continue;
    const registration = library?.sections.find(entry => entry.id === section.sectionId);
    if (!registration) add("section", "designer", section.sectionId, `Section is not registered in the selected consumer library: ${section.sectionId}`);
    else if (!registration.configIds.includes(section.configId)) add("config", "designer", section.configId, `Section config is not registered: ${section.sectionId}/${section.configId}`);
    const supported = ["sections.empty-state", "sections.section-header", "sections.logo-hero"].includes(section.sectionId);
    if (!supported) add("section", "designer", section.sectionId, `Designer section export adapter is unavailable: ${section.sectionId}`);
    else if (section.configId !== "default") add("config", "designer", section.configId, `Section config adapter is unavailable: ${section.sectionId}/${section.configId}`);

    // A historical section is projected in isolation; unrelated source sections never replace this route.
    const sectionCopy = recordCopy(resolveCopy({ composition: { ...composition, sections: [{ ...section, key: occurrence.key }] } }, locale, copyOptions));
    const fields = sectionCopy[occurrence.key] ?? {};
    const allowed = section.sectionId === "sections.logo-hero" ? ["name"] : section.sectionId === "sections.section-header" ? ["heading", "description", "eyebrow"] : ["title", "description"];
    if (supported) for (const field of section.fields) if (!allowed.includes(field.key)) add("copy", "writer", `${occurrence.key}.${field.key}`, `Section copy has no closed adapter: ${section.sectionId}/${field.key}`);
    const requiredKey = section.sectionId === "sections.logo-hero" ? "name" : section.sectionId === "sections.section-header" ? "heading" : "title";
    if (supported && !fields[requiredKey]?.trim()) add("copy", "writer", `${occurrence.key}.${requiredKey}`, `Writer section copy is required for ${locale}: ${occurrence.key}.${requiredKey}`);

    for (const ref of section.assets ?? []) {
      if (ref.libraryVersion !== composition.libraryVersion || !library?.assetIds.includes(ref.assetId)) add("asset", "designer", ref.assetId, `Asset is not registered in the selected consumer library: ${ref.assetId}/${ref.libraryVersion}`);
    }
    if (section.sectionId !== "sections.logo-hero" && section.assets?.length) add("config", "designer", section.configId, `Section config has no asset adapter: ${section.sectionId}/${section.configId}`);
    if (!supported || section.configId !== "default") continue;
    if (section.sectionId === "sections.logo-hero") {
      const refs = section.assets ?? [];
      if (refs.length !== 1) { add("asset", "designer", occurrence.key, `LogoHero requires exactly one registered mark asset: ${occurrence.key}`); continue; }
      const ref = refs[0]!;
      const asset = assets.find(entry => entry.assetId === ref.assetId && entry.libraryVersion === ref.libraryVersion);
      if (!asset) { add("asset", "designer", ref.assetId, `Asset source binding is unavailable: ${ref.assetId}/${ref.libraryVersion}`); continue; }
      sectionNodes.push(createElement(LogoHero, { key: occurrence.key, mark: asset.src, name: fields.name! }));
    } else if (section.sectionId === "sections.section-header") sectionNodes.push(createElement(SectionHeader, { key: occurrence.key, title: fields.heading, description: fields.description, eyebrow: fields.eyebrow }));
    else sectionNodes.push(createElement(EmptyState, { key: occurrence.key, title: fields.title, description: fields.description }));
  }

  if (needs.length) return { ...selection, status: "needs-input", metadata, needs, copyFindings };
  const node = createElement(AuthFrame, { skipLabel: frameCopy.skipLabel!, children: sectionNodes });
  return { ...selection, status: "ready", metadata, needs, copyFindings, node };
}

/** Native document metadata surrounds a body composed exclusively by Designer exports. */
export function ContentRoutePage({ input }: { readonly input: ContentRouteInput }): ReactElement {
  const prepared = prepareContentRoute(input);
  if (prepared.status !== "ready" || !prepared.node) throw new ContentRouteNeedsError(prepared.needs);
  const { metadata, candidate, locale } = prepared;
  const writer = input.writer;
  const pageCopy = resolveCopy({ pageMeta: candidate.pageMeta }, locale, {
    requirePageMeta: true,
    ...(writer === undefined ? {} : { resolver: createCopyResolver(writer.registry, {
      ...(writer.registries === undefined ? {} : { registries: writer.registries }),
      ...(writer.manifest === undefined ? {} : { manifest: writer.manifest }),
      timeZone: writer.timeZone ?? "UTC", now: new Date(input.raisedAt),
    }) }),
  }).copy[PAGE_META_KEY] ?? {};
  return <Fragment>
    {metadata.title === undefined ? null : <title>{metadata.title}</title>}
    {metadata.description === undefined ? null : <meta name="description" content={metadata.description} />}
    <meta name="robots" content={metadata.robots} />
    {metadata.canonical === undefined ? null : <link rel="canonical" href={metadata.canonical} />}
    {pageCopy["share-title"] === undefined ? null : <meta property="og:title" content={pageCopy["share-title"]} />}
    {pageCopy["share-text"] === undefined ? null : <meta property="og:description" content={pageCopy["share-text"]} />}
    {candidate.pageMetaAssets?.["og-image"] === undefined ? null : <meta property="og:image" content={candidate.pageMetaAssets["og-image"]} />}
    {candidate.pageMetaAssets?.icon === undefined ? null : <link rel="icon" href={candidate.pageMetaAssets.icon} />}
    {prepared.node}
  </Fragment>;
}
