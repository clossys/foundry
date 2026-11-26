/**
 * `clossys publish --install --site <publication> --next <app dir> --bind --selection <module>`:
 * Publisher writes the Next app's assembly too, so no module between the route files and the
 * pinned records is left to a hand.
 *
 * The site project is the app directory's parent. For every page of the content map, the
 * publication's pinned Publisher page record (frame and sections from Designer pins, copy from
 * Writer keys) is resolved and bound, its pinned items install into the site project through
 * shadcn, and its page module is generated (`clossys/pages/<id>.tsx`, the same `pageModule` every
 * substrate render uses). The assembly (`clossys/publication.tsx`) mounts those page modules by id
 * for the route files, serves the document and the metadata; the states module
 * (`clossys/states.tsx`) mounts the home record's frame with no sections for every state. The
 * projection (`clossys/publication.json`) is what the route checks read. Every generated file
 * carries Publisher's route marker, so the same marker and parity rules hold as for route files.
 *
 * With more than one recorded locale (`outputs.locales`) every page and the state page bind once per
 * locale, and the assembly serves each locale its own document language and title
 * (`publishedLocaleMetadata`, `PublishedDocument({ locale })`), as the per-locale root layouts
 * `planNextRoutes` installs ask. Each locale's pages mount inside that locale's own Publisher host
 * (`clossys/publisher-host@<locale>.tsx`), whose Designer shell strings (skip link, navigation,
 * breadcrumb, theme, dock and banner labels) are that locale's Writer copy. A title or shell key the
 * default locale holds and another locale lacks is a blocking finding.
 *
 * Nothing here authors a visible string: every word is a bound Writer key. A record, a pin or a
 * key the install needs and the consumer lacks is a finding, never a fallback.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { bindPage, installPage, isBlocking, NEXT_ROUTE_MARKER, pageHostModule, relativeSpecifier, resolvePage, shellCopyIds, type BoundPage, type InstallFinding, type InstallPageRecord, type PageHostSelection, type ShadcnRunner } from "@clossys/publisher/install";
import type { ContentMap, ContentMapEntry } from "@clossys/publisher/content-map";

/** The content map's own path rule (`contentMapPath`): a declared path, else `/<slug>`. */
const contentMapPath = (entry: { readonly path?: string; readonly slug?: string }) => entry.path ?? `/${entry.slug}`;
import { libraryRecordSource } from "../specimen/library-source.js";
import { specimenRoots } from "./publish.js";
import { dataBoundReads, scopeParams } from "../cli/admin-plan.js";
import { ADMIN_LABELS_SLOT, ADMIN_RECORD_PORTS, adminRouteParams, readAdminRecords, type AdminRecords } from "./admin-records.js";
import { designerPins, pageModule, pageRecordFromCell, shadcnRunner, SUBSTRATE_HOST_FILE, writerCopy, type PageModuleRecords } from "./install.js";
import { writerLocaleCopy } from "./install-outputs.js";

/** The generated directory, relative to the site project. */
export const NEXT_BIND_DIR = "clossys";
export const NEXT_BIND_ASSEMBLY = `${NEXT_BIND_DIR}/publication.tsx`;
export const NEXT_BIND_STATES = `${NEXT_BIND_DIR}/states.tsx`;
export const NEXT_BIND_PROJECTION = `${NEXT_BIND_DIR}/publication.json`;
export const NEXT_BIND_PAGES = `${NEXT_BIND_DIR}/pages`;
/** The consumer's records the data-bound sections read (admin-records.ts), as one generated module (U20b). */
export const NEXT_BIND_RECORDS = `${NEXT_BIND_DIR}/records.ts`;
/** The Publisher host a locale's pages mount inside: the default locale's is the substrate host, every other locale has its own. */
export const nextBindHostFile = (locale: string, defaultLocale: string) => (locale === defaultLocale ? SUBSTRATE_HOST_FILE : `${NEXT_BIND_DIR}/publisher-host@${locale}.tsx`);
/** Whether a generated bind file is a non-default locale's host (`nextBindHostFile`). */
export const isLocaleHostFile = (file: string) => /^clossys\/publisher-host@[^/]+\.tsx$/.test(file);
/** The bound page every state mounts: the home record's frame, no sections. */
export const NEXT_BIND_STATE_PAGE = "state";
export const NEXT_BIND_SCHEMA = "clossys.next-publication/1";

