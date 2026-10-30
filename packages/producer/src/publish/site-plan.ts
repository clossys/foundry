/**
 * Publisher assembly plan for `clossys publish --target preview`.
 *
 * Every page is one Frame plus ordered Sections. Designer supplies the look (the selected
 * surface fills), Writer supplies the words (compiled records and section bindings) and
 * Publisher supplies placement, order, routes and navigation (its compiled content map,
 * route pack and page Copy lists). This module only joins those three sources: it never
 * invents copy, styling, hrefs or placeholder text. Whatever cannot be joined becomes a
 * build-report row instead of output.
 *
 * Pure: the caller reads every input. No consumer-specific value lives here.
 */

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
type JsonRecord = { readonly [key: string]: Json };

/** One `- <key>: writer:<cell>` bullet of a Publisher page cell. */
export interface PageCopyBinding { readonly key: string; readonly cell: string }
export interface PublisherEntry {
  readonly id: string;
  readonly order: number;
  readonly title: string;
  readonly kind: string;
  readonly path?: string;
  readonly slug?: string;
  readonly source?: { readonly frameId?: string; readonly sectionIds?: readonly string[] };
  readonly pin?: { readonly nav?: boolean; readonly footer?: boolean };
}
export interface PublisherRouteSlot {
  readonly section: string;
  readonly config?: string;
  readonly state?: string;
  readonly heldBy?: string;
  /** Host-injected data the Publisher owns (for example action destinations), keyed by contract field path. */
  readonly data?: Readonly<Record<string, Json>>;
}
export interface PublisherRoute {
  readonly instanceId: string;
  readonly path: string;
  readonly slots: readonly PublisherRouteSlot[];
  readonly requested?: readonly { readonly agent?: string; readonly section?: string; readonly config?: string }[];
}
export interface PublisherInput {
  readonly publicationId: string;
  readonly entries: readonly PublisherEntry[];
  readonly routes: readonly PublisherRoute[];
  /** Page cell id → Copy bullets; entry id → page cell id. */
  readonly copy: Readonly<Record<string, readonly PageCopyBinding[]>>;
  readonly cellOfEntry: Readonly<Record<string, string>>;
}

export interface WriterRecord { readonly id: string; readonly context?: string; readonly text: string }
export interface WriterSectionBinding {
  readonly sectionId: string;
  readonly configId: string;
  readonly fields: readonly { readonly key: string; readonly ref: { readonly id: string } }[];
}
export interface WriterInput {
  readonly aliases: Readonly<Record<string, string>>;
  readonly records: readonly WriterRecord[];
  readonly sections: readonly WriterSectionBinding[];
}

export interface ContractSlot { readonly name: string; readonly type: string; readonly required?: boolean }
export interface SectionContract { readonly slots: readonly ContractSlot[]; readonly anatomy?: { readonly header?: string | null; readonly band?: string | null } | null }
/** A selected surface fill entry (`profile.surfaces.fills[leaf].document[layer][name]`). */
export interface SurfaceFill {
  readonly id: string;
  readonly slots: readonly string[];
  readonly members: readonly string[];
  readonly configs: Readonly<Record<string, string>>;
}
export interface DesignerInput {
  /** Active Designer cell ids (`tree.json` active). */
  readonly active: ReadonlySet<string>;
  /** Selected surface fills, keyed by leaf. */
  readonly fills: Readonly<Record<string, SurfaceFill>>;
  readonly contracts: Readonly<Record<string, SectionContract>>;
  /** Registered package renderer leaves → the content keys their own sample delivers. */
  readonly renderers: Readonly<Record<string, readonly string[]>>;
  /** The consumer's mark as a site-relative image URL, when Designer has one. */
  readonly mark?: { readonly src: string; readonly width: number; readonly height: number };
}

export type ReportAgent = "designer" | "writer" | "publisher";
export interface BuildRequest { readonly agent: ReportAgent; readonly subject: string; readonly need: string }
export interface EmptySlot { readonly page: string; readonly slot: string; readonly section: string; readonly reason: string }
export interface UnboundKey { readonly page: string; readonly key: string; readonly reason: string }
export interface BuildReport {
  readonly publication: string;
  readonly pages: { id: string; path: string; frame: string; sections: string[] }[];
  readonly emptySlots: EmptySlot[];
  readonly unboundKeys: UnboundKey[];
  readonly requests: BuildRequest[];
}

