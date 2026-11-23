/**
 * U-VOICE-PROV (owner Q7 b): a Writer copy candidate names the pinned Director voice as frontmatter provenance
 * (`provenance.voice`), never as an input. copy.voice-derived reads that field and only that field; R07.1 still holds
 * every source citation to the slot's inputs, so the voice need not be (and, for copy and prose, may not be) an input.
 * The Writer half (checkWriterInputs still fails a copy slot that lists the voice) is pinned in
 * packages/writer/src/catalog/ia/voice-shape.test.ts.
 */
import { describe, expect, it } from "vitest";
import { cleanSpec, contextOf, slotDoc, type WorkspaceSpec } from "../../../__fixtures__/workspace.js";
import { undeclaredCitations } from "../../../checks/R07-citations.js";
import { subjectOf } from "../../core/verdict.js";
import { voiceDerived } from "./copy.js";
import { candidateView, headeredMarkdown } from "../../../../records/slot-current.js";
import type { Actor, AgentId, Iso, SlotId } from "../../../../records/types.js";

const VOICE = "director:identity.verbal.voice";
const PROMISE = "director:advantage.proposition.promise";
const SLOT = "home.hero";
const BY: Actor = { actor: "code", cli: "clossys test", version: "0.0.0" };

/** A Writer copy candidate for home.hero: frontmatter slot, locales, source (refs) and, unless null, provenance. */
function copy(refs: readonly string[], provenance: unknown = { voice: VOICE }): string {
  return [
    "---",
    `slot: ${JSON.stringify(SLOT)}`,
    `locales: ${JSON.stringify(["en"])}`,
    `reason: ${JSON.stringify(`Realises ${VOICE} for the pinned promise.`)}`,
    `source: ${JSON.stringify({ kind: "derived", ref: refs })}`,
    ...(provenance === null ? [] : [`provenance: ${JSON.stringify(provenance)}`]),
    "---",
    "## en",
    "",
    "### header.heading",
    `<!-- ${JSON.stringify({ id: "header.heading", bindings: [] })} -->`,
    "Keep your site current without waiting",
    "",
  ].join("\n");
}

/** The clean workspace with the voice and the promise pinned upstream and home.hero reading only the promise. */
function world(candidate: string) {
  const spec: WorkspaceSpec = cleanSpec();
  spec.director!["identity.verbal.voice"] = { candidates: { "voice-v1.md": "---\nsource:\n  kind: authored\n---\nCalm and plain.\n" } };
  spec.director!["advantage.proposition.promise"] = { candidates: { "promise-v1.md": "---\nsource:\n  kind: authored\n---\nSites stay current.\n" } };
  spec.writer![SLOT] = { slot: slotDoc("writer", SLOT, { inputs: ["advantage.proposition.promise"] }), candidates: { "hero-v1.md": candidate } };
  return contextOf(spec);
}

const voiceDerivedOf = (text: string) => voiceDerived(subjectOf("hero-v1.md", text, "strings"), {});
const r071Of = (text: string) => undeclaredCitations(world(text)).filter(row => row.slot === SLOT);

describe("copy.voice-derived reads provenance.voice; R07.1 holds source to inputs (U-VOICE-PROV)", () => {
  it("a copy slot whose candidate names the voice in provenance passes R07.1 and copy.voice-derived together", () => {
    const text = copy([PROMISE]);
    expect(r071Of(text)).toEqual([]);
    expect(voiceDerivedOf(text)).toEqual([]);
  });

  it("the same provenance survives the clossys.candidate/1 header: candidateView keeps it beside the header source", () => {
    const headered = headeredMarkdown("hero-v1.md", copy([PROMISE]), {
      agent: "writer" as AgentId, slotId: SLOT as SlotId, createdBy: BY, createdAt: "2026-11-22T00:00:00Z" as Iso,
    });
    expect(headered).toContain(`provenance: ${JSON.stringify({ voice: VOICE })}`);
    expect(voiceDerivedOf(candidateView("hero-v1.md", headered))).toEqual([]);
  });

  it("without provenance copy.voice-derived fails, naming the slot", () => {
    const failures = voiceDerivedOf(copy([PROMISE], null));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(SLOT);
    expect(failures[0]).toContain("no provenance");
  });

  it("the voice in source.ref alone does not satisfy copy.voice-derived, and R07.1 refuses it as an undeclared citation", () => {
    const text = copy([VOICE, PROMISE], null);
    expect(voiceDerivedOf(text)[0]).toContain(SLOT);
    expect(r071Of(text).map(row => row.reason).join("\n")).toContain("identity.verbal.voice");
  });

  it("provenance naming anything other than the pinned voice fails, naming the slot and the value", () => {
    for (const provenance of [{ voice: PROMISE }, { voice: "identity.verbal.voice" }, {}, { voice: 7 }, "not-an-object"]) {
      const failures = voiceDerivedOf(copy([PROMISE], provenance));
      expect(failures, JSON.stringify(provenance)).toHaveLength(1);
      expect(failures[0]).toContain(SLOT);
    }
    expect(voiceDerivedOf(copy([PROMISE], { voice: PROMISE }))[0]).toContain(JSON.stringify(PROMISE));
  });
});
