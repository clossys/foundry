import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HUB_ONLY_PACKAGE_DIRECTORIES, planDigest, resolvePackages, snapshotDigest, validateAdvisorPlan } from "./index.js";
import type { AdvisorPlan, PackageResolutionResult, RegistrySnapshot, RegistrySnapshotPackage, RegistrySnapshotVersion } from "./index.js";

/*
 * Issue #1178: resolvePackages() turns a staffed plan and a registry snapshot
 * into the plan's exact package acts. Every refusal the resolution defines is
 * tested here, and the output is checked with this package's own plan
 * validator, so a resolved plan always satisfies the plan contract's rules.
 */
const SCOPE_FILE = JSON.parse(readFileSync(new URL("../../../package-scope.json", import.meta.url), "utf8")) as { scope: string; registry: string };
const SCOPE = SCOPE_FILE.scope;
const CORPUS = JSON.parse(readFileSync(new URL("../../../docs/contracts/registry-snapshot.fixture.json", import.meta.url), "utf8")) as {
  digests: { name: string; snapshot: RegistrySnapshot; digest: string }[];
};
const corpusSnapshot = (name: string) => structuredClone(CORPUS.digests.find((entry) => entry.name === name)!.snapshot) as RegistrySnapshot;
const corpusDigest = (name: string) => CORPUS.digests.find((entry) => entry.name === name)!.digest;

const WRITER = `${SCOPE}/writer`;
const DESIGNER = `${SCOPE}/designer`;
const STARTER = `${SCOPE}/starter`;

const PLAN: AdvisorPlan = {
  schemaVersion: 1,
  asOf: "2026-09-24T12:00:00Z",
  mandate: { problem: "FOUNDER-PROSE our story is unclear", primaryProblemId: "strategist-unclear-direction", roles: ["writer", "designer"] },
  whereWeAre: ["FOUNDER-PROSE a status line"],
  recommendedNext: { action: "FOUNDER-PROSE approve the plan", owner: "sponsor" },
  decisions: [],
  blockers: [],
  staffing: [
    { repository: "example-owner/site", roles: ["writer", "designer"] },
    { repository: "example-owner/docs", roles: ["writer"] },
  ],
};

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** The corpus base snapshot with one package entry (and optionally its version entry) edited. */
function withPackage(name: string, edit: (entry: Mutable<RegistrySnapshotPackage>, version: Mutable<RegistrySnapshotVersion> | undefined) => void): RegistrySnapshot {
  const snapshot = corpusSnapshot("base");
  const entry = snapshot.packages.find((candidate) => candidate.name === name)! as Mutable<RegistrySnapshotPackage>;
  edit(entry, entry.versions[0] as Mutable<RegistrySnapshotVersion> | undefined);
  return snapshot;
}
const indexOf = (snapshot: RegistrySnapshot, name: string) => snapshot.packages.findIndex((entry) => entry.name === name);
const base = corpusSnapshot("base");
const W = indexOf(base, WRITER);
const D = indexOf(base, DESIGNER);
const S = indexOf(base, STARTER);

function refusal(result: PackageResolutionResult) {
  return { state: result.state, findings: result.findings.map(({ rule, verdict, path }) => ({ rule, verdict, path })) };
}

afterEach(() => vi.unstubAllGlobals());

