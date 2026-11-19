import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CORE_CRITERIA } from "../criteria/core/index.js";
import { CERTIFY_KEY_FIELDS, requirementsVerdict } from "../criteria/core/verdict.js";
import { buildContext } from "../context.js";
import { NO_FOUNDRY_LEAVES, NO_HISTORY, SAMPLE_SEAT, slotDoc, writeWorkspace, type WorkspaceSpec } from "../__fixtures__/workspace.js";
import type { ConstitutionContext, SlotRecord } from "../types.js";
import { openCache } from "./cache.js";
import { dryRun, familyOf, proposedContract } from "./dry-run.js";
import {
  CERTIFY_INPUT_FIELDS, certify, certifyEnv, certifyFit, certifyWorld, MISSING_RECORD_CODES, onlyMissingRecords, pinSetOf, resultKey, slotDocOf, standardReasons,
} from "./index.js";
import { certifyElement } from "./element.js";
import { requirementsVerdictSync } from "./requirements.js";
import { BRIEF_HEADINGS, briefText, elementItem, LABEL, pageItem, writerText } from "./certify.world.js";

const FIXTURES = fileURLToPath(new URL("../__fixtures__/", import.meta.url));
const STANDARD = "fixture-headline";
const codes = (reasons: readonly { code: string }[]) => [...new Set(reasons.map(item => item.code))].sort();

function ctxOf(spec: WorkspaceSpec, edit?: (root: string) => void): ConstitutionContext {
  const { root, consumer } = writeWorkspace(spec);
  edit?.(root);
  return buildContext(root, consumer, { history: () => NO_HISTORY, foundryLeaves: NO_FOUNDRY_LEAVES });
}
const slotOf = (ctx: ConstitutionContext, agent: string, id: string): SlotRecord => ctx.agents.find(item => item.agent === agent)!.slots.get(id)!;
const fitOf = (ctx: ConstitutionContext, agent: string, id: string, name?: string) => {
  const slot = slotOf(ctx, agent, id);
  const candidate = name ? slot.candidates.find(item => item.name === name)! : slot.candidates[0]!;
  return certifyFit({ slot, candidate }, certifyEnv(ctx));
};
const withStandard = (root: string) => cpSync(join(FIXTURES, "standards", STANDARD), join(root, "packages", "writer", "standards", STANDARD), { recursive: true });

describe("certify: one certifier for every rung (R03.3)", () => {
  it("takes only slot, candidate and contract", () => {
    expect([...CERTIFY_INPUT_FIELDS]).toEqual(["slot", "candidate", "contract"]);
  });

  it("gives the same verdict whatever the candidate's source kind says", () => {
    const SOURCES: Record<string, Record<string, unknown>> = {
      registry: { kind: "registry", ref: ["shadcn/button@1.0.0"] },
      derived: { kind: "derived", ref: ["shadcn/button@1.0.0"] },
      original: { kind: "original", ref: [] },
      composition: { kind: "composition", ref: [], parts: [{ slot: "ui.label", files: ["registry/ui/label.tsx"] }] },
      npm: { kind: "npm", ref: ["npm/react@19.0.0"] },
    };
    const run = (kind: string) => {
      const ctx = ctxOf({ designer: { "ui.button": { candidates: { "button-v1.json": elementItem("ui/ui.button.tsx", LABEL, { meta: { source: SOURCES[kind] } }) } } } });
      const slot = slotOf(ctx, "designer", "ui.button");
      return certify({ slot, candidate: slot.candidates[0]! }, certifyEnv(ctx));
    };
    const original = run("original");
    expect(codes(original.reasons)).toEqual(["no-standard"]);
    for (const kind of ["registry", "derived", "composition", "npm"]) expect(run(kind)).toEqual(original);
  });
});