export interface NextBindOptions {
  /** The consumer's component selection module every page mounts inside (`<module>[#export]`); absolute or relative to `cwd`. */
  readonly selection: PageHostSelection;
  /** Resolves a relative `selection.module`; defaults to process.cwd(). */
  readonly cwd?: string;
  /** Extra record roots (`--records`). */
  readonly records?: readonly string[];
  /** The shadcn CLI; a test seam. */
  readonly runner?: ShadcnRunner;
}

/** One generated file of the bind, relative to the site project. */
export interface NextBindFile { readonly file: string; readonly pageId: string; readonly content: string }
export interface NextBindProjection {
  readonly schema: typeof NEXT_BIND_SCHEMA;
  readonly installedBy: "publisher";
  readonly publicationId: string;
  readonly homeId: string;
  readonly pages: readonly { readonly id: string; readonly route: string; readonly module: string; readonly frame: string; readonly sections: readonly string[]; readonly copyKeys: readonly string[] }[];
  readonly state: { readonly module: string; readonly frame: string };
  readonly titleKey?: string;
}
export interface NextBindPlan {
  readonly files: readonly NextBindFile[]; readonly findings: readonly InstallFinding[]; readonly assembly: string; readonly states: string;
  /** Each dynamic page's route parameter values, from the consumer's records (the route files' `generateStaticParams`). */
  readonly routeParams?: Readonly<Record<string, readonly Readonly<Record<string, string>>[]>>;
}

const marked = (content: string) => `${NEXT_ROUTE_MARKER}\n${content}`;
const pathOf = (map: ContentMap, id: string) => contentMapPath(map.entries.find(row => row.id === id) as ContentMapEntry);

/** The verified native font output (`resolveNativeNextFonts`) the document applies at its html element, when the site holds it. */
export const NEXT_BIND_FONTS = "src/clossys/fonts.ts";

/** A non-default locale's bound pages (`outputs.locales`): every page again, bound to that locale's Writer copy. */
interface LocalizedPages { readonly locale: string; readonly pages: readonly { id: string; module: string }[] }

