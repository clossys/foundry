/**
 * The specimen preflight certifies every candidate of a slot by the same rules, pinned or not, and
 * lists every failing rule in one pass: an option whose component needs props the slot contract
 * fixture does not supply, a CommonJS entry and a preview naming a file the candidate does not ship
 * each fail, while the clean pinned candidate passes. Every candidate mounts the slot contract fixture
 * (slot.json contract.fixture), never a sibling's preview; with no contract fixture none certifies.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listSlots } from "../records/slots.js";
import { candidatesDir, jsonBytes, slotFile } from "../records/slot-model/index.js";
import { canonicalLibrary } from "./__fixtures__/canonical-library.js";
import { specimenPreflight, type PreflightResult } from "./preflight.js";

const require = createRequire(import.meta.url);
const workspace = fileURLToPath(new URL("../../../../", import.meta.url));
const registryBase = dirname(require.resolve("@clossys/designer-ui"));

let root: string;
let result: PreflightResult;
let uncontracted: PreflightResult;

/** The card slot's contract fixture: the props every card candidate mounts and is certified with. */
const CONTRACT_FIXTURE = {
  schema: "clossys.preview/1",
  fixtures: { file: "registry/blocks/sample-card.tsx", export: "SampleCard", props: { title: { $copy: "card.title" }, body: { $copy: "card.body" }, action: { $copy: "card.action" } } },
  inputs: { copy: ["card.action", "card.body", "card.title"] },
  container: "canvas", theme: "light", width: 480,
};

/** A card candidate built from the pinned one: `content` replaces its component, `preview` its own preview (null drops it). */
function card(version: number, content: string, preview: unknown, extra: Record<string, unknown> = {}) {
  const dir = candidatesDir(listSlots(root, "designer").find(entry => entry.id === "components.card")!.dir);
  const item = JSON.parse(readFileSync(join(dir, "sample-card-v1.json"), "utf8"));
  item.files[0].content = content;
  if (preview === null) delete item.meta.preview; else item.meta.preview = preview;
  Object.assign(item.meta.preview ?? {}, extra);
  writeFileSync(join(dir, `sample-card-v${version}.json`), `${JSON.stringify(item, null, 2)}\n`);
}

const NEEDS_ITEMS = 'import * as React from "react";\nexport function SampleCard({ items }: { items: string[] }) {\n  return <ul>{items.map(item => <li key={item}>{item}</li>)}</ul>;\n}\n';
const NEEDS_TITLE = 'import * as React from "react";\nexport function SampleCard({ title }: { title: string }) {\n  return <h3>{title.toUpperCase()}</h3>;\n}\n';
const COMMON_JS = '"use strict";\nconst React = require("react");\nfunction SampleCard() { return React.createElement("div", null, "card"); }\nmodule.exports = { SampleCard };\n';
const PLAIN = 'import * as React from "react";\nexport function SampleCard() {\n  return <div>card</div>;\n}\n';

beforeAll(async () => {
  root = await canonicalLibrary(mkdtempSync(join(tmpdir(), "producer-specimen-preflight-")));
  const preview = JSON.parse(readFileSync(join(candidatesDir(listSlots(root, "designer").find(entry => entry.id === "components.card")!.dir), "sample-card-v1.json"), "utf8")).meta.preview;
  card(2, NEEDS_ITEMS, null);                                         // needs props, no fixture of its own
  card(3, NEEDS_TITLE, null);                                         // needs props the slot fixture supplies
  card(4, COMMON_JS, { schema: "clossys.preview/1", container: "canvas", width: 480 });
  card(5, PLAIN, { schema: "clossys.preview/1", container: "canvas", width: 480, entry: "registry/blocks/missing-card.tsx" });
  expect(preview).toBeDefined();
  uncontracted = await specimenPreflight({ root, workspace, registryBase, slots: ["components.card"], refVerbatim: false, concurrency: 2 });
  const slot = slotFile(listSlots(root, "designer").find(entry => entry.id === "components.card")!.dir);
  const doc = JSON.parse(readFileSync(slot, "utf8"));
  writeFileSync(slot, jsonBytes({ ...doc, contract: { ...doc.contract, props: ["action", "body", "title"], fixture: CONTRACT_FIXTURE } }));
  result = await specimenPreflight({ root, workspace, registryBase, slots: ["components.card"], refVerbatim: false, concurrency: 2 });
}, 300_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));

const row = (candidate: string) => result.table.find(entry => entry.candidate === candidate)!;
const rules = (candidate: string) => row(candidate).failing.map(reason => reason.split(":")[0]);

describe("specimen preflight certification", () => {
  it("checks every candidate of the slot in one pass and passes the clean pinned one", () => {
    expect(result.table.map(entry => entry.candidate)).toEqual(["sample-card-v1.json", "sample-card-v2.json", "sample-card-v3.json", "sample-card-v4.json", "sample-card-v5.json"]);
    expect(row("sample-card-v1.json")).toMatchObject({ pinned: true, failing: [], contractFixture: true, notRenderable: false });
    expect(result.limits).toEqual([]);
  });

  it("fails an option whose component needs props the contract fixture does not supply", () => {
    expect(row("sample-card-v2.json")).toMatchObject({ pinned: false, contractFixture: true });
    expect(rules("sample-card-v2.json")).toContain("mount/runtime");
  });

  it("certifies an option with no preview of its own by mounting the slot contract fixture", () => {
    expect(row("sample-card-v3.json")).toMatchObject({ pinned: false, failing: [], contractFixture: true });
  });

  it("borrows no fixture: with no contract fixture every component candidate is uncertified and an option with no preview mounts no props", () => {
    for (const entry of uncontracted.table) {
      expect(entry.contractFixture).toBe(false);
      expect(entry.failing).toContainEqual("contract/no-contract-fixture: uncertified: slot components.card declares no contract fixture (slot.json contract.fixture)");
    }
    // The pinned v1's preview supplies a title, but v3 never mounts it: its title is undefined.
    expect(uncontracted.table.find(entry => entry.candidate === "sample-card-v3.json")!.failing.map(reason => reason.split(":")[0])).toContain("mount/runtime");
  });

  it("fails a CommonJS entry and marks it not-renderable", () => {
    expect(rules("sample-card-v4.json")).toContain("entry/commonjs");
    expect(row("sample-card-v4.json").notRenderable).toBe(true);
  });

  it("fails a preview that names a file the candidate does not ship", () => {
    expect(row("sample-card-v5.json").failing).toContainEqual(expect.stringMatching(/^preview\/missing-file: meta\.preview\.entry names registry\/blocks\/missing-card\.tsx/));
  });

  it("lists every failing rule as a flat (slot, candidate, rule) row", () => {
    const offending = new Set(result.rows.map(entry => entry.candidate));
    expect([...offending].sort()).toEqual(["sample-card-v2.json", "sample-card-v4.json", "sample-card-v5.json"]);
    expect(result.rows.every(entry => entry.slot === "components.card" && entry.reason.length > 0)).toBe(true);
  });
});