describe("certify: interactive backdrop descriptor on a backdrop-declaring surface's code candidate (foundry-build-0048 A4, U23)", () => {
  /** A contract slot list that declares (or not) a backdrop-placed media slot. */
  const DECLARES = [{ name: "header", type: "region", required: true }, { name: "backdrop", type: "media", required: false, placement: "backdrop" }];
  const FIGURE_ONLY = [{ name: "header", type: "region", required: true }, { name: "media", type: "media", required: false, placement: "figure", alt: { copy: "media.title" } }];
  const surface = (slotId: string, backdrop: unknown, code = LABEL) => elementItem(`ui/${slotId}.tsx`, code, { meta: { source: { kind: "original", ref: [] }, backdrop } });
  const fit = (item: Record<string, unknown>, slots?: unknown, slotId = "sections.hero") => {
    const ctx = ctxOf({ designer: { [slotId]: { candidates: { "surface-v1.json": item } } } });
    const slot = slotOf(ctx, "designer", slotId);
    const own = slotDocOf(slot).contract;
    const contract = slots === undefined ? own : { ...own, slots };
    return certifyFit({ slot, candidate: slot.candidates[0]!, contract }, certifyEnv(ctx)).map(item => `${item.code}: ${item.message}`);
  };

  it("fits a descriptor on any surface whose contract declares a backdrop slot; the code still mounts and renders", () => {
    expect(fit(surface("sections.hero", { component: "flickering-grid", params: { squareSize: 8 } }), DECLARES)).toEqual([]);
    expect(fit(surface("sections.feature", { component: "particles", params: { quantity: 40 } }), DECLARES, "sections.feature")).toEqual([]);
    expect(fit(surface("frames.site-shell", { component: "grid-pattern", params: {} }), [{ id: "main", required: true, accepts: ["sections"] }, { id: "ground", required: false, accepts: ["assets"], placement: "backdrop" }], "frames.site-shell")).toEqual([]);
    expect(fit(surface("sections.hero", { component: "flickering-grid", params: {} }, "export function Example(): never { throw new Error(\"boom\"); }\n"), DECLARES))
      .toEqual([expect.stringMatching(/^render: .*boom/)]);
  });

  it("refuses a descriptor on a surface that declares no backdrop slot, a component, or a frame without one", () => {
    const refused = (slot: string) => [expect.stringMatching(new RegExp(`^invalid: slot ${slot.replace(".", "\\.")}: meta\\.backdrop rides only on the code candidate of a surface whose contract declares a backdrop-placed slot; the ${slot.replace(".", "\\.")} contract declares none`))];
    expect(fit(surface("sections.hero", { component: "flickering-grid", params: {} }), FIGURE_ONLY)).toEqual(refused("sections.hero"));
    expect(fit(surface("sections.feature", { component: "flickering-grid", params: {} }), [], "sections.feature")).toEqual(refused("sections.feature"));
    expect(fit(surface("frames.site-shell", { component: "flickering-grid", params: {} }), [{ id: "main", required: true, accepts: ["sections"] }], "frames.site-shell")).toEqual(refused("frames.site-shell"));
    expect(fit(surface("ui.button", { component: "flickering-grid", params: {} }), undefined, "ui.button")).toEqual(refused("ui.button"));
  });

  it("refuses a component the registry does not adopt and a param outside the record's schema", () => {
    expect(fit(surface("sections.hero", { component: "grid-glow", params: {} }), DECLARES)).toEqual([expect.stringMatching(/^invalid: slot sections\.hero: the interactive backdrop component is "grid-glow", not one of the adopted backdrop components/)]);
    expect(fit(surface("sections.hero", { component: "flickering-grid", params: { squareSize: 1 } }), DECLARES)).toEqual([expect.stringMatching(/^invalid: slot sections\.hero: flickering-grid param squareSize is 1, outside 2\.\.16/)]);
  });

  it("refuses, pin-side and independent of the validator, an interactive backdrop in a candidate's preview props on any slot", () => {
    const interactive = { kind: "interactive", backdrop: { component: "particles", params: { quantity: 160 } } };
    const ctx = ctxOf({ designer: {
      "sections.call-to-action": { candidates: { "cta-v1.json": elementItem("ui/sections.call-to-action.tsx", LABEL, { meta: { source: { kind: "original", ref: [] }, preview: { fixtures: { props: { backdrop: interactive } } } } }) } },
      "sections.hero": { candidates: { "hero-v1.json": surface("sections.hero", { component: "flickering-grid", params: { squareSize: 8 } }) } },
    } });
    const slot = slotOf(ctx, "designer", "sections.call-to-action");
    const message = "is an interactive backdrop in preview props; it rides only as meta.backdrop on the code candidate of a surface whose contract declares a backdrop-placed slot";
    // Through certifyFit the validator refuses it first; certifyElement (the pin's kind certifier) refuses it on its own.
    expect(certifyFit({ slot, candidate: slot.candidates[0]! }, certifyEnv(ctx)).map(item => item.message)).toEqual([expect.stringMatching(/^meta\.preview\.fixtures\.props\.backdrop is an interactive backdrop in preview props/)]);
    expect(certifyElement(slot, slot.candidates[0]!, slotDocOf(slot).contract, certifyEnv(ctx)).map(item => `${item.code}: ${item.message}`))
      .toEqual([`invalid: slot sections.call-to-action: meta.preview.fixtures.props.backdrop ${message}`]);
    const heroSlot = slotOf(ctx, "designer", "sections.hero");
    const outOfRange = { ...JSON.parse(heroSlot.candidates[0]!.text), meta: { source: { kind: "original", ref: [] }, backdrop: { component: "flickering-grid", params: { squareSize: 8 } }, preview: { fixtures: { backdrop: { kind: "interactive", backdrop: { component: "flickering-grid", params: { squareSize: 1 } } } } } } };
    expect(certifyElement(heroSlot, { ...heroSlot.candidates[0]!, json: outOfRange }, { ...slotDocOf(heroSlot).contract, slots: DECLARES }, certifyEnv(ctx)).map(item => item.message))
      .toEqual([`slot sections.hero: meta.preview.fixtures.backdrop ${message}`]);
  });
});

