import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  CELL_ID_PATTERN, cellPath, formatLinkRef, isoDate, parseConfirmRef,
  parseDocument, parseLinkRef, positiveInteger, readBullet, serializeScalar,
  strings, tokenizeBody, validateGenericTree,
} from "./index.js";

const fixtureRoot = new URL("./__fixtures__/conformance/", import.meta.url);
const expected = JSON.parse(readFileSync(new URL("expected.json", fixtureRoot), "utf8")) as Record<string, unknown>;

describe("shared flat frontmatter conformance", () => {
  it("runs every Markdown fixture against independent expected fields, body and issues", () => {
    expect(readdirSync(fixtureRoot).filter(name => name.endsWith(".md")).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, result] of Object.entries(expected)) {
      expect(parseDocument(readFileSync(new URL(name, fixtureRoot), "utf8")), name).toEqual(result);
    }
  });

  it.each([
    ["plain words", "plain words"], ["false", '"false"'], ["01", "01"],
    ["1", '"1"'], ["-1.5", '"-1.5"'], ["a,b", '"a,b"'],
    ["a: b", '"a: b"'], ["[one]", '"[one]"'], ["", '""'],
    ["line\nbreak", '"line\\nbreak"'], ['"quote"', '"\\"quote\\""'],
    [true, "true"], [false, "false"], [1.5, "1.5"], [-2, "-2"],
  ])("serializes %j without changing its scalar type", (value, serialized) => {
    expect(serializeScalar(value)).toBe(serialized);
    expect(parseDocument(`---\nvalue: ${serialized}\n---`)).toMatchObject({ ok: true, value: { fields: { value } } });
  });

  it("keeps the flat parser independent of an agent's required/allowed keys", () => {
    expect(parseDocument("---\nprofileSpecific: accepted here\n---")).toMatchObject({ ok: true, value: { fields: { profileSpecific: "accepted here" } } });
    expect(strings([])).toBe(true);
    expect(strings(["a", "b"])).toBe(true);
    expect(strings(["a", 1])).toBe(false);
    expect(strings("a")).toBe(false);
  });
});

describe("legacy bullet contract", () => {
  it("preserves labels, source text, terminal citations and physical lines", () => {
    expect(readBullet("- Evidence 2: Verified (focus.segment.core@2, msg:2026-10-29-1#S3, finding:sample-1).", 37)).toEqual({
      key: "Evidence 2", text: "Verified (focus.segment.core@2, msg:2026-10-29-1#S3, finding:sample-1).", line: 37,
      refs: [{ kind: "cell", ref: { cell: "focus.segment.core", version: 2 } }, { kind: "msg", session: "2026-10-29-1", line: "S3" }, { kind: "finding", id: "sample-1" }],
    });
  });

  it.each([
    "- Parentheses (ordinary prose)", "- Mixed refs (focus.segment.core@1, bad)",
    "- A ref (focus.segment.core@1) followed by prose", "- Shared links (designer:tokens.accent@1)",
    "- Two segments (tokens.accent@1)",
  ])("keeps non-legacy citations as ordinary text: %s", text => {
    expect(readBullet(text, 8)).toEqual({ text: text.slice(2), refs: [], line: 8 });
  });

  it.each(["plain", " - indented", "-", "- ", "- \t"])("rejects non-bullet %j", text => {
    expect(readBullet(text, 4)).toBeUndefined();
  });
});

