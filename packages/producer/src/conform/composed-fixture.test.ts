/**
 * FCR: a composed frame or section slot (no reference adoptable in the selected style and engine) is judged against
 * its own pinned, certified composition, and frames may compose frames (frames.site-shell places frames.site-header)
 * with no banner landmark nested inside another. One rule, four places: the derive (reference-fixtures.ts), the
 * DF contract-fixture probe (dogfood.ts), the congruence tests (contract-fixtures.test.ts, ia-sync) and the element
 * certifier's fixture start (certify/element.ts).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { syncCriterion } from "../constitution/certify/requirements.js";
import { bannerLandmarks, certifyElement } from "../constitution/certify/element.js";
import { pinKey, type CertifyEnv } from "../constitution/certify/env.js";
import { SCORECARD_REF_TO, SCORECARD_SCHEMA } from "../constitution/pin-gate.js";
import type { CandidateRecord, SlotRecord } from "../constitution/types.js";
import { composedSlots } from "../specimen/composed-slots.js";
import { blockReferenceFixture, COMPOSED, referenceIndex } from "../specimen/reference-fixtures.js";
import { PROBES, type ProbeFacts } from "./dogfood.js";
import type { AgentModel, ConformModel } from "./model.js";

const here = dirname(fileURLToPath(import.meta.url));
const DESIGNER = join(here, "../../../designer");
const sha256 = (bytes: string) => createHash("sha256").update(bytes).digest("hex");

const SLOT = "frames.site-header";
const FILE = "registry/frames/site-header.tsx";
const NAME = "site-header-v1.json";
const HEADER_SOURCE = "export function SiteHeader() { return <header><nav>Home</nav></header>; }\n";
const fixture = (file: string | null = FILE, name = "SiteHeader") => ({ schema: "clossys.element-preview/1", fixtures: { ...(file !== null ? { file } : {}), export: name, props: {} } });
const candidateDoc = (path = FILE, content = HEADER_SOURCE) => ({
  clossys: { schema: "clossys.candidate/1", source: { kind: "composition", ref: [], license: "MIT", parts: [] } },
  content: { name: "site-header", type: "registry:block", files: [{ path, type: "registry:component", target: "components/site-header.tsx", content }] },
});

interface Certified { verdict?: string; certified?: boolean; submitted?: boolean; pick?: string; rowSha?: string; slot?: string }
/** The scorecard the CHOOSE gate writes when it pins `NAME` (pin-gate.ts `pinGate`). */
const scorecardOf = (candidateSha: string, { verdict = "certify", certified = true, submitted = true, pick = NAME, rowSha = candidateSha, slot = SLOT }: Certified = {}) => `${JSON.stringify({
  schema: SCORECARD_SCHEMA, slot: `designer/${slot}`, pick,
  candidates: [{ rank: 1, candidate: NAME, sha256: rowSha, submitted, certified, verdict, reasons: [], pinSet: "0".repeat(64) }],
}, null, 2)}\n`;
/** The critique `clossys critique` writes for `NAME` (critique-record.ts). */
const critiqueOf = (slot = SLOT) => ({
  schema: "clossys.critique/1", slot, candidate: NAME, standard: "frame", scores: { hierarchy: 4, restraint: 4 },
  packet: { manifest: [
    { role: "taste", ref: "packages/designer/standards/frame/taste.md" },
    { role: "contract", ref: `clossys/agents/designer/${slot}/slot.json#contract` },
    { role: "render", ref: `clossys/.state/renders/designer/${slot}/site-header-v1.png` },
  ] },
});