describe("resolvePackages: a resolvable snapshot", () => {
  const result = resolvePackages(PLAN, base);
  const version = (name: string) => base.packages.find((entry) => entry.name === name)!.versions[0]!;

  it("writes one pin-starter act per staffed repository and one install act per staffed role, sorted by repository then name", () => {
    expect(result.state).toBe("satisfied");
    if (result.state !== "satisfied") return;
    const act = (repository: string, kind: string, name: string) => ({
      planItem: `${repository}:${name}`, repository, act: kind, name, version: version(name).version, integrity: version(name).integrity, placement: "devDependencies",
    });
    expect(result.packages).toEqual([
      act("example-owner/docs", "pin-starter", STARTER),
      act("example-owner/docs", "install", WRITER),
      act("example-owner/site", "install", DESIGNER),
      act("example-owner/site", "pin-starter", STARTER),
      act("example-owner/site", "install", WRITER),
    ]);
    expect(result.findings).toEqual([]);
  });

  it("selects exactly the version latest names, with that version's integrity", () => {
    if (result.state !== "satisfied") throw new Error("expected satisfied");
    for (const act of result.packages) {
      const entry = base.packages.find((candidate) => candidate.name === act.name)!;
      expect(act.version).toBe(entry.latest);
      expect(act.integrity).toBe(entry.versions.find((candidate) => candidate.version === entry.latest)!.integrity);
    }
  });

  it("records the snapshot digest the corpus computed independently", () => {
    if (result.state !== "satisfied") throw new Error("expected satisfied");
    expect(result.resolution).toEqual({ snapshotDigest: corpusDigest("base") });
  });

  it("gives a plan that passes validateAdvisorPlan, the contract's rules R1-R10 included, and has a digest", () => {
    if (result.state !== "satisfied") throw new Error("expected satisfied");
    const resolved = { ...PLAN, packages: result.packages, resolution: result.resolution };
    expect(validateAdvisorPlan(resolved)).toEqual([]);
    // R10: exactly one pin-starter act per staffed repository, as a devDependency.
    const pins = result.packages.filter((act) => act.act === "pin-starter");
    expect(pins.map((act) => act.repository).sort()).toEqual(PLAN.staffing!.map((entry) => entry.repository).sort());
    expect(new Set(pins.map((act) => act.placement))).toEqual(new Set(["devDependencies"]));
    expect(planDigest(resolved)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("lists each distinct package reference once, sorted by name, for the sponsor's grant", () => {
    if (result.state !== "satisfied") throw new Error("expected satisfied");
    expect(result.permittedPackages).toEqual([DESIGNER, STARTER, WRITER].map((name) => ({ name, version: version(name).version, integrity: version(name).integrity })));
  });

  it("is byte-identical when resolved again, from the same snapshot or from a re-fetch of the same selection", () => {
    expect(JSON.stringify(resolvePackages(PLAN, base))).toBe(JSON.stringify(result));
    expect(JSON.stringify(resolvePackages(PLAN, corpusSnapshot("base-refetched")))).toBe(JSON.stringify(result));
  });

  it("is byte-identical when resolved from a plan that already carries its packages and resolution", () => {
    if (result.state !== "satisfied") throw new Error("expected satisfied");
    expect(JSON.stringify(resolvePackages({ ...PLAN, packages: result.packages, resolution: result.resolution }, base))).toBe(JSON.stringify(result));
  });

  it("ignores packages in the snapshot the plan does not ask for, but they stay in the digest", () => {
    const extra = corpusSnapshot("base");
    (extra.packages as RegistrySnapshotPackage[]).push({ ...extra.packages[W]!, name: `${SCOPE}/publisher` });
    const resolved = resolvePackages(PLAN, extra);
    expect(resolved.state).toBe("satisfied");
    if (resolved.state !== "satisfied" || result.state !== "satisfied") return;
    expect(resolved.packages.map((act) => act.name)).toEqual(result.packages.map((act) => act.name));
    expect(resolved.resolution.snapshotDigest).toBe(snapshotDigest(extra));
    expect(resolved.resolution.snapshotDigest).not.toBe(result.resolution.snapshotDigest);
  });

  it("makes no network call", () => {
    const fetch = vi.fn(() => {
      throw new Error("no network");
    });
    vi.stubGlobal("fetch", fetch);
    expect(resolvePackages(PLAN, base).state).toBe("satisfied");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("resolvePackages: every refusal", () => {
  it("snapshot fails its contract: violated snapshot-shape, by position", () => {
    const { kind: _kind, ...shapeless } = base;
    expect(refusal(resolvePackages(PLAN, shapeless))).toEqual({ state: "violated", findings: [{ rule: "snapshot-shape", verdict: "violated", path: "kind" }] });
    const repeated = corpusSnapshot("base");
    (repeated.packages as RegistrySnapshotPackage[]).push(repeated.packages[W]!);
    expect(refusal(resolvePackages(PLAN, repeated))).toEqual({ state: "violated", findings: [{ rule: "snapshot-shape", verdict: "violated", path: "packages[3].name" }] });
  });

  it("registry is not the packed registry: violated foreign-registry", () => {
    const foreign = { ...corpusSnapshot("base"), registry: "https://registry.example.com" };
    expect(refusal(resolvePackages(PLAN, foreign))).toEqual({ state: "violated", findings: [{ rule: "foreign-registry", verdict: "violated", path: "registry" }] });
    // The same snapshot passes the registry check against a build for that registry; its tarballs are then foreign to it.
    const rules = resolvePackages(PLAN, foreign, { packageScope: { scope: SCOPE, registry: "https://registry.example.com" } }).findings.map((finding) => finding.rule);
    expect(new Set(rules)).toEqual(new Set(["foreign-tarball-host"]));
  });

  it("requested name absent from the snapshot: indeterminate package-not-in-snapshot", () => {
    const missing = corpusSnapshot("base");
    (missing.packages as RegistrySnapshotPackage[]).splice(D, 1);
    expect(refusal(resolvePackages(PLAN, missing))).toEqual({ state: "indeterminate", findings: [{ rule: "package-not-in-snapshot", verdict: "indeterminate", path: "packages" }] });
  });

  it("status not-found: violated package-not-published", () => {
    const snapshot = withPackage(DESIGNER, (entry) => Object.assign(entry, { status: "not-found", latest: null, versions: [] }));
    expect(refusal(resolvePackages(PLAN, snapshot))).toEqual({ state: "violated", findings: [{ rule: "package-not-published", verdict: "violated", path: `packages[${D}].status` }] });
  });

  it("latest null: indeterminate no-latest", () => {
    const snapshot = withPackage(WRITER, (entry) => Object.assign(entry, { latest: null }));
    expect(refusal(resolvePackages(PLAN, snapshot))).toEqual({ state: "indeterminate", findings: [{ rule: "no-latest", verdict: "indeterminate", path: `packages[${W}].latest` }] });
  });

  it("latest names a version the snapshot does not record: indeterminate tag-points-at-missing-version", () => {
    const snapshot = withPackage(WRITER, (entry) => Object.assign(entry, { latest: "0.4.2" }));
    expect(refusal(resolvePackages(PLAN, snapshot))).toEqual({
      state: "indeterminate", findings: [{ rule: "tag-points-at-missing-version", verdict: "indeterminate", path: `packages[${W}].latest` }],
    });
  });

  it("latest has a prerelease or build suffix: violated prerelease-latest, even when that version is recorded", () => {
    for (const latest of ["0.5.0-rc.1", "0.5.0+build.7", "0.5.0-beta+exp.sha"]) {
      const snapshot = withPackage(WRITER, (entry, version) => {
        entry.latest = latest;
        version!.version = latest;
      });
      expect(refusal(resolvePackages(PLAN, snapshot)), latest).toEqual({ state: "violated", findings: [{ rule: "prerelease-latest", verdict: "violated", path: `packages[${W}].latest` }] });
    }
  });

  it("integrity missing, sha1 only, or more than one token: violated no-sha512-integrity", () => {
    const sha512 = base.packages[W]!.versions[0]!.integrity!;
    for (const integrity of [null, "sha1-dGhpcyBpcyBub3QgYSBzaGE1MTI=", `${sha512} sha1-dGhpcyBpcyBub3QgYSBzaGE1MTI=`, sha512.replace("sha512-", "sha384-"), `${sha512}x`]) {
      const snapshot = withPackage(WRITER, (_entry, version) => {
        version!.integrity = integrity;
      });
      expect(refusal(resolvePackages(PLAN, snapshot)), String(integrity)).toEqual({
        state: "violated", findings: [{ rule: "no-sha512-integrity", verdict: "violated", path: `packages[${W}].versions[0].integrity` }],
      });
    }
  });

  it("integrity that is not canonical base64 (a second spelling of the same bytes): violated no-sha512-integrity", () => {
    const canonical = base.packages[W]!.versions[0]!.integrity!;
    const last = canonical.at(-3)!;
    expect("AQgw").toContain(last);
    const respelled = `${canonical.slice(0, -3)}${String.fromCharCode(last.charCodeAt(0) + 1)}==`;
    expect(Buffer.from(respelled.slice(7), "base64")).toEqual(Buffer.from(canonical.slice(7), "base64"));
    const snapshot = withPackage(WRITER, (_entry, version) => {
      version!.integrity = respelled;
    });
    expect(refusal(resolvePackages(PLAN, snapshot))).toEqual({ state: "violated", findings: [{ rule: "no-sha512-integrity", verdict: "violated", path: `packages[${W}].versions[0].integrity` }] });
  });

  it("a version number longer than any plan accepts: violated snapshot-shape", () => {
    const snapshot = withPackage(WRITER, (entry, version) => {
      entry.latest = "12345678901234567.0.0";
      version!.version = "12345678901234567.0.0";
    });
    expect(refusal(resolvePackages(PLAN, snapshot)).findings.map((finding) => finding.rule)).toEqual(["snapshot-shape", "snapshot-shape"]);
  });

  it("a staffed role whose package lives in the hub only: violated hub-only-package, by position, before any snapshot is read", () => {
    expect(HUB_ONLY_PACKAGE_DIRECTORIES).toEqual(["advisor", "integrator"]);
    const plan = { ...PLAN, mandate: { ...PLAN.mandate, roles: ["writer", "designer", "advisor"] }, staffing: [PLAN.staffing![0]!, { repository: "example-owner/docs", roles: ["writer", "advisor"] }] };
    const expected = { state: "violated", findings: [{ rule: "hub-only-package", verdict: "violated", path: "staffing[1].roles[1]" }] };
    expect(refusal(resolvePackages(plan, base))).toEqual(expected);
    expect(refusal(resolvePackages(plan, { not: "a snapshot" }))).toEqual(expected);
    expect(JSON.stringify(resolvePackages(plan, base))).not.toMatch(/example-owner|FOUNDER/);
  });

  it("deprecated: violated deprecated-version", () => {
    const snapshot = withPackage(STARTER, (_entry, version) => {
      version!.deprecated = true;
    });
    expect(refusal(resolvePackages(PLAN, snapshot))).toEqual({ state: "violated", findings: [{ rule: "deprecated-version", verdict: "violated", path: `packages[${S}].versions[0].deprecated` }] });
  });

  it("tarball host, scheme or credentials not the registry's: violated foreign-tarball-host", () => {
    const tarball = base.packages[W]!.versions[0]!.tarball;
    const foreign = [
      tarball.replace("https://registry.npmjs.org", "https://registry.npmjs.org.example.com"),
      tarball.replace("https://registry.npmjs.org", "https://cdn.example.com"),
      tarball.replace("https://", "http://"),
      tarball.replace("https://registry.npmjs.org", "https://registry.npmjs.org:8443"),
      tarball.replace("https://", "https://user:token@"),
      "not a url",
    ];
    expect(new URL(SCOPE_FILE.registry).host).toBe("registry.npmjs.org");
    for (const url of foreign) {
      const snapshot = withPackage(WRITER, (_entry, version) => {
        version!.tarball = url;
      });
      expect(refusal(resolvePackages(PLAN, snapshot)), url).toEqual({ state: "violated", findings: [{ rule: "foreign-tarball-host", verdict: "violated", path: `packages[${W}].versions[0].tarball` }] });
    }
  });

  it("no attestations yet: a warning, and the plan still resolves", () => {
    const snapshot = withPackage(WRITER, (_entry, version) => {
      version!.hasAttestations = false;
    });
    const result = resolvePackages(PLAN, snapshot);
    expect(refusal(result)).toEqual({ state: "satisfied", findings: [{ rule: "no-attestation-yet", verdict: "warning", path: `packages[${W}].versions[0].hasAttestations` }] });
  });

  it("reports every refused package, and violated outranks indeterminate", () => {
    const snapshot = withPackage(WRITER, (entry) => Object.assign(entry, { latest: null }));
    const designer = snapshot.packages[D]! as Mutable<RegistrySnapshotPackage>;
    (designer.versions[0] as Mutable<RegistrySnapshotVersion>).deprecated = true;
    const result = refusal(resolvePackages(PLAN, snapshot));
    expect(result.state).toBe("violated");
    expect(result.findings.map((finding) => finding.rule).sort()).toEqual(["deprecated-version", "no-latest"]);
  });

  it("reports every fault of one selected version together", () => {
    const snapshot = withPackage(WRITER, (_entry, version) => Object.assign(version!, { integrity: null, deprecated: true, tarball: "https://cdn.example.com/x.tgz", hasAttestations: false }));
    expect(refusal(resolvePackages(PLAN, snapshot)).findings.map((finding) => finding.rule)).toEqual(["no-sha512-integrity", "deprecated-version", "foreign-tarball-host"]);
  });

  it("refuses a plan the request step refuses, before reading the snapshot", () => {
    const { staffing: _staffing, ...unstaffed } = PLAN;
    expect(refusal(resolvePackages(unstaffed, base))).toEqual({ state: "violated", findings: [{ rule: "plan-not-staffed", verdict: "violated", path: "staffing" }] });
  });

  it("never quotes plan text, a repository id, or a snapshot value in a finding", () => {
    const snapshots = [
      withPackage(WRITER, (_entry, version) => Object.assign(version!, { integrity: "sha1-SNAPSHOT-VALUE", tarball: "https://SNAPSHOT-VALUE.example.com/x.tgz" })),
      withPackage(WRITER, (entry) => Object.assign(entry, { latest: "9.9.9-SNAPSHOT-VALUE" })),
      { ...corpusSnapshot("base"), registry: "https://snapshot-value.example.com" },
      { ...corpusSnapshot("base"), "SNAPSHOT-VALUE key": true },
    ];
    for (const snapshot of snapshots) {
      const text = JSON.stringify(resolvePackages(PLAN, snapshot).findings);
      expect(text).not.toMatch(/FOUNDER|example-owner|SNAPSHOT-VALUE|snapshot-value/i);
    }
  });
});

describe("resolvePackages holds no network or credential code", () => {
  it("imports nothing that can reach the network, a process, or the environment", () => {
    for (const file of ["package-resolution.ts", "registry-snapshot.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/node:(?:http|https|net|tls|dns|child_process|fs)\b|\bfetch\(|process\.env|XMLHttpRequest|WebSocket/);
    }
  });
});