function assemblyModule(pages: readonly { id: string; module: string }[], title: string | undefined, lang: string, css: string | undefined, fonts: boolean, localized: readonly LocalizedPages[] = [], titles: Readonly<Record<string, string | undefined>> = {}): string {
  const imports = [...pages, ...localized.flatMap(row => row.pages)];
  let next = pages.length;
  const tables = localized.map(row => `${JSON.stringify(row.locale)}: { ${row.pages.map(page => `${JSON.stringify(page.id)}: Page${next++}`).join(", ")} }`);
  const lookup = localized.length
    ? [
        "/** The bound page for a content-map page id in a locale, with a dynamic route's parameters; an id or locale the install did not bind is an error, never a fallback. */",
        "export function PublishedPage({ page, locale, params }: { page: string; slug?: string; locale?: string; params?: Record<string, string> }): ReactNode {",
        `  const table = locale === undefined || locale === ${JSON.stringify(lang)} ? pages : Object.hasOwn(localized, locale) ? localized[locale] : undefined;`,
        "  const Page = table && Object.hasOwn(table, page) ? table[page] : undefined;",
        "  if (!Page) throw new Error(`publication: no bound page ${page}${locale === undefined ? \"\" : ` in ${locale}`}`);",
      ]
    : [
        "/** The bound page for a content-map page id, with a dynamic route's parameters; an id the install did not bind is an error, never a fallback. */",
        "export function PublishedPage({ page, params }: { page: string; slug?: string; params?: Record<string, string> }): ReactNode {",
        "  const Page = Object.hasOwn(pages, page) ? pages[page] : undefined;",
        "  if (!Page) throw new Error(`publication: no bound page ${page}`);",
      ];
  return marked([
    "// Generated by clossys publish --install --next --bind from the pinned page records. Reinstall rather than editing this file.",
    'import { createElement, type ReactNode } from "react";',
    ...(css ? [`import ${JSON.stringify(relativeSpecifier(NEXT_BIND_ASSEMBLY, css))};`] : []),
    ...(fonts ? [`import { nativeFontVariables } from ${JSON.stringify(relativeSpecifier(NEXT_BIND_ASSEMBLY, NEXT_BIND_FONTS))};`] : []),
    ...imports.map((page, index) => `import Page${index} from ${JSON.stringify(relativeSpecifier(NEXT_BIND_ASSEMBLY, page.module))};`),
    "",
    "/** A bound page module: a dynamic route passes its parameters, which the page's data-bound sections key their records on. */",
    "type BoundPageModule = (props: { params?: Record<string, string> }) => ReactNode;",
    `const pages: Record<string, BoundPageModule> = { ${pages.map((page, index) => `${JSON.stringify(page.id)}: Page${index}`).join(", ")} };`,
    ...(localized.length ? [`const localized: Record<string, Record<string, BoundPageModule>> = { ${tables.join(", ")} };`] : []),
    "",
    ...lookup,
    "  return createElement(Page, params ? { params } : {});",
    "}",
    "",
    "/** A bound install serves the leaves it was installed with: none at request time. */",
    "export async function publishedLeaf(_page: string, _slug: string): Promise<boolean> { return false; }",
    "",
    `export const publishedMetadata: { title?: string } = ${JSON.stringify(title === undefined ? {} : { title })};`,
    "",
    ...(localized.length
      ? [
          "/** Every installed locale's document metadata, each from that locale's own Writer copy. */",
          `const localeMetadata: Record<string, { title?: string }> = ${JSON.stringify(Object.fromEntries([lang, ...localized.map(row => row.locale)].map(locale => [locale, titles[locale] === undefined ? {} : { title: titles[locale] }])))};`,
          "",
          "/** A locale's document metadata; a locale the install did not bind is an error, never another locale's. */",
          "export function publishedLocaleMetadata(locale: string): { title?: string } {",
          "  if (!Object.hasOwn(localeMetadata, locale)) throw new Error(`publication: no bound locale ${locale}`);",
          "  return localeMetadata[locale]!;",
          "}",
          "",
          "/** The document in a locale: its language is the route's locale (none names the default, for the app-root global error). */",
          "export function PublishedDocument({ children, locale }: { children: ReactNode; locale?: string }): ReactNode {",
          `  const lang = locale ?? ${JSON.stringify(lang)};`,
          "  if (!Object.hasOwn(localeMetadata, lang)) throw new Error(`publication: no bound locale ${lang}`);",
          `  return createElement("html", { lang${fonts ? ", className: nativeFontVariables || undefined" : ""} }, createElement("body", null, children));`,
        ]
      : [
          "export function PublishedDocument({ children }: { children: ReactNode }): ReactNode {",
          `  return createElement("html", { lang: ${JSON.stringify(lang)}${fonts ? ", className: nativeFontVariables || undefined" : ""} }, createElement("body", null, children));`,
        ]),
    "}",
    "",
  ].join("\n"));
}

