import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { loadCatalog } from "../catalog.js";
import { parseCell, serializeCell } from "./cell.js";
import { parseRef, formatRef } from "./ref.js";
import { parseSession } from "./session.js";
import { parseFinding, validateFinding } from "./finding.js";
import { validateRequest } from "./request.js";
import { validateTree } from "./tree.js";

const example = readFileSync(new URL("../../test-fixtures/strategy-v2/example/cells/focus.segment.core/v2.md", import.meta.url), "utf8");
const finding = readFileSync(new URL("../../test-fixtures/strategy-v2/example/findings/studio-interviews-2026-10.md", import.meta.url), "utf8");
const catalog = loadCatalog();
const tree = () => ({ schemaVersion: 1, catalog: "@clossys/strategist#strategy-v1", archetype: "default", core: "archetype", active: {} });

describe("cell format", () => {
  it("round-trips optional same-agent and cross-agent links", () => {
    const links = ["focus.segment.core@2", "strategist:identity.visual.palette@2", "designer:frames.app-shell@1", "writer:admin.writer@3", "publisher:page.home@1"];
    const text = example.replace("functions: [gtm, product]", `functions: [gtm, product]\nlinks: [${links.join(", ")}]`);
    const parsed = parseCell(text);
    expect(parsed).toMatchObject({ ok: true, value: { links } });
    if (parsed.ok) expect(serializeCell(parsed.value)).toBe(text);
  });
  it("preserves omitted links and explicit empty links separately", () => {
    for (const text of [example, example.replace("functions: [gtm, product]", "functions: [gtm, product]\nlinks: []")]) {
      const parsed = parseCell(text);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(serializeCell(parsed.value)).toBe(text);
    }
  });
  it.each([
    "designer:frames.app-shell@0", "writer:admin.writer@01", "publisher:page.home@9007199254740992",
    "designer:frames.app-shell", "designer:frames.app-shell@1.5", "designer:Frames.app-shell@1",
    "designer:../outside@1", "designer:one@1", "writer:one.two.three.four@1", "msg:2026-10-29-1#U2",
    "designer:frames.app-shell@1 trailing", "designer:frames.app-shell@1:extra",
  ])("rejects invalid shared link %j at its field line", link => {
    const text = example.replace("functions: [gtm, product]", `functions: [gtm, product]\nlinks: [${link}]`);
    const parsed = parseCell(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues).toContainEqual(expect.objectContaining({ path: "links", line: 9 }));
  });
  it.each(["null", "false", "[1]", "designer:frames.app-shell@1"])("requires links to be a string flow list: %s", value => {
    expect(parseCell(example.replace("functions: [gtm, product]", `functions: [gtm, product]\nlinks: ${value}`)).ok).toBe(false);
  });
  it.each(["designer:frames.app-shell@1\n", "designer:frames.app-shell@1\r", " designer:frames.app-shell@1", "designer:frames.app-shell@1 "])("rejects whitespace inside quoted link %j", link => {
    const parsed = parseCell(example.replace("functions: [gtm, product]", `functions: [gtm, product]\nlinks: [${JSON.stringify(link)}]`));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues).toContainEqual(expect.objectContaining({ path: "links", line: 9 }));
  });
  it("keeps all 57 catalog leaf templates without links byte-compatible", () => {
    expect(catalog.cells).toHaveLength(57);
    for (const { id } of catalog.cells) {
      const text = example.replace("id: focus.segment.core", `id: ${id}`);
      const parsed = parseCell(text);
      expect(parsed.ok, id).toBe(true);
      if (parsed.ok) expect(serializeCell(parsed.value), id).toBe(text);
    }
  });
  it("keeps the existing published worked templates byte-compatible", () => {
    for (const path of ["../../skill/templates/cell.md", "../../docs/v2/templates/cell.md"]) {
      const template = readFileSync(new URL(path, import.meta.url), "utf8");
      const worked = [...template.matchAll(/```markdown\n(---\nid: focus\.segment\.core\n[\s\S]*?)```/g)];
      expect(worked, path).toHaveLength(1);
      for (const match of worked) {
        const parsed = parseCell(match[1]!);
        expect(parsed.ok, path).toBe(true);
        if (parsed.ok) expect(serializeCell(parsed.value), path).toBe(match[1]);
      }
    }
  });
  it("preserves the frozen three-segment Strategist id grammar", () => {
    for (const id of ["focus.segment", "focus.segment.core.extra", "focus.segment.core2"]) {
      expect(parseCell(example.replace("id: focus.segment.core", `id: ${id}`)).ok).toBe(false);
    }
  });
  it("round-trips the complete worked template byte for byte, with labels and refs", () => {
    const parsed = parseCell(example, "cells/focus.segment.core/v2.md");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeCell(parsed.value)).toBe(example);
    expect(parsed.value.direction[0]).toMatchObject({ key: "Who", line: 14 });
    expect(parsed.value.direction[0]!.text).toMatch(/^owners of/);
    expect(parsed.value.because[0]!.refs).toEqual([{ kind: "msg", session: "2026-10-29-1", line: "U4" }]);
    expect(parsed.value.because[0]!.text).toMatch(/\(msg:2026-10-29-1#U4\)\.$/);
    expect(parsed.value.path).toBe("cells/focus.segment.core/v2.md");
  });
  it.each([
    ["nested mapping", example.replace("note: Narrowed", "note:\n  nested: Narrowed")],
    ["nested flow", example.replace("functions: [gtm, product]", "functions: [[gtm], product]")],
    ["flow map", example.replace("functions: [gtm, product]", "functions: [{role: gtm}]")],
    ["duplicate key", example.replace("version: 2", "version: 2\nversion: 3")],
    ["block scalar", example.replace("note: Narrowed", "note: |\nNarrowed")],
    ["unknown key", example.replace("version: 2", "version: 2\nextra: value")],
    ["non-bullet", example.replace("- Who:", "Who:")],
    ["wrong order", example.replace("## Because", "## TEMP").replace("## Watch", "## Because").replace("## TEMP", "## Watch")],
    ["repeated section", example + "\n## Watch\n- again\n"],
    ["missing section", example.slice(0, example.indexOf("## Watch"))],
    ["invalid date", example.replace("updated: 2026-10-29", "updated: 2026-02-30")],
    ["unsafe version", example.replace("version: 2", "version: 9007199254740992")],
    ["missing required", example.replace("feeds: [writer.messaging, customer.persona]\n", "")],
    ["active confirm", example.replace("confirmed: msg:2026-10-29-1#U9\n", "")],
    ["cell confirm", example.replace("confirmed: msg:2026-10-29-1#U9", "confirmed: focus.segment.core@1")],
  ])("rejects %s with a physical line number", (_, input) => {
    const parsed = parseCell(input);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues.every(issue => issue.line > 0)).toBe(true);
  });
  it("supports quoted scalars and flow list entries with commas", () => {
    const parsed = parseCell(example.replace("functions: [gtm, product]", 'functions: ["gtm", "product"]')
      .replace("note: Narrowed from v1; home potters dropped after the pricing pushback.", 'note: "A comma, a colon: and \\"quote\\"."'));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parseCell(serializeCell(parsed.value))).toMatchObject({ ok: true, value: { note: 'A comma, a colon: and "quote".' } });
  });
  it("leaves quality and cross-record checks to the checks layer", () => {
    const minimal = example.replace(/cites: \[.*\]/, "cites: []").replace(/- Owners called.*\n/, "- An ungrounded reason\n");
    expect(parseCell(minimal).ok).toBe(true);
  });
});

