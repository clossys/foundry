import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdvisorPackageCliInputError, main as packageRequestMain } from "./package-request-cli.js";
import { main as resolvePackagesMain } from "./resolve-packages-cli.js";
import type { AdvisorPlan, RegistrySnapshot } from "./index.js";

/*
 * Issue #1178: advisor-package-request and advisor-resolve-packages. Each
 * reads its files strictly, prints a JSON report, and exits 0 (done),
 * 1 (violated) or 2 (indeterminate, unreadable input, or a usage error).
 * Nothing either prints quotes plan text, a repository id, or a file path.
 */
const SCOPE = (JSON.parse(readFileSync(new URL("../../../package-scope.json", import.meta.url), "utf8")) as { scope: string }).scope;
const CORPUS = JSON.parse(readFileSync(new URL("../../../docs/contracts/registry-snapshot.fixture.json", import.meta.url), "utf8")) as { digests: { name: string; snapshot: RegistrySnapshot }[] };
const BASE = CORPUS.digests.find((entry) => entry.name === "base")!.snapshot;

const PLAN: AdvisorPlan = {
  schemaVersion: 1,
  asOf: "2026-09-24T12:00:00Z",
  mandate: { problem: "FOUNDER-PROSE we cannot explain our product", primaryProblemId: "strategist-unclear-direction", roles: ["writer", "designer"] },
  whereWeAre: [],
  recommendedNext: null,
  decisions: [],
  blockers: [],
  staffing: [{ repository: "example-owner/private-site", roles: ["writer", "designer"] }],
};

let root: string;
let out: string[];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "advisor-resolve-packages-cli-"));
  out = [];
  vi.spyOn(console, "log").mockImplementation((text: string) => void out.push(text));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

function write(name: string, contents: unknown): string {
  const path = join(root, name);
  writeFileSync(path, typeof contents === "string" || contents instanceof Uint8Array ? contents : JSON.stringify(contents));
  return path;
}
const printed = () => JSON.parse(out.join("\n")) as { state: string; findings: { rule: string; message: string }[]; names?: string[]; packages?: unknown[] };

describe("advisor-package-request", () => {
  it("prints the names and exits 0", () => {
    expect(packageRequestMain([write("plan.json", PLAN)])).toBe(0);
    expect(printed()).toEqual({ state: "satisfied", names: [`${SCOPE}/designer`, `${SCOPE}/starter`, `${SCOPE}/writer`], findings: [] });
  });

  it("exits 1 for a plan it refuses, and prints positions only", () => {
    const plan = { ...PLAN, mandate: { ...PLAN.mandate, roles: ["FOUNDER-ROLE"] }, staffing: [{ repository: "example-owner/private-site", roles: ["FOUNDER-ROLE"] }] };
    expect(packageRequestMain([write("plan.json", plan)])).toBe(1);
    expect(printed().findings.map((finding) => finding.rule)).toEqual(["role-not-in-catalogue"]);
    expect(out.join("\n")).not.toMatch(/FOUNDER|private-site/);
  });

  it("prints usage for --help and exits 0", () => {
    expect(packageRequestMain(["--help"])).toBe(0);
    expect(out.join("\n")).toMatch(/^Usage: advisor-package-request <plan.json>/);
  });

  it("throws a usage error (exit 2) for the wrong number of arguments or a missing file, never naming the path", () => {
    expect(() => packageRequestMain([])).toThrow(AdvisorPackageCliInputError);
    expect(() => packageRequestMain(["a", "b"])).toThrow(AdvisorPackageCliInputError);
    expect(() => packageRequestMain([join(root, "FOUNDER-missing.json")])).toThrow(/^the plan file does not exist$/);
    expect(() => packageRequestMain([root])).toThrow(/^the plan file is not a file$/);
  });

  it("refuses a file that is not strict JSON by reason and position, never quoting it", () => {
    const text = JSON.stringify(PLAN);
    expect(() => packageRequestMain([write("plan.json", text.replace('"problem":', '"problem":"FOUNDER-PROSE","problem":'))])).toThrow(/^the plan file repeats a key in one object$/);
    expect(() => packageRequestMain([write("plan.json", '{"schemaVersion":1,FOUNDER-PROSE}')])).toThrow(/^the plan file is not valid JSON at position 19$/);
    const bytes = Buffer.from(text, "utf8");
    bytes[bytes.indexOf(Buffer.from("FOUNDER"))] = 0xff;
    expect(() => packageRequestMain([write("plan.json", bytes)])).toThrow(/^the plan file is not valid UTF-8$/);
  });
});