export interface PlannedContent { readonly kind: string; readonly ref: string; readonly value: Json }
export interface PlannedSurface {
  readonly leaf: string;
  readonly fill: string;
  readonly config: string | null;
  readonly slots: readonly string[];
  readonly members: readonly string[];
  readonly content: Readonly<Record<string, PlannedContent>>;
}
export interface PlannedSection extends PlannedSurface {
  /** `<page>/<index>`: stable slot identity in the build report. */
  readonly slot: string;
  /** Header copy composed through the consumer's own header section when the renderer has no header channel. */
  readonly header?: PlannedSurface;
  /** Writer texts this Section binds, checked against the rendered output. */
  readonly texts: readonly { readonly key: string; readonly text: string }[];
}
export interface PlannedPage {
  readonly id: string;
  readonly path: string;
  readonly meta: { readonly title?: string; readonly description?: string };
  readonly frame?: PlannedSurface & { readonly texts: readonly { readonly key: string; readonly text: string }[] };
  readonly sections: readonly PlannedSection[];
}
export interface SitePlan { readonly publication: string; readonly pages: readonly PlannedPage[]; readonly report: BuildReport }

/**
 * Frame copy ports. Publisher Copy keys name the port; the value is the Frame content path it fills.
 * Frame contracts declare no copy ports yet, so this table is the renderer's provisional wiring and
 * is reported as a Designer request whenever it is used.
 */
export const FRAME_COPY_PORTS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  "frames.site-shell": Object.freeze({
    "skip-link": "skip-link",
    "brand-name": "header.brand.label",
    "nav-label": "header.nav.label",
    "menu-open": "header.nav.triggerLabel",
    "menu-close": "header.nav.closeLabel",
    "footer-identity": "footer.legal.entity",
    "footer-legal-label": "footer.legal.linksLabel",
  }),
});
/** Page Copy keys that fill the document head rather than a Frame or Section. */
export const DOCUMENT_COPY_KEYS = Object.freeze({ title: "meta-title", description: "meta-description" });
const SECTION_HEADER_KEY = "header";
const UNSAFE_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

const isRecord = (value: unknown): value is Record<string, Json> => !!value && typeof value === "object" && !Array.isArray(value);

/** `a.b[0].c` → ["a", "b", 0, "c"]; undefined for an unsafe or malformed path. */
export function fieldPath(key: string): (string | number)[] | undefined {
  const parts: (string | number)[] = [];
  for (const segment of key.split(".")) {
    const match = /^([A-Za-z][A-Za-z0-9-]*)((?:\[\d+\])*)$/.exec(segment);
    if (!match || UNSAFE_SEGMENTS.has(match[1]!)) return undefined;
    parts.push(match[1]!);
    for (const index of match[2]!.matchAll(/\[(\d+)\]/g)) parts.push(Number(index[1]));
  }
  return parts;
}

/** Write one value at a field path into a plain JSON tree, creating objects and arrays as named. */
export function assign(target: Record<string, unknown>, path: readonly (string | number)[], value: Json): boolean {
  let node: any = target;
  for (let index = 0; index < path.length; index++) {
    const part = path[index]!, last = index === path.length - 1;
    if (last) { if (node[part] !== undefined) return false; node[part] = value; return true; }
    const next = path[index + 1]!;
    if (node[part] === undefined) node[part] = typeof next === "number" ? [] : {};
    node = node[part];
    if (typeof next === "number" ? !Array.isArray(node) : !isRecord(node)) return false;
  }
  return false;
}

/**
 * Host-injected row identities: every record in a list gets `id = <list>-<n>` unless it has one.
 * Holes left by missing records are compacted first.
 * Identities are structural keys, never visible copy.
 */