function statesModule(module: string, localized: readonly { locale: string; module: string }[] = [], lang = "en"): string {
  if (localized.length) return marked([
    '"use client";',
    "// Generated by clossys publish --install --next --bind: every state mounts the home record's frame with no sections, bound to the state's locale.",
    'import { createElement, type ReactNode } from "react";',
    `import StatePage from ${JSON.stringify(relativeSpecifier(NEXT_BIND_STATES, module))};`,
    ...localized.map((row, index) => `import StatePage${index + 1} from ${JSON.stringify(relativeSpecifier(NEXT_BIND_STATES, row.module))};`),
    "",
    `const pages: Record<string, () => ReactNode> = { ${[`${JSON.stringify(lang)}: StatePage`, ...localized.map((row, index) => `${JSON.stringify(row.locale)}: StatePage${index + 1}`)].join(", ")} };`,
    "",
    "/** A state in its locale (none names the default, for the app-root global error); a locale the install did not bind is an error, never a fallback. */",
    "export function PublishedState({ locale }: { state: string; locale?: string }): ReactNode {",
    `  const key = locale ?? ${JSON.stringify(lang)};`,
    "  const Page = Object.hasOwn(pages, key) ? pages[key] : undefined;",
    "  if (!Page) throw new Error(`publication: no bound state in ${key}`);",
    "  return createElement(Page);",
    "}",
    "",
  ].join("\n"));
  return marked([
    '"use client";',
    "// Generated by clossys publish --install --next --bind: every state mounts the home record's frame with no sections.",
    'import { createElement, type ReactNode } from "react";',
    `import StatePage from ${JSON.stringify(relativeSpecifier(NEXT_BIND_STATES, module))};`,
    "",
    "export function PublishedState(_props: { state: string }): ReactNode {",
    "  return createElement(StatePage);",
    "}",
    "",
  ].join("\n"));
}

/** The frame-only record a state binds: the home record's frame and the home record's frame copy, nothing else. */
function stateRecord(home: InstallPageRecord): InstallPageRecord {
  const frameCopy = (copy: Readonly<Record<string, string>> | undefined) => Object.fromEntries(Object.entries(copy ?? {}).filter(([slot]) => slot.startsWith("frame.")));
  const bindings = home.bindings?.frame ? { bindings: { frame: home.bindings.frame } } : {};
  return { id: NEXT_BIND_STATE_PAGE, frame: home.frame, sections: [], ...(home.include ? { include: home.include } : {}), copy: frameCopy(home.copy), ...bindings };
}

/**
 * Resolve, bind and (unless `check`) install every page of the publication into the site project,
 * and plan the generated modules. Blocking findings mean the plan holds no files.
 */
