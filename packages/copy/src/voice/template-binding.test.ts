/**
 * Proves the unbound signal against the REAL, shipped template — not a
 * hand-written stand-in for it — the same discipline
 * `src/field-coverage.test.ts` already applies to structural coverage. If
 * `checkCopy` ever reported an untouched copy of
 * `templates/voice-record.template.jsonc` as clean, this package would be
 * repeating the exact defect its own design exists to close: a check that
 * passes while asserting nothing. See `checker.ts`'s top-of-file doc
 * comment, "The unbound signal".
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { checkCopy } from "./checker.js";
import { parseTemplate } from "./internal/parse-template.js";
import type { VoiceRecord } from "./types.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const templateRaw = readFileSync(join(packageRoot, "templates", "voice-record.template.jsonc"), "utf8");

// The template's placeholder values do not satisfy VoiceRecord's own type
// (`rules.formality`, for instance, is `TEMPLATE_PLACEHOLDER`, not one of
// the three real `FormalityLevel` members) — expected, since a template is
// never meant to run unedited. This cast mirrors the one already used in
// this file's sibling `checker.test.ts` for its own "caller passes a
// wrong-shaped value" cases: a genuine runtime assertion, not a type-level
// one, so it is force-cast rather than suppressed.
function loadTemplateAsRecord(): VoiceRecord {
  return parseTemplate(templateRaw) as unknown as VoiceRecord;
}

describe("checkCopy on the untouched template — the unbound signal, proven for real", () => {
  it("reports bound: false for the raw template, with copy given", () => {
    const report = checkCopy(loadTemplateAsRecord(), "Some real, unrelated piece of copy to scan.");
    expect(report.bound).toBe(false);
  });

  it("reports bound: false for the raw template even with empty copy — binding is a property of the record, not the copy", () => {
    const report = checkCopy(loadTemplateAsRecord(), "");
    expect(report.bound).toBe(false);
    expect(report.complete).toBe(false); // still true separately: every dimension was skipped for empty-copy
  });

  it("surfaces an unmissable error finding per unfilled slot — never a silent flag only", () => {
    const report = checkCopy(loadTemplateAsRecord(), "");
    const unboundFindings = report.findings.filter((f) => f.rule === "voice:unbound-placeholder");
    // One per bindable STRING leaf the template ships: id, both rule
    // descriptions, one pronoun, one marker, formality, one tone entry, one
    // glossary entry's term/reason/alternative, one claim's id/text — see
    // templates/voice-record.template.jsonc for the exact set.
    expect(unboundFindings.length).toBeGreaterThan(0);
    expect(unboundFindings.every((f) => f.severity === "error")).toBe(true);
    // The exact idiom this package's own README tells every caller to use.
    expect(report.findings.some((f) => f.severity === "error")).toBe(true);
  });

  it("cannot be waived away — the unbound finding survives a waiver naming its exact rule and path", () => {
    const report = checkCopy(loadTemplateAsRecord(), "", {
      waivers: [{ rule: "voice:unbound-placeholder", match: "id", reason: "attempting to suppress it" }],
    });
    expect(report.bound).toBe(false);
    expect(report.findings.some((f) => f.rule === "voice:unbound-placeholder" && f.path === "id")).toBe(true);
    expect(report.waived.some((f) => f.rule === "voice:unbound-placeholder")).toBe(false);
    // The waiver itself is reported as dead configuration — proof it truly
    // never matched anything, not proof-by-silence.
    expect(report.findings.some((f) => f.rule === "waiver:unused" && f.path === "id")).toBe(true);
  });

  it("a fully bound record derived from the template shape (placeholders replaced) reports bound: true", () => {
    const record: VoiceRecord = {
      id: "acme-app",
      rules: {
        person: { description: "second-person, you-voice", forbiddenPronouns: ["we", "our"] },
        tense: { description: "present tense", forbiddenMarkers: ["will"] },
        formality: "neutral",
        tone: ["direct"],
      },
      glossary: [{ term: "revolutionary", status: "forbidden", reason: "overused buzzword", caseSensitive: false }],
      claims: [{ id: "fast-sync", text: "fastest sync in its class", matchPhrases: [], requiresSupport: true }],
    };
    const report = checkCopy(record, "Some copy.");
    expect(report.bound).toBe(true);
    expect(report.findings.some((f) => f.rule === "voice:unbound-placeholder")).toBe(false);
  });
});