describe("references", () => {
  it.each(["focus.segment.core@1", "aspiration.goal.long-term@42", "msg:2026-10-29-1#U4", "msg:2026-10-29-1#S12", "finding:studio-interviews-2026-10"])("round-trips %s", text => {
    expect(formatRef(parseRef(text)!)).toBe(text);
  });
  it.each(["focus.segment.core@0", "focus.segment.core@01", "focus.segment.core@-1", "focus.segment.core@1.5", "focus.segment.core@9007199254740992", "strategy:focus.segment.core@1", "finding:../outside", "finding:", "msg:../escape#U1", "msg:2026-10-29-1#U0", "msg:2026-02-30-1#U1", "msg:2026-10-29-1#A1", "focus.segment.core@1\n"])("rejects malformed %j", text => {
    expect(parseRef(text)).toBeUndefined();
  });
});

describe("sessions, findings and requests", () => {
  it("indexes U/S ids while preserving physical conversation order", () => {
    const parsed = parseSession("- U4: Need it\n- S6: Playback: focus.segment.core@2, advantage.proposition.promise@1.\n- U7: Yes\n", "2026-10-29-1");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.index.U7).toMatchObject({ line: 3, role: "user", text: "Yes" });
    expect(parsed.value.lines[1]!.refs).toHaveLength(2);
    expect(parsed.value.lines.map(line => line.id)).toEqual(["U4", "S6", "U7"]);
  });
  it.each(["- U1: first\n- U1: duplicate\n", "U1: missing bullet\n", "- X1: invalid\n", "- U0: zero\n"])("rejects invalid session %j", text => expect(parseSession(text, "2026-10-29-1").ok).toBe(false));
  it("parses a sourced numeric finding", () => {
    const parsed = parseFinding(finding);
    expect(parsed).toMatchObject({ ok: true, value: { value: 11, aliases: ["eleven of fourteen owners"], bullets: [{ text: expect.any(String), line: 10 }, { text: expect.any(String) }] } });
    if (parsed.ok) {
      expect(validateFinding(parsed.value).ok).toBe(true);
      expect(validateFinding({ ...parsed.value, observed: "2026-13-01" }).ok).toBe(false);
      expect(validateFinding({ ...parsed.value, value: {} }).ok).toBe(false);
    }
    expect(parseFinding(finding.replace("- 14 studio", "14 studio")).ok).toBe(false);
    expect(parseFinding(finding.replace("source: user", "source: /outside/evidence.md")).ok).toBe(false);
  });
  const request = { id: "REQ-0007", raisedBy: "@clossys/writer", kind: "missing", cells: ["identity.verbal.voice"], detail: "Voice has no active version", status: "open", opened: "2026-10-29", resolvedBy: null };
  it("validates requests and converts their resolving ref", () => {
    expect(validateRequest(request)).toMatchObject({ ok: true, value: { resolvedBy: null } });
    expect(validateRequest({ ...request, status: "resolved", resolvedBy: "focus.segment.core@2" })).toMatchObject({ ok: true, value: { resolvedBy: { kind: "cell", ref: { cell: "focus.segment.core", version: 2 } } } });
    expect(validateRequest({ ...request, resolvedBy: "msg:2026-10-29-1#U7" }).ok).toBe(true);
  });
  it.each([{ id: "REQ-x" }, { kind: "other" }, { status: "other" }, { cells: ["not-a-cell"] }, { cells: ["identity.verbal.unknown"] }, { resolvedBy: "finding:source" }, { opened: "2026-02-30" }, { detail: "" }, { status: "resolved" }])("rejects invalid request fields %j", fields => expect(validateRequest({ ...request, ...fields }, catalog).ok).toBe(false));
});

