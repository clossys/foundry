import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { createCopyResolver, resolveCopyRef } from "@clossys/writer";
import type { CopyRegistry } from "@clossys/writer";
import { describe, expect, it } from "vitest";
import { LEGAL_SECTION_IDS, gateLegalDocument } from "../../document/legal.js";
import type { LegalDocumentKind } from "../../document/legal.js";
import { RenderError } from "../../internal/errors.js";
import { LegalView } from "./LegalView.js";
import { NativeLegalView } from "./NativeLegalView.js";
import type { NativeLegalViewDocument, NativeLegalViewProps } from "./NativeLegalView.js";

// Non-client markers only. The legacy approved status exercises the same
// synthetic fixture convention as LegalView.test; no approval record is minted.
function fixture(kind: LegalDocumentKind = "terms"): NativeLegalViewDocument {
  const entries: CopyRegistry["entries"] = [];
  const ref = (name: string) => {
    const id = `synthetic.native-legal.${kind}.${name}`;
    entries.push({ id, text: `SYNTHETIC ${kind} ${name}`, context: "non-client test marker", status: "approved" });
    return { id };
  };
  return {
    document: {
      id: `synthetic-native-${kind}`,
      title: ref("title"),
      sections: LEGAL_SECTION_IDS[kind].map((id, index) => ({
        kind: "section", id, level: 2, heading: ref(`${id}.heading`),
        blocks: [
          { kind: "paragraph", content: [{ kind: "text", text: ref(`${id}.body`) }] },
          ...(index === 0 ? [{
            kind: "section" as const, id: "synthetic-nested", level: 3 as const, heading: ref("nested.heading"),
            blocks: [
              { kind: "paragraph" as const, content: [
                { kind: "text" as const, text: ref("nested.before") },
                { kind: "link" as const, text: ref("nested.link"), href: "#contact" },
                { kind: "strong" as const, content: [{ kind: "text" as const, text: ref("nested.strong") }] },
                { kind: "em" as const, content: [{ kind: "text" as const, text: ref("nested.after") }] },
              ] },
              { kind: "section" as const, id: "synthetic-deep", level: 4 as const, heading: ref("deep.heading"), blocks: [
                { kind: "list" as const, style: "ordered" as const, items: [[{ kind: "text" as const, text: ref("deep.item") }]] },
                { kind: "table" as const, headers: [ref("deep.header")], rows: [[ref("deep.cell")]] },
                { kind: "definition-list" as const, items: [{ term: ref("deep.term"), description: ref("deep.definition") }] },
                { kind: "callout" as const, tone: "info" as const, content: [{ kind: "text" as const, text: ref("deep.note") }] },
              ] },
            ],
          }] : []),
        ],
      })),
      legal: {
        kind, status: "counsel-reviewed", effectiveDate: "2026-01-15", lastUpdated: "2026-02-01",
        variables: { entity: "SYNTHETIC ENTITY", jurisdiction: "SYNTHETIC JURISDICTION", contact: "SYNTHETIC CONTACT" },
      },
    },
    registry: { id: "synthetic-native-legal", locale: "en", revision: "1", source: { kind: "generated", reference: "synthetic-test-markers" }, entries },
    labels: { effectiveDate: ref("label.effective"), lastUpdated: ref("label.updated") },
    locale: "en", target: "production", summary: ref("summary"),
  };
}

const render = (document: NativeLegalViewDocument) => renderToStaticMarkup(<NativeLegalView document={document} landmark="none" />);
const unsafeRender = (props: unknown) => renderToStaticMarkup(<NativeLegalView {...props as NativeLegalViewProps} />);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function freeze(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  Object.values(value).forEach(freeze);
  Object.freeze(value);
}