interface World {
  id?: string;
  mount?: unknown;
  /** The candidate file bytes (null: unreadable). */
  candidate?: unknown;
  certified?: Certified;
  /** The pin (null: unpinned); `refs` default to the gate's scorecard cite. */
  pin?: Record<string, unknown> | null;
  pinRejection?: string;
  /** Override the consumer files (null: absent). */
  scorecard?: string | null;
  critique?: unknown;
  composed?: readonly string[];
  ships?: ProbeFacts["referenceShips"];
}
/** One composed Designer slot under the DF contract-fixture probe, with a CHOOSE-gate pin of a certified candidate. */
function probe({ id = SLOT, mount = fixture(), candidate = candidateDoc(), certified = {}, pin, pinRejection, scorecard, critique = critiqueOf(id), composed = [SLOT], ships = () => false }: World = {}): string[] {
  const bytes = JSON.stringify(candidate);
  const card = scorecard === undefined ? scorecardOf(sha256(bytes), { slot: id, ...certified }) : scorecard;
  const cite = { to: SCORECARD_REF_TO, rel: "cites", record: `.state/checks/designer/${id}/scorecard.json`, sha256: card === null ? "0".repeat(64) : sha256(card) };
  const pinned = pin === null ? undefined : { schema: "clossys.pin/2", candidate: NAME, sha256: sha256(bytes), refs: [cite], ...(pin ?? {}) };
  const files: Record<string, string | null> = {
    [`.state/checks/designer/${id}/scorecard.json`]: card,
    [`agents/designer/${id}/critiques/site-header-v1.json`]: critique === null ? null : JSON.stringify(critique),
  };
  const live = { id, source: "placed", contract: { props: [], fixture: mount }, inputs: [], uses: [], ledger: [], ...(pinned ? { pin: pinned } : {}), ...(pinRejection !== undefined ? { pinRejection } : {}) };
  return PROBES["contract-fixture"]!({ agent: "designer", live: [live] } as unknown as AgentModel, { consumer: "/consumer/clossys" } as ConformModel, {
    emptyL2Detected: {}, requestVerb: true, critiqueMonorepoPath: false, referenceShips: ships, consumerAssets: [], composedSlots: new Set(composed),
    candidateText: (_slot, name) => { if (name !== NAME || candidate === null) throw new Error(`ENOENT: ${name}`); return bytes; },
    consumerText: path => { const text = files[path]; if (text === undefined || text === null) throw new Error(`ENOENT: ${path}`); return text; },
  }).rows;
}
const red = (why: RegExp, id = SLOT) => [expect.stringMatching(new RegExp(`^${id.replace(/\./g, "\\.")}: contract\\.fixture mounts .*, which neither its adopted references ship in the selected style nor its pinned, certified composition ships \\(${why.source}\\)$`))];
const u27 = (id: string, file = FILE, name = "SiteHeader") => [`${id}: contract.fixture mounts ${file}#${name}, which none of its adopted references ships in the selected style`];

describe("FCR (a): a composed frame whose pin is certified passes the DF contract-fixture probe", () => {
  it("green: pinned through the CHOOSE gate, certified on its scorecard, critiqued, and it ships the fixture's file and export", () => {
    expect(probe()).toEqual([]);
  });

  it("green: a default export the fixture names", () => {
    const source = "export default function SiteHeader() { return <header /> }\n";
    expect(probe({ mount: fixture(FILE, "default"), candidate: candidateDoc(FILE, source) })).toEqual([]);
  });

  it("OR kept: a composed slot whose fixture an adopted reference ships passes with no pin", () => {
    expect(probe({ pin: null, ships: (slot, file, name) => slot === SLOT && file === FILE && name === "SiteHeader" })).toEqual([]);
  });
});