export async function planNextBind(options: { root: string; site: string; map: ContentMap; check: boolean; bind: NextBindOptions; leafTemplates: readonly unknown[]; locales?: { readonly default: string; readonly all: readonly string[] } }): Promise<NextBindPlan> {
  const { root, site, map } = options;
  const findings: InstallFinding[] = [];
  const assembly = posixRelative(join(site, "app"), join(site, NEXT_BIND_ASSEMBLY));
  const states = posixRelative(join(site, "app"), join(site, NEXT_BIND_STATES));
  const empty = (): NextBindPlan => ({ files: [], findings, assembly, states });
  if (options.leafTemplates.length) {
    findings.push({ code: "site-contract", detail: `${map.publicationId}: a bound Next install serves pages only; leaf templates need an assembly leaf export (ENGINE gap)` });
    return empty();
  }
  if (!existsSync(join(site, "components.json"))) {
    findings.push({ code: "site-contract", detail: `${relative(root, site) || "."}/components.json is missing: the site project is not a shadcn project the pinned items can install into` });
    return empty();
  }
  const pins = designerPins(root);
  // With recorded locales every page binds once per locale, each to that locale's pinned Writer copy.
  const locales = options.locales;
  const perLocale = locales ? await writerLocaleCopy(root) : undefined;
  const copy: Record<string, string> = perLocale ? { ...perLocale.copy(locales!.default) } : await writerCopy(root);
  // The document title per locale: the home title key in each locale's own copy. A key the default locale holds and
  // another lacks is the Writer's to draft; that locale's document never takes the default's title.
  const homeTitle = (map.entries.find(entry => entry.kind === "page" && contentMapPath(entry as ContentMapEntry) === "/") ?? map.entries.find(entry => entry.kind === "page")) as { title?: string } | undefined;
  const titleKey = homeTitle?.title;
  const titles: Record<string, string | undefined> = {};
  if (locales && perLocale) {
    const held = titleKey !== undefined && Object.hasOwn(copy, titleKey);
    for (const locale of locales.all) {
      const localeCopy = perLocale.copy(locale);
      titles[locale] = held && Object.hasOwn(localeCopy, titleKey!) ? localeCopy[titleKey!] : undefined;
      if (held && titles[locale] === undefined) findings.push({ code: "missing-copy-key", slot: map.publicationId, detail: `${locale}: ${map.publicationId}: the document title ${titleKey} has no ${locale} text; the Writer drafts it before ${locale} installs` });
    }
    // The Designer shell strings each locale's host serves: a shell key the default locale holds and another lacks is the
    // Writer's to draft; that locale's host never serves the default's text.
    const shellIds = await shellCopyIds();
    for (const locale of locales.all) {
      if (locale === locales.default) continue;
      const localeCopy = perLocale.copy(locale);
      for (const id of shellIds) {
        if (Object.hasOwn(copy, id) && !Object.hasOwn(localeCopy, id)) findings.push({ code: "missing-copy-key", slot: map.publicationId, detail: `${locale}: ${map.publicationId}: the shell string ${id} has no ${locale} text; the Writer drafts it before ${locale} installs` });
      }
    }
  }
  const source = libraryRecordSource({ roots: specimenRoots(root, options.bind.records ? [...options.bind.records] : undefined), slotStates: false });
  const entries = map.entries.filter((entry): entry is ContentMapEntry => entry.kind === "page");
  const homeId = (entries.find(entry => contentMapPath(entry) === "/") ?? entries[0])?.id;
  const records: InstallPageRecord[] = [];
  for (const entry of entries) {
    try { records.push(await pageRecordFromCell(root, entry.id, pins, copy)); }
    catch (error) { findings.push({ code: "site-route-missing", slot: entry.id, detail: `${entry.id}: ${error instanceof Error ? error.message : String(error)}` }); }
  }
  const home = records.find(record => record.id === homeId);
  if (!home) findings.push({ code: "site-route-missing", detail: `${map.publicationId}: the home page ${homeId ?? "(none)"} has no pinned Publisher page record, so no state can bind its frame` });
  if (findings.some(isBlocking)) return empty();
  const bound: BoundPage[] = [];
  const localizedBound: { locale: string; page: BoundPage }[] = [];
  const others = locales ? locales.all.filter(locale => locale !== locales.default) : [];
  for (const record of [...records, stateRecord(home!)]) {
    const resolved = await resolvePage(record, pins, source);
    findings.push(...resolved.findings);
    if (resolved.findings.some(isBlocking)) continue;
    const result = bindPage({ page: record, slots: resolved.slots, copy });
    findings.push(...result.findings);
    if (!result.page || result.findings.some(isBlocking)) continue;
    if (!options.check) {
      const installed = await installPage({ page: record, pins, source, substrate: site, runner: options.bind.runner ?? shadcnRunner() });
      findings.push(...installed.findings);
      if (installed.findings.some(isBlocking)) continue;
    }
    bound.push(result.page);
    for (const locale of others) {
      // A key the locale does not hold is the binder's blocking finding: the Writer drafts it, nothing falls back.
      const localized = bindPage({ page: record, slots: resolved.slots, copy: { ...perLocale!.copy(locale) } });
      findings.push(...localized.findings.filter(isBlocking).map(finding => ({ ...finding, detail: `${locale}: ${finding.detail}` })));
      if (localized.page && !localized.findings.some(isBlocking)) localizedBound.push({ locale, page: localized.page });
    }
  }
  if (findings.some(isBlocking) || bound.length !== records.length + 1 || localizedBound.length !== (records.length + 1) * others.length) return empty();

  // Host-injected records (U20b): each data-bound section a bound page places reads its port from the consumer's
  // records under its route scope, and each dynamic page serves the parameter values those records hold.
  // Unreadable Designer section contracts mean no section is known to be data-bound: nothing is injected (a placed
  // record section then renders its own empty state) and the install says so, never crashing a publication that binds none.
  let reads: ReadonlyMap<string, { port: string; scope: string }> = new Map();
  try { reads = dataBoundReads(root); } catch (error) {
    findings.push({ code: "site-contract", severity: "info", detail: `${map.publicationId}: the Designer section contracts are unreadable (${error instanceof Error ? error.message : String(error)}), so no data-bound section is filled from records` });
  }
  const injected = new Map<string, { port: string; scope: string[] }>();
  for (const page of bound) for (const slot of page.sections) {
    const read = reads.get(slot.slot);
    if (!read) continue;
    if (!(ADMIN_RECORD_PORTS as readonly string[]).includes(read.port)) { findings.push({ code: "site-contract", slot: page.id, detail: `${page.id}: data-bound section ${slot.slot} reads port ${read.port}, which the records reader does not fill` }); continue; }
    injected.set(slot.slot, { port: read.port, scope: scopeParams(read.scope) });
  }
  const paths = entries.map(entry => contentMapPath(entry));
  const dynamic = entries.filter(entry => /<[a-z][a-z0-9]*>/.test(contentMapPath(entry)));
  let snapshot: AdminRecords | undefined;
  const routeParams: Record<string, Record<string, string>[]> = {};
  if (injected.size || dynamic.length) {
    snapshot = readAdminRecords(root, { routes: paths });
    for (const entry of dynamic) {
      const values = adminRouteParams(snapshot, contentMapPath(entry), paths);
      if (values) routeParams[entry.id] = values;
    }
  }
  // The record sections are copy-less: their labels come with the records from the pinned Writer strings slot. Unpinned,
  // the sections render without labels and the install says so (never a literal label in their place).
  if (injected.size && snapshot && !snapshot.labels) {
    findings.push({ code: "unbound-copy-slot", severity: "info", slot: `writer/${ADMIN_LABELS_SLOT}`, detail: `${map.publicationId}: writer/${ADMIN_LABELS_SLOT} is not pinned and readable, so the data-bound record sections have no labels (${snapshot.issues.find(issue => issue.startsWith(`writer/${ADMIN_LABELS_SLOT}:`)) ?? "no labels"})` });
  }
  if (findings.some(isBlocking)) return empty();

  const files: NextBindFile[] = [];
  const moduleOf = (id: string) => `${NEXT_BIND_PAGES}/${id}.tsx`;
  const localeModuleOf = (id: string, locale: string) => `${NEXT_BIND_PAGES}/${id}@${locale}.tsx`;
  const recordsOption: PageModuleRecords | undefined = injected.size ? { module: NEXT_BIND_RECORDS, reads: Object.fromEntries(injected) } : undefined;
  const withRecords = recordsOption ? { records: recordsOption } : {};
  for (const page of bound) files.push({ file: moduleOf(page.id), pageId: page.id, content: marked(pageModule(page, site, withRecords)) });
  // Every locale's page module reads the same records: a record is data, not copy, so no locale holds its own.
  for (const { locale, page } of localizedBound) files.push({ file: localeModuleOf(page.id, locale), pageId: page.id, content: marked(pageModule(page, site, { hostFile: nextBindHostFile(locale, locales!.default), ...withRecords })) });
  if (recordsOption && snapshot) {
    const { issues: _issues, ...data } = snapshot;
    files.push({ file: NEXT_BIND_RECORDS, pageId: "", content: marked([
      "// Generated by clossys publish --install --next --bind from the consumer's clossys records (read-only). Reinstall rather than editing this file.",
      `export const records = ${JSON.stringify(data, null, 2)} as const;`,
      "",
    ].join("\n")) });
  }
  const cwd = options.bind.cwd ?? process.cwd();
  const selectionModule = /\.(?:[cm]?[jt]sx?)$/.test(options.bind.selection.module)
    ? posixRelative(site, isAbsolute(options.bind.selection.module) ? options.bind.selection.module : resolve(cwd, options.bind.selection.module))
    : options.bind.selection.module;
  files.push({ file: SUBSTRATE_HOST_FILE, pageId: "", content: marked(await pageHostModule({ selection: { ...options.bind.selection, module: selectionModule }, copy, file: SUBSTRATE_HOST_FILE })) });
  // Every other locale's host, from that locale's own Writer copy.
  for (const locale of others) {
    const file = nextBindHostFile(locale, locales!.default);
    files.push({ file, pageId: "", content: marked(await pageHostModule({ selection: { ...options.bind.selection, module: selectionModule }, copy: perLocale!.copy(locale), file })) });
  }
  const title = titleKey !== undefined && Object.hasOwn(copy, titleKey) ? copy[titleKey] : undefined;
  if (title === undefined) findings.push({ code: "unbound-copy-slot", severity: "info", detail: `${map.publicationId}: the home title ${titleKey ?? "(none)"} is not a Writer key, so the document has no title (CREATIVE: Writer title key)` });
  const css = existsSync(join(site, "app", "globals.css")) ? "app/globals.css" : undefined;
  // The default document's language is the publication's default locale (`outputs.locales`), else the Writer
  // default; every other locale's document is its own (`PublishedDocument({ locale })`).
  const lang = locales?.default ?? "en";
  const localized = others.map(locale => ({ locale, pages: records.map(record => ({ id: record.id, module: localeModuleOf(record.id, locale) })) }));
  files.push({ file: NEXT_BIND_ASSEMBLY, pageId: "", content: assemblyModule(records.map(record => ({ id: record.id, module: moduleOf(record.id) })), title, lang, css, existsSync(join(site, ...NEXT_BIND_FONTS.split("/"))), localized, titles) });
  files.push({ file: NEXT_BIND_STATES, pageId: NEXT_BIND_STATE_PAGE, content: statesModule(moduleOf(NEXT_BIND_STATE_PAGE), others.map(locale => ({ locale, module: localeModuleOf(NEXT_BIND_STATE_PAGE, locale) })), lang) });
  const projection: NextBindProjection = {
    schema: NEXT_BIND_SCHEMA, installedBy: "publisher", publicationId: map.publicationId, homeId: home!.id,
    pages: records.map(record => ({
      id: record.id, route: pathOf(map, record.id), module: moduleOf(record.id), frame: record.frame, sections: record.sections,
      copyKeys: [...new Set([...Object.values(record.copy ?? {}), ...Object.values(record.bindings ?? {}).flatMap(binding => Object.values(binding.copy ?? {}))])].sort(),
    })),
    state: { module: moduleOf(NEXT_BIND_STATE_PAGE), frame: home!.frame },
    ...(titleKey !== undefined ? { titleKey } : {}),
  };
  files.push({ file: NEXT_BIND_PROJECTION, pageId: "", content: `${JSON.stringify(projection, null, 2)}\n` });
  return { files, findings, assembly, states, ...(Object.keys(routeParams).length ? { routeParams } : {}) };
}

