import { ADMIN_ROBOTS, isAdminConsoleRoute } from "./headMetadata.js";
import { ADMIN_PAGE_COPY_REFS, adminPageForRoute, adminNavigationCopy, isAdminContentRoute } from "../content/admin-copy.js";
import { createContentPreviewProvenance } from "./preview/provenance.js";
import { bindContentAppFrame, ContentCopyBindingError } from "./content-route-copy.js";
import { renderContentSection } from "./content-route-runtime.js";
import { Fragment, createElement } from "react";
import { createCopyResolver } from "@clossys/writer";
import type { ReactElement } from "react";
import { canonicalLocale, directionFor } from "@clossys/writer/locale";
import { AppFrame, AuthFrame, DocumentFrame } from "@clossys/designer/frames";
import { EmptyState, LogoHero, SectionHeader } from "@clossys/designer/blocks/server";
import { PAGE_META_KEY, resolveCopy, validateCopyFields } from "../content/composition.js";
import type { CompositionSection, CopyFinding, CopyResolutionReport, ResolveCopyOptions } from "../content/composition.js";
import { isContentJson } from "../content/json.js";
import { validateConsumerLibrarySnapshots } from "../content/library.js";
import { checkPageMetadata, robotsFor } from "../content/metadata.js";
import { buildLocaleRoutePlan, localePathFor } from "../content/hreflang.js";
import { formatPageTitle } from "./siteMetadata.js";
import { selectContentRoute } from "./content-route-binding.js";
import type { ContentRouteInput, ContentRouteMetadata, ContentRouteNeed, PreparedContentRoute } from "./content-route-types.js";

export { adminRobotsPolicy } from "./headMetadata.js";
export { bindContentRoute } from "./content-route-binding.js";
export type * from "./content-route-types.js";
export { resolveContentRouteRequest } from "./content-route-request.js";
export type * from "./content-route-request.js";

/** Missing design or Writer inputs prevent the complete route from rendering. */
export class ContentRouteNeedsError extends Error {
  readonly needs: readonly ContentRouteNeed[];

  constructor(needs: readonly ContentRouteNeed[]) {
    super(needs.map(need => need.detail).join("; "));
    this.name = "ContentRouteNeedsError";
    this.needs = needs;
  }
}

/** Emitted routes require publishing evidence; direct preparation remains a read-only preview. */
export function requireContentRoutePublishing(input: ContentRouteInput): ContentRouteInput {
  if (input.publishing === undefined) throw new ContentRouteNeedsError([{
    id: `content-route:${JSON.stringify([input.slotId, input.locale, "publishing"])}`,
    kind: "config", target: "designer", slotId: input.slotId, ref: "publishing",
    detail: "Serving content requires publishing document and locale-route evidence", raisedAt: input.raisedAt,
  }]);
  return input;
}