describe("certify: element (server render with the slot's contract fixture)", () => {
  it("renders a fitting candidate; with no standard it stays uncertified (no-standard), never passed by default", () => {
    const ctx = ctxOf({ designer: { "ui.button": { candidates: { "button-v1.json": elementItem("ui/ui.button.tsx", LABEL) } } } });
    expect(fitOf(ctx, "designer", "ui.button")).toEqual([]);
    const slot = slotOf(ctx, "designer", "ui.button");
    const result = certify({ slot, candidate: slot.candidates[0]! }, certifyEnv(ctx));
    expect(result.certified).toBe(false);
    expect(codes(result.reasons)).toEqual(["no-standard"]);
  });

  it("fails a candidate that throws while rendering, ships no fixture file, or exports no component", () => {
    const ctx = ctxOf({ designer: { "ui.button": { candidates: {
      "button-v1.json": elementItem("ui/ui.button.tsx", "export function Example(): never { throw new Error(\"boom\"); }\n"),
      "button-v2.json": elementItem("ui/other.tsx", LABEL),
      "button-v3.json": elementItem("ui/ui.button.tsx", "export const Example = 42;\n"),
    } } } });
    expect(fitOf(ctx, "designer", "ui.button", "button-v1.json")).toEqual([expect.objectContaining({ code: "render", message: expect.stringMatching(/boom/) })]);
    expect(codes(fitOf(ctx, "designer", "ui.button", "button-v2.json"))).toEqual(["fixture"]);
    expect(fitOf(ctx, "designer", "ui.button", "button-v3.json")).toEqual([expect.objectContaining({ code: "render", message: expect.stringMatching(/exports no component Example/) })]);
  });

  it("fails an import of an undeclared package", () => {
    const code = `import { thing } from "left-pad-not-declared";\nexport const used = thing;\n${LABEL}`;
    const ctx = ctxOf({ designer: { "ui.button": { candidates: { "button-v1.json": elementItem("ui/ui.button.tsx", code) } } } });
    expect(codes(fitOf(ctx, "designer", "ui.button"))).toContain("import");
  });

  it("ignores the candidate's own meta.preview: only the contract fixture mounts it", () => {
    const preview = { schema: "clossys.element-preview/1", fixtures: { file: "ui/ui.button.tsx", export: "Other", props: {} } };
    const code = `${LABEL}export function Other(): never { throw new Error("own preview mounted"); }\n`;
    const ctx = ctxOf({ designer: { "ui.button": { candidates: { "button-v1.json": elementItem("ui/ui.button.tsx", code, { meta: { preview } }) } } } });
    expect(fitOf(ctx, "designer", "ui.button")).toEqual([]);
  });

  it("reports a slot with no contract fixture as a missing record (no-fixture), not a fit failure", () => {
    const doc = slotDoc("designer", "ui.button");
    const { fixture: _fixture, ...contract } = doc.contract as Record<string, unknown>;
    const ctx = ctxOf({ designer: { "ui.button": { slot: { ...doc, contract }, candidates: { "button-v1.json": elementItem("ui/ui.button.tsx", LABEL) } } } });
    const reasons = fitOf(ctx, "designer", "ui.button");
    expect(codes(reasons)).toEqual(["no-fixture"]);
    expect(onlyMissingRecords(reasons)).toBe(true);
    expect([...MISSING_RECORD_CODES].sort()).toEqual(["no-fixture", "no-standard"]);
  });
});

