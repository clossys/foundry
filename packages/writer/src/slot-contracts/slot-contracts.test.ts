import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mainWriterSlotCheck } from "./cli.js";
import { directorVoiceFromFiles, runWriterSuite, WRITER_CHECKS, type WriterFinding } from "./checks.js";
import { adaptSlotContract, loadWriterContracts, WRITER_SLOT_LAYERS } from "./format.js";
import { copiedExemplar, trigramJaccard } from "./similarity.js";

const contracts = loadWriterContracts();
const byId = new Map(contracts.slots.map(s => [s.id, s]));
const catalogSlots = (layer: string) => JSON.parse(readFileSync(new URL(`../catalog/slots/${layer}.json`, import.meta.url), "utf8")) as Array<{ id: string; contract: Record<string, any> }>;
const directorContracts = JSON.parse(readFileSync(new URL("../../../strategist/src/slot-contracts/contracts.json", import.meta.url), "utf8")) as { slots: Array<{ id: string; feeds: string[] }> };

interface Rec { context: string; leaf: string; text?: string; json?: Record<string, unknown>; meta?: Record<string, unknown> }
function writerCell(id: string, records: Rec[], locales: Record<string, Rec[]> = {}) {
  const block = (r: Rec) => {
    const rid = r.context.replace(/\./g, "-");
    const head = `### ${r.context}\n<!-- ${JSON.stringify({ id: rid, leaf: r.leaf, ...r.meta })} -->\n`;
    return r.json ? `${head}\`\`\`json\n${JSON.stringify({ id: rid, leaf: r.leaf, context: r.context, ...r.json })}\n\`\`\`\n` : `${head}${r.text}\n`;
  };
  const all = { en: records, ...locales };
  const body = Object.entries(all).map(([locale, recs]) => `## ${locale}\n${recs.map(block).join("\n")}`).join("\n");
  return { path: `cells/${id}/v1.md`, text: `---\nid: ${id}\nversion: 1\nstatus: draft\nupdated: 2026-10-30\nlinks: []\nlocales: [${Object.keys(all).join(", ")}]\n---\n\n${body}` };
}
const directorCell = (id: string, direction: string[]) => ({
  path: `cells/${id}/v1.md`,
  text: `---\nid: ${id}\nversion: 1\nstatus: draft\nupdated: 2026-10-30\ncites: []\nfeeds: []\nfunctions: []\n---\n\n## Direction\n${direction.map(b => `- ${b}`).join("\n")}\n\n## Because\n- Interviews with clinic owners in the launch regions.\n\n## Watch\n- If fewer than 5 trials start each month, then review.\n`,
});
const director = directorVoiceFromFiles([
  directorCell("identity.verbal.voice", ["Sound: calm, exact, plain; short sentences, second person", "Do: name the next action; use the clinic's words (diary, note, claim)", "Never: \"seamless\", \"revolutionary\", \"effortless\" or exclamation marks"]),
  directorCell("advantage.proposition.proof", ["Proof: zero rejected claims in 3 insurer audits at the founders' clinic (finding:audit-history)", "Gap: no data yet from clinics we do not run ourselves", "Never-claim: \"guaranteed claim approval\" or \"insurer approved\""]),
  directorCell("identity.naming.name", ["Name: \"Stridewell\"", "Casing: one word, capital S only; never STRIDEWELL or StrideWell", "Meaning: a stride taken well, the goal of every treatment plan"]),
]);
const run = (...cells: ReturnType<typeof writerCell>[]) => runWriterSuite({ cells, director: director.voice }).findings;
const checksOf = (findings: WriterFinding[]) => [...new Set(findings.map(f => f.check))].sort();
const headline = (text: string) => writerCell("home.hero", [{ context: "home.hero.headline", leaf: "patterns.headline", json: { parts: { headline: { text } } } }]);
const tagline = (text: string, page = "home", meta?: Record<string, unknown>) => writerCell(`${page}.intro`, [{ context: `${page}.intro.tagline`, leaf: "strings.taglines", text, ...(meta ? { meta } : {}) }]);