describe("advisor-resolve-packages", () => {
  it("prints the packages, resolution and permitted packages, and exits 0", () => {
    expect(resolvePackagesMain([write("plan.json", PLAN), write("snapshot.json", BASE)])).toBe(0);
    const report = printed();
    expect(report.state).toBe("satisfied");
    expect(Object.keys(report)).toEqual(["state", "findings", "packages", "resolution", "permittedPackages"]);
    expect(report.packages).toHaveLength(3);
  });

  it("prints byte-identical output for the same inputs", () => {
    const args = [write("plan.json", PLAN), write("snapshot.json", BASE)];
    resolvePackagesMain(args);
    const first = out.join("\n");
    out.length = 0;
    resolvePackagesMain(args);
    expect(out.join("\n")).toBe(first);
  });

  it("prints byte-identical output for a re-fetch that lists packages in another order, warning included", () => {
    const warned = structuredClone(BASE) as { fetchedAt: string; packages: { name: string; versions: { hasAttestations: boolean }[] }[] };
    warned.packages.find((entry) => entry.name.endsWith("/writer"))!.versions[0]!.hasAttestations = false;
    const refetched = { ...structuredClone(warned), fetchedAt: "2026-09-30T00:00:00Z", packages: [...structuredClone(warned).packages].reverse() };
    expect(resolvePackagesMain([write("plan.json", PLAN), write("snapshot.json", warned)])).toBe(0);
    const first = out.join("\n");
    expect(printed().findings.map((finding) => finding.rule)).toEqual(["no-attestation-yet"]);
    out.length = 0;
    expect(resolvePackagesMain([write("plan.json", PLAN), write("snapshot.json", refetched)])).toBe(0);
    expect(out.join("\n")).toBe(first);
  });

  it("exits 1 when a package is refused", () => {
    const snapshot = structuredClone(BASE) as { packages: { versions: { deprecated: boolean }[] }[] };
    snapshot.packages[0]!.versions[0]!.deprecated = true;
    expect(resolvePackagesMain([write("plan.json", PLAN), write("snapshot.json", snapshot)])).toBe(1);
    expect(printed().findings.map((finding) => finding.rule)).toEqual(["deprecated-version"]);
  });

  it("exits 1 for a snapshot from another registry", () => {
    expect(resolvePackagesMain([write("plan.json", PLAN), write("snapshot.json", { ...BASE, registry: "https://registry.example.com" })])).toBe(1);
    expect(printed().findings.map((finding) => finding.rule)).toEqual(["foreign-registry"]);
  });

  it("exits 2 when the snapshot cannot decide", () => {
    const snapshot = { ...BASE, packages: BASE.packages.filter((entry) => !entry.name.endsWith("/designer")) };
    expect(resolvePackagesMain([write("plan.json", PLAN), write("snapshot.json", snapshot)])).toBe(2);
    expect(printed()).toMatchObject({ state: "indeterminate", findings: [{ rule: "package-not-in-snapshot" }] });
  });

  it("never prints plan text or a repository id", () => {
    resolvePackagesMain([write("plan.json", { ...PLAN, staffing: [{ repository: "example-owner/private-site", roles: ["writer", "FOUNDER-ROLE"] }] }), write("snapshot.json", BASE)]);
    expect(out.join("\n")).not.toMatch(/FOUNDER|private-site/);
  });

  it("prints usage for --help and exits 0; wrong arguments and unreadable files are usage errors (exit 2)", () => {
    expect(resolvePackagesMain(["-h"])).toBe(0);
    expect(out.join("\n")).toMatch(/^Usage: advisor-resolve-packages <plan.json> <registry-snapshot.json>/);
    expect(() => resolvePackagesMain([write("plan.json", PLAN)])).toThrow(AdvisorPackageCliInputError);
    expect(() => resolvePackagesMain([write("plan.json", PLAN), join(root, "missing.json")])).toThrow(/^the snapshot file does not exist$/);
    const repeated = JSON.stringify(BASE).replace('"registry":', '"registry":"https://registry.example.com","registry":');
    expect(() => resolvePackagesMain([write("plan.json", PLAN), write("snapshot.json", repeated)])).toThrow(/^the snapshot file repeats a key in one object$/);
  });
});
