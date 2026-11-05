import { describe, expect, it } from "vitest";
import drafts from "./admin-voice.r1.en.json" with { type: "json" };
import common from "./common-labels.r1.en.json" with { type: "json" };
import { withDeclaredCommonRecords } from "../__fixtures__/shared-records.fixture.js";
import terminology from "../admin-terminology.json" with { type: "json" };
import { validateWriterRecord } from "../../model/validate.js";
import type { WriterLibrary, WriterRecord, StringRecord } from "../../model/types.js";
import { loadWriterCatalog } from "../ia/index.js";
import { checkWriterLint } from "../../checks/lint/index.js";
import { compileLexiconRules } from "../../checks/lint/rules.js";
import { writerLintTargets } from "../../checks/lint/targets.js";
import { checkWriterLength } from "../../checks/length.js";
import { parseIcuMessage } from "../../icu/parse.js";
import { resolveCopyRef } from "../../resolve.js";

const usages = common.usages.filter(usage => usage.source === "records/admin-voice.r1.en.json");
const canonicalId = (id: string) => usages.find(usage => usage.legacyRecordId === id)?.recordId ?? id;
const sharedIds = new Set(usages.map(usage => usage.recordId));
const records = withDeclaredCommonRecords(drafts) as StringRecord[];
const lexicon = terminology.lexiconRecords as WriterRecord[];
const library = (copy: WriterRecord[] = records): WriterLibrary => ({
  manifest: {
    consumer: "admin-voice-review", messageSyntax: "icu-mf1", defaultLocale: "en",
    locales: [{ tag: "en", dir: "ltr", state: "active" }], fallback: {},
    strategy: { root: "strategy", contract: "writer.messaging" },
    leafFreeze: { lexicon: "", strings: "", patterns: "", passages: "", narratives: "" },
  },
  locales: { en: { records: [...lexicon, ...copy], documents: [] } },
});

describe("admin voice draft revision", () => {
  it("contains only unapproved revision-one drafts on existing Writer leaves", () => {
    expect(drafts.revision).toBe(1);
    expect(drafts.state).toBe("draft");
    expect(drafts.activation).toBe("none");
    expect(records.length).toBeGreaterThan(150);
    expect(drafts.records.length + usages.length).toBe(206);
    const known = new Set(loadWriterCatalog().slots.map(slot => slot.id));
    expect(new Set(records.map(record => record.id)).size).toBe(records.length);
    for (const record of [...lexicon, ...records]) {
      expect(record.status).toBe("draft");
      expect(record).not.toHaveProperty("approval");
      expect(known.has(record.leaf), record.leaf).toBe(true);
      expect(validateWriterRecord(record, record.id.startsWith("lx.") ? "lexicon" : "strings")).toEqual([]);
    }
  });

  it("pairs every record with source evidence, before/after wording and a rationale", () => {
    expect(drafts.reviews).toHaveLength(drafts.records.length + usages.length);
    expect(new Set(drafts.reviews.map(review => review.cellId)).size).toBe(206);
    expect(new Set(drafts.reviews.map(review => canonicalId(review.recordId)))).toEqual(new Set(records.map(record => record.id)));
    for (const review of drafts.reviews) {
      const record = records.find(record => record.id === canonicalId(review.recordId))!;
      expect(record, review.cellId).toBeDefined();
      expect(review.after).toBe(record.text);
      expect(review.before.trim().length).toBeGreaterThan(0);
      expect(review.rationale.trim().length).toBeGreaterThan(15);
      expect(review.source.commit).toBe(drafts.sourceCommit);
      expect(review.source.path).toMatch(/^packages\/(?:designer|publisher)\/src\//);
      expect(review.source.line).toBeGreaterThan(0);
      expect(Object.hasOwn(drafts.sourceFiles, review.source.path)).toBe(true);
      expect(review.scope).toBe("draft only");
      const usage = usages.find(usage => usage.legacyRecordId === review.recordId);
      expect(review.budget).toBe(usage?.limits.maxChars ?? record.limits?.maxChars);
      expect(record.limits?.maxChars).toBeLessThanOrEqual(review.budget);
    }
  });

  it("lints every draft with actual retext rules, including drafts that are not approved", () => {
    const compiled = compileLexiconRules(lexicon);
    expect(compiled.issues).toEqual([]);
    expect(compiled.rules.length).toBeGreaterThan(10);
    const targets = writerLintTargets(library());
    for (const record of records) expect(targets.some(target => target.recordId === record.id)).toBe(true);
    expect(checkWriterLint(library())).toEqual([]);
    const bad = { ...records[0]!, text: "Please utilize this leaf." };
    expect(checkWriterLint(library([bad]))).toContainEqual(expect.objectContaining({
      code: "WR5", severity: "error", recordId: bad.id,
    }));
  });

  it("keeps the entire draft within explicit Writer length budgets and valid ICU syntax", () => {
    expect(checkWriterLength(library())).toEqual([]);
    for (const record of records) {
      const parsed = parseIcuMessage(record.text);
      expect(parsed.issues, record.id).toEqual([]);
      expect(parsed.arguments.map(arg => arg.name).sort()).toEqual((record.args ?? []).map(arg => arg.name).sort());
      expect(record.limits?.maxChars).toBeGreaterThan(0);
    }
  });

  it("gives failure messages a supported next step and keeps visible labels in sentence case", () => {
    for (const review of drafts.reviews) {
      if (review.role === "error") {
        expect(review.after, review.cellId).toMatch(/\. (?:Ask|Select|Refresh|Try|Set up)/);
      }
      expect(review.after).not.toMatch(/\b(?:PB|DG|WR|FR)-\d|\b(?:frames|sections|passages|tokens)\.[a-z]/);
      if (!review.after.includes("{")) {
        const words = review.after.split(/\s+/);
        for (const word of words.slice(1)) {
          if (["Designer", "Writer", "Publisher", "System", "Light", "Dark", "SSO"].includes(word.replace(/[.,]$/, ""))) continue;
          // A new sentence and a proper product name may start in upper case.
          const index = words.indexOf(word);
          if (/[.!?]$/.test(words[index - 1] ?? "")) continue;
          expect(word, review.cellId).not.toMatch(/^[A-Z][a-z]/);
        }
      }
    }
  });

  it("reports binding and missing-host-copy Needs without pretending the draft is rendered", () => {
    for (const review of drafts.reviews) expect(drafts.needs).toContainEqual(expect.objectContaining({
      recordId: review.recordId, severity: "P0", status: "Need",
    }));
    expect(drafts.coverage.kind).toBe("source audit; not rendered-page coverage");
    expect(drafts.needs.some(need => need.cellId === "document.head-copy")).toBe(true);
    expect(drafts.needs.some(need => need.cellId === "WR-VOICE-WR-CONSOLE-SOURCE")).toBe(true);
  });

  it("cannot resolve any new record as approved copy", () => {
    const registry = {
      id: "admin-voice-drafts", locale: "en", revision: "r1",
      source: { kind: "generated", reference: "admin voice review" },
      entries: records.map(record => ({ id: record.id, text: record.text, context: record.context, status: record.status })),
    };
    for (const record of records) {
      const result = resolveCopyRef(registry, { id: record.id, locale: "en" }, { target: "production" });
      expect(result.complete).toBe(false);
      expect(result.resolution).toBeUndefined();
    }
  });
});
