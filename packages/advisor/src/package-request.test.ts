import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PACKAGE_SCOPE } from "./generated/package-scope.generated.js";
import { CAPABILITY_CATALOGUE, packageRequest } from "./index.js";
import type { AdvisorPlan, CapabilityCatalogue } from "./index.js";

/*
 * Issue #1178: the package names a staffed plan needs, from this package's
 * packed capability catalogue and packed scope, before any registry is read.
 */
const SCOPE_FILE = JSON.parse(readFileSync(new URL("../../../package-scope.json", import.meta.url), "utf8")) as { scope: string; registry: string };
const SCOPE = SCOPE_FILE.scope;

const PLAN: AdvisorPlan = {
  schemaVersion: 1,
  asOf: "2026-09-24T12:00:00Z",
  mandate: { problem: "FOUNDER-PROSE nobody understands what we sell", primaryProblemId: "strategist-unclear-direction", roles: ["writer", "designer", "strategist"] },
  whereWeAre: ["FOUNDER-PROSE status line"],
  recommendedNext: null,
  decisions: [],
  blockers: [],
  staffing: [
    { repository: "example-owner/site", roles: ["writer", "designer"] },
    { repository: "example-owner/docs", roles: ["writer", "strategist"] },
  ],
};

describe("the packed publishing scope", () => {
  it("is exactly the scope and registry of the repository's package-scope.json", () => {
    expect(PACKAGE_SCOPE).toEqual({ scope: SCOPE_FILE.scope, registry: SCOPE_FILE.registry });
  });
});

