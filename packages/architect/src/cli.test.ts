import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArchitectCliInputError, main } from "./cli.js";

let root: string;
let topologyFile: string;
let observationsFile: string;

function writeJson(name: string, value: unknown): string {
  const path = join(root, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

const topology = {
  id: "example",
  schemaVersion: "0.1.0",
  scope: { id: "example-business", kind: "business" },
  systems: [
    { id: "workspace", kind: "workspace", responsibilities: ["control-plane"] },
    { id: "product", kind: "repository", responsibilities: ["product"] },
  ],
  authorities: [
    { responsibility: "control-plane", owner: "owner", systemOfRecord: "workspace" },
    { responsibility: "product", owner: "owner", systemOfRecord: "product" },
  ],
  interfaces: [{ id: "workspace-product", from: "workspace", to: "product", responsibilities: ["product"] }],
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "architect-cli-"));
  topologyFile = writeJson("topology.json", topology);
  observationsFile = writeJson("observations.json", [{ id: "one", observedAt: "2026-08-23T12:00:00Z", material: true, crossings: [{ from: "workspace", to: "product", responsibility: "product" }] }]);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("architect-check topology", () => {
  it("returns 0 for a satisfied topology and 1 for a violated topology", () => {
    expect(main(["topology", topologyFile])).toBe(0);
    expect(JSON.parse((console.log as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as string)).toMatchObject({ state: "satisfied", findings: [] });
    const invalid = writeJson("invalid.json", { ...topology, authorities: [] });
    expect(main(["topology", invalid])).toBe(1);
  });
});

describe("architect-check exceptions", () => {
  it("maps satisfied, violated, and unobserved results to 0, 1, and 2", () => {
    expect(main(["exceptions", topologyFile, observationsFile, "--maximum-exception-rate", "0"])).toBe(0);
    const violation = writeJson("violation.json", [{ id: "one", observedAt: "2026-08-23T12:00:00Z", material: true, crossings: [{ from: "product", to: "workspace", responsibility: "product" }] }]);
    expect(main(["exceptions", topologyFile, violation, "--maximum-exception-rate", "0"])).toBe(1);
    const unobserved = writeJson("unobserved.json", []);
    expect(main(["exceptions", topologyFile, unobserved, "--maximum-exception-rate", "0"])).toBe(2);
  });

  it("returns 2 semantics by throwing on unreadable or invalid command input", () => {
    expect(() => main([])).toThrow(ArchitectCliInputError);
    expect(() => main(["topology", join(root, "missing.json")])).toThrow(ArchitectCliInputError);
    expect(() => main(["exceptions", topologyFile, observationsFile])).toThrow(ArchitectCliInputError);
  });

  it("prints help with the three-state contract", () => {
    expect(main(["--help"])).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("0 = satisfied, 1 = violated, 2 = indeterminate"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("architect-check <assessment.json>"));
  });
});

describe("architect-check assessment.json", () => {
  function assessment(observations: unknown, maximumExceptionRate = 0) {
    return { topology, observations, maximumExceptionRate };
  }

  it("maps satisfied, violated, and unobserved single-file input to 0, 1, and 2", () => {
    expect(main([writeJson("satisfied.json", assessment([{ id: "one", observedAt: "2026-08-23T12:00:00Z", material: true, crossings: [{ from: "workspace", to: "product", responsibility: "product" }] }]))])).toBe(0);
    expect(JSON.parse((console.log as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as string)).toMatchObject({
      state: "satisfied",
      exceptionRate: 0,
      proposedPositions: [],
    });
    const violated = writeJson("violated.json", assessment([{ id: "one", observedAt: "2026-08-23T12:00:00Z", material: true, crossings: [{ from: "product", to: "workspace", responsibility: "product" }] }]));
    expect(main([violated])).toBe(1);
    const unobserved = writeJson("unobserved.json", assessment([]));
    expect(main([unobserved])).toBe(2);
  });

  it("throws on a missing assessment file and does not treat topology as the single-file form", () => {
    expect(() => main([join(root, "missing.json")])).toThrow(ArchitectCliInputError);
    expect(main(["topology", topologyFile])).toBe(0);
  });
});