export function withRowIds(value: unknown, name = "item"): Json {
  // A list row whose Writer record is missing is left out (and reported), never rendered as a gap.
  if (Array.isArray(value)) return value.filter(row => row !== undefined && row !== null).map((row, index) => {
    const filled = withRowIds(row, name);
    return isRecord(filled) && filled.id === undefined ? { id: `${name}-${index + 1}`, ...filled } : filled;
  });
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, row]) => [key, withRowIds(row, key)]));
  return value as Json;
}

/**
 * Leaf adapters between Writer's contract field shape and a package renderer's input shape.
 * Each is a structural reshaping of bound content, never new copy, and is reported when applied.
 */
export const CONTENT_ADAPTERS: Readonly<Record<string, (content: Record<string, Json>) => string | undefined>> = Object.freeze({
  // Contract copy fields name `rows[].cells[]` as a list aligned with `columns[]`; the renderer reads cells keyed by column id.
  "sections.comparison": (content: Record<string, Json>) => {
    const columns = content.columns, rows = content.rows;
    if (!Array.isArray(columns) || !Array.isArray(rows)) return undefined;
    let adapted = false;
    content.rows = rows.map(row => {
      if (!isRecord(row) || !Array.isArray(row.cells)) return row;
      adapted = true;
      const cells: Record<string, Json> = {};
      row.cells.forEach((cell, index) => {
        const column = columns[index];
        const id = isRecord(column) && typeof column.id === "string" ? column.id : undefined;
        if (id === undefined) return;
        cells[id] = isRecord(cell) && typeof cell.text === "string" ? { type: "text", text: cell.text } : cell;
      });
      return { ...row, cells };
    });
    return adapted ? "rows[].cells[] list re-keyed by column id with type text" : undefined;
  },
});

class Report {
  readonly emptySlots: EmptySlot[] = [];
  readonly unboundKeys: UnboundKey[] = [];
  private readonly requests = new Map<string, BuildRequest>();
  request(agent: ReportAgent, subject: string, need: string): void {
    const key = `${agent}\0${subject}\0${need}`;
    if (!this.requests.has(key)) this.requests.set(key, { agent, subject, need });
  }
  get requestList(): BuildRequest[] { return [...this.requests.values()]; }
}

/** Writer text by alias (`<cell>.<key>`), falling back to a record whose context is that alias. */
function writerText(writer: WriterInput) {
  const byId = new Map(writer.records.map(record => [record.id, record]));
  const byContext = new Map(writer.records.filter(record => record.context).map(record => [record.context!, record]));
  return {
    alias(alias: string): string | undefined {
      const id = Object.hasOwn(writer.aliases, alias) ? writer.aliases[alias] : undefined;
      const record = (id ? byId.get(id) : undefined) ?? byContext.get(alias);
      return typeof record?.text === "string" && record.text.trim() ? record.text : undefined;
    },
    record(id: string): string | undefined {
      const text = byId.get(id)?.text;
      return typeof text === "string" && text.trim() ? text : undefined;
    },
  };
}

/** Legal-style body copy: blank-line paragraphs become typed paragraph records. */
function richBody(text: string): Json {
  return text.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean).map(part => ({ kind: "paragraph", text: part }));
}

