import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { criterionIds } from "../constitution/criteria/core/catalog.js";
import {
  CARD_STANDARDS, cardContractIssues, cardCoverage, DEFAULT_LICENSES, DEFAULT_SEED_REGISTRIES, exemplarIssues, ledgerEvents, loadStandards, parseTaste, readStandard, readStandardPolicy, requirementIssues,
  resolveRequirements, seedIssues, slotKinds, STANDARD_AGENTS, standardFits, standardFor, tasteIssues,
} from "./standards.js";

const FIXTURE = fileURLToPath(new URL("../constitution/__fixtures__/standards/fixture-headline/", import.meta.url));
const put = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "standards-"));
  cpSync(FIXTURE, join(root, "packages", "writer", "standards", "fixture-headline"), { recursive: true });
  return root;
}

describe("records/standards", () => {
  it("reads the fixture standard clean, with every file hashed and the ledger kept apart", () => {
    const standard = readStandard(workspace(), "writer", "fixture-headline");
    expect(standard.issues).toEqual([]);
    expect(standard.dir).toBe("packages/writer/standards/fixture-headline");
    expect(standard.doc).toMatchObject({ id: "fixture-headline", kinds: ["strings"], mode: "craft", craftTier: "high", seeds: [] });
    expect(Object.keys(standard.files).sort()).toEqual(["exemplars/exemplars.json", "exemplars/house-voice.md", "exemplars/plain-claim.md", "requirements.json", "taste.md"]);
    expect(standard.exemplarFiles).toEqual(["house-voice.md", "plain-claim.md"]);
    expect(standard.taste?.criteria.map(criterion => criterion.id)).toEqual(["clarity", "voice", "rhythm"]);
    expect(standard.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(standard.ledger).toHaveLength(1);
    const registered = criterionIds();
    expect(requirementIssues(standard, registered)).toEqual([]);
    expect(tasteIssues(standard, registered)).toEqual([]);
    expect(exemplarIssues(standard, {})).toEqual([]);
    expect(seedIssues(standard, {})).toEqual([]);
  });

  it("the standard sha is the files' tree hash: stable, ledger-blind, content-sensitive", () => {
    const root = workspace();
    const first = readStandard(root, "writer", "fixture-headline").sha256;
    put(join(root, "packages", "writer", "standards", "fixture-headline", "ledger.json"), "{\"events\":[]}\n");
    expect(readStandard(root, "writer", "fixture-headline").sha256).toBe(first);
    put(join(root, "packages", "writer", "standards", "fixture-headline", "taste.md"), "## clarity\n");
    expect(readStandard(root, "writer", "fixture-headline").sha256).not.toBe(first);
  });

  it("reports unreadable parts: bad JSON, a symlink, missing files", () => {
    const root = workspace();
    const dir = join(root, "packages", "writer", "standards", "fixture-headline");
    put(join(dir, "requirements.json"), "{");
    expect(readStandard(root, "writer", "fixture-headline").issues.join("\n")).toMatch(/requirements\.json: /);
    symlinkSync(join(dir, "taste.md"), join(dir, "link.md"));
    expect(readStandard(root, "writer", "fixture-headline").issues.join("\n")).toMatch(/link\.md is a symbolic link/);
    const empty = mkdtempSync(join(tmpdir(), "standards-"));
    mkdirSync(join(empty, "packages", "writer", "standards", "bare"), { recursive: true });
    expect(readStandard(empty, "writer", "bare").issues).toEqual(["no requirements.json", "no taste.md", "no exemplars/ folder"]);
  });

  it("createOnly comes with a non-empty createOnlyReason, and neither alone", () => {
    const root = workspace();
    const file = join(root, "packages", "writer", "standards", "fixture-headline", "requirements.json");
    const base = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const issuesWith = (extra: Record<string, unknown>) => { put(file, JSON.stringify({ ...base, ...extra })); return readStandard(root, "writer", "fixture-headline").issues.join("\n"); };
    expect(issuesWith({ createOnly: true, createOnlyReason: "every candidate is crafted from the brief" })).toBe("");
    expect(issuesWith({ createOnly: true })).toMatch(/anyOf/);
    expect(issuesWith({ createOnlyReason: "why" })).toMatch(/anyOf/);
    expect(issuesWith({ createOnly: true, createOnlyReason: "   " })).toMatch(/createOnlyReason/);
    expect(issuesWith({ createOnly: false, createOnlyReason: "why" })).toMatch(/createOnly/);
  });

  it("createOnly is a craft standard's only: never adopt-first, and never with seeds", () => {
    const root = workspace();
    const file = join(root, "packages", "writer", "standards", "fixture-headline", "requirements.json");
    const base = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const issuesWith = (extra: Record<string, unknown>) => { put(file, JSON.stringify({ ...base, ...extra })); return readStandard(root, "writer", "fixture-headline").issues.join("\n"); };
    const createOnly = { createOnly: true, createOnlyReason: "every candidate is crafted from the brief" };
    // Control: adopt-first without createOnly, and craft with createOnly and empty seeds, are both valid.
    expect(issuesWith({ mode: "adopt-first", createGaps: ["missing-behavior"] })).toBe("");
    expect(issuesWith({ ...createOnly, seeds: [] })).toBe("");
    expect(issuesWith({ mode: "adopt-first", createGaps: ["missing-behavior"], ...createOnly })).toMatch(/oneOf/);
    expect(issuesWith({ ...createOnly, seeds: ["shadcn/button"] })).toMatch(/anyOf/);
  });

  it("loads every agent's standards in agent then id order and finds one by agent", () => {
    const root = workspace();
    cpSync(FIXTURE, join(root, "packages", "director", "standards", "brief.voice"), { recursive: true });
    const all = loadStandards(root);
    expect(all.map(item => `${item.agent}/${item.id}`)).toEqual(["director/brief.voice", "writer/fixture-headline"]);
    expect(standardFor(all, "writer", "fixture-headline")?.agent).toBe("writer");
    expect(standardFor(all, "designer", "fixture-headline")).toBeUndefined();
    expect(STANDARD_AGENTS).toContain("producer");
  });

  it("parses taste anchors and ledger shapes", () => {
    expect(parseTaste("# t\n## `clarity`\n- 1: a\n* 2) b\n- 3. c\n# other\n- 4: ignored\n")).toEqual([{ id: "clarity", anchors: { 1: "a", 2: "b", 3: "c" } }]);
    expect(ledgerEvents([{ op: "a" }, 1])).toEqual([{ op: "a" }]);
    expect(ledgerEvents({ events: [{ op: "b" }] })).toEqual([{ op: "b" }]);
    expect(ledgerEvents("x")).toEqual([]);
  });

  it("matches a slot kind and its contract sub-kind", () => {
    expect(slotKinds("element", { kind: "button" })).toEqual(["element/button", "element"]);
    expect(slotKinds("element", {})).toEqual(["element"]);
    expect(standardFits({ kinds: ["element/button"] }, "element", { kind: "button" })).toBe(true);
    expect(standardFits({ kinds: ["element/button"] }, "element", {})).toBe(false);
    expect(standardFits({ kinds: ["element"] }, "element", { kind: "card" })).toBe(true);
  });

  it("reads policy.json licenses and seed registries, and defaults the license allowlist", () => {
    const consumer = mkdtempSync(join(tmpdir(), "standards-consumer-"));
    expect(readStandardPolicy(consumer, "designer")).toEqual({});
    put(join(consumer, "agents", "designer", "policy.json"), JSON.stringify({ licenses: ["MIT"], seedRegistries: ["shadcn", 3], other: true }));
    expect(readStandardPolicy(consumer, "designer")).toEqual({ licenses: ["MIT"], seedRegistries: ["shadcn"] });
    put(join(consumer, "agents", "writer", "policy.json"), "[");
    expect(readStandardPolicy(consumer, "writer").error).toMatch(/policy\.json/);
    expect(DEFAULT_LICENSES).toEqual(["MIT", "Apache-2.0", "CC0-1.0", "CC-BY-4.0"]);
  });

  it("with no policy.json, Designer seeds come from stock shadcn and shadcn-aria only; a consumer list overrides", () => {
    const none = readStandardPolicy(mkdtempSync(join(tmpdir(), "standards-consumer-")), "designer");
    expect(none).toEqual({});
    const seeded = (seeds: string[], agent = "designer") => ({ agent, doc: { seeds } }) as unknown as Parameters<typeof seedIssues>[0];
    expect(DEFAULT_SEED_REGISTRIES).toEqual(["shadcn", "shadcn-aria"]);
    expect(seedIssues(seeded(["shadcn", "shadcn-aria", "shadcn/button", "shadcn-aria:dialog"]), none)).toEqual([]);
    expect(seedIssues(seeded(["magicui/marquee", "shadcn-app", "shadcn"]), none)).toEqual([
      "seed magicui/marquee is not from a policy.json seed registry (shadcn, shadcn-aria)",
      "seed shadcn-app is not from a policy.json seed registry (shadcn, shadcn-aria)",
    ]);
    // A consumer list replaces the default: its registries pass, the default's no longer do.
    expect(seedIssues(seeded(["magicui/marquee"]), { seedRegistries: ["magicui"] })).toEqual([]);
    expect(seedIssues(seeded(["shadcn/button"]), { seedRegistries: ["magicui"] })).toEqual(["seed shadcn/button is not from a policy.json seed registry (magicui)"]);
    expect(seedIssues(seeded(["shadcn"]), { seedRegistries: [] })).toEqual(["seed shadcn is not from a policy.json seed registry (none)"]);
    // The default never lets a non-Designer standard list seeds.
    expect(seedIssues(seeded(["shadcn"], "writer"), none)).toEqual(["writer standards list no seeds (seeds: [])"]);
  });

  it("resolves requirements: the contract parameterises and extends the standard's", () => {
    const standard = [{ check: "text.word-limit", params: { max: 12 } }, { check: "lexicon.clean", params: {} }];
    expect(resolveRequirements(standard, {})).toEqual(standard);
    expect(resolveRequirements(standard, { requirements: [{ check: "text.word-limit", params: { max: 8 } }, { check: "text.nonempty", params: {} }] })).toEqual([
      { check: "text.word-limit", params: { max: 8 } }, { check: "lexicon.clean", params: {} }, { check: "text.nonempty", params: {} },
    ]);
  });

  it("binds a \"$contract\" param to the slot's own contract, so per-slot facts are never copied into contract.requirements", () => {
    const contract = { question: "Why us?", mustContain: [{ key: "Difference", hint: "how" }] };
    const standard = [{ check: "brief.keys", params: { contract: "$contract" } }, { check: "brief.sections", params: { note: "$contracts" } }];
    expect(resolveRequirements(standard, contract)).toEqual([{ check: "brief.keys", params: { contract } }, { check: "brief.sections", params: { note: "$contracts" } }]);
    expect(resolveRequirements(standard, undefined)[0]).toEqual({ check: "brief.keys", params: { contract: {} } });
    // The standard is never mutated: the next slot binds its own contract.
    expect(standard[0]!.params.contract).toBe("$contract");
  });

  describe("preview.card (SC-0, R18.13)", () => {
    const INLINE = { method: "inline", intrinsicWidth: null, mustContain: ["[data-swatch]"], states: ["loading", "not-needed", "no-preview", "failed", "not-pinned"] };
    const FRAME = { method: "frame", intrinsicWidth: 480, mustContain: ["[data-clossys-slot]"], states: ["loading", "failed", "not-pinned"] };
    /** The fixture standard with `preview` set (undefined removes it), read back. */
    function withPreview(preview: unknown, root = workspace()) {
      const path = join(root, "packages", "writer", "standards", "fixture-headline", "requirements.json");
      const { preview: _previous, ...doc } = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      put(path, `${JSON.stringify(preview === undefined ? doc : { ...doc, preview }, null, 2)}\n`);
      return readStandard(root, "writer", "fixture-headline");
    }

    it("reads a valid inline or frame card contract clean and types it on the doc", () => {
      const inline = withPreview({ card: INLINE });
      expect(inline.issues).toEqual([]);
      expect(inline.doc?.preview?.card).toEqual(INLINE);
      expect(withPreview({ card: FRAME }).issues).toEqual([]);
      expect(withPreview(undefined).doc?.preview).toBeUndefined();
    });

    it("refuses a malformed card contract through the R15.2 schema", () => {
      const issues = (preview: unknown) => withPreview(preview).issues.join("\n");
      expect(issues({})).toMatch(/\/preview: requires card/);
      expect(issues({ card: INLINE, extra: 1 })).toMatch(/\/preview: has unknown key extra/);
      expect(issues({ card: { ...INLINE, method: "png" } })).toMatch(/\/preview\/card\/method: must be one of "inline", "frame"/);
      expect(issues({ card: { method: "frame", mustContain: ["a"], states: ["loading"] } })).toMatch(/\/preview\/card: requires intrinsicWidth/);
      expect(issues({ card: { ...FRAME, intrinsicWidth: 0 } })).toMatch(/intrinsicWidth: must be at least 1/);
      expect(issues({ card: { ...FRAME, intrinsicWidth: 480.5 } })).toMatch(/intrinsicWidth: must be integer or null/);
      expect(issues({ card: { ...INLINE, mustContain: [] } })).toMatch(/mustContain: must have at least 1 items/);
      expect(issues({ card: { ...INLINE, mustContain: [" "] } })).toMatch(/mustContain\/0: must match/);
      expect(issues({ card: { ...INLINE, states: ["empty"] } })).toMatch(/states\/0: must be one of "loading"/);
      expect(issues({ card: { ...INLINE, size: "card" } })).toMatch(/\/preview\/card: has unknown key size/);
    });

    it("refuses what the schema cannot express: method and width pairing, repeats", () => {
      expect(withPreview({ card: { ...FRAME, intrinsicWidth: null } }).issues).toEqual(["requirements.json /preview/card: method frame needs an intrinsicWidth in px"]);
      expect(withPreview({ card: { ...INLINE, intrinsicWidth: 1280 } }).issues).toEqual(["requirements.json /preview/card: method inline renders from data: intrinsicWidth must be null, not 1280"]);
      expect(cardContractIssues({ ...FRAME, method: "frame", mustContain: ["a", "a", "b", "a"], states: ["failed", "failed"] } as never)).toEqual(["mustContain lists a twice", "states lists failed twice"]);
      expect(cardContractIssues(undefined)).toEqual([]);
    });

    it("lists the 29 card standards of section 5a", () => {
      const ids = Object.entries(CARD_STANDARDS).flatMap(([agent, list]) => list.map(id => `${agent}/${id}`));
      expect(ids).toHaveLength(29);
      expect(new Set(ids).size).toBe(29);
      for (const agent of Object.keys(CARD_STANDARDS)) expect(STANDARD_AGENTS).toContain(agent);
      expect(ids).toEqual(expect.arrayContaining(["producer/section.studio", "producer/seat", "publisher/page", "publisher/release", "designer/token.color", "writer/string"]));
    });

    it("R18.13 coverage reports every gap and clears a valid contract", () => {
      const root = workspace();
      cpSync(FIXTURE, join(root, "packages", "publisher", "standards", "page"), { recursive: true });
      put(join(root, "packages", "publisher", "standards", "page", "requirements.json"), "{");
      withPreview({ card: { ...FRAME, intrinsicWidth: null } }, root);
      const expected = { writer: ["fixture-headline"], publisher: ["page", "publication"] };
      expect(cardCoverage(loadStandards(root), expected).map(gap => `${gap.agent}/${gap.id}: ${gap.reason}`)).toEqual([
        "writer/fixture-headline: preview.card is invalid: method frame needs an intrinsicWidth in px",
        "publisher/page: requirements.json is invalid (R15.2): no preview.card read",
        "publisher/publication: no standard folder: no preview.card",
      ]);
      withPreview(undefined, root);
      expect(cardCoverage(loadStandards(root), { writer: ["fixture-headline"] })[0]?.reason).toBe("requirements.json has no preview.card");
      withPreview({ card: INLINE }, root);
      expect(cardCoverage(loadStandards(root), { writer: ["fixture-headline"] })).toEqual([]);
    });
  });
});
