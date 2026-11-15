import { describe, expect, it } from "vitest";
import sectionSlots from "../catalog/slots/sections.json" with { type: "json" };
import { COPY_ROLES, ROLE_BUDGET, checkCopyFieldRoles, type CopyUnit } from "./copy-fields-role.js";

const units = sectionSlots as unknown as CopyUnit[];
const clone = (): CopyUnit[] => structuredClone(units);
const field = (all: CopyUnit[], id: string, key: string) => all.find(unit => unit.id === id)!.contract.copy!.fields!.find(entry => entry.key === key)! as Record<string, unknown>;

describe("copy fields carry a role, a role budget and a binding kind", () => {
  it("fixes the role vocabulary and the hero budgets (action 24, heading 60)", () => {
    expect(COPY_ROLES).toEqual(["eyebrow", "heading", "lead", "body", "action", "label", "alt"]);
    expect(ROLE_BUDGET.action).toBe(24);
    expect(ROLE_BUDGET.heading).toBe(60);
  });

  it("passes on every committed section copy field", () => {
    const fields = units.flatMap(unit => unit.contract.copy?.fields ?? []);
    expect(fields.length).toBeGreaterThan(500);
    expect(checkCopyFieldRoles(units)).toEqual([]);
  });

  it("hero heading and action fit their budgets", () => {
    const hero = units.find(unit => unit.id === "sections.hero")!.contract.copy!.fields!;
    for (const entry of hero) {
      if (entry.role === "heading") expect(entry.maxLength!.en).toBeLessThanOrEqual(60);
      if (entry.role === "action") expect(entry.maxLength!.en).toBeLessThanOrEqual(24);
    }
    expect(hero.some(entry => entry.role === "action")).toBe(true);
    expect(hero.some(entry => entry.role === "heading")).toBe(true);
  });

  it("mutation: a field with no role fails", () => {
    const all = clone();
    delete field(all, "sections.hero", "header.heading").role;
    expect(checkCopyFieldRoles(all).map(finding => finding.code)).toEqual(["COPY_ROLE_MISSING"]);
  });

  it("mutation: maxLength.en over the role budget fails", () => {
    const all = clone();
    (field(all, "sections.hero", "header.heading").maxLength as Record<string, number>).en = 61;
    expect(checkCopyFieldRoles(all)).toEqual([expect.objectContaining({ code: "COPY_BUDGET", subject: "sections.hero#header.heading" })]);
  });

  it("mutation: an unknown role fails", () => {
    const all = clone();
    field(all, "sections.hero", "header.heading").role = "title";
    expect(checkCopyFieldRoles(all).map(finding => finding.code)).toEqual(["COPY_ROLE_UNKNOWN"]);
  });

  it("mutation: a Director binding on a field without kind icu fails", () => {
    const all = clone();
    const heading = field(all, "sections.hero", "header.heading");
    heading.bindings = ["brand"];
    heading.kind = "plain";
    expect(checkCopyFieldRoles(all).map(finding => finding.code)).toEqual(["COPY_BINDING_KIND"]);
    delete heading.kind;
    expect(checkCopyFieldRoles(all).map(finding => finding.code)).toEqual(["COPY_BINDING_KIND"]);
    heading.kind = "icu";
    expect(checkCopyFieldRoles(all)).toEqual([]);
  });
});