function frameContent(leaf: string, texts: Map<string, string>, entries: readonly PublisherEntry[], current: string, designer: DesignerInput, page: string, report: Report): { content: Record<string, PlannedContent>; used: Set<string> } | undefined {
  const ports = FRAME_COPY_PORTS[leaf];
  if (!ports) { report.request("designer", leaf, "declare the frame's copy ports; the preview renderer has no port table for this frame"); return undefined; }
  const tree: Record<string, unknown> = {}, used = new Set<string>();
  for (const [key, path] of Object.entries(ports)) {
    const text = texts.get(key);
    if (text === undefined) continue;
    assign(tree, fieldPath(path)!, text);
    used.add(key);
  }
  report.request("designer", leaf, `declare copy ports in the frame contract (preview wires ${Object.keys(ports).join(", ")} provisionally)`);
  const header = (tree.header ??= {}) as Record<string, any>;
  if (leaf === "frames.site-shell") {
    const brand = (header.brand ??= {}) as Record<string, unknown>;
    if (designer.mark) brand.mark = { ...designer.mark };
    else report.request("designer", "assets.mark", "activate a mark asset; the site header needs a brand image");
    // A nav without its own label would make the frame fall back to copy nobody authored.
    if (!used.has("nav-label")) {
      for (const key of ["menu-open", "menu-close"]) used.delete(key);
      delete header.nav;
    } else {
      const links = entries.filter(entry => entry.pin?.nav && entry.path !== undefined).map(entry => ({ entry, label: texts.get(`title:${entry.id}`) }));
      for (const row of links) if (row.label === undefined) report.unboundKeys.push({ page, key: row.entry.title, reason: "navigation label has no Writer record" });
      header.nav = { ...(header.nav ?? {}), links: links.filter(row => row.label !== undefined).map(row => ({ label: row.label!, href: row.entry.path!, ...(row.entry.id === current ? { isCurrent: true } : {}) })) };
    }
    if (tree.footer !== undefined) {
      const footer = tree.footer as Record<string, any>;
      const legal = entries.filter(entry => entry.pin?.footer && entry.path !== undefined && texts.get(`title:${entry.id}`) !== undefined);
      footer.legal = { ...(footer.legal ?? {}), links: legal.map(entry => ({ label: texts.get(`title:${entry.id}`)!, href: entry.path! })) };
      if (!footer.legal.entity) delete tree.footer;
    }
  }
  const content: Record<string, PlannedContent> = {};
  for (const [slot, value] of Object.entries(tree)) {
    if (isRecord(value) && !Object.keys(value).length) continue;
    content[slot] = { kind: "region", ref: `publisher:${page}/frame/${slot}`, value: value as Json };
  }
  return { content, used };
}