describe("certify: brief, strings, page, seat", () => {
  it("brief: holds every fixture heading", () => {
    const withHeadings = (headings: string[]) => ({ ...slotDoc("director", "brand.voice"), contract: { summary: "brief brand.voice", fixture: { headings } } });
    const fits = ctxOf({ director: { "brand.voice": { slot: withHeadings(BRIEF_HEADINGS), candidates: { "voice-v1.md": briefText("brand.voice") }, pin: false } } });
    expect(fitOf(fits, "director", "brand.voice")).toEqual([]);
    const lacks = ctxOf({ director: { "brand.voice": { slot: withHeadings([...BRIEF_HEADINGS, "Evidence"]), candidates: { "voice-v1.md": briefText("brand.voice") }, pin: false } } });
    expect(fitOf(lacks, "director", "brand.voice")).toEqual([expect.objectContaining({ code: "fixture", message: expect.stringMatching(/Evidence/) })]);
  });

  it("strings: every fixture key in every fixture locale, and no other key in a closed contract", () => {
    const doc = slotDoc("writer", "home.hero");
    const ctx = ctxOf({ writer: { "home.hero": { slot: doc, pin: false, candidates: {
      "hero-v1.md": writerText("home.hero", { title: "Welcome." }),
      "hero-v2.md": writerText("home.hero", { lede: "Hello." }),
      "hero-v3.md": writerText("home.hero", { title: "Welcome.", lede: "Hello." }),
    } } } });
    expect(fitOf(ctx, "writer", "home.hero", "hero-v1.md")).toEqual([]);
    expect(fitOf(ctx, "writer", "home.hero", "hero-v2.md").map(item => item.message).join("\n")).toMatch(/lacks 1 fixture key\(s\): title[\s\S]*does not name: lede/);
    expect(fitOf(ctx, "writer", "home.hero", "hero-v3.md")).toEqual([expect.objectContaining({ code: "fixture", message: expect.stringMatching(/does not name: lede/) })]);
  });

  it("page: the fixture route, live pinned Designer frame and sections, resolvable copy", () => {
    const spec: WorkspaceSpec = {
      designer: { "ui.card": { candidates: { "card-v1.json": elementItem("ui/ui.card.tsx", LABEL) } } },
      writer: { "home.hero": { candidates: { "hero-v1.md": writerText("home.hero", { title: "Welcome." }) } } },
      publisher: { "site.home": { pin: false, candidates: {
        "home-v1.json": pageItem("/", ["ui.card"], { title: "home.hero#title" }),
        "home-v2.json": pageItem("/about", ["ui.missing"], { title: "home.hero#nope" }),
      } } },
    };
    const ctx = ctxOf(spec);
    expect(fitOf(ctx, "publisher", "site.home", "home-v1.json")).toEqual([]);
    expect(codes(fitOf(ctx, "publisher", "site.home", "home-v2.json"))).toEqual(["copy", "fixture", "section"]);
  });

  it("seat: a step of the graph; with no seat standard the seat is uncertified (planner decision 2026-11-13)", () => {
    const ctx = ctxOf({ producer: {
      "seat.pick.director": { candidates: { "director-v1.json": SAMPLE_SEAT } },
      "seat.nowhere": { candidates: { "nowhere-v1.json": SAMPLE_SEAT } },
    } });
    expect(fitOf(ctx, "producer", "seat.pick.director")).toEqual([]);
    expect(codes(fitOf(ctx, "producer", "seat.nowhere"))).toEqual(["step"]);
    const slot = slotOf(ctx, "producer", "seat.pick.director");
    const result = certify({ slot, candidate: slot.candidates[0]! }, certifyEnv(ctx));
    expect(result).toEqual({ certified: false, reasons: [expect.objectContaining({ code: "no-standard" })] });
  });
});

