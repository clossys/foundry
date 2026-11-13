import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseWriterSlotBody } from "../slot-body.js";
import { runWriterSlotSuite, type WriterPinnedSlot } from "./checks.js";

const slot = (id: string, body: string, locales = ["en"]): WriterPinnedSlot => ({ slot: id, path: `agents/writer/${id}/candidates/test-v1.md`, locales, rows: parseWriterSlotBody(body, locales) });
const text = (id: string, value: string, meta: Record<string, unknown> = {}) => `### ${id}\n<!-- ${JSON.stringify({ id, bindings: [], ...meta })} -->\n${value}\n\n`;
const json = (id: string, value: Record<string, unknown>) => `### ${id}\n<!-- ${JSON.stringify({ id, bindings: [] })} -->\n\`\`\`json\n${JSON.stringify({ id, context: id, ...value })}\n\`\`\`\n\n`;
const checks = (slots: WriterPinnedSlot[]) => runWriterSlotSuite({ slots }).findings.map(f => `${f.check}:${f.slot}:${f.record ?? ""}`);

describe("writer.copy.v1 over pinned slot candidates", () => {
  it("passes clean rows and counts every row of every slot", () => {
    const result = runWriterSlotSuite({ slots: [slot("strings.actions", `## en\n\n${text("a.save", "Save draft")}`), slot("strings.page-titles", `## en\n\n${text("t.home", "Home")}`)] });
    expect(result.findings.filter(f => f.severity === "error")).toEqual([]);
    expect(result).toMatchObject({ suite: "writer.copy.v1", slots: 2, records: 2 });
  });

  it("checks length against the slot contract chosen by the candidate's slot id", () => {
    const long = "Save every draft you have written today and send it to your team for review";
    expect(checks([slot("strings.actions", `## en\n\n${text("a.long", long)}`)])).toContain("W-LEN:strings.actions:a.long");
    // The same text in a slot with a looser contract is not a length finding.
    expect(checks([slot("strings.descriptions", `## en\n\n${text("d.long", long)}`)]).filter(c => c.startsWith("W-LEN"))).toEqual([]);
  });

  it("applies the pinned lexicon's avoided terms and brand spellings to copy in other slots", () => {
    const lexicon = slot("lexicon.avoid-terms", `## en\n\n${json("term.seamless", { kind: "term", term: "seamless", forms: ["seamlessly"], termStatus: "avoid", reason: "voice" })}`);
    const brand = slot("lexicon.brand-names", `## en\n\n${json("term.clossys", { kind: "term", term: "Clossys", forms: [], termStatus: "brand", reason: "name" })}`);
    const copy = slot("strings.common", `## en\n\n${text("c.one", "Works seamlessly")}${text("c.two", "Open CLOSSYS")}`);
    const found = checks([lexicon, brand, copy]);
    expect(found).toContain("W-VOICE:strings.common:c.one");
    expect(found).toContain("W-BRAND:strings.common:c.two");
    // The lexicon is the source of the rules, not checked against them.
    expect(found.filter(c => c.includes("lexicon."))).toEqual([]);
  });

  it("requires a claim or evidence reference for numbers in claim slots", () => {
    expect(checks([slot("strings.page-titles", `## en\n\n${text("t.claim", "The best studio")}`)])).toContain("W-CLAIM:strings.page-titles:t.claim");
    expect(checks([slot("strings.page-titles", `## en\n\n${text("t.ok", "The best studio", { evidence: "director:advantage.proposition.proof@1" })}`)])).toEqual([]);
    // ICU arguments are not numbers.
    expect(checks([slot("strings.common", `## en\n\n${text("c.count", "{count, plural, one {# step} other {# steps}}")}`)])).toEqual([]);
  });

  it("checks textless records' kind and required properties", () => {
    const bad = slot("lexicon.avoid-terms", `## en\n\n${json("term.bad", { kind: "term", term: "synergy" })}`);
    const found = checks([bad]);
    expect(found).toContain("W-REQ:lexicon.avoid-terms:term.bad");
    expect(runWriterSlotSuite({ slots: [bad] }).findings.map(f => f.key)).toEqual(expect.arrayContaining(["forms", "termStatus", "reason"]));
  });

  it("reports a slot with no Writer contract instead of passing over it", () => {
    expect(checks([slot("strings.nonexistent", `## en\n\n${text("x", "Hello")}`)])).toEqual(["INPUT:strings.nonexistent:"]);
  });

  it("flags repeated text across pages in unique slots", () => {
    const a = slot("strings.page-titles", `## en\n\n${text("home.title", "Clossys Studio")}${text("writer.title", "Clossys Studio")}`);
    expect(checks([a])).toContain("W-DUP:strings.page-titles:writer.title");
    // Uniqueness is the slot's own rule: the same text in another unique slot is not a repeat.
    const b = slot("strings.page-titles", `## en\n\n${text("home.title", "Context")}`);
    const c = slot("strings.descriptions", `## en\n\n${text("director.summary", "Context")}`);
    expect(checks([b, c]).filter(found => found.startsWith("W-DUP"))).toEqual([]);
  });

  it("lets names repeat across pages: a name labels the same thing wherever it appears", () => {
    const names = slot("strings.names", `## en\n\n${text("designer.item.sections.cards", "Cards")}${text("writer.item.passages.cards", "Cards")}`);
    expect(checks([names]).filter(found => found.startsWith("W-DUP"))).toEqual([]);
    // Page titles stay unique per page.
    const titles = slot("strings.page-titles", `## en\n\n${text("designer.title", "Cards")}${text("writer.title", "Cards")}`);
    expect(checks([titles])).toContain("W-DUP:strings.page-titles:writer.title");
  });

  it("reports one brand misspelling once, however many lexicon records name the brand", () => {
    const term = (id: string, value: Record<string, unknown>) => json(id, { kind: "term", termStatus: "brand", reason: "name", ...value });
    const lexicon = slot("lexicon.brand-names", `## en\n\n${term("term.clossys", { term: "Clossys", forms: ["Clossys"] })}`);
    const pronounce = slot("lexicon.pronunciation", `## en\n\n${term("term.pronounce.clossys", { term: "Clossys", forms: ["Clossys"] })}`);
    const copy = slot("strings.common", `## en\n\n${text("c.one", "Open CLOSSYS")}`);
    expect(checks([lexicon, pronounce, copy]).filter(found => found.startsWith("W-BRAND"))).toEqual(["W-BRAND:strings.common:c.one"]);
  });

  it("checks every name a brand record governs, each on its own spelling", () => {
    const agents = slot("lexicon.brand-names", `## en\n\n${json("term.agents", { kind: "term", term: "Director", forms: ["Director", "Designer", "Writer"], termStatus: "brand", reason: "agent names" })}`);
    const copy = slot("strings.common", `## en\n\n${text("c.dir", "Ask the director")}${text("c.des", "Ask the designer")}${text("c.ok", "Ask the Designer and the Writer")}`);
    const found = runWriterSlotSuite({ slots: [agents, copy] }).findings.filter(f => f.check === "W-BRAND");
    expect(found.map(f => f.record)).toEqual(["c.dir", "c.des"]);
    // The message names the accepted form of that name, not every name on the record.
    expect(found[1]!.message).toMatch(/^"designer" should be spelled "Designer" \(/);
  });

  it("does not apply brand spelling inside code, paths, packages or host names", () => {
    const brand = slot("lexicon.brand-names", `## en\n\n${json("term.clossys", { kind: "term", term: "Clossys", forms: ["Clossys"], termStatus: "brand", reason: "name" })}`);
    const copy = slot("strings.common", `## en\n\n${text("c.code", "Run \`clossys check --slots\` to see why.")}${text("c.path", "clossys/")}${text("c.pkg", "Install @clossys/writer.")}${text("c.host", "clossys.com is set at release.")}${text("c.syntax", "Written as <clossys slot>#<key>.")}${text("c.prose", "Run clossys check --slots to see why.")}`);
    expect(checks([brand, copy]).filter(found => found.startsWith("W-BRAND"))).toEqual(["W-BRAND:strings.common:c.prose"]);
  });

  it("does not read an index or a digit specimen as a numeric claim", () => {
    const copy = slot("strings.common", `## en\n\n${text("c.h1", "Heading 1")}${text("c.chart", "Chart 5")}${text("c.digits", "0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ")}`);
    expect(checks([copy])).toEqual([]);
    // Ranks and amounts remain claims.
    const claims = slot("strings.common", `## en\n\n${text("c.top", "Top 10 studios")}${text("c.save", "Save 20 hours")}${text("c.of", "Page 3 of 10")}`);
    expect(checks([claims])).toEqual(["W-CLAIM:strings.common:c.top", "W-CLAIM:strings.common:c.save", "W-CLAIM:strings.common:c.of"]);
  });

  it("runs over the consumer's pinned Writer candidates with a contract for every pinned slot", () => {
    const writer = fileURLToPath(new URL("../../../../clossys/agents/writer/", import.meta.url));
    if (!existsSync(writer)) return;
    const slots: WriterPinnedSlot[] = [];
    for (const id of readdirSync(writer).sort()) {
      const pin = join(writer, id, "pin.json");
      if (!existsSync(pin)) continue;
      const name = (JSON.parse(readFileSync(pin, "utf8")) as { candidate: string }).candidate;
      const source = readFileSync(join(writer, id, "candidates", name), "utf8");
      const end = source.indexOf("\n---\n", 4);
      const locales = JSON.parse(/^locales: (.+)$/m.exec(source.slice(0, end))![1]!) as string[];
      slots.push({ slot: id, path: `agents/writer/${id}/candidates/${name}`, locales, rows: parseWriterSlotBody(source.slice(end + 5), locales) });
    }
    const result = runWriterSlotSuite({ slots });
    expect(result.slots).toBe(slots.length);
    expect(result.records).toBeGreaterThan(500);
    expect(result.findings.filter(f => f.check === "INPUT")).toEqual([]);
  }, 120_000);
});