describe("packageRequest", () => {
  it("names every staffed role's package once and the starter package, sorted", () => {
    expect(packageRequest(PLAN)).toEqual({
      state: "satisfied",
      names: [`${SCOPE}/designer`, `${SCOPE}/starter`, `${SCOPE}/strategist`, `${SCOPE}/writer`],
      findings: [],
    });
  });

  it("maps each role to its package through the catalogue, whose own scoped name agrees", () => {
    for (const role of ["writer", "designer", "strategist"]) {
      expect(CAPABILITY_CATALOGUE.roles.find((entry) => entry.role === role)?.scopeName).toBe(`${SCOPE}/${role}`);
    }
  });

  it("always includes the starter package, even for one repository staffed with one role", () => {
    const plan = { ...PLAN, mandate: { ...PLAN.mandate, roles: ["writer"] }, staffing: [{ repository: "example-owner/site", roles: ["writer"] }] };
    expect(packageRequest(plan)).toMatchObject({ state: "satisfied", names: [`${SCOPE}/starter`, `${SCOPE}/writer`] });
  });

  it("is deterministic: staffing order and role order do not change the names", () => {
    const reordered = { ...PLAN, staffing: [...PLAN.staffing!].reverse().map((entry) => ({ ...entry, roles: [...entry.roles].reverse() })) };
    expect(JSON.stringify(packageRequest(reordered))).toBe(JSON.stringify(packageRequest(PLAN)));
  });

  it("takes the scope from the packed package-scope.json, not from a literal", () => {
    const catalogue: CapabilityCatalogue = { ...CAPABILITY_CATALOGUE, roles: CAPABILITY_CATALOGUE.roles.map((entry) => ({ ...entry, scopeName: `@example/${entry.role}` })) };
    expect(packageRequest(PLAN, { catalogue, packageScope: { scope: "@example", registry: SCOPE_FILE.registry } })).toMatchObject({
      state: "satisfied",
      names: ["@example/designer", "@example/starter", "@example/strategist", "@example/writer"],
    });
  });

  it("refuses a role the catalogue does not list, by position only", () => {
    const plan = { ...PLAN, mandate: { ...PLAN.mandate, roles: ["writer", "FOUNDER-ROLE"] }, staffing: [{ repository: "example-owner/site", roles: ["writer", "FOUNDER-ROLE"] }] };
    const result = packageRequest(plan);
    expect(result).toEqual({
      state: "violated",
      findings: [{ rule: "role-not-in-catalogue", verdict: "violated", path: "staffing[0].roles[1]", message: "plan.staffing[0].roles[1] is not a role in this package's capability catalogue" }],
    });
  });

  it("refuses starter as a staffed role: it is pinned, never installed as a role", () => {
    const catalogue: CapabilityCatalogue = { ...CAPABILITY_CATALOGUE, roles: [...CAPABILITY_CATALOGUE.roles, { ...CAPABILITY_CATALOGUE.roles[0]!, role: "starter", scopeName: `${SCOPE}/starter` }] };
    const plan = { ...PLAN, mandate: { ...PLAN.mandate, roles: ["starter"] }, staffing: [{ repository: "example-owner/site", roles: ["starter"] }] };
    expect(packageRequest(plan, { catalogue })).toMatchObject({ state: "violated", findings: [{ rule: "role-not-in-catalogue", path: "staffing[0].roles[0]" }] });
  });

  it("refuses a staffed hub-only role through the plan's rule R11, at each position it is staffed, never naming the role", () => {
    const plan = {
      ...PLAN,
      mandate: { ...PLAN.mandate, roles: [...PLAN.mandate.roles, "integrator", "advisor"] },
      staffing: [{ ...PLAN.staffing![0]!, roles: ["writer", "integrator", "designer"] }, { ...PLAN.staffing![1]!, roles: ["advisor", "strategist", "writer", "integrator"] }],
    };
    const result = packageRequest(plan);
    expect(result.state).toBe("violated");
    expect(result.findings.map(({ rule, path }) => ({ rule, path }))).toEqual([
      { rule: "plan-shape", path: "staffing[0].roles[1]" },
      { rule: "plan-shape", path: "staffing[1].roles[0]" },
      { rule: "plan-shape", path: "staffing[1].roles[3]" },
    ]);
    for (const finding of result.findings) expect(finding.message).toMatch(/\(rule R11\)$/);
    expect(JSON.stringify(result)).not.toMatch(/integrator|advisor|example-owner/i);
  });

  it("names no package for a hub-only role in the mandate, which is left unstaffed", () => {
    const plan = { ...PLAN, mandate: { ...PLAN.mandate, roles: [...PLAN.mandate.roles, "integrator", "advisor"] } };
    expect(packageRequest(plan)).toEqual({ state: "satisfied", names: [`${SCOPE}/designer`, `${SCOPE}/starter`, `${SCOPE}/strategist`, `${SCOPE}/writer`], findings: [] });
  });

  it("refuses a catalogue entry whose scoped name is not in the packed scope", () => {
    const catalogue: CapabilityCatalogue = { ...CAPABILITY_CATALOGUE, roles: CAPABILITY_CATALOGUE.roles.map((entry) => (entry.role === "designer" ? { ...entry, scopeName: "@other-scope/designer" } : entry)) };
    expect(packageRequest(PLAN, { catalogue })).toMatchObject({ state: "violated", findings: [{ rule: "catalogue-scope-mismatch", path: "staffing[0].roles[1]" }] });
  });

  it("refuses a plan with no staffing", () => {
    const { staffing: _staffing, ...plan } = PLAN;
    expect(packageRequest(plan)).toMatchObject({ state: "violated", findings: [{ rule: "plan-not-staffed", verdict: "violated", path: "staffing" }] });
  });

  it("refuses a plan that fails its contract or its code rules, by position, never quoting plan text or an undeclared key", () => {
    const shape = packageRequest({ ...PLAN, "FOUNDER-KEY secret": "FOUNDER-PROSE" });
    expect(shape).toEqual({
      state: "violated",
      findings: [{ rule: "plan-shape", verdict: "violated", path: "", message: "plan has a field the contract does not declare, and unknown fields are refused" }],
    });
    const nested = packageRequest({ ...PLAN, staffing: [{ ...PLAN.staffing![0]!, "FOUNDER-KEY": 1 }, PLAN.staffing![1]!] });
    expect(nested).toMatchObject({ state: "violated", findings: [{ rule: "plan-shape", path: "staffing[0]" }] });
    const rule = packageRequest({ ...PLAN, staffing: [...PLAN.staffing!, { repository: "EXAMPLE-OWNER/SITE", roles: ["writer"] }] });
    expect(rule).toMatchObject({ state: "violated", findings: [{ rule: "plan-shape", path: "staffing[2].repository" }] });
    for (const result of [shape, nested, rule]) expect(JSON.stringify(result)).not.toMatch(/FOUNDER|example-owner|EXAMPLE-OWNER/);
  });
});