describe("Writer slot contracts", () => {
  it("declares one contract per Writer L3 slot, with the catalog's limits", () => {
    expect(contracts.slots).toHaveLength(136);
    const counts = Object.fromEntries(WRITER_SLOT_LAYERS.map(l => [l, contracts.slots.filter(s => s.layer === l).length]));
    expect(counts).toEqual({ lexicon: 27, strings: 22, patterns: 24, passages: 51, narratives: 12 });
    for (const layer of WRITER_SLOT_LAYERS) {
      const catalog = catalogSlots(layer);
      expect(contracts.slots.filter(s => s.layer === layer).map(s => s.id).sort()).toEqual(catalog.map(s => s.id).sort());
      for (const { id, contract } of catalog) {
        const fields = byId.get(id)!.limits.fields;
        if (layer === "strings") expect([fields.text!.maxChars, fields.text!.maxWords]).toEqual([contract.maxChars, contract.maxWords]);
        if (layer === "patterns") for (const part of contract.parts.items) expect([fields[part.id]!.required, fields[part.id]!.maxChars]).toEqual([part.required, part.maxChars]);
        if (layer === "passages") for (const field of contract.copy.fields) expect([fields[field.key]!.required, fields[field.key]!.maxChars]).toEqual([field.required, field.maxLength.en]);
        if (layer === "lexicon") expect(byId.get(id)!.limits.recordKind).toBe(contract.recordKind);
      }
    }
  });

  it("gives every slot a guide with 2-3 exemplars that fit the slot with translation headroom", () => {
    let exemplars = 0;
    for (const slot of contracts.slots) {
      expect(slot.references.length, slot.id).toBeGreaterThanOrEqual(1);
      expect(slot.limits.translationHeadroom).toBe(0.3);
      const list = slot.references.flatMap(r => r.exemplars);
      expect(list.length, slot.id).toBeGreaterThanOrEqual(2);
      expect(list.length, slot.id).toBeLessThanOrEqual(3);
      exemplars += list.length;
      for (const ex of list) if ("fields" in ex) for (const [key, value] of Object.entries(ex.fields)) for (const t of [value].flat()) {
        const limit = slot.limits.fields[key];
        expect(limit, `${slot.id}:${key}`).toBeDefined();
        expect([...t].length, `${slot.id}:${key}: ${t}`).toBeLessThanOrEqual(Math.floor(limit!.maxChars / 1.3));
        if (limit!.maxWords !== undefined) expect(t.split(/\s+/).length, `${slot.id}:${key}`).toBeLessThanOrEqual(limit!.maxWords);
      }
    }
    expect(exemplars).toBe(277);
  });

  it("cites only Director cells whose contracts list the slot as a feed", () => {
    const feeds = new Map(directorContracts.slots.map(s => [s.id, new Set(s.feeds)]));
    for (const slot of contracts.slots) for (const input of slot.inputs) {
      const cell = input.slice("director:".length);
      expect(feeds.has(cell), `${slot.id} cites unknown ${cell}`).toBe(true);
      expect(feeds.get(cell)!.has(slot.id), `${cell} does not feed ${slot.id}`).toBe(true);
    }
    expect(contracts.slots.filter(s => s.inputs.length > 0).length).toBeGreaterThan(100);
  });

  it("rejects contracts missing a field from the shared list", () => {
    const valid = contracts.slots[0]!;
    expect(adaptSlotContract(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
    expect(() => adaptSlotContract({ ...valid, purpose: "" })).toThrow(/purpose/);
    expect(() => adaptSlotContract({ ...valid, references: [] })).toThrow(/reference/);
    expect(() => adaptSlotContract({ ...valid, inputs: ["designer:tokens.color"] })).toThrow(/director/);
  });

  it("runs exactly eight checks", () => {
    expect(WRITER_CHECKS.map(c => c.id)).toEqual(["W-LEN", "W-ROOM", "W-REQ", "W-VOICE", "W-BRAND", "W-CLAIM", "W-ORIG", "W-DUP"]);
  });
});

describe("writer.copy.v1", () => {
  it("passes a headline within limits and fails an over-limit one (mutation)", () => {
    expect(run(headline("Rotas for teams whose plans change daily"))).toEqual([]);
    const over = run(headline("Plan every shift ".repeat(8).trim()));
    expect(checksOf(over)).toEqual(["W-LEN"]);
    expect(over.map(f => f.message).join(" ")).toMatch(/characters; limit is 100/);
    expect(checksOf(run(headline("Rotas for teams\nwhose plans\nchange daily")))).toEqual(["W-LEN"]);
  });

  it("warns when source copy leaves no translation headroom, only in the source locale", () => {
    const tight = "Download the full quarterly report"; // 34 of 40 characters
    const findings = run(writerCell("reports.toolbar", [{ context: "reports.toolbar.export", leaf: "strings.actions", text: tight }], { de: [{ context: "reports.toolbar.export", leaf: "strings.actions", text: tight }] }));
    expect(findings.map(f => [f.check, f.severity, f.locale])).toEqual([["W-ROOM", "warning", "en"]]);
  });

  it("fails an empty required part", () => {
    const cell = writerCell("home.hero", [{ context: "home.hero.lead", leaf: "patterns.headline-subhead", json: { parts: { headline: { text: "Shift swaps the manager approves" } } } }]);
    expect(run(cell).map(f => [f.check, f.key])).toEqual([["W-REQ", "subhead"]]);
  });

  it("trips the similarity check on a verbatim or lightly edited exemplar (mutation)", () => {
    const exemplar = "Shift plans that fix themselves when someone calls in sick.";
    expect(checksOf(run(tagline(exemplar)))).toEqual(["W-ORIG"]);
    expect(checksOf(run(tagline("shift plans that FIX themselves, when someone calls in sick")))).toEqual(["W-ORIG"]);
    expect(run(tagline("Physio diaries that rebook missed visits for you"))).toEqual([]);
    expect(copiedExemplar("ok", [{ slot: "x", text: "ok" }])).toBeUndefined();
    expect(trigramJaccard("a b c d", "a b c d")).toBe(1);
  });

  it("applies the Director voice, never-claims and brand spelling", () => {
    expect(director.issues).toEqual([]);
    expect(director.voice.banned.map(b => b.phrase)).toEqual(["seamless", "revolutionary", "effortless", "guaranteed claim approval", "insurer approved"]);
    expect(checksOf(run(tagline("Seamless rebooking for physio clinics")))).toEqual(["W-VOICE"]);
    expect(checksOf(run(tagline("Insurer approved notes for physio clinics")))).toEqual(["W-VOICE"]);
    const brand = run(tagline("StrideWell rebooks missed physio visits"));
    expect(checksOf(brand)).toEqual(["W-BRAND"]);
    expect(checksOf(run(tagline("Stride well rebooks missed physio visits")))).toEqual(["W-BRAND"]);
    expect(run(tagline("Stridewell rebooks missed physio visits"))).toEqual([]);
  });

  it("applies lexicon avoid terms and avoid patterns, but not to the lexicon itself", () => {
    const lexicon = writerCell("voice.terms", [
      { context: "voice.terms.simply", leaf: "lexicon.avoid-terms", json: { kind: "term", term: "simply", forms: [], termStatus: "avoid", reason: "Blames the reader" } },
      { context: "voice.terms.please-note", leaf: "lexicon.avoid-patterns", json: { kind: "pattern-rule", pattern: { source: "^please note", flags: "i" }, severity: "warning", reason: "State the fact" } },
    ]);
    expect(run(lexicon)).toEqual([]);
    const findings = run(lexicon, writerCell("help.steps", [
      { context: "help.steps.first", leaf: "strings.common", text: "Simply drag the shift to a new day." },
      { context: "help.steps.second", leaf: "strings.common", text: "Please note that drafts expire." },
    ]));
    expect(findings.map(f => [f.check, f.severity, f.record])).toEqual([["W-VOICE", "error", "help-steps-first"], ["W-VOICE", "warning", "help-steps-second"]]);
  });

  it("requires evidence for numbers and superlatives in claim slots only", () => {
    expect(checksOf(run(tagline("The fastest diary for physio clinics")))).toEqual(["W-CLAIM"]);
    expect(checksOf(run(tagline("Rebook 40% of missed visits automatically")))).toEqual(["W-CLAIM"]);
    expect(run(tagline("Rebook 40% of missed visits automatically", "home", { claim: "claims.rebook-rate" }))).toEqual([]);
    expect(run(writerCell("projects.delete", [{ context: "projects.delete.warning", leaf: "strings.warnings", text: "Deleting this project removes its 9 notes." }]))).toEqual([]);
  });

  it("flags unique copy repeated on another page", () => {
    const text = "Physio diaries that rebook missed visits for you";
    const findings = run(tagline(text, "home"), tagline(text, "pricing"));
    expect(findings.map(f => [f.check, f.path])).toEqual([["W-DUP", "cells/pricing.intro/v1.md"]]);
    const action = (page: string) => writerCell(`${page}.form`, [{ context: `${page}.form.save`, leaf: "strings.actions", text: "Save draft" }]);
    expect(run(action("notes"), action("letters"))).toEqual([]);
  });

  it("reports unreadable files and unknown leaves as input findings", () => {
    const findings = runWriterSuite({ cells: [{ path: "cells/x.y/v1.md", text: "not a cell" }, writerCell("home.hero", [{ context: "home.hero.title", leaf: "strings.unknown", text: "Hello there" }])] }).findings;
    expect(findings.map(f => f.check)).toEqual(["INPUT", "INPUT"]);
  });
});

describe("writer slots CLI", () => {
  it("prints JSON, exits 0 on findings, 1 with --strict and 2 on usage errors", () => {
    const dir = mkdtempSync(join(tmpdir(), "writer-slots-"));
    try {
      const bad = headline("Plan every shift ".repeat(8).trim());
      mkdirSync(join(dir, "bad", "cells", "home.hero"), { recursive: true });
      writeFileSync(join(dir, "bad", bad.path), bad.text);
      const good = headline("Rotas for teams whose plans change daily");
      mkdirSync(join(dir, "good", "cells", "home.hero"), { recursive: true });
      writeFileSync(join(dir, "good", good.path), good.text);
      let out = "";
      const write = (t: string) => { out += t; };
      expect(mainWriterSlotCheck([join(dir, "bad")], write)).toBe(0);
      const report = JSON.parse(out) as { command: string; suite: string; findings: WriterFinding[]; counts: { slots: number; byCheck: Record<string, number> } };
      expect([report.command, report.suite, report.counts.slots]).toEqual(["slots", "writer.copy.v1", 136]);
      expect(report.counts.byCheck["W-LEN"]).toBeGreaterThan(0);
      out = ""; expect(mainWriterSlotCheck([join(dir, "bad"), "--strict"], write)).toBe(1);
      out = ""; expect(mainWriterSlotCheck([join(dir, "good"), "--strict"], write)).toBe(0);
      expect(JSON.parse(out).findings).toEqual([]);
      out = ""; expect(mainWriterSlotCheck([], write)).toBe(2);
      out = ""; expect(mainWriterSlotCheck([join(dir, "good"), "--bogus"], write)).toBe(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