/** Resolve one active content route using closed adapters for actual Designer exports. */
export function prepareContentRoute(input: ContentRouteInput): PreparedContentRoute {
  const selection = selectContentRoute(input.registry, input.slotId, input.locale);
  const { slot, candidate, locale } = selection;
  const composition = candidate.composition!;
  const requireWriterCopy = isAdminContentRoute(slot, input.registry.workspace);
  if (typeof input.raisedAt !== "string" || !input.raisedAt.trim() || !Number.isFinite(Date.parse(input.raisedAt))) throw new TypeError("Content route requires a caller-supplied raisedAt instant");
  const needs: ContentRouteNeed[] = [];
  const add = (kind: ContentRouteNeed["kind"], target: ContentRouteNeed["target"], ref: string, detail: string) => {
    const id = `content-route:${JSON.stringify([slot.id, locale, kind, target, ref, detail])}`;
    if (!needs.some(need => need.id === id)) needs.push({ id, kind, target, slotId: slot.id, ref, detail, raisedAt: input.raisedAt });
  };

  const copyFindings: CopyFinding[] = [];
  const copyReports: { binding: string; report: CopyResolutionReport }[] = [];
  const validateCopy = (report: CopyResolutionReport): CopyResolutionReport["copy"] => {
    copyFindings.push(...report.findings);
    // Refuse legacy reports independently of their historical warning/complete flags.
    for (const finding of report.findings) if (finding.severity === "error" || requireWriterCopy && finding.rule === "legacy-inline-copy") {
      add("copy", "writer", finding.path, `Writer copy is required: ${finding.path} (${finding.rule})`);
    }
    return report.copy;
  };
  const recordCopy = (report: CopyResolutionReport, binding: string): CopyResolutionReport["copy"] => {
    copyReports.push({ binding, report });
    return validateCopy(report);
  };
  const writer = input.writer;
  const writerValid = writer === undefined || isContentJson(writer) && writer !== null && typeof writer === "object" && !Array.isArray(writer)
    && Object.keys(writer).every(key => ["registry", "registries", "manifest", "timeZone"].includes(key)) && Object.hasOwn(writer, "registry");
  if (!writerValid) add("copy", "writer", "writer", "Writer context requires finite registry, registries, manifest, and timeZone values");
  const copyOptions: ResolveCopyOptions = { requireWriterCopy, ...(input.resolveCopy ? { resolver: input.resolveCopy } : writerValid && writer !== undefined ? {
    resolver: createCopyResolver(writer.registry, {
      ...(writer.registries === undefined ? {} : { registries: writer.registries }),
      ...(writer.manifest === undefined ? {} : { manifest: writer.manifest }),
      timeZone: writer.timeZone ?? "UTC", now: new Date(input.raisedAt),
    }),
  } : {}) };
  const pageCopy = recordCopy(resolveCopy({ pageMeta: candidate.pageMeta }, locale, { ...copyOptions, requirePageMeta: true }), "pageMeta")[PAGE_META_KEY] ?? {};
  const canonicalPolicy = slot.meta?.canonical;
  const canonical = typeof canonicalPolicy === "string"
    ? locale === input.registry.workspace.defaultLocale ? canonicalPolicy : undefined
    : canonicalPolicy?.[locale];
  let metadata: ContentRouteMetadata = {
    ...(pageCopy.title === undefined ? {} : { title: pageCopy.title }),
    ...(pageCopy.description === undefined ? {} : { description: pageCopy.description }),
    robots: robotsFor(slot),
    ...(canonical === undefined ? {} : { canonical }),
  };
  for (const finding of checkPageMetadata({ ...slot, locales: [locale] }, { ...candidate, pageMeta: candidate.pageMeta?.filter(field => field.locale === locale) }, undefined, copyOptions)) {
    add("copy", "writer", finding.path, `Writer page metadata is required: ${finding.path} (${finding.rule})`);
  }

  if (input.publishing !== undefined) {
    const publishing = input.publishing;
    if (!isContentJson(publishing) || publishing === null || typeof publishing !== "object" || Array.isArray(publishing)) {
      add("config", "designer", "publishing", "Publishing requires finite document and locale-route evidence");
    } else {
      let nativeMetadataComplete = true;
      for (const publishedLocale of slot.locales) {
        // Validate all served locales; provenance describes only this route's projections.
        const nativeCopy = publishedLocale === locale ? pageCopy
          : validateCopy(resolveCopy({ pageMeta: candidate.pageMeta }, publishedLocale, { ...copyOptions, requirePageMeta: true }))[PAGE_META_KEY] ?? {};
        for (const key of ["title", "description"] as const) if (!nativeCopy[key]?.trim()) {
          nativeMetadataComplete = false;
          add("copy", "writer", `pageMeta.${publishedLocale}.${key}`, `Publishing requires native Writer ${key} for every served locale: ${publishedLocale}`);
        }
      }
      const plan = buildLocaleRoutePlan(slot, { ...publishing, workspace: input.registry.workspace });
      for (const finding of plan.findings) if (finding.severity === "error") {
        add("config", "designer", finding.path, `Publishing locale metadata is required: ${finding.path} (${finding.rule})`);
      }
      const page = plan.pages.find(entry => entry.locale === locale);
      if (!page) add("config", "designer", "publishing.locale", "Publishing requires an active locale page");
      let title: string | undefined;
      try { title = formatPageTitle({ page: pageCopy.title!, brand: publishing.brand }); }
      catch { add("copy", "writer", "publishing.title", "Publishing requires Writer page title and brand text"); }
      let lang: string | undefined;
      let dir: "ltr" | "rtl" | undefined;
      try { lang = canonicalLocale(locale); dir = directionFor(lang, publishing.manifest); }
      catch { add("config", "writer", "publishing.manifest", "Publishing requires the Writer locale direction manifest"); }
      metadata = {
        ...metadata, ...(title === undefined ? {} : { title }),
        ...(page === undefined ? {} : { canonical: page.canonical, alternates: nativeMetadataComplete ? page.alternates : [] }),
        ...(lang === undefined ? {} : { lang, openGraphLocale: lang.replaceAll("-", "_") }),
        ...(dir === undefined ? {} : { dir }),
        openGraphTitle: pageCopy["share-title"]?.trim() ? pageCopy["share-title"] : title,
        openGraphDescription: pageCopy["share-text"]?.trim() ? pageCopy["share-text"] : pageCopy.description,
      };
    }
  }

  const libraryFindings = validateConsumerLibrarySnapshots(input.libraries);
  for (const finding of libraryFindings) add("config", "designer", finding.path, `Consumer library registration is invalid: ${finding.path} (${finding.rule})`);
  const library = libraryFindings.length ? undefined : input.libraries.find(entry => entry.consumerId === input.registry.workspace.consumerId && entry.version === composition.libraryVersion);
  if (!library) add("config", "designer", composition.libraryVersion, `Consumer library version is unavailable: ${composition.libraryVersion}`);
  const frame = composition.frame;
  const frameRegistration = library?.frames.find(entry => entry.id === frame.frameId);
  if (!frameRegistration) add("frame", "designer", frame.frameId, `Frame is not registered in the selected consumer library: ${frame.frameId}`);
  else if (!frameRegistration.configIds.includes(frame.configId)) add("config", "designer", frame.configId, `Frame config is not registered: ${frame.frameId}/${frame.configId}`);
  let appFrame: ReturnType<typeof bindContentAppFrame> | undefined;
  if (frame.frameId === "frames.app-shell") {
    if (!input.appFrame) add("config", "designer", frame.configId, "Registered AppFrame copy bindings are required");
    else try {
      const admin = adminPageForRoute(slot.route);
      const pageRefs = admin && ADMIN_PAGE_COPY_REFS[admin];
      const suppliedPage = input.appFrame.page as Record<string, unknown> | undefined;
      const navigation = input.appFrame.navigation as Record<string, unknown> | undefined;
      const chrome = { ...input.appFrame,
        ...(pageRefs ? { page: { title: pageRefs.title, description: pageRefs.description, ...suppliedPage } } : {}),
        ...(Array.isArray(navigation?.tree) ? { navigation: { ...navigation, tree: adminNavigationCopy(navigation.tree) } } : {}) };

      appFrame = bindContentAppFrame(chrome, locale, copyOptions.resolver, {
        registeredPaths: input.registry.slots.flatMap(registered => registered.route === undefined || registered.deployTarget !== slot.deployTarget ? []
          : registered.locales.map(tag => localePathFor(registered.route!, tag, input.registry.workspace.defaultLocale))),
        report: finding => copyFindings.push({ path: finding.path, rule: finding.rule, severity: "warning", locale,
          message: `Dropped unregistered route: ${finding.href}` }),
      });
    }
    catch (error) {
      const layout = error instanceof ContentCopyBindingError && error.rule === "designer-owned-layout";
      add(layout ? "config" : "copy", layout ? "designer" : "writer", error instanceof ContentCopyBindingError ? error.path : "appFrame", error instanceof Error ? error.message : "AppFrame copy bindings are required");
    }
  } else if (frame.frameId !== "frames.auth-shell") add("frame", "designer", frame.frameId, `Designer frame export is unavailable: ${frame.frameId}`);
  else if (frame.configId !== "default") add("config", "designer", frame.configId, `Frame config adapter is unavailable: ${frame.frameId}/${frame.configId}`);

  const frameFields = input.frameCopy ?? [];
  const frameCopyFindings = validateCopyFields(frameFields, "frameCopy", ["skipLabel"]);
  for (const finding of frameCopyFindings) add("copy", "writer", finding.path, `Writer frame copy is invalid: ${finding.path} (${finding.rule})`);
  // Frame copy uses the same validated, read-only Writer projection as section copy.
  const frameCopy = frameCopyFindings.length ? {} : recordCopy(resolveCopy({ composition: { ...composition, sections: [{ key: "$frame", sectionId: frame.frameId, configId: frame.configId, intent: "continues", fields: frameFields }] } }, locale, copyOptions), "frameCopy").$frame ?? {};
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
    const binding = input.sectionBindings?.[occurrence.key];
    if (!supported && !binding) add("section", "designer", section.sectionId, `Designer section export adapter is unavailable: ${section.sectionId}`);
    else if (!binding && section.configId !== "default") add("config", "designer", section.configId, `Section config adapter is unavailable: ${section.sectionId}/${section.configId}`);

    // A historical section is projected in isolation; unrelated source sections never replace this route.
    const sectionCopy = recordCopy(resolveCopy({ composition: { ...composition, sections: [{ ...section, key: occurrence.key }] } }, locale, copyOptions), `sections.${occurrence.key}`);
    const fields = sectionCopy[occurrence.key] ?? {};
    const allowed = section.sectionId === "sections.logo-hero" ? ["name"] : section.sectionId === "sections.section-header" ? ["heading", "description", "eyebrow"] : ["title", "description"];
    if (supported && !binding) for (const field of section.fields) if (!allowed.includes(field.key)) add("copy", "writer", `${occurrence.key}.${field.key}`, `Section copy has no closed adapter: ${section.sectionId}/${field.key}`);
    const requiredKey = section.sectionId === "sections.logo-hero" ? "name" : section.sectionId === "sections.section-header" ? "heading" : "title";
    if (supported && !binding && !fields[requiredKey]?.trim()) add("copy", "writer", `${occurrence.key}.${requiredKey}`, `Writer section copy is required for ${locale}: ${occurrence.key}.${requiredKey}`);

    for (const ref of section.assets ?? []) {
      if (ref.libraryVersion !== composition.libraryVersion || !library?.assetIds.includes(ref.assetId)) add("asset", "designer", ref.assetId, `Asset is not registered in the selected consumer library: ${ref.assetId}/${ref.libraryVersion}`);
    }
    if (!binding && section.sectionId !== "sections.logo-hero" && section.assets?.length) add("config", "designer", section.configId, `Section config has no asset adapter: ${section.sectionId}/${section.configId}`);
    if (binding && (!registration || !registration.configIds.includes(section.configId))) continue;
    if (binding) {
      try { sectionNodes.push(createElement(Fragment, { key: occurrence.key }, renderContentSection(binding, section.sectionId, section.configId, composition.libraryVersion, fields, locale))); }
      catch (error) {
        const copy = error instanceof ContentCopyBindingError && (error.rule.startsWith("copy-") || error.rule === "unresolved-native-copy");
        add(copy ? "copy" : "config", copy ? "writer" : "designer", error instanceof ContentCopyBindingError ? error.path : occurrence.key,
          error instanceof Error ? error.message : "Registered Designer section input is required");
      }
      continue;
    }
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
  const provenance = createContentPreviewProvenance(selection, copyReports, writer?.manifest);
  const node = appFrame ? createElement(AppFrame, { ...appFrame, children: sectionNodes }) : createElement(AuthFrame, { skipLabel: frameCopy.skipLabel!, children: sectionNodes });
  return { ...selection, status: "ready", metadata, needs, copyFindings, provenance, node };
}