function posixRelative(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
}

/** Whether a generated bind file is Publisher's: route marker on line one, or the projection's `installedBy`. */
export function isBindGenerated(file: string, content: string): boolean {
  if (file.endsWith(".json")) { try { return (JSON.parse(content) as { installedBy?: unknown }).installedBy === "publisher"; } catch { return false; } }
  return content.split("\n", 1)[0] === NEXT_ROUTE_MARKER;
}

/**
 * The part of `shadcn add <item.json>` a local registry item needs: write each of the item's files
 * (`target`, else `path`) into the project, nothing fetched and no dependency installed. The route
 * checks reinstall with it, so a parity run never reaches a registry or the network.
 */
export const localItemRunner: ShadcnRunner = async (args, { cwd }) => {
  const itemFile = args[1];
  if (args[0] !== "add" || itemFile === undefined) return { code: 1, stdout: "", stderr: `localItemRunner: only \`add <item.json>\` runs locally (${args.join(" ")})` };
  const item = JSON.parse(await readFile(resolve(cwd, itemFile), "utf8")) as { files?: { path: string; target?: string; content?: string }[] };
  for (const file of item.files ?? []) {
    if (typeof file.content !== "string") return { code: 1, stdout: "", stderr: `localItemRunner: ${file.path} carries no content` };
    const out = resolve(cwd, file.target ?? file.path);
    if (relative(cwd, out).startsWith("..")) return { code: 1, stdout: "", stderr: `localItemRunner: ${file.path} writes outside the project` };
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, file.content);
  }
  return { code: 0, stdout: "", stderr: "" };
};
