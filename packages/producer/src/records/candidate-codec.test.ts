/**
 * The one candidate codec (foundry-build-0048 U13 r4, B4; diagnosis section 8 risk 3): a clossys.candidate/1 file reads
 * as its header plus the view the kind rules and every renderer read; the header never reaches that view; heading is
 * idempotent; two files that hold the same view differ only in their headers (what R03.2's verbatim adopt compares);
 * and the readers that publish or specimen a pinned candidate take the view of headered bytes.
 */
import { cpSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pinUpstream } from "../cli/__fixtures__/upstream.js";
import { slotInstallInputs } from "../specimen/slot-install-inputs.js";
import { candidateCodec, type HeaderContext } from "./candidate-codec.js";
import { readCandidate, readPin } from "./slots.js";

const AT = "2026-11-18T10:00:00Z";
const context = (slotId: string, name: string, agent: HeaderContext["agent"] = "writer"): HeaderContext =>
  ({ agent, slotId, at: AT as HeaderContext["at"], version: "0.0.0-test", sourceRef: `agents/${agent}/${slotId}/candidates/${name}`, cli: "clossys test" });

const SOURCE = { kind: "derived", ref: ["director:identity.verbal.voice"] };
const STRINGS = `---\nslot: "sections.hero.copy"\nlocales: ["en"]\nsource: ${JSON.stringify(SOURCE)}\n---\n\n## en\n### header.heading\nShip your site this week\n`;
const ELEMENT = `${JSON.stringify({ name: "button", type: "registry:ui", files: [], meta: { slot: "components.button", source: SOURCE } }, null, 2)}\n`;

/** A view carries no clossys header in any form a renderer could print. */
const headerless = (view: string) => !/clossys\.candidate\/1|^\s*clossys\s*:|"clossys"\s*:/m.test(view);

describe("candidateCodec", () => {
  it("reads a headered Markdown candidate as its header and a headerless view that keeps the int2 source", () => {
    const bytes = candidateCodec.headered("copy-v1.md", STRINGS, context("sections.hero.copy", "copy-v1.md"));
    expect(bytes).not.toBe(STRINGS);
    const parsed = candidateCodec.parse("copy-v1.md", bytes);
    expect(parsed.header).toMatchObject({ schema: "clossys.candidate/1", id: "writer/sections.hero.copy/copy-v1.md", slot: "writer/sections.hero.copy", source: SOURCE });
    expect(headerless(parsed.view)).toBe(true);
    expect(parsed.view).toContain("Ship your site this week");
    expect(parsed.view).toContain(JSON.stringify(SOURCE.ref));
    expect(parsed.front).toMatchObject({ slot: "sections.hero.copy", locales: ["en"] });
    expect(parsed.content).toContain("## en");
  });

  it("reads a headered JSON candidate as its header and a view whose meta.source is the header's", () => {
    const bytes = candidateCodec.headered("button-v1.json", ELEMENT, context("components.button", "button-v1.json", "designer"));
    const parsed = candidateCodec.parse("button-v1.json", bytes);
    expect(parsed.header).toMatchObject({ schema: "clossys.candidate/1", slot: "designer/components.button", source: SOURCE });
    expect(headerless(parsed.view)).toBe(true);
    expect(JSON.parse(parsed.view)).toEqual(JSON.parse(ELEMENT));
    expect(JSON.parse(parsed.content)).toEqual({ name: "button", type: "registry:ui", files: [], meta: { slot: "components.button" } });
  });

  it("is idempotent: heading a headered file returns its bytes", () => {
    for (const [name, text, agent, slotId] of [["copy-v1.md", STRINGS, "writer", "sections.hero.copy"], ["button-v1.json", ELEMENT, "designer", "components.button"]] as const) {
      const once = candidateCodec.headered(name, text, context(slotId, name, agent));
      expect(candidateCodec.headered(name, once, context(slotId, name, agent)), name).toBe(once);
    }
  });

  it("gives two files with one view different bytes (each header names its own file) and the same view", () => {
    const one = candidateCodec.headered("copy-v1.md", STRINGS, context("sections.hero.copy", "copy-v1.md"));
    const two = candidateCodec.headered("copy-v2.md", STRINGS, context("sections.hero.copy", "copy-v2.md"));
    expect(one).not.toBe(two);
    expect(candidateCodec.parse("copy-v2.md", two).view).toBe(candidateCodec.parse("copy-v1.md", one).view);
  });

  it("reads bytes with no header as their own view", () => {
    expect(candidateCodec.parse("copy-v1.md", STRINGS)).toEqual({ view: STRINGS, content: STRINGS, front: {} });
  });
});

describe("readers of pinned candidates take the view of headered bytes (risk 3)", () => {
  it("readCandidate serves the view and the file sha; the specimen install inputs read every headered pin", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "codec-readers-")));
    cpSync(fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url)), root, { recursive: true });
    const consumer = join(root, "clossys");
    const pinned = pinUpstream(consumer, "designer", "sections.hero", AT).filter(id => id.startsWith("designer/"));
    expect(pinned.length).toBeGreaterThan(0);
    for (const id of pinned) {
      const slotId = id.slice("designer/".length);
      const pin = readPin(consumer, "designer", slotId)!;
      const read = readCandidate(consumer, "designer", slotId, pin.candidate);
      expect(candidateCodec.parse(pin.candidate, read.raw).header, id).toBeDefined();
      expect(read.sha256, id).toBe(pin.sha256);
      expect(read.bytes, id).toBe(candidateCodec.parse(pin.candidate, read.raw).view);
      expect(headerless(read.bytes), id).toBe(true);
    }
    const inputs = slotInstallInputs(consumer)!;
    for (const id of pinned) expect(inputs.pins[id.slice("designer/".length)], id).toEqual({ element: "upstream", version: 1 });
  }, 120_000);
});