describe("consumer tree", () => {
  it("accepts optional empty retired ids without adding a field to existing trees", () => {
    const original = tree();
    expect(validateTree(original)).toEqual({ ok: true, value: original });
    expect(original).not.toHaveProperty("retired");
    expect(validateTree({ ...original, retired: [] })).toEqual({ ok: true, value: { ...original, retired: [] } });
  });
  it.each([null, "", {}, [1], ["not-a-cell"], ["focus.segment.unknown"], ["focus.segment.core"], ["focus.segment.core", "focus.segment.core"]])("rejects invalid retired list %j", retired => {
    expect(validateTree({ ...tree(), retired }).ok).toBe(false);
  });
  it("keeps unknown tree keys as errors", () => {
    expect(validateTree({ ...tree(), retired: [], metadata: {} }).ok).toBe(false);
  });
  const grouping = () => catalog.ia.nodes.map(node => ({ id: node.id, name: node.name, children: node.children.map(child => ({ id: child.id, name: child.name, cells: [...child.leaves] })) }));
  it("uses catalog grouping when omitted, and permits regrouping without renaming leaves", () => {
    expect(validateTree(tree(), catalog).ok).toBe(true);
    const groups = grouping();
    groups[0]!.id = "renamed";
    groups[0]!.children[0]!.id = "renamed.group";
    groups[0]!.children[0]!.cells.push(groups[1]!.children[0]!.cells.pop()!);
    expect(validateTree({ ...tree(), tree: groups }, catalog).ok).toBe(true);
  });
  it("rejects missing, renamed and duplicate leaves", () => {
    for (const mutate of [(a: string[]) => a.pop(), (a: string[]) => { a[0] = "context.market.renamed"; }, (a: string[]) => a.push(a[0]!)]) {
      const groups = grouping(); mutate(groups[0]!.children[0]!.cells);
      expect(validateTree({ ...tree(), tree: groups }, catalog).ok).toBe(false);
    }
  });
  it.each([0, -1, 1.5, "1", true, 9007199254740992])("rejects active pointer %j", version => expect(validateTree({ ...tree(), active: { "focus.segment.core": version } }, catalog).ok).toBe(false));
  it("allows null pointers and a superset of default core", () => {
    expect(validateTree({ ...tree(), active: { "focus.segment.core": null }, core: [...catalog.archetypes.default, "context.market.size"] }, catalog).ok).toBe(true);
    expect(validateTree({ ...tree(), core: catalog.archetypes.default.slice(1) }, catalog).ok).toBe(false);
    expect(validateTree({ ...tree(), archetype: "unknown" }, catalog).ok).toBe(false);
    expect(validateTree({ ...tree(), active: { "focus.segment.unknown": 1 } }, catalog).ok).toBe(false);
  });
});