describe("certify: the standard's requirements plus the contract's (W2-I's loader)", () => {
  const spec = (text: string, contract: Record<string, unknown> = {}): WorkspaceSpec => {
    const doc = slotDoc("writer", "home.hero");
    return { writer: { "home.hero": { slot: { ...doc, standard: STANDARD, contract: { ...(doc.contract as object), ...contract } }, candidates: { "hero-v1.md": writerText("home.hero", { title: text }) } } } };
  };
  const result = (ctx: ConstitutionContext) => {
    const slot = slotOf(ctx, "writer", "home.hero");
    return certify({ slot, candidate: slot.candidates[0]! }, certifyEnv(ctx));
  };

  it("certifies a candidate that fits and passes every requirement", () => {
    expect(result(ctxOf(spec("Ship the page you meant to write."), withStandard))).toEqual({ certified: true, reasons: [] });
  });

  it("fails a requirement of the standard, and one the contract adds", () => {
    expect(codes(result(ctxOf(spec("TODO lorem ipsum"), withStandard)).reasons)).toEqual(["requirement"]);
    const stricter = result(ctxOf(spec("Ship the page you meant to write.", { requirements: [{ check: "text.word-limit", params: { max: 3 } }] }), withStandard));
    expect(stricter.reasons).toEqual([expect.objectContaining({ code: "requirement", message: expect.stringMatching(/^text\.word-limit/) })]);
  });

  it("refuses a standard that does not exist or does not serve the slot's kind", () => {
    expect(result(ctxOf(spec("Ship the page you meant to write.")))).toEqual({ certified: false, reasons: [expect.objectContaining({ code: "standard", message: expect.stringMatching(/does not exist/) })] });
    const ctx = ctxOf({ director: { "brand.voice": { slot: { ...slotDoc("director", "brand.voice"), standard: STANDARD }, candidates: { "voice-v1.md": "---\nslot: \"brand.voice\"\nsource: {\"kind\":\"original\",\"ref\":[]}\n---\n## Voice\n" } } } }, root => cpSync(join(FIXTURES, "standards", STANDARD), join(root, "packages", "director", "standards", STANDARD), { recursive: true }));
    const slot = slotOf(ctx, "director", "brand.voice");
    expect(standardReasons({ slot, candidate: slot.candidates[0]! }, certifyEnv(ctx), "pins")).toEqual([expect.objectContaining({ code: "standard" })]);
  });

  it("the synchronous requirements verdict equals the async one for core criteria", async () => {
    const inputs = { candidate: { name: "hero-v1.md", bytes: "Ship the page you meant to write. TODO" }, kind: "strings", standard: { id: STANDARD, sha256: "abc", requirements: JSON.parse(readFileSync(join(FIXTURES, "standards", STANDARD, "requirements.json"), "utf8")).requirements }, contract: { requirements: [{ check: "text.word-limit", params: { max: 3 } }] }, pinSet: "p" };
    const resolve = async (id: string) => CORE_CRITERIA[id]!;
    expect(requirementsVerdictSync(inputs)).toEqual(await requirementsVerdict(inputs, resolve));
  });
});