describe("NativeLegalView whole document", () => {
  it.each(["terms", "privacy"] as const)("preserves the complete %s tree and genuine framed LegalView output", (kind) => {
    const input = JSON.parse(JSON.stringify(fixture(kind))) as NativeLegalViewDocument;
    expect(gateLegalDocument(input.document, input.target).ok).toBe(true);
    const before = hash(input);
    freeze(input);
    const html = render(input);
    const genuine = renderToStaticMarkup(<LegalView framed document={input.document} labels={input.labels}
      locale={input.locale} summary={input.summary} resolveCopyId={createCopyResolver(input.registry, { target: input.target })} />);
    expect(html).toBe(genuine);
    expect(hash(input)).toBe(before);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toMatch(/<main\b|<footer\b/);
    expect([...html.matchAll(/<section id="([^"]+)"/g)].map((match) => match[1]))
      .toEqual([LEGAL_SECTION_IDS[kind][0], "synthetic-nested", "synthetic-deep", ...LEGAL_SECTION_IDS[kind].slice(1)]);
    expect(html).toContain(`<h3>SYNTHETIC ${kind} nested.heading</h3>`);
    expect(html).toContain(`<h4>SYNTHETIC ${kind} deep.heading</h4>`);
    expect(html).toContain(`<a href="#contact">SYNTHETIC ${kind} nested.link</a>`);
    expect(html).toContain(`<strong>SYNTHETIC ${kind} nested.strong</strong>`);
    expect(html).toContain(`<em>SYNTHETIC ${kind} nested.after</em>`);
    // Every marker is present once and the complete body retains source order.
    const body = html.slice(html.indexOf("<article"));
    const bodyEntries = input.registry.entries.filter((entry) => !/\.(title|summary|label\.)/.test(entry.id));
    const positions = bodyEntries.map((entry) => body.indexOf(entry.text));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    for (const entry of input.registry.entries) expect(html.split(entry.text)).toHaveLength(2);
    expect([...html.matchAll(/<time dateTime="([^"]+)"[^>]*>([^<]+)<\/time>/g)].map((match) => [match[1], match[2]]))
      .toEqual([["2026-01-15", "January 15, 2026"], ["2026-02-01", "February 1, 2026"]]);
    expect(html).not.toMatch(/SYNTHETIC ENTITY|SYNTHETIC JURISDICTION|SYNTHETIC CONTACT/);
  });

  it("supports an omitted summary and uses the explicit date locale", () => {
    const input = fixture();
    delete input.summary;
    input.locale = "de";
    const html = render(input);
    expect(html).not.toContain("SYNTHETIC terms summary");
    expect(html).toContain(">15. Januar 2026</time>");
  });

  it("renders a genuine keyed React element without reading key metadata", () => {
    const input = fixture();
    const before = hash(input);
    expect(renderToStaticMarkup(<NativeLegalView key="synthetic-key" document={input} landmark="none" />)).toBe(render(input));
    expect(hash(input)).toBe(before);
  });

  it("leaves the framed view's unused draft heading unresolved", () => {
    const input = fixture();
    const before = render(input);
    input.labels.draftHeading = { id: "synthetic.unresolved-draft-heading" };
    expect(render(input)).toBe(before);
    expect(input.labels.draftHeading.id).toBe("synthetic.unresolved-draft-heading");
  });

  it("exports the genuine adapter through the existing ordinary and server barrels", async () => {
    const barrels = await Promise.all([import("./index.js"), import("./server.js"), import("../index.js")]);
    expect(barrels).toHaveLength(3);
    for (const barrel of barrels) expect(barrel.NativeLegalView).toBe(NativeLegalView);
    // The top-level server barrel follows the package's existing conditional
    // import, which points at compiled views under the normal Node condition.
    const [server, selectedViews] = await Promise.all([import("../server.js"), import("#publisher-web-views")]);
    expect(server.NativeLegalView).toBe(selectedViews.NativeLegalView);
    expect(renderToStaticMarkup(<server.NativeLegalView document={fixture()} landmark="none" />)).toBe(render(fixture()));
    const draft = fixture();
    draft.document.legal.status = "draft";
    draft.document.legal.factsToConfirm = [{ id: "synthetic.unresolved-fact" }];
    expect(() => renderToStaticMarkup(<server.NativeLegalView document={draft} landmark="none" />)).toThrow(/legal document gate/);
  });
});

describe("NativeLegalView authentic refusal", () => {
  it("refuses a valid draft in production while allowing explicit preview", () => {
    const input = fixture();
    input.document.legal.status = "draft";
    input.document.legal.factsToConfirm = [{ id: "synthetic.unresolved-fact" }];
    expect(gateLegalDocument(input.document, "preview").ok).toBe(true);
    const before = hash(input);
    expect(() => render(input)).toThrow(/legal document gate/);
    expect(hash(input)).toBe(before);
    input.target = "preview";
    expect(render(input)).not.toMatch(/unresolved-fact|data-callout-tone="warning"/);
    expect(input.document.legal.status).toBe("draft");
  });

  it("keeps Writer's unapproved-copy production refusal", () => {
    const input = fixture();
    const entry = input.registry.entries.find((candidate) => candidate.id === input.document.title.id)!;
    entry.status = "draft";
    expect(resolveCopyRef(input.registry, input.document.title, { target: "production" }).complete).toBe(false);
    expect(resolveCopyRef(input.registry, input.document.title, { target: "preview" }).complete).toBe(true);
    const before = hash(input);
    expect(() => render(input)).toThrow(RenderError);
    expect(hash(input)).toBe(before);
    input.target = "preview";
    expect(render(input)).toContain(entry.text);
    expect(entry.status).toBe("draft");
  });

  it.each(["title", "body", "label", "summary"])("refuses missing required %s copy without echoing source ids", (slot) => {
    const input = fixture();
    const id = slot === "title" ? input.document.title.id : slot === "label" ? input.labels.effectiveDate.id
      : slot === "summary" ? input.summary!.id : input.registry.entries.find((entry) => entry.id.endsWith("contact.body"))!.id;
    input.registry.entries = input.registry.entries.filter((entry) => entry.id !== id);
    const attempt = () => render(input);
    expect(attempt).toThrow(RenderError);
    expect(attempt).not.toThrow(id);
  });

  it("refuses malformed legal data without echoing gate finding payloads", () => {
    const input = fixture();
    input.document.legal.effectiveDate = "SYNTHETIC-PRIVATE-SENTINEL";
    expect(() => render(input)).toThrow(/legal document gate/);
    expect(() => render(input)).not.toThrow(/SYNTHETIC-PRIVATE-SENTINEL/);
  });
});

describe("NativeLegalView JSON transport", () => {
  it("consumes descriptor data rather than a Proxy's preview target", () => {
    const input = fixture();
    input.document.legal.status = "draft";
    input.document.legal.factsToConfirm = [{ id: "synthetic.unresolved-fact" }];
    let gets = 0;
    const transport = new Proxy(input, { get(target, key) {
      gets++;
      return key === "target" ? "preview" : Reflect.get(target, key);
    } });
    const props = new Proxy({ document: transport, landmark: "none" as const }, { get(target, key) {
      gets++;
      return Reflect.get(target, key);
    } });
    // Direct call: JSX prop spreading would itself invoke the Proxy get trap.
    expect(() => NativeLegalView(props)).toThrow(/legal document gate/);
    expect(gets).toBe(0);
  });

  it("passes the same descriptor snapshot to Writer's approval gate", () => {
    const input = fixture();
    input.registry.entries[0]!.status = "draft";
    const approved = fixture().registry;
    let gets = 0;
    input.registry = new Proxy(input.registry, { get(target, key) {
      gets++;
      return key === "entries" ? approved.entries : Reflect.get(target, key);
    } });
    const before = hash(Object.getOwnPropertyDescriptor(input.registry, "entries")!.value);
    expect(() => renderToStaticMarkup(NativeLegalView({ document: input, landmark: "none" }))).toThrow(RenderError);
    expect(hash(Object.getOwnPropertyDescriptor(input.registry, "entries")!.value)).toBe(before);
    expect(gets).toBe(0);
  });

  it("renders descriptor document, labels and array data without invoking Proxy get", () => {
    const input = fixture();
    const expected = render(input);
    const original = hash(input);
    let gets = 0;
    const wrap = <T extends object,>(value: T): T => new Proxy(value, { get() {
      gets++;
      throw new Error("SYNTHETIC-PRIVATE-SENTINEL");
    } });
    const transport = wrap({
      ...input,
      document: wrap({ ...input.document, sections: wrap(input.document.sections) }),
      registry: wrap({ ...input.registry, entries: wrap(input.registry.entries) }),
      labels: wrap(input.labels),
    });
    expect(renderToStaticMarkup(NativeLegalView({ document: transport, landmark: "none" }))).toBe(expected);
    expect(gets).toBe(0);
    expect(hash(input)).toBe(original);
  });

  it.each(["resolveCopyId", "options", "brand", "framed", "extra"])("refuses unknown transport field %s", (key) => {
    const input = { ...fixture(), [key]: "SYNTHETIC-PRIVATE-SENTINEL" };
    expect(() => unsafeRender({ document: input, landmark: "none" })).toThrow(/transport/);
    expect(() => unsafeRender({ document: input, landmark: "none" })).not.toThrow(/SYNTHETIC-PRIVATE-SENTINEL/);
    expect(() => unsafeRender({ document: fixture(), landmark: "none", [key]: true })).toThrow(/transport/);
  });

  it.each([undefined, null, "main", "region", false])("refuses landmark %s", (landmark) => {
    expect(() => unsafeRender({ document: fixture(), landmark })).toThrow(RenderError);
  });

  it.each([undefined, null, "default", "PRODUCTION", false])("refuses target %s without a default", (target) => {
    expect(() => unsafeRender({ document: { ...fixture(), target }, landmark: "none" })).toThrow(RenderError);
  });

  it.each([undefined, null, [], "json"])("refuses malformed transport %s", (document) => {
    expect(() => unsafeRender({ document, landmark: "none" })).toThrow(RenderError);
  });

  it.each([undefined, null, "", "!!synthetic-locale!!"])("refuses malformed locale %s", (locale) => {
    expect(() => unsafeRender({ document: { ...fixture(), locale }, landmark: "none" })).toThrow(RenderError);
  });

  it.each([undefined, () => "SYNTHETIC", NaN, Infinity, -Infinity, 1n, Symbol("synthetic"),
    new Date(0), new Map(), new Set(), new (class Synthetic {})(), Object.create({ synthetic: true })])("refuses non-JSON nested value %#", (value) => {
    const input = fixture();
    Object.assign(input.registry.entries[0]!, { synthetic: value });
    expect(() => render(input)).toThrow(/JSON/);
  });

  it("rejects cycles, sparse arrays and properties JSON would discard", () => {
    const cycle = fixture();
    Object.assign(cycle.registry, { cycle });
    const sparse = fixture();
    delete sparse.document.sections[1];
    const symbolic = fixture();
    Object.assign(symbolic.labels, { [Symbol("synthetic")]: true });
    const hidden = fixture();
    Object.defineProperty(hidden.registry, "synthetic", { value: true });
    const decorated = fixture();
    Object.assign(decorated.registry.entries, { synthetic: true });
    for (const input of [cycle, sparse, symbolic, hidden, decorated]) expect(() => render(input)).toThrow(/JSON/);
  });

  it("refuses accessors without invoking them or calling toJSON", () => {
    let calls = 0;
    const accessor = fixture();
    Object.defineProperty(accessor.registry, "synthetic", { enumerable: true, get() { calls++; return "SYNTHETIC"; } });
    const custom = fixture();
    Object.assign(custom.registry, { toJSON() { calls++; return {}; } });
    const nestedKey = fixture();
    Object.defineProperty(nestedKey.labels, "key", { get() { calls++; return "SYNTHETIC"; } });
    expect(() => render(accessor)).toThrow(/JSON/);
    expect(() => render(custom)).toThrow(/JSON/);
    expect(() => render(nestedKey)).toThrow(/JSON/);
    expect(calls).toBe(0);
  });
});
