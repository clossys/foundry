import { describe, expect, it } from "vitest";
import * as core from "./index.js";
import { checkImportPurity } from "../../../../scripts/lib/import-purity.mjs";
import type { InstanceRecord } from "./instance-record.js";
const base = (): InstanceRecord => ({
  instanceId: "standard.home", label: "Home", path: "/", surface: "site",
  frameBlockRef: { blockId: "SiteFrame", configId: "site" }, viewBlockRef: { blockId: "SectionedView", configId: "home" },
  context: { medium: "web" }, packIds: ["pack.example"],
});
const collection = () => ({ instances: [base()], packs: [{ packId: "pack.example", label: "Example", instanceIds: ["standard.home"] }] });
const custom = (): InstanceRecord => ({ ...base(), instanceId: "example.home", context: { consumer: "example", brand: "primary", medium: "web" }, uses: "standard.home" });
const refuse = (input: unknown, reason?: string) => {
  const result = core.validateInstanceRecord(input);
  expect(result).toMatchObject({ status: "refused", ...(reason ? { reason } : {}) });
};
describe("Instance and Pack record contracts", () => {
  it("exports pure validators and keeps plain refs separate from role qualification", () => {
    expect(core.validateInstanceRecord(base())).toEqual({ status: "valid" });
    expect(core.validatePackRecord(collection().packs[0])).toEqual({ status: "valid" });
    expect(checkImportPurity({ root: process.cwd(), entries: ["src/core/instance-record.ts", "src/core/standard-website-pack.ts"], allowedBuiltins: [], allowedPackages: [] }).findings).toEqual([]);
    expect(base().frameBlockRef).toEqual({ blockId: "SiteFrame", configId: "site" });
  });
  it("accepts each named built-in View under its declared site pairing", () => {
    for (const blockId of ["AuthView", "CaptureView", "CollectionView", "ContactView", "DocumentView", "HeroView", "LegalView", "MarketingView", "SectionedView", "StatusView"]) {
      expect(core.validateInstanceRecord({ ...base(), frameBlockRef: { blockId: "SiteFrame", configId: blockId === "AuthView" ? "front-door" : "site" }, viewBlockRef: { blockId, configId: "example" } })).toEqual({ status: "valid" });
    }
  });
  it("requires both explicit refs and their configuration identities", () => {
    for (const key of ["frameBlockRef", "viewBlockRef"]) {
      const missing: any = base(); delete missing[key]; refuse(missing, "shape");
      for (const value of [null, [], "LandingView", {}, { blockId: "LandingView" }, { blockId: "LandingView", configId: "" }]) refuse({ ...base(), [key]: value });
    }
    refuse({ ...base(), frameBlockRef: { ...base().frameBlockRef, status: "recorded" } });
  });
  it("accepts all lite AuthView kinds including demo, refusing site and non-auth lite pairs", () => {
    for (const configId of ["front-door", "admin", "demo"]) {
      expect(core.validateInstanceRecord({ ...base(), frameBlockRef: { blockId: "SiteFrame", configId }, viewBlockRef: { blockId: "AuthView", configId: "sign-in" } })).toEqual({ status: "valid" });
      refuse({ ...base(), frameBlockRef: { blockId: "SiteFrame", configId } }, "pairing");
    }
    refuse({ ...base(), viewBlockRef: { blockId: "AuthView", configId: "sign-in" } }, "pairing");
  });
  it("requires AppFrame on app surfaces and SiteFrame on site surfaces", () => {
    refuse({ ...base(), surface: "app" }, "pairing");
    refuse({ ...base(), surface: "app", frameBlockRef: { blockId: "AppFrame", configId: "workspace" }, viewBlockRef: { blockId: "AuthView", configId: "sign-in" } }, "pairing");
    expect(core.validateInstanceRecord({ ...base(), surface: "app", frameBlockRef: { blockId: "AppFrame", configId: "workspace" } })).toEqual({ status: "valid" });
    refuse({ ...base(), frameBlockRef: { blockId: "AppFrame", configId: "workspace" } }, "pairing");
    refuse({ ...base(), frameBlockRef: { blockId: "CustomFrame", configId: "site" } }, "frame");
  });
  it("registers Standard IndexView and DetailsView only on AppFrame app surfaces", () => {
    for (const blockId of ["IndexView", "DetailsView"]) {
      const record = { ...base(), surface: "app", frameBlockRef: { blockId: "AppFrame", configId: "workspace" }, viewBlockRef: { blockId, configId: "records" } };
      expect(core.validateInstanceRecord(record)).toEqual({ status: "valid" });
      refuse({ ...base(), viewBlockRef: record.viewBlockRef }, "pairing");
      refuse({ ...record, frameBlockRef: { blockId: "SiteFrame", configId: "site" } }, "pairing");
    }
  });
  it("permits explicitly registered custom Views without extending the Frame set", () => {
    const record = { ...custom(), viewBlockRef: { blockId: "ExampleView", configId: "overview" } };
    refuse(record, "view");
    expect(core.validateInstanceRecord(record, { customViewIds: ["ExampleView"] })).toEqual({ status: "valid" });
    expect(core.validateInstanceRecord(record, { customViewIds: ["ExampleView", "ExampleView"] }).status).toBe("refused");
  });
  it("reserves known Frame names when registering custom Views", () => {
    for (const blockId of ["SiteFrame", "AppFrame"]) {
      const record = { ...custom(), packIds: [], viewBlockRef: { blockId, configId: "example" } };
      const options = { customViewIds: [blockId] };
      expect(core.validateInstanceRecord(record, options)).toMatchObject({ status: "refused" });
      const input = collection();
      expect(core.validateInstanceRecords([...input.instances, record], input.packs, options)).toMatchObject({ status: "refused" });
    }
  });
  it("enforces namespace context and omits consumer, brand and uses on Standard records", () => {
    for (const context of [{ medium: "web", consumer: "example" }, { medium: "web", brand: "primary" }, { medium: "web", consumer: undefined }]) refuse({ ...base(), context }, "identity");
    refuse({ ...base(), uses: "standard.about" }, "identity");
    for (const context of [{ medium: "web" }, { medium: "web", consumer: "other", brand: "primary" }, { medium: "web", consumer: "example", brand: "" }, { medium: "email", consumer: "example", brand: "primary" }]) refuse({ ...custom(), context }, "identity");
    expect(core.validateInstanceRecord(custom())).toEqual({ status: "valid" });
  });
  it("refuses duplicate IDs and resolves Standard uses with matching surface", () => {
    const input = collection();
    expect(core.validateInstanceRecords([...input.instances, base()], input.packs)).toMatchObject({ status: "refused", reason: "duplicate" });
    expect(core.validateInstanceRecords(input.instances, [...input.packs, input.packs[0]])).toMatchObject({ status: "refused", reason: "duplicate" });
    const adopted = custom(); adopted.packIds = [];
    expect(core.validateInstanceRecords([...input.instances, adopted], input.packs)).toEqual({ status: "valid" });
    for (const uses of ["standard.absent", "example.home", "Standard.home", "standard/home"]) expect(core.validateInstanceRecords([...input.instances, { ...adopted, uses }], input.packs)).toMatchObject({ status: "refused", reason: "uses" });
    expect(core.validateInstanceRecords([...input.instances, { ...adopted, surface: "app", frameBlockRef: { blockId: "AppFrame", configId: "workspace" } }], input.packs)).toMatchObject({ status: "refused", reason: "uses" });
  });
  it("checks Pack membership in both directions without mutating records", () => {
    const input = collection(), before = structuredClone(input);
    expect(core.validateInstanceRecords(input.instances, input.packs)).toEqual({ status: "valid" });
    expect(input).toEqual(before);
    expect(core.validateInstanceRecords(input.instances, [])).toMatchObject({ status: "refused", reason: "membership" });
    expect(core.validateInstanceRecords(input.instances, [{ ...input.packs[0], instanceIds: [] }])).toMatchObject({ status: "refused", reason: "membership" });
    expect(core.validateInstanceRecords([{ ...base(), packIds: [] }], input.packs)).toMatchObject({ status: "refused", reason: "membership" });
    expect(core.validateInstanceRecords([], input.packs)).toMatchObject({ status: "refused", reason: "membership" });
    for (const patch of [{ packIds: ["pack.example", "pack.example"] }, { packIds: ["Pack.example"] }, { viewStates: ["default", "default"] }]) refuse({ ...base(), ...patch });
  });
  it("pins the hand-selected accepted set against near misses through the real validator", () => {
    const cases: [unknown, boolean][] = [
      ["SectionedView", true], ["LandingView", false], ["MarketingView", true], ["StatusView", true], ["LandingViews", false], ["landingView", false],
      ["Landingview", false], ["Landing-View", false], ["Landing_View", false], ["LаndingView", false], ["ErrorView", false],
      ["BoundaryView", false], ["", false], [null, false], [[], false], [{ blockId: "LandingView" }, false], [1, false],
    ];
    for (const [blockId, accepted] of cases) expect(core.validateInstanceRecord({ ...base(), viewBlockRef: { blockId, configId: "home" } }).status === "valid", String(blockId)).toBe(accepted);
    for (const blockId of ["SiteFrames", "siteFrame", "Site_Frame", "Site-Frame", "SіteFrame", null, [], 1]) refuse({ ...base(), frameBlockRef: { blockId, configId: "site" } });
    for (const configId of ["front_door", "frontdoor", "front-door ", "Front-door", "frоnt-door", null, [], 1]) refuse({ ...base(), frameBlockRef: { blockId: "SiteFrame", configId }, viewBlockRef: { blockId: "AuthView", configId: "sign-in" } });
    for (const instanceId of ["standard_home", "standard/home", "standard..home", "Standard.home", "standard.HOME", "stаndard.home", "standard.home ", null, 1]) refuse({ ...base(), instanceId });
    for (const input of [null, [], "instance", 3, { ...base(), path: "//example.test" }, { ...base(), label: " " }, { ...base(), context: [] }, { ...base(), surface: "Site" }]) refuse(input);
    for (const packId of ["pack_example", "Pack.example", "pack..example", "pаck.example", "pack.example ", null, 1]) expect(core.validatePackRecord({ ...collection().packs[0], packId }).status).toBe("refused");
  });
  it("refuses accessors, hostile prototypes, sparse containers and unknown fields", () => {
    let invoked = false;
    const accessor = { ...base() }; Object.defineProperty(accessor, "label", { enumerable: true, get() { invoked = true; throw new Error("called"); } });
    refuse(accessor); expect(invoked).toBe(false);
    refuse(Object.assign(Object.create({ inherited: true }), base()));
    refuse({ ...base(), extra: true });
    const sparse = new Array(1);
    expect(core.validateInstanceRecords(sparse, [])).toMatchObject({ status: "refused", reason: "shape" });
    expect(core.validateInstanceRecords({}, [])).toMatchObject({ status: "refused", reason: "shape" });
    expect(core.validateInstanceRecords([], null)).toMatchObject({ status: "refused", reason: "shape" });
  });
});
