import { describe, expect, it } from "vitest";
import {
  assessArchitectureExceptions,
  compareOperatingTopologies,
  defineOperatingTopology,
  serializeOperatingTopology,
  validateArchitectureChangeObservations,
  validateOperatingTopology,
} from "./index.js";
import type { OperatingTopologyDefinition } from "./types.js";

function topology(overrides: Partial<OperatingTopologyDefinition> = {}): OperatingTopologyDefinition {
  return {
    id: "example",
    schemaVersion: "0.1.0",
    scope: { id: "example-business", kind: "business" },
    systems: [
      { id: "workspace", kind: "workspace", responsibilities: ["control-plane"], visibility: "private" },
      { id: "product", kind: "repository", responsibilities: ["product"], visibility: "private" },
    ],
    authorities: [
      { responsibility: "control-plane", owner: "owner", systemOfRecord: "workspace" },
      { responsibility: "product", owner: "product-owner", systemOfRecord: "product" },
    ],
    interfaces: [{ id: "workspace-product", from: "workspace", to: "product", responsibilities: ["product"] }],
    ...overrides,
  };
}

describe("operating topology", () => {
  it("detaches author input and accepts a complete business topology", () => {
    const source = topology();
    const defined = defineOperatingTopology(source);
    (source.systems as Array<{ responsibilities: string[] }>)[0]?.responsibilities.push("commercial");
    expect(defined.systems[0]?.responsibilities).toEqual(["control-plane"]);
    expect(validateOperatingTopology(defined)).toEqual([]);
  });

  it("accepts portfolio scope and provider-neutral services", () => {
    const value = topology({
      scope: { id: "studio", kind: "portfolio" },
      systems: [{ id: "portfolio-control", kind: "service", responsibilities: ["control-plane", "commercial"], provider: "provider-name", locator: "account-reference" }],
      authorities: [
        { responsibility: "control-plane", owner: "studio-owner", systemOfRecord: "portfolio-control" },
        { responsibility: "commercial", owner: "studio-owner", systemOfRecord: "portfolio-control" },
      ],
      interfaces: [],
    });
    expect(validateOperatingTopology(value)).toEqual([]);
  });

  it("reports malformed references, missing authorities, duplicate identities, and self-interfaces", () => {
    const invalid = topology({
      systems: [
        { id: "same", kind: "unknown" as never, responsibilities: ["product"] },
        { id: "same", kind: "repository", responsibilities: ["product"] },
      ],
      authorities: [{ responsibility: "product", owner: "", systemOfRecord: "missing" }],
      interfaces: [{ id: "self", from: "same", to: "same", responsibilities: ["product"] }],
    });
    expect(validateOperatingTopology(invalid).map((entry) => entry.rule)).toEqual(expect.arrayContaining([
      "duplicate-system-id", "system-kind-known", "required-string", "system-of-record-known", "interface-boundary",
    ]));
  });

  it("requires systems, authorities, and a represented control plane", () => {
    const empty = topology({ systems: [], authorities: [], interfaces: [] });
    expect(validateOperatingTopology(empty).map((entry) => entry.rule)).toEqual(expect.arrayContaining([
      "systems-required", "authorities-required", "control-plane-required",
    ]));

    const withoutControlPlane = topology({
      systems: [{ id: "product", kind: "repository", responsibilities: ["product"] }],
      authorities: [{ responsibility: "product", owner: "owner", systemOfRecord: "product" }],
      interfaces: [],
    });
    expect(validateOperatingTopology(withoutControlPlane).map((entry) => entry.rule)).toContain("control-plane-required");
    expect(validateOperatingTopology(topology())).toEqual([]);
  });

  it("requires each system of record to implement its authority responsibility", () => {
    const invalid = topology({
      authorities: [
        { responsibility: "control-plane", owner: "owner", systemOfRecord: "workspace" },
        { responsibility: "product", owner: "product-owner", systemOfRecord: "workspace" },
      ],
    });
    expect(validateOperatingTopology(invalid)).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "system-of-record-responsibility", path: "authorities[1].systemOfRecord" }),
    ]));
    expect(validateOperatingTopology(topology())).toEqual([]);
  });

  it("requires every interface responsibility to be implemented by a system", () => {
    const invalid = topology({
      interfaces: [{ id: "workspace-product", from: "workspace", to: "product", responsibilities: ["knowledge"] }],
    });
    expect(validateOperatingTopology(invalid)).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "interface-responsibility-unimplemented", path: "interfaces[0].responsibilities" }),
    ]));
    expect(validateOperatingTopology(topology())).toEqual([]);
  });

  it("serializes equivalent input deterministically", () => {
    const first = topology();
    const second = topology({
      systems: [...(first.systems ?? [])].reverse(),
      authorities: [...(first.authorities ?? [])].reverse(),
    });
    expect(serializeOperatingTopology(first)).toBe(serializeOperatingTopology(second));
    expect(serializeOperatingTopology(first).endsWith("\n")).toBe(true);
  });

  it("classifies additions and contract changes", () => {
    const previous = topology();
    const additive = topology({
      systems: [...(previous.systems ?? []), { id: "knowledge", kind: "data-store", responsibilities: ["knowledge"] }],
      authorities: [...(previous.authorities ?? []), { responsibility: "knowledge", owner: "knowledge-owner", systemOfRecord: "knowledge" }],
    });
    expect(compareOperatingTopologies(previous, additive)).toMatchObject({ compatible: true, changes: expect.arrayContaining([expect.objectContaining({ kind: "additive", subject: "system", id: "knowledge" })]) });
    const breaking = topology({ systems: previous.systems?.map((system) => system.id === "product" ? { ...system, visibility: "public" } : system) });
    expect(compareOperatingTopologies(previous, breaking)).toMatchObject({ compatible: false, changes: expect.arrayContaining([expect.objectContaining({ kind: "breaking", subject: "system", id: "product" })]) });
  });
});