describe("FCR (b): an unpinned or uncertified composition is refused", () => {
  it("refused: unpinned", () => {
    expect(probe({ pin: null })).toEqual(red(/it has no pin/));
  });

  it("refused: uncertified (no passing verdict on its scorecard)", () => {
    expect(probe({ certified: { certified: false } })).toEqual(red(/its pinned candidate site-header-v1\.json has no passing verdict \(submitted and certified\) on its scorecard/));
    expect(probe({ certified: { verdict: "refuse" } })).toEqual(red(/its pinned candidate site-header-v1\.json has no passing verdict .*/));
    expect(probe({ certified: { submitted: false } })).toEqual(red(/its pinned candidate site-header-v1\.json has no passing verdict .*/));
  });

  it("refused: each other broken pin, scorecard, critique or candidate gives exactly one row", () => {
    const cases: [string, World, RegExp][] = [
      ["pin the reader refuses", { pinRejection: "hash-drift" }, /the slot\/2 reader refuses its pin \(hash-drift\)/],
      ["pin names no candidate", { pin: { candidate: undefined } }, /its pin names no candidate/],
      ["not pinned through the CHOOSE gate", { pin: { refs: [] } }, /its pin cites no scorecard \(producer\/checks\.scorecard\), so it was not pinned through the CHOOSE gate/],
      ["scorecard missing", { scorecard: null }, /its scorecard \.state\/checks\/designer\/frames\.site-header\/scorecard\.json cannot be read: ENOENT: .*/],
      ["scorecard is not the cited one", { pin: { refs: [{ to: SCORECARD_REF_TO, rel: "cites", sha256: "f".repeat(64) }] } }, /its scorecard .* is not the one its pin cites .*/],
      ["scorecard of another slot", { certified: { slot: "frames.site-footer" } }, /its scorecard .* is no clossys\.scorecard\/1 scorecard of designer\/frames\.site-header/],
      ["scorecard picks another candidate", { certified: { pick: "site-header-v2.json" } }, /its scorecard picks "site-header-v2\.json", not its pinned candidate site-header-v1\.json/],
      ["scorecard judged other bytes", { certified: { rowSha: "e".repeat(64) } }, /its scorecard judged site-header-v1\.json at other bytes than its pin names/],
      ["no critique", { critique: null }, /its pinned candidate site-header-v1\.json has no readable critique record agents\/designer\/frames\.site-header\/critiques\/site-header-v1\.json: ENOENT: .*/],
      ["critique of another slot", { critique: critiqueOf("frames.site-footer") }, /its critique record .* is invalid \(.*\)/],
      ["critique lists the maker", { critique: { ...critiqueOf(), packet: { manifest: [...critiqueOf().packet.manifest, { role: "exemplar", ref: "packages/designer/recipes/create.frame/craft.md" }] } } }, /its critique record .* is invalid \(.*never a recipe file.*\)/],
      ["fixture path the candidate does not ship", { mount: fixture("registry/frames/other.tsx") }, /its pinned candidate site-header-v1\.json ships no file registry\/frames\/other\.tsx/],
      ["fixture export the candidate does not ship", { mount: fixture(FILE, "Header") }, /its pinned candidate's registry\/frames\/site-header\.tsx has no value export Header/],
      ["no fixture file", { mount: fixture(null) }, /the fixture names no file or export/],
      ["candidate unreadable", { candidate: null }, /its pinned candidate site-header-v1\.json cannot be read: .*/],
    ];
    for (const [name, world, why] of cases) expect(probe(world), name).toEqual(red(why));
  });
});

describe("FCR (c): a slot with an adoptable reference still demands the reference fixture", () => {
  it("the same certified composition is red with the U27 message on a slot that is not composed", () => {
    expect(probe({ composed: [] }), "not in the composed list").toEqual(u27(SLOT));
    expect(probe({ id: "frames.site-footer", composed: [SLOT] }), "frames.site-footer").toEqual(u27("frames.site-footer"));
    expect(probe({ id: "components.logo", composed: ["components.logo"] }), "a component slot is never composed").toEqual(u27("components.logo"));
  });

  it("the package's derived composed list (read by the default reader) holds no slot with an adoptable reference", () => {
    const composed = composedSlots(DESIGNER);
    expect(composed.has(SLOT)).toBe(true);
    for (const id of ["frames.site-footer", "frames.site-shell", "sections.comparison", "sections.people"]) expect(composed.has(id), id).toBe(false);
    const index = referenceIndex(DESIGNER);
    // frames.site-footer adopts the engine-neutral tailark mist footer: the derive keeps its reference fixture.
    const footer = blockReferenceFixture(index, "frames", {}, index.references.get("frames.site-footer") ?? [], DESIGNER);
    expect(footer).toMatchObject({ fixture: { fixtures: { file: "mist/blocks/footer/one.tsx" } } });
    // frames.site-header's only rows are engine-flavoured (asChild headers): composed, never a reference fixture.
    const header = blockReferenceFixture(index, "frames", {}, index.references.get(SLOT) ?? [], DESIGNER);
    expect(header).toEqual({ composed: expect.stringContaining(COMPOSED) });
    expect(blockReferenceFixture(index, "sections", {}, [], DESIGNER)).toEqual({ composed: expect.stringContaining(COMPOSED) });
  });

  it("the probe's default composed list is the package's: a non-composed frame still needs its reference", () => {
    const run = (id: string) => PROBES["contract-fixture"]!({ agent: "designer", live: [{ id, source: "placed", contract: { props: [], fixture: fixture() }, inputs: [], uses: [], ledger: [] }] } as unknown as AgentModel, { consumer: "/consumer/clossys" } as ConformModel, {
      emptyL2Detected: {}, requestVerb: true, critiqueMonorepoPath: false, referenceShips: () => false, consumerAssets: [],
    }).rows;
    expect(run("frames.site-footer")).toEqual(u27("frames.site-footer"));
    expect(run(SLOT)).toEqual(red(/it has no pin/));
  });
});

describe("FCR (d): frames compose frames, with one banner landmark", () => {
  const frame = JSON.parse(readFileSync(join(DESIGNER, "standards/frame/requirements.json"), "utf8")) as { requirements: { check: string; params?: Record<string, unknown> }[] };
  const layers = frame.requirements.find(requirement => requirement.check === "compose.layers")!;
  const shellItem = (parts: string[]) => ({ name: "site-shell", type: "registry:block", files: [], meta: { source: { kind: "composition", ref: [], license: "MIT", parts: parts.map(slot => ({ slot, files: [] })) } } });

  it("compose.layers of the frame standard admits frames.site-header and frames.site-footer as parts of frames.site-shell", () => {
    const check = syncCriterion("compose.layers");
    expect(check({ kind: "element/frame", text: "", json: shellItem(["frames.site-header", "frames.site-footer", "sections.consent", "components.button"]) }, layers.params ?? {})).toEqual([]);
    // Pages stay out of a frame: the layer list is the standard's, not open.
    expect(check({ kind: "element/frame", text: "", json: shellItem(["pages.home"]) }, layers.params ?? {})).toEqual([expect.stringMatching(/^part pages\.home is from layer pages, not /)]);
  });

  const SHELL_FILE = "registry/frames/site-shell.tsx";
  const shellSource = (wrapper: string) => `import { SiteHeader } from "@/components/site-header";\nexport function SiteShell() { return <${wrapper}><SiteHeader /><main>Body</main><footer>Foot</footer></${wrapper}>; }\n`;
  const record = (id: string, uses: string[]) => ({ agent: "designer", id, dir: `clossys/agents/designer/${id}`, live: true, entries: [], slot: { path: `clossys/agents/designer/${id}/slot.json`, value: { uses } }, candidates: [] }) as unknown as SlotRecord;
  const candidate = (name: string, json: unknown) => ({ name, json }) as unknown as CandidateRecord;
  const header = candidateDoc().content;
  const env = {
    root: join(here, "../.."),
    pins: new Map([[pinKey("designer", SLOT), { slot: record(SLOT, []), candidate: candidate(NAME, header) }]]),
    installers: new Map([["components/site-header.tsx", [SLOT]]]),
    copy: new Map<string, string>(),
    composed: new Set([SLOT, "frames.site-shell"]),
  } as unknown as CertifyEnv;
  const contract = { props: [], fixture: { schema: "clossys.element-preview/1", fixtures: { file: SHELL_FILE, export: "SiteShell", props: {} } } };
  const shell = (wrapper: string) => candidate("site-shell-v1.json", { name: "site-shell", type: "registry:block", files: [{ path: SHELL_FILE, type: "registry:component", content: shellSource(wrapper) }] });

  it("a shell placing the pinned header frame certifies, and its render has exactly one banner landmark", () => {
    const slot = record("frames.site-shell", [SLOT]);
    expect(certifyElement(slot, shell("div"), contract, env)).toEqual([]);
    const SiteHeader = () => createElement("header", null, createElement("nav", null, "Home"));
    const markup = renderToString(createElement("div", null, createElement(SiteHeader), createElement("main", null, "Body"), createElement("footer", null, "Foot")));
    expect(bannerLandmarks(markup)).toEqual({ banners: 1, nested: 0 });
  });

  it("refused: a shell whose own banner wraps the header frame's banner", () => {
    const slot = record("frames.site-shell", [SLOT]);
    expect(certifyElement(slot, shell("header"), contract, env)).toEqual([expect.objectContaining({ code: "render", message: expect.stringMatching(/renders a banner landmark nested inside another banner/) })]);
  });

  it("refused: a composed slot's fixture that its own pin does not ship", () => {
    const pinnedShell = { ...env, pins: new Map([...env.pins, [pinKey("designer", "frames.site-shell"), { slot: record("frames.site-shell", [SLOT]), candidate: shell("div") }]]) } as unknown as CertifyEnv;
    expect(certifyElement(record("frames.site-shell", [SLOT]), shell("div"), contract, pinnedShell)).toEqual([]);
    const moved = { ...contract, fixture: { ...contract.fixture, fixtures: { ...contract.fixture.fixtures, file: "registry/frames/shell.tsx" } } };
    const elsewhere = candidate("site-shell-v2.json", { name: "site-shell", type: "registry:block", files: [{ path: "registry/frames/shell.tsx", type: "registry:component", content: shellSource("div") }] });
    expect(certifyElement(record("frames.site-shell", [SLOT]), elsewhere, moved, pinnedShell)).toEqual([expect.objectContaining({ code: "fixture", message: "composed slot frames.site-shell's contract fixture mounts registry/frames/shell.tsx, which its pinned composition does not ship" })]);
    // Not composed: the same move is judged as before (no composed-fixture reason).
    expect(certifyElement(record("frames.site-shell", [SLOT]), elsewhere, moved, { ...pinnedShell, composed: new Set() } as unknown as CertifyEnv)).toEqual([]);
  });

  it("bannerLandmarks: a header inside sectioning content or main is no banner; role=banner is", () => {
    expect(bannerLandmarks("<div><header>a</header></div>")).toEqual({ banners: 1, nested: 0 });
    expect(bannerLandmarks("<header><header>a</header></header>")).toEqual({ banners: 2, nested: 1 });
    expect(bannerLandmarks("<div role=\"banner\"><header>a</header></div>")).toEqual({ banners: 2, nested: 1 });
    expect(bannerLandmarks("<header><section><header>a</header></section><article><header/></article></header>")).toEqual({ banners: 1, nested: 0 });
    expect(bannerLandmarks("<main><header>a</header></main><header role=\"presentation\">b</header>")).toEqual({ banners: 0, nested: 0 });
    expect(bannerLandmarks("<header><img src=\"x\"><br></header><header>b</header>")).toEqual({ banners: 2, nested: 0 });
  });
});
