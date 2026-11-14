import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSlots } from "../records/slots.js";
import { candidatesDir, jsonBytes, pinFile, slotFile, validateSlotDoc } from "../records/slot-model/index.js";
import { contractFixtureIssues } from "../records/slot-model/contract-fixture.js";
import { sha256Hex } from "../records/hash.js";
import { canonicalLibrary } from "./__fixtures__/canonical-library.js";
import { certifyCandidate, CONTRACT_FIXTURE_SOURCE, libraryRecordStore, specimenPreviewIssue } from "./library-source.js";
import { deriveContractFixtures, fixtureFromPreview } from "./contract-fixture-derive.js";

let root: string;
beforeEach(async () => { root = await canonicalLibrary(mkdtempSync(join(tmpdir(), "producer-contract-fixture-"))); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

const card = () => listSlots(root, "designer").find(entry => entry.id === "components.card")!;
const cardItem = () => JSON.parse(readFileSync(join(candidatesDir(card().dir), "sample-card-v1.json"), "utf8"));
const WRITER_COPY = { "card.action": "Open report", "card.body": "Review the numbers from the last seven days before they go out to the team.", "card.title": "Weekly report ready" };
/** The card slot's contract fixture: the props every card candidate is certified with. */
const CONTRACT_FIXTURE = {
  schema: "clossys.preview/1",
  fixtures: { file: "registry/blocks/sample-card.tsx", export: "SampleCard", props: { title: { $copy: "card.title" }, body: { $copy: "card.body" }, action: { $copy: "card.action" } } },
  inputs: { copy: ["card.action", "card.body", "card.title"] },
  container: "canvas", theme: "light", width: 480,
};
const slotDoc = () => JSON.parse(readFileSync(slotFile(card().dir), "utf8"));
const setContract = (fixture: unknown, props: string[] = ["action", "body", "title"]) => {
  const doc = slotDoc();
  writeFileSync(slotFile(card().dir), jsonBytes({ ...doc, contract: { ...doc.contract, props, ...(fixture === undefined ? {} : { fixture }) } }));
};
const writeCandidate = (version: number, item: unknown) => {
  const path = join(candidatesDir(card().dir), `sample-card-v${version}.json`);
  writeFileSync(path, jsonBytes(item));
  return readFileSync(path, "utf8");
};
const bare = () => { const item = cardItem(); const { preview: _own, ...meta } = item.meta; return { ...item, meta }; };
const certify = (version: number, bytes = readFileSync(join(candidatesDir(card().dir), `sample-card-v${version}.json`), "utf8")) =>
  certifyCandidate({ root, slot: "components.card", name: `sample-card-v${version}.json`, bytes, contract: slotDoc().contract, layer: "components" });

describe("the slot contract fixture (slot.json contract.fixture)", () => {
  it("is validated with the slot and typed by contract.props", () => {
    expect(contractFixtureIssues({ props: ["action", "body", "title"], fixture: CONTRACT_FIXTURE })).toEqual([]);
    expect(contractFixtureIssues({ props: [] })).toEqual([]);
    expect(contractFixtureIssues({ props: ["title"], fixture: CONTRACT_FIXTURE }).map(issue => issue.message)).toEqual(["contract.fixture props action, body are not declared in contract.props"]);
    expect(contractFixtureIssues({ fixture: CONTRACT_FIXTURE }).map(issue => issue.message)).toEqual(["contract.fixture is typed by contract.props, which must list prop names"]);
    expect(contractFixtureIssues({ props: [], fixture: { ...CONTRACT_FIXTURE, fixtures: { file: "x.tsx", props: {} } } }).map(issue => issue.message)).toEqual(["contract.fixture fixtures must be { file, export, props } with a props object"]);
    expect(contractFixtureIssues({ props: ["action", "body", "title"], fixture: { ...CONTRACT_FIXTURE, copy: { "card.title": "x" } } }).map(issue => issue.message)).toEqual([expect.stringMatching(/carries no copy snapshot/)]);
    // The slot validator runs it: a slot.json with an untyped fixture is an invalid slot.
    setContract(CONTRACT_FIXTURE, ["title"]);
    expect(validateSlotDoc(slotDoc())).toEqual([{ code: "slot-invalid", path: "slot.json", message: "contract.fixture props action, body are not declared in contract.props" }]);
    setContract(CONTRACT_FIXTURE);
    expect(validateSlotDoc(slotDoc())).toEqual([]);
  });

  it("is what a candidate with no preview of its own mounts, pinned or not; a sibling's preview is never borrowed", async () => {
    writeCandidate(2, bare());
    // No contract fixture: the bare option mounts no props, though the pinned v1 carries a preview.
    expect((await libraryRecordStore([root]).load("sample-card", 2))!.preview).toEqual({ copy: {} });
    expect(specimenPreviewIssue(root, "components.card", "sample-card-v2.json", readFileSync(join(candidatesDir(card().dir), "sample-card-v2.json"), "utf8"))).toBeUndefined();
    setContract(CONTRACT_FIXTURE);
    const { inputs: _inputs, ...shown } = CONTRACT_FIXTURE;
    expect((await libraryRecordStore([root]).load("sample-card", 2))!.preview).toEqual({ ...shown, copy: WRITER_COPY, fixtureFrom: CONTRACT_FIXTURE_SOURCE });
    // A candidate's own preview overrides the contract fixture for its specimen.
    expect((await libraryRecordStore([root]).load("sample-card", 1))!.preview).not.toHaveProperty("fixtureFrom");
    // No pinned/option distinction: a pinned candidate with no preview mounts the contract fixture too.
    const v2 = readFileSync(join(candidatesDir(card().dir), "sample-card-v2.json"));
    writeFileSync(pinFile(card().dir), jsonBytes({ ...card().pin, candidate: "sample-card-v2.json", sha256: sha256Hex(v2) }));
    expect((await libraryRecordStore([root]).load("sample-card"))!.preview).toMatchObject({ fixtureFrom: CONTRACT_FIXTURE_SOURCE, copy: WRITER_COPY });
    // A candidate that does not ship the fixture's file mounts nothing.
    const item = bare();
    writeCandidate(3, { ...item, files: item.files.map((file: { path: string }) => ({ ...file, path: `other-${file.path}` })) });
    expect((await libraryRecordStore([root]).load("sample-card", 3))!.preview).toEqual({ copy: {} });
  });
});

describe("candidate certification against the slot contract fixture", () => {
  it("with no contract fixture, every component candidate is uncertified: its own preview does not certify it and no sibling lends one", () => {
    writeCandidate(2, bare());
    for (const version of [1, 2]) {
      expect(certify(version)).toEqual({ certified: false, mounts: true, reasons: ["uncertified: slot components.card declares no contract fixture (slot.json contract.fixture)"] });
    }
  });

  it("certifies by compiling with the contract fixture, pinned or not, with or without a preview of its own", () => {
    setContract(CONTRACT_FIXTURE);
    writeCandidate(2, bare());
    expect(certify(1)).toEqual({ certified: true, mounts: true, reasons: [] });
    expect(certify(2)).toEqual({ certified: true, mounts: true, reasons: [] });
    // Certification uses the contract fixture, not the candidate's own: an own preview whose
    // inputs would not resolve still certifies when the contract's do.
    const item = cardItem();
    const ownBroken = { ...item, meta: { ...item.meta, preview: { ...item.meta.preview, inputs: { copy: ["card.action", "card.body", "card.title", "card.missing"] } } } };
    expect(certify(3, writeCandidate(3, ownBroken))).toEqual({ certified: true, mounts: true, reasons: [] });
    // ...and a contract fixture whose inputs do not resolve fails every candidate, whatever its own preview says.
    setContract({ ...CONTRACT_FIXTURE, inputs: { copy: ["card.action", "card.body"] } });
    expect(certify(1).certified).toBe(false);
    expect(certify(1).reasons).toEqual([expect.stringMatching(/fixture \$copy card\.title is not a declared input/)]);
  });

  it("fails a candidate that needs props the contract fixture does not supply", () => {
    setContract(CONTRACT_FIXTURE);
    const item = cardItem();
    const needsMore = { ...item, meta: { ...item.meta, preview: { ...item.meta.preview, fixtures: { ...item.meta.preview.fixtures, footer: "Sent weekly", badge: "New" } } } };
    expect(certify(2, writeCandidate(2, needsMore))).toEqual({ certified: false, mounts: true, reasons: ["the candidate needs props the contract fixture does not supply: badge, footer"] });
    // The { file, export, props } form of an own preview is read the same way.
    const nested = { ...item, meta: { ...item.meta, preview: { schema: "clossys.preview/1", fixtures: { file: CONTRACT_FIXTURE.fixtures.file, export: "SampleCard", props: { title: "x", subtitle: "y" } } } } };
    expect(certify(3, writeCandidate(3, nested)).reasons).toEqual(["the candidate needs props the contract fixture does not supply: subtitle"]);
  });

  it("fails a candidate that does not ship the file and export the contract fixture mounts", () => {
    setContract(CONTRACT_FIXTURE);
    const item = bare();
    const other = writeCandidate(2, { ...item, files: item.files.map((file: { path: string }) => ({ ...file, path: `other-${file.path}` })) });
    expect(certify(2, other)).toEqual({ certified: false, mounts: true, reasons: ["the candidate does not ship registry/blocks/sample-card.tsx exporting SampleCard, which the contract fixture mounts"] });
    setContract({ ...CONTRACT_FIXTURE, fixtures: { ...CONTRACT_FIXTURE.fixtures, export: "OtherCard" } });
    expect(certify(1).reasons).toEqual(["the candidate does not ship registry/blocks/sample-card.tsx exporting OtherCard, which the contract fixture mounts"]);
  });

  it("mounts a default export when the contract fixture names export default", () => {
    setContract({ ...CONTRACT_FIXTURE, fixtures: { ...CONTRACT_FIXTURE.fixtures, export: "default" } });
    // The pinned card exports SampleCard by name only: it does not ship a default export.
    expect(certify(1).reasons).toEqual(["the candidate does not ship registry/blocks/sample-card.tsx exporting default, which the contract fixture mounts"]);
    const item = bare();
    const files = item.files.map((file: { path: string; content: string }) => file.path === CONTRACT_FIXTURE.fixtures.file
      ? { ...file, content: file.content.replace(/export function SampleCard/, "export default function SampleCard") } : file);
    expect(certify(2, writeCandidate(2, { ...item, files }))).toEqual({ certified: true, mounts: true, reasons: [] });
  });

  it("reports an untyped contract fixture as the reason, and needs no fixture for a candidate that mounts no component", () => {
    setContract(CONTRACT_FIXTURE, ["title"]);
    expect(certify(1)).toEqual({ certified: false, mounts: true, reasons: ["the slot's contract.fixture props action, body are not declared in contract.props"] });
    const theme = listSlots(root, "designer").find(entry => entry.id === "themes.preset")!;
    const bytes = readFileSync(join(candidatesDir(theme.dir), theme.pin!.candidate), "utf8");
    expect(certifyCandidate({ root, slot: "themes.preset", name: theme.pin!.candidate, bytes, contract: {}, layer: "themes" })).toEqual({ certified: true, mounts: false, reasons: [] });
  });
});

describe("derive contract-fixtures --dry-run", () => {
  it("proposes contract.fixture from the pinned preview, writes nothing, and counts the candidates that would not certify", () => {
    const before = readFileSync(slotFile(card().dir), "utf8");
    const item = cardItem();
    // A { file, export, props } pinned preview (the canonical form) is the source.
    const pinned = { ...item, meta: { ...item.meta, preview: { ...CONTRACT_FIXTURE, copy: {} } } };
    const bytes = writeCandidate(1, pinned);
    writeFileSync(pinFile(card().dir), jsonBytes({ ...card().pin, sha256: sha256Hex(bytes) }));
    const before1 = readFileSync(slotFile(card().dir), "utf8");
    writeCandidate(2, bare());
    writeCandidate(3, { ...item, meta: { ...item.meta, preview: { ...item.meta.preview, fixtures: { ...item.meta.preview.fixtures, footer: "x" } } } });
    const report = deriveContractFixtures(root);
    expect(readFileSync(slotFile(card().dir), "utf8")).toBe(before1);
    expect(before1).toBe(before);
    const proposal = report.proposals.find(row => row.slot === "components.card")!;
    expect(proposal).toEqual({ slot: "components.card", status: "derived", pinned: "sample-card-v1.json", mounts: true, fixture: CONTRACT_FIXTURE, propsToDeclare: ["action", "body", "title"] });
    expect(report.proposals.find(row => row.slot === "components.button")).toMatchObject({ status: "no-source", reason: "pinned-preview-without-fixture", mounts: true });
    expect(report.proposals.find(row => row.slot === "themes.preset")).toMatchObject({ status: "no-source", reason: "pinned-preview-without-fixture", mounts: false });
    expect(report.failing.filter(row => row.slot === "components.card")).toEqual([
      { slot: "components.card", candidate: "sample-card-v3.json", pinned: false, reasons: ["the candidate needs props the contract fixture does not supply: footer"] },
    ]);
    expect(report.reasonClasses).toMatchObject({ "needs-extra-props": 1 });
    expect(report.candidates.nonPinnedFailing).toBe(report.failing.filter(row => !row.pinned).length);
    // Deterministic: the same report on every run.
    expect(deriveContractFixtures(root)).toEqual(report);
  });

  it("proposes no fixture from a preview that names no { file, export, props }", () => {
    expect(fixtureFromPreview({ fixtures: { title: "x" } })).toBeUndefined();
    expect(fixtureFromPreview(undefined)).toBeUndefined();
    expect(fixtureFromPreview({ ...CONTRACT_FIXTURE, copy: {} })).toEqual(CONTRACT_FIXTURE);
  });
});