describe("body tokenization with physical line numbers", () => {
  it("retains Writer raw lines and headings, bullets and structured JSON", () => {
    const text = ["## en", "### writer.title", '<!-- {"id":"sample"} -->', "Plain record text", "", "- Tone: Clear", "```json", '{"nested": [true, 2]}', "```", "# Raw", "#### Raw"].join("\n");
    expect(tokenizeBody(text)).toEqual({ ok: true, value: [
      { type: "heading", depth: 2, text: "en", line: 1 },
      { type: "heading", depth: 3, text: "writer.title", line: 2 },
      { type: "raw", text: '<!-- {"id":"sample"} -->', line: 3 },
      { type: "raw", text: "Plain record text", line: 4 },
      { type: "raw", text: "", line: 5 },
      { type: "bullet", text: "- Tone: Clear", bullet: { key: "Tone", text: "Clear", refs: [], line: 6 }, line: 6 },
      { type: "json", text: '{"nested": [true, 2]}', value: { nested: [true, 2] }, line: 7, endLine: 9 },
      { type: "raw", text: "# Raw", line: 10 },
      { type: "raw", text: "#### Raw", line: 11 },
    ] });
  });

  it("uses document line numbers and ignores Markdown-looking text inside JSON", () => {
    const parsed = parseDocument('---\nid: writer.title\n---\n## Fill\n```json\n{"text":"## Heading\\n- item"}\n```');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(tokenizeBody(parsed.value.body)).toEqual({ ok: true, value: [
      { type: "heading", depth: 2, text: "Fill", line: 4 },
      { type: "json", text: '{"text":"## Heading\\n- item"}', value: { text: "## Heading\n- item" }, line: 5, endLine: 7 },
    ] });
  });

  it.each([
    ["## Fill\n```json\n{bad}\n```", 2, "Invalid fenced JSON"],
    ["## Fill\n```json\n{}", 2, "Expected closing JSON fence"],
  ])("reports a bad fence at its opening line", (text, line, message) => {
    expect(tokenizeBody(text)).toEqual({ ok: false, issues: [{ path: "body", line, message }] });
  });
});

describe("shared identifiers, references and paths", () => {
  it.each(["tokens.accent-color", "page.home2", "identity.visual.palette", "a1.b2.c3"])("accepts shared id %s", id => {
    expect(CELL_ID_PATTERN.test(id)).toBe(true);
  });
  it.each(["one", "a.b.c.d", "A.b", "a.B", "a._b", "a/b.c", "a..b", "a.b\n"])("rejects shared id %j", id => {
    expect(CELL_ID_PATTERN.test(id)).toBe(false);
  });
  it.each([
    ["tokens.accent-color@2", { cell: "tokens.accent-color", version: 2 }],
    ["designer:tokens.accent-color@2", { agent: "designer", cell: "tokens.accent-color", version: 2 }],
    ["strategist:identity.visual.palette@17", { agent: "strategist", cell: "identity.visual.palette", version: 17 }],
  ])("round-trips link %s", (text, value) => {
    expect(parseLinkRef(text)).toEqual(value);
    expect(formatLinkRef(value)).toBe(text);
  });
  it.each(["tokens.accent@0", "tokens.accent@01", "tokens.accent@-1", "tokens.accent@1.2", "tokens.accent@9007199254740992", " tokens.accent@1", "tokens.accent@1\n", "Designer:tokens.accent@1", ":tokens.accent@1", "designer:writer:tokens.accent@1", "one@1", "a.b.c.d@1"])("rejects malformed link %j", text => {
    expect(parseLinkRef(text)).toBeUndefined();
  });
  it("accepts user confirmations and migration dates", () => {
    expect(parseConfirmRef("msg:2026-10-29-1#U12")).toEqual({ kind: "msg", session: "2026-10-29-1", line: "U12" });
    expect(parseConfirmRef("migration:2024-02-29")).toEqual({ kind: "migration", date: "2024-02-29" });
  });
  it.each(["msg:2026-10-29-1#S1", "msg:2026-10-29-1#U0", "msg:2026-10-29-1#U01", "msg:../outside#U1", "msg:session#U1\n", "migration:2026-02-29", "migration:2026-10-29\n", "tokens.accent@1"])("rejects confirm %j", text => {
    expect(parseConfirmRef(text)).toBeUndefined();
  });
  it("checks safe positive versions, real dates and derived cell paths", () => {
    expect(cellPath("tokens.accent-color", 3)).toBe("cells/tokens.accent-color/v3.md");
    expect(positiveInteger(Number.MAX_SAFE_INTEGER)).toBe(true);
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, "1", null]) expect(positiveInteger(value)).toBe(false);
    expect(isoDate("2024-02-29")).toBe(true);
    for (const value of ["2026-02-29", "2026-13-01", "2026-1-01", "2026-10-29\n", null]) expect(isoDate(value)).toBe(false);
    for (const id of ["../outside", "one", "a.b/c", "a.b\n"]) expect(() => cellPath(id, 1)).toThrow();
    for (const version of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => cellPath("tokens.accent", version)).toThrow();
  });
});