/** Join Publisher placement, Writer copy and Designer selection into renderable pages and a report. */
export function planSite(publisher: PublisherInput, writer: WriterInput, designer: DesignerInput): SitePlan {
  const report = new Report();
  const text = writerText(writer);
  const routes = new Map(publisher.routes.map(route => [route.instanceId, route]));
  const pages: PlannedPage[] = [];
  const reportPages: BuildReport["pages"] = [];
  const entries = [...publisher.entries].filter(entry => entry.kind === "page").sort((a, b) => a.order - b.order);
  const reachable = new Set(entries.filter(entry => entry.pin?.nav || entry.pin?.footer).map(entry => entry.id));
  for (const entry of entries) {
    if (entry.path === undefined) { report.request("publisher", entry.id, "give the page a path; slug-only pages are not served by the preview"); continue; }
    const page = entry.id, cell = publisher.cellOfEntry[page];
    const bindings = cell ? publisher.copy[cell] ?? [] : [];
    const texts = new Map<string, string>(), used = new Set<string>();
    const sectionConfigs = new Set(publisher.routes.find(route => route.instanceId === page)?.slots.map(slot => slot.config).filter((config): config is string => !!config) ?? []);
    for (const binding of bindings) {
      if (sectionConfigs.has(binding.key)) continue;
      const value = text.alias(`${binding.cell}.${binding.key}`);
      if (value === undefined) report.unboundKeys.push({ page, key: binding.key, reason: `writer:${binding.cell} has no record for ${binding.cell}.${binding.key}` });
      else texts.set(binding.key, value);
    }
    for (const other of entries) {
      const label = text.alias(other.title);
      if (label !== undefined) texts.set(`title:${other.id}`, label);
    }
    const meta = { ...(texts.has(DOCUMENT_COPY_KEYS.title) ? { title: texts.get(DOCUMENT_COPY_KEYS.title)! } : {}), ...(texts.has(DOCUMENT_COPY_KEYS.description) ? { description: texts.get(DOCUMENT_COPY_KEYS.description)! } : {}) };
    used.add(DOCUMENT_COPY_KEYS.title); used.add(DOCUMENT_COPY_KEYS.description);
    if (!reachable.has(page) && page !== entries[0]?.id) report.request("publisher", page, "pin the page in navigation or the footer; nothing links to it");

    let frame: PlannedPage["frame"];
    const frameLeaf = entry.source?.frameId;
    if (!frameLeaf) report.request("publisher", page, "place a frame on the page");
    else if (!designer.active.has(frameLeaf) || !designer.fills[frameLeaf]) report.request("designer", frameLeaf, `activate ${frameLeaf}; ${page} places it`);
    else if (!Object.hasOwn(designer.renderers, frameLeaf)) report.request("designer", frameLeaf, "register a package runtime renderer for this frame");
    else {
      const fill = designer.fills[frameLeaf]!;
      const built = frameContent(frameLeaf, texts, entries, page, designer, page, report);
      if (built) {
        for (const key of built.used) used.add(key);
        frame = { leaf: frameLeaf, fill: fill.id, config: null, slots: fill.slots, members: [], content: built.content, texts: [...built.used].map(key => ({ key, text: texts.get(key)! })) };
        const ports = FRAME_COPY_PORTS[frameLeaf] ?? {};
        for (const key of Object.keys(ports)) if (!texts.has(key)) report.request("publisher", page, `bind frame copy key ${key} (${ports[key]})`);
      }
    }
    for (const binding of bindings) if (!sectionConfigs.has(binding.key) && texts.has(binding.key) && !used.has(binding.key)) report.unboundKeys.push({ page, key: binding.key, reason: `no ${frameLeaf ?? "frame"} or document port takes this key` });

    const sections: PlannedSection[] = [];
    const route = routes.get(page);
    if (!route) report.request("publisher", page, "compile Route metadata for the page");
    const placed = entry.source?.sectionIds ?? [];
    (route?.slots ?? []).forEach((slot, index) => {
      const at = `${page}/${index}`, leaf = slot.section;
      const empty = (reason: string) => report.emptySlots.push({ page, slot: at, section: leaf, reason });
      if (!placed.includes(leaf)) { empty("route slot is not in the page's sections"); report.request("publisher", page, `list ${leaf} in the page sections or drop its Route slot`); return; }
      if (!designer.active.has(leaf) || !designer.fills[leaf]) { empty(slot.heldBy ? `no active Designer section (held by ${slot.heldBy})` : "no active Designer section"); report.request("designer", leaf, `activate ${leaf}; ${page} places it`); return; }
      if (slot.state !== "active") report.request("publisher", page, `slot ${leaf} is ${slot.state ?? "unset"}${slot.heldBy ? ` (held by ${slot.heldBy})` : ""} but Designer has activated it; mark it active`);
      const contract = designer.contracts[leaf];
      const sample = designer.renderers[leaf];
      if (!contract || !sample) { empty("no package runtime renderer"); report.request("designer", leaf, "register a package runtime renderer"); return; }
      const fill = designer.fills[leaf]!;
      const binding = writer.sections.find(row => row.sectionId === leaf && row.configId === slot.config);
      const copyBound = bindings.some(row => row.key === slot.config);
      if (!binding || !copyBound) {
        empty(!binding ? `Writer has no section binding ${leaf}/${slot.config ?? "(none)"}` : `page Copy does not bind ${slot.config}`);
        report.request(!binding ? "writer" : "publisher", !binding ? `${leaf}/${slot.config}` : page, !binding ? "author the section binding" : `bind ${slot.config} in the page Copy`);
        return;
      }
      const tree: Record<string, unknown> = {}, boundTexts: { key: string; text: string }[] = [];
      for (const field of binding.fields) {
        const path = fieldPath(field.key), value = text.record(field.ref.id);
        if (!path) { report.unboundKeys.push({ page, key: `${slot.config}.${field.key}`, reason: "unsafe field path" }); continue; }
        if (value === undefined) { report.unboundKeys.push({ page, key: `${slot.config}.${field.key}`, reason: `Writer record ${field.ref.id} is missing or empty` }); continue; }
        const slotType = contract.slots.find(row => row.name === path[0])?.type;
        const rich = path.length === 1 && slotType === "region";
        if (!assign(tree, path, rich ? richBody(value) : value)) { report.unboundKeys.push({ page, key: `${slot.config}.${field.key}`, reason: "conflicting field path" }); continue; }
        boundTexts.push({ key: `${slot.config}.${field.key}`, text: value });
      }
      for (const [key, value] of Object.entries(slot.data ?? {})) {
        const path = fieldPath(key);
        if (!path || !assign(tree, path, value)) report.unboundKeys.push({ page, key: `${slot.config}.${key}`, reason: "Publisher data path is unsafe or conflicts with Writer copy" });
      }
      const content = withRowIds(tree) as Record<string, Json>;
      const adapted = CONTENT_ADAPTERS[leaf]?.(content);
      if (adapted) report.request("designer", leaf, `align the renderer input with the contract copy fields (preview adapts: ${adapted})`);
      const planned: Record<string, PlannedContent> = {};
      let header: PlannedSurface | undefined;
      const slotNames = contract.slots.map(row => row.name);
      for (const [name, value] of Object.entries(content)) {
        const mapped = slotNames.includes(name) && fill.slots.includes(name);
        const headerChannel = name === SECTION_HEADER_KEY && !slotNames.includes(name) && !!contract.anatomy?.header && sample.includes(name);
        if (mapped || headerChannel) { planned[name] = { kind: headerChannel ? "copy" : contract.slots.find(row => row.name === name)!.type, ref: `writer:${slot.config}/${name}`, value }; continue; }
        const headerLeaf = contract.anatomy?.header;
        if (name === SECTION_HEADER_KEY && headerLeaf && designer.fills[headerLeaf] && designer.active.has(headerLeaf) && designer.contracts[headerLeaf] && isRecord(value)) {
          const headerFill = designer.fills[headerLeaf]!, headerSlots = designer.contracts[headerLeaf]!.slots;
          const headerContent: Record<string, PlannedContent> = {};
          for (const [part, partValue] of Object.entries(value)) {
            if (headerSlots.some(row => row.name === part) && headerFill.slots.includes(part)) headerContent[part] = { kind: headerSlots.find(row => row.name === part)!.type, ref: `writer:${slot.config}/header.${part}`, value: partValue };
            else report.unboundKeys.push({ page, key: `${slot.config}.header.${part}`, reason: `${headerLeaf} has no ${part} slot` });
          }
          header = { leaf: headerLeaf, fill: headerFill.id, config: null, slots: headerFill.slots, members: [], content: headerContent };
          report.request("designer", leaf, `deliver the anatomy header through the renderer (preview composes ${headerLeaf} before the section)`);
          continue;
        }
        report.unboundKeys.push({ page, key: `${slot.config}.${name}`, reason: `${leaf} has no ${name} slot in the selected fill` });
      }
      const missing = contract.slots.filter(row => row.required && planned[row.name] === undefined).map(row => row.name);
      if (missing.length) { empty(`required content missing: ${missing.join(", ")}`); report.request("writer", `${leaf}/${slot.config}`, `bind ${missing.join(", ")}`); return; }
      const config = slot.config && Object.hasOwn(fill.configs, slot.config) ? slot.config : null;
      const members = config ? fill.members.filter(member => member === config) : [];
      sections.push({ slot: at, leaf, fill: fill.id, config, slots: fill.slots, members, content: planned, ...(header ? { header } : {}), texts: boundTexts });
    });
    for (const request of route?.requested ?? []) {
      if (!request.section) continue;
      const active = designer.active.has(request.section) && !!designer.fills[request.section];
      report.emptySlots.push({ page, slot: `${page}/requested`, section: request.section, reason: active ? "requested section is active in Designer but not placed by Publisher" : "requested section is not active in Designer" });
      if (active) report.request("publisher", page, `place ${request.section}${request.config ? ` (${request.config})` : ""} now that Designer has activated it`);
      else report.request("designer", request.section, `activate ${request.section}; ${page} requests it`);
    }
    pages.push({ id: page, path: entry.path, meta, ...(frame ? { frame } : {}), sections });
    reportPages.push({ id: page, path: entry.path, frame: frame?.leaf ?? "(none)", sections: sections.map(section => section.leaf) });
  }
  return { publication: publisher.publicationId, pages, report: { publication: publisher.publicationId, pages: reportPages, emptySlots: report.emptySlots, unboundKeys: report.unboundKeys, requests: report.requestList } };
}