/** Native document metadata surrounds a body composed exclusively by Designer exports. */
export function ContentRoutePage({ input }: { readonly input: ContentRouteInput }): ReactElement {
  const prepared = prepareContentRoute(input);
  if (prepared.status !== "ready" || !prepared.node) throw new ContentRouteNeedsError(prepared.needs);
  const { metadata, candidate, locale } = prepared;
  const robots = isAdminConsoleRoute(prepared.slot.route) ? ADMIN_ROBOTS : metadata.robots;
  if (input.publishing !== undefined) return <DocumentFrame
    lang={metadata.lang!} dir={metadata.dir!} variant="page" title={metadata.title!}
    icon={candidate.pageMetaAssets?.icon === undefined ? undefined : { href: candidate.pageMetaAssets.icon }}
    meta={[{ name: "description", content: metadata.description! }, { name: "robots", content: robots }, { name: "twitter:card", content: "summary" }]}
    links={[
      { rel: "canonical", href: metadata.canonical! },
      ...(metadata.alternates ?? []).map(alternate => ({ rel: "alternate" as const, href: alternate.href, hrefLang: alternate.hreflang })),
    ]}
  >
    <meta property="og:title" content={metadata.openGraphTitle} />
    <meta property="og:description" content={metadata.openGraphDescription} />
    <meta property="og:locale" content={metadata.openGraphLocale} />
    {candidate.pageMetaAssets?.["og-image"] === undefined ? null : <meta property="og:image" content={candidate.pageMetaAssets["og-image"]} />}
    {prepared.node}
  </DocumentFrame>;
  const writer = input.writer;
  const pageCopy = resolveCopy({ pageMeta: candidate.pageMeta }, locale, {
    requirePageMeta: true,
    requireWriterCopy: isAdminContentRoute(prepared.slot, input.registry.workspace),
    ...(input.resolveCopy ? { resolver: input.resolveCopy } : writer === undefined ? {} : { resolver: createCopyResolver(writer.registry, {
      ...(writer.registries === undefined ? {} : { registries: writer.registries }),
      ...(writer.manifest === undefined ? {} : { manifest: writer.manifest }),
      timeZone: writer.timeZone ?? "UTC", now: new Date(input.raisedAt),
    }) }),
  }).copy[PAGE_META_KEY] ?? {};
  return <Fragment>
    {metadata.title === undefined ? null : <title>{metadata.title}</title>}
    {metadata.description === undefined ? null : <meta name="description" content={metadata.description} />}
    <meta name="robots" content={robots} />
    <meta name="twitter:card" content="summary" />
    {metadata.canonical === undefined ? null : <link rel="canonical" href={metadata.canonical} />}
    {pageCopy["share-title"] === undefined ? null : <meta property="og:title" content={pageCopy["share-title"]} />}
    {pageCopy["share-text"] === undefined ? null : <meta property="og:description" content={pageCopy["share-text"]} />}
    {candidate.pageMetaAssets?.["og-image"] === undefined ? null : <meta property="og:image" content={candidate.pageMetaAssets["og-image"]} />}
    {candidate.pageMetaAssets?.icon === undefined ? null : <link rel="icon" href={candidate.pageMetaAssets.icon} />}
    {prepared.node}
  </Fragment>;
}
