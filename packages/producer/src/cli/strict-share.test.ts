import { describe, expect, it } from "vitest";
import type { SuiteFinding, SuiteReport } from "../check/record-suites.js";
import { conformanceShare, directorSlotsShare, refVerbatimShare, slotShare, strictShareLine } from "./strict-share.js";

const slots = (findings: { rule: string; message: string; path?: string }[]) => ({ findings }) as never;
const suite = (findings: SuiteFinding[], status: SuiteReport["status"] = "ran") => ({ status, findings, ...(status === "error" ? { error: "boom" } : {}) });
const error = (code: string, where = "studio/home"): SuiteFinding => ({ severity: "error", code, where, message: `${code} at ${where}` });

describe("strict share attribution (pure)", () => {
  it("slot rows go to their own agent only", () => {
    const report = slots([
      { rule: "source-ref-unknown", message: "ref", path: "designer:components.button" },
      { rule: "no-pin", message: "unpinned", path: "writer:pages.home" },
      { rule: "no-pin", message: "unpinned", path: "publisher:studio.home" },
      { rule: "hash-drift", message: "drift", path: "director:identity.brand.name" },
    ]);
    expect(slotShare(report, "designer")).toEqual([{ code: "slots/source-ref-unknown", where: "designer:components.button", message: "ref" }]);
    expect(slotShare(report, "writer").map(finding => finding.where)).toEqual(["writer:pages.home"]);
    expect(slotShare(report, "publisher").map(finding => finding.where)).toEqual(["publisher:studio.home"]);
    expect(slotShare(report, "director").map(finding => finding.where)).toEqual(["director:identity.brand.name"]);
  });

  it("an unreadable references manifest is the Designer's; any other model input error is every agent's", () => {
    const manifest = slots([{ rule: "schema", message: "References manifest could not be read or validated." }]);
    expect(slotShare(manifest, "designer")).toHaveLength(1);
    expect(slotShare(manifest, "writer")).toEqual([]);
    const model = slots([{ rule: "schema", message: "Slot model inputs could not be read or validated." }]);
    for (const agent of ["director", "designer", "writer", "publisher"] as const) expect(slotShare(model, agent)).toHaveLength(1);
    const path = slots([{ rule: "ia-path", message: "bad", path: "agents/writer/ia.json" }]);
    expect(slotShare(path, "writer")).toHaveLength(1);
    expect(slotShare(path, "designer")).toEqual([]);
  });

  it("mutation: a clean slot report is an empty share, one finding is one finding", () => {
    expect(slotShare(slots([]), "designer")).toEqual([]);
    expect(slotShare(slots([{ rule: "orphan-candidate", message: "x", path: "designer:themes.spacing" }]), "designer")).toHaveLength(1);
  });

  it("page conformance: every error is the Publisher's, copy/meta errors are also the Writer's, warnings are no one's", () => {
    const report = suite([error("archetype/archetype-unknown"), error("format/format-frame"), error("copy/copy-unbound"), error("meta/meta-title-missing"), error("copy-fit/copy-fit-overflow"),
      { severity: "warning", code: "format/format-section-unknown", where: "studio/home", message: "w" }]);
    expect(conformanceShare(report, "publisher").map(finding => finding.code)).toEqual(["suites/archetype/archetype-unknown", "suites/format/format-frame", "suites/copy/copy-unbound", "suites/meta/meta-title-missing", "suites/copy-fit/copy-fit-overflow"]);
    expect(conformanceShare(report, "writer").map(finding => finding.code)).toEqual(["suites/copy/copy-unbound", "suites/meta/meta-title-missing", "suites/copy-fit/copy-fit-overflow"]);
    expect(conformanceShare(report, "designer")).toEqual([]);
    expect(conformanceShare(report, "director")).toEqual([]);
  });

  it("mutation: a conformance suite that could not run is a finding for its owners, never a pass", () => {
    expect(conformanceShare(suite([], "error"), "publisher")).toEqual([expect.objectContaining({ code: "suites/archetypes-unavailable" })]);
    expect(conformanceShare(suite([], "error"), "writer")).toHaveLength(1);
    expect(conformanceShare(suite([]), "publisher")).toEqual([]);
  });

  it("ref-verbatim errors are the Designer's", () => {
    expect(refVerbatimShare(suite([error("REF-DRIFT", "components.button")]), "designer")).toEqual([expect.objectContaining({ code: "suites/ref-verbatim/REF-DRIFT" })]);
    expect(refVerbatimShare(suite([error("REF-DRIFT")]), "writer")).toEqual([]);
    expect(refVerbatimShare(suite([], "error"), "designer")).toHaveLength(1);
  });

  it("director-slots errors are the Director's; mutation: empty is empty, a suite that could not run is a finding", () => {
    expect(directorSlotsShare(suite([error("D-SPEC", "focus.lifecycle.retention")]), "director")).toEqual([expect.objectContaining({ code: "suites/director-slots/D-SPEC", where: "focus.lifecycle.retention" })]);
    expect(directorSlotsShare(suite([error("D-SPEC")]), "writer")).toEqual([]);
    expect(directorSlotsShare(suite([]), "director")).toEqual([]);
    expect(directorSlotsShare(suite([{ severity: "warning", code: "D-SPEC", where: "x", message: "w" }]), "director")).toEqual([]);
    expect(directorSlotsShare(suite([], "error"), "director")).toHaveLength(1);
  });

  it("summarises counts by code", () => {
    expect(strictShareLine({ findings: [{ code: "slots/no-pin", where: "a", message: "" }, { code: "slots/no-pin", where: "b", message: "" }], limits: [] })).toContain("2 finding(s) (slots/no-pin 2)");
  });
});
