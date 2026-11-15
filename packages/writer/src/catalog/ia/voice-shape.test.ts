/**
 * Voice slots carry measurable shapes (foundry-audit-0017) and every Director input names its key (foundry-audit-0016).
 * The old categorical-prose exemplars are re-certified: their transcription stays as -v1 (it fails), the measurable
 * -v2 passes. Nothing edits a candidate in place.
 */
import { describe, expect, it } from "vitest";
import { COPY_ROLES } from "../../../../designer/src/check/copy-fields-role.js";
import { ROLE_WORD_BUDGET, VOICE_ROLES, checkVoiceContent, checkWriterInputs, loadVoiceDefaults } from "./voice-shape.js";
import { loadWriterTrees, type GroupTree } from "./target.js";

const defaults = loadVoiceDefaults();
const trees = loadWriterTrees();
const clone = <T>(value: T): T => structuredClone(value);
const group = (id: string, from: readonly GroupTree[]) => from.find(tree => tree.group === id)!;
const text = (findings: readonly { message: string }[]) => findings.map(finding => finding.message).join("\n");

describe("Voice defaults (writer/defaults/<slot>/)", () => {
  it("each of the 12 Voice slots has a v1 and a v2 package default", () => {
    const slots = group("voice", trees).slots.map(slot => slot.id);
    expect(slots).toHaveLength(12);
    for (const slot of slots) expect(defaults.filter(file => file.slot === slot).map(file => file.name).sort()).toEqual([`${slot.split(".")[1]}-v1.json`, `${slot.split(".")[1]}-v2.json`]);
  });

  it("every v2 default passes its slot shape and carries a candidate header", () => {
    for (const file of defaults.filter(entry => entry.version === 2)) {
      expect(checkVoiceContent(file.slot, file.candidate.content), file.name).toEqual([]);
      expect(file.candidate.clossys).toMatchObject({ schema: "clossys.candidate/1", agent: "writer", kind: "candidate", slot: `writer/${file.slot}`, status: "submitted" });
    }
  });

  it("every v1 default is the old categorical prose, kept and retired, and fails voice.shape", () => {
    for (const file of defaults.filter(entry => entry.version === 1)) {
      expect(file.candidate.clossys.status, file.name).toBe("retired");
      expect(checkVoiceContent(file.slot, file.candidate.content).map(finding => finding.code), file.name).toContain("voice.shape");
    }
  });

  it("uses the Designer copy roles and derives word budgets from the Designer character budgets", () => {
    expect([...VOICE_ROLES]).toEqual([...COPY_ROLES]);
    expect(ROLE_WORD_BUDGET).toEqual({ eyebrow: 9, heading: 12, lead: 40, body: 40, action: 4, label: 32, alt: 28 });
  });
});

describe("mutations that must die (Voice shapes)", () => {
  const v2 = (slot: string) => clone(defaults.find(file => file.slot === slot && file.version === 2)!.candidate.content) as Record<string, any>;

  it("a default over its role budget", () => {
    const content = v2("lexicon.sentence-length");
    content.byLocale.en.byRole.heading.max = 13;
    expect(text(checkVoiceContent("lexicon.sentence-length", content))).toMatch(/heading.*12/);
  });

  it("a categorical-prose fixture", () => {
    expect(checkVoiceContent("lexicon.warmth", { rule: "Warm but brief: thank people once." }).map(finding => finding.code)).toContain("voice.shape");
  });

  it("a level outside its scale", () => {
    expect(checkVoiceContent("lexicon.warmth", { level: 6 }).length).toBeGreaterThan(0);
  });

  it("an avoid-pattern that is not a valid expression", () => {
    expect(checkVoiceContent("lexicon.avoid-patterns", { patterns: [{ id: "broken", regex: "(" }] }).length).toBeGreaterThan(0);
  });

  it("a role missing from mood", () => {
    const content = v2("lexicon.mood");
    delete content.byRole.alt;
    expect(text(checkVoiceContent("lexicon.mood", content))).toContain("alt");
  });
});

describe("Director inputs are named keys; style goes through Voice (foundry-audit-0016)", () => {
  it("passes on the committed trees", () => {
    expect(checkWriterInputs(trees)).toEqual([]);
  });

  it("mutation: a blanket Director input with no key fails", () => {
    const next = clone(trees);
    group("voice", next).slots[0]!.inputs.push({ to: "director/identity.brand.personality" });
    expect(text(checkWriterInputs(next))).toContain("identity.brand.personality");
  });

  it("mutation: a key the Director cell does not have fails", () => {
    const next = clone(trees);
    group("voice", next).slots[0]!.inputs.push({ to: "director/identity.verbal.voice", key: "Mood" });
    expect(text(checkWriterInputs(next))).toContain("Mood");
  });

  it("mutation: a Prose slot that lists identity.verbal.voice directly fails", () => {
    const next = clone(trees);
    group("prose", next).slots[0]!.inputs.push({ to: "director/identity.verbal.voice", key: "Sound" });
    expect(text(checkWriterInputs(next))).toContain("identity.verbal.voice");
  });

  it("mutation: a Copy slot that lists identity.verbal.voice directly fails", () => {
    const next = clone(trees);
    group("copy", next).slots[0]!.inputs.push({ to: "director/identity.verbal.voice", key: "Do" });
    expect(text(checkWriterInputs(next))).toContain("identity.verbal.voice");
  });

  it("mutation: a Prose slot that drops a Voice input fails", () => {
    const next = clone(trees);
    const prose = group("prose", next).slots[0]!;
    prose.inputs = prose.inputs.filter(ref => ref.to !== "writer/lexicon.formality");
    expect(text(checkWriterInputs(next))).toContain("lexicon.formality");
  });
});