describe("architecture exception assessment", () => {
  it("is satisfied when every material crossing is declared", () => {
    const report = assessArchitectureExceptions(topology(), [{ id: "one", observedAt: "2026-08-23T12:00:00Z", material: true, crossings: [{ from: "workspace", to: "product", responsibility: "product", interface: "workspace-product" }] }], { maximumExceptionRate: 0 });
    expect(report).toMatchObject({ state: "satisfied", exceptionRate: 0, observedMaterialChanges: 1, materialChangesWithExceptions: 0 });
  });

  it("counts a material change once when it has one or more undeclared crossings", () => {
    const report = assessArchitectureExceptions(topology(), [
      { id: "one", observedAt: "2026-08-23T12:00:00Z", material: true, crossings: [{ from: "product", to: "workspace", responsibility: "product" }, { from: "product", to: "outside", responsibility: "product" }] },
      { id: "two", observedAt: "2026-08-23T13:00:00Z", material: true, crossings: [] },
      { id: "three", observedAt: "2026-08-23T14:00:00Z", material: false, crossings: [{ from: "outside", to: "product", responsibility: "product" }] },
    ], { maximumExceptionRate: 0.25 });
    expect(report).toMatchObject({ state: "violated", exceptionRate: 0.5, observedChanges: 3, observedMaterialChanges: 2, materialChangesWithExceptions: 1 });
  });

  it("does not let one interface authorize an undeclared responsibility between the same systems", () => {
    const report = assessArchitectureExceptions(topology(), [{
      id: "one",
      observedAt: "2026-08-23T12:00:00Z",
      material: true,
      crossings: [{ from: "workspace", to: "product", responsibility: "commercial", interface: "workspace-product" }],
    }], { maximumExceptionRate: 0 });
    expect(report).toMatchObject({ state: "violated", exceptionRate: 1, materialChangesWithExceptions: 1 });
    expect(report.changes[0]?.crossings[0]).toMatchObject({ declared: false, responsibility: "commercial" });
  });

  it("returns indeterminate rather than zero when no material changes were observed", () => {
    const report = assessArchitectureExceptions(topology(), [{ id: "one", observedAt: "2026-08-23T12:00:00Z", material: false, crossings: [] }], { maximumExceptionRate: 0 });
    expect(report).toMatchObject({ state: "indeterminate", exceptionRate: null, observedMaterialChanges: 0 });
    expect(report.findings.map((entry) => entry.rule)).toContain("material-evidence-required");
  });

  it("returns indeterminate for invalid evidence, topology, or setpoint", () => {
    expect(assessArchitectureExceptions({}, [], { maximumExceptionRate: 2 })).toMatchObject({ state: "indeterminate", exceptionRate: null });
    expect(validateArchitectureChangeObservations([{ id: "same", observedAt: "no", material: "yes", crossings: "none" }, { id: "same", observedAt: "no", material: true, crossings: [] }]).map((entry) => entry.rule)).toEqual(expect.arrayContaining(["observed-at", "material-shape", "crossings-shape", "duplicate-observation-id"]));
  });
});