describe("certify: the hash-keyed cache (R16.4 key, no recipe field)", () => {
  const spec = (): WorkspaceSpec => ({
    designer: {
      "ui.button": { candidates: { "button-v1.json": elementItem("ui/ui.button.tsx", LABEL) } },
      "ui.card": { slot: slotDoc("designer", "ui.card", { uses: ["ui.button"] }), candidates: { "card-v1.json": elementItem("ui/ui.card.tsx", LABEL) } },
    },
  });

  it("keys on candidate, standard, contract and pinSet only", () => {
    expect([...CERTIFY_KEY_FIELDS]).toEqual(["candidate", "standard", "contract", "pinSet"]);
  });

  it("a second run over the same records is all hits; a changed pin of the dependency set changes the pinSet", () => {
    const dir = mkdtempSync(join(tmpdir(), "certify-cache-"));
    const cache = join(dir, "certify.json");
    const cold = certifyWorld(ctxOf(spec()), { cache });
    expect(cold).toMatchObject({ hits: 0, misses: 2 });
    expect(existsSync(cache)).toBe(true);
    const warm = certifyWorld(ctxOf(spec()), { cache });
    expect(warm).toMatchObject({ hits: 2, misses: 0 });
    expect([...warm.results.values()].map(item => item.certification)).toEqual([...cold.results.values()].map(item => item.certification));

    const changed = spec();
    changed.designer!["ui.button"]!.candidates = { "button-v1.json": elementItem("ui/ui.button.tsx", `${LABEL}// changed\n`) };
    const ctx = ctxOf(changed);
    const card = slotOf(ctx, "designer", "ui.card");
    const before = ctxOf(spec());
    const cardBefore = slotOf(before, "designer", "ui.card");
    expect(pinSetOf({ slot: card, candidate: card.candidates[0]! }, certifyEnv(ctx))).not.toBe(pinSetOf({ slot: cardBefore, candidate: cardBefore.candidates[0]! }, certifyEnv(before)));
    // The button's bytes changed (its own key) and the card's pinSet names the button's pin: both miss.
    expect(certifyWorld(ctx, { cache })).toMatchObject({ hits: 0, misses: 2 });
  });

  it("a header for another certifier version or environment discards the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "certify-cache-"));
    const path = join(dir, "certify.json");
    const key = { candidate: "c", standard: "s", contract: "k", pinSet: "p" };
    const one = openCache(path, "v1", "e1");
    one.set(key, { certified: true, reasons: [] });
    expect(one.save()).toBe(true);
    expect(openCache(path, "v1", "e1").get(key)).toEqual({ certified: true, reasons: [] });
    expect(openCache(path, "v2", "e1").get(key)).toBeUndefined();
    expect(openCache(path, "v1", "e2").get(key)).toBeUndefined();
  });

  it("results are keyed by agent, slot and candidate", () => {
    const world = certifyWorld(ctxOf(spec()), { cache: false });
    expect([...world.results.keys()].sort()).toEqual([resultKey("designer", "ui.button", "button-v1.json"), resultKey("designer", "ui.card", "card-v1.json")]);
  });
});

describe("certify: the fit dry run", () => {
  it("proposes each slot's fixture from its pinned candidate and groups fit failures per agent and family", () => {
    const doc = slotDoc("writer", "home.hero");
    const { fixture: _fixture, ...contract } = doc.contract as Record<string, unknown>;
    const ctx = ctxOf({ writer: { "home.hero": { slot: { ...doc, contract }, candidates: {
      "hero-v1.md": writerText("home.hero", { title: "Welcome." }),
      "hero-v2.md": writerText("home.hero", { lede: "Hello." }),
    } } } });
    const slot = slotOf(ctx, "writer", "home.hero");
    expect(proposedContract(slot, certifyEnv(ctx))).toEqual({ source: "pinned", contract: { ...contract, fixture: { keys: ["title"], locales: ["en"] } } });
    const result = dryRun(ctx);
    expect(result).toMatchObject({ candidates: 2, fit: 1, failing: 1, unmeasured: 0, fixtures: { writer: { own: 0, pinned: 1, none: 0, "not-needed": 0 } } });
    expect(result.families).toEqual([expect.objectContaining({ agent: "writer", family: "home", candidates: 2, failing: 1, codes: { fixture: 1 } })]);
    expect(familyOf("components.studio.card")).toBe("components");
  });
});