describe("catalog-free generic tree", () => {
  const cellIds = ["tokens.accent", "assets.favicon"];
  const tree = () => ({ schemaVersion: 1, tree: [{ id: "admin", name: "Admin", children: [{ id: "admin.brand", name: "Brand", cells: [...cellIds], icon: "star" }] }], active: { "tokens.accent": 1, "assets.favicon": null }, retired: [], meta: { source: { arbitrary: true } }, agentExtension: "passthrough" });

  it("accepts optional grouping and agent metadata without consulting a catalog", () => {
    const value = tree();
    expect(validateGenericTree(value, { cellIds })).toEqual({ ok: true, value });
    const { tree: _tree, ...ungrouped } = value;
    expect(validateGenericTree(ungrouped, { cellIds })).toEqual({ ok: true, value: ungrouped });
  });

  it("rejects missing, duplicate and unknown placements", () => {
    for (const cells of [[cellIds[0]], [cellIds[0], cellIds[0]], [...cellIds, "page.unknown"]]) {
      const value = tree(); value.tree[0]!.children[0]!.cells = cells as string[];
      const result = validateGenericTree(value, { cellIds });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ path: "tree", line: 1 }));
    }
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1", true])("rejects invalid active pointer %j", version => {
    const value = { ...tree(), active: { "tokens.accent": version } };
    const result = validateGenericTree(value, { cellIds });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ path: "active.tokens.accent", line: 1 }));
  });

  it("rejects unresolved active/retired ids and duplicate retired ids", () => {
    for (const value of [
      { ...tree(), active: { "page.unknown": 1 } },
      { ...tree(), retired: ["page.unknown"] },
      { ...tree(), retired: ["tokens.accent", "tokens.accent"] },
    ]) expect(validateGenericTree(value, { cellIds }).ok).toBe(false);
  });

  it("enforces group uniqueness, separation from cell ids and bounded depth", () => {
    for (const id of ["admin", "tokens.accent"]) {
      const value = tree(); value.tree[0]!.children[0]!.id = id;
      expect(validateGenericTree(value, { cellIds }).ok).toBe(false);
    }
    const deep = { ...tree(), tree: [{ id: "web", name: "Web", children: [{ id: "web.group", name: "Group", children: [{ id: "web.group.inner", name: "Inner", cells: cellIds }] }] }] };
    expect(validateGenericTree(deep, { cellIds }).ok).toBe(false);
    expect(validateGenericTree(deep, { cellIds, maxDepth: 3 })).toEqual({ ok: true, value: deep });
    expect(validateGenericTree({ ...tree(), tree: [{ id: "root", name: "Root", cells: cellIds }] }, { cellIds }).ok).toBe(false);
  });
});

describe("cell-format import boundary", () => {
  it("permits only local sibling modules and Node builtins in every production source", () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const builtin = new Set(builtinModules.map(name => name.replace(/^node:/, "")));
    const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const path = resolve(dir, entry.name);
      return entry.isDirectory() ? sources(path) : entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
    });
    const files = sources(root);
    expect(files.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const path of files) {
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
      const check = (node: ts.Node | undefined) => {
        if (!node || !ts.isStringLiteralLike(node)) { violations.push(`${relative(root, path)}: non-literal module`); return; }
        const specifier = node.text;
        if (builtin.has(specifier.replace(/^node:/, ""))) return;
        if (specifier.startsWith("./") && !specifier.split("/").includes("..") && !relative(root, resolve(dirname(path), specifier)).startsWith("..")) return;
        violations.push(`${relative(root, path)}: ${specifier}`);
      };
      const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) { if (node.moduleSpecifier) check(node.moduleSpecifier); }
        if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) check(node.moduleReference.expression);
        if (ts.isImportTypeNode(node)) check(ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined);
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) check(node.arguments[0]);
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(violations).toEqual([]);
  });
});
