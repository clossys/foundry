import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { ApplyCheck, ChangeSetItem } from "./change-set-contract.js";
import { PACKAGE_SCOPE } from "./generated/package-scope.generated.js";
import type { LockfileSpawn, LockfileSpawnRequest, LockfileSpawnResult } from "./lockfile-regen.js";
import { LOCKFILE_TOOL_ENV_KEYS } from "./lockfile-tool-env.js";
import {
  PROVENANCE_CHECK_BIN,
  PROVENANCE_CHECK_MAX_BUFFER,
  PROVENANCE_CHECK_TIMEOUT_MS,
  checkSetProvenance,
  registrySnapshotDigest,
} from "./provenance-gate.js";
import type { ProvenanceGateInput } from "./provenance-gate.js";
import type { RegistrySnapshot } from "./registry-snapshot.js";

/*
 * Issue #1178, check V9 and decision D20. Every test that is not the one real
 * spawn injects the spawn port, so no test reaches the network and none needs
 * Integrator built. Each hub is a real directory tree under the real temp
 * root, with a stub file where Integrator's bin would be and the bin link a
 * relative symlink, the way npm publishes it.
 */

const REPOSITORY_ROOT = new URL("../../../", import.meta.url);
const readRepositoryFile = (path: string): string => readFileSync(new URL(path, REPOSITORY_ROOT), "utf8");

const REGISTRY = PACKAGE_SCOPE.registry;
const WRITER = "@clossys/writer";
const DESIGNER = "@clossys/designer";
const LEGACY = "@clossys/inspector";
const INTEGRITY = `sha512-${"A".repeat(86)}==`;

const scratchRoot = mkdtempSync(join(realpathSync(tmpdir()), "provenance-gate-test-"));
let counter = 0;
afterAll(() => rmSync(scratchRoot, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

const STUB_BIN_TEXT = "#!/usr/bin/env node\n";

/** Variables the OS or Node puts into every child process: macOS adds this one, whatever the parent passed. */
const ADDED_BY_OS_OR_NODE: readonly string[] = ["__CF_USER_TEXT_ENCODING"];

interface Hub {
  readonly hub: string;
  readonly tree: string;
  /** The .bin entry, a relative symlink. */
  readonly bin: string;
  /** The stub file it points to. */
  readonly stub: string;
  readonly integrator: string;
}

/** A hub with Integrator installed the way npm lays it out. `stubText` is the stub's whole content. */
function makeHub(stubText: string = STUB_BIN_TEXT): Hub {
  counter += 1;
  const base = join(scratchRoot, `case-${counter}`);
  const hub = join(base, "hub");
  const tree = join(base, "tree");
  const integrator = join(hub, "node_modules", "@clossys", "integrator");
  const stub = join(integrator, "dist", "provenance-check-cli.js");
  const bin = join(hub, "node_modules", ".bin", PROVENANCE_CHECK_BIN);
  mkdirSync(dirname(stub), { recursive: true });
  mkdirSync(dirname(bin), { recursive: true });
  mkdirSync(tree, { recursive: true });
  writeFileSync(stub, stubText, { mode: 0o755 });
  symlinkSync("../@clossys/integrator/dist/provenance-check-cli.js", bin);
  return { hub, tree, bin, stub, integrator };
}

/** A directory of its own under the scratch root, for targets that must sit outside the hub. */
function outsideDir(): string {
  counter += 1;
  const directory = join(scratchRoot, `outside-${counter}`);
  mkdirSync(directory, { recursive: true });
  return directory;
}

interface ReportPackage {
  name: string;
  installedVersion: string;
  state: "verified" | "violated" | "indeterminate";
  reasons?: string[];
  latestVersion?: string;
  currencyDistance?: string;
}
interface Report {
  state: string;
  registryBaseUrl: string;
  packages: ReportPackage[];
}

const verifiedPackage = (name: string, version: string): ReportPackage => ({ name, installedVersion: version, latestVersion: version, currencyDistance: "current", state: "verified", reasons: [] });
const violatedPackage = (name: string, version: string): ReportPackage => ({ name, installedVersion: version, state: "violated", reasons: ["no provenance"] });
const report = (state: string, packages: ReportPackage[], registryBaseUrl: string = REGISTRY): Report => ({ state, registryBaseUrl, packages });
const verifiedReport = (...packages: [string, string][]): Report => report("verified", packages.map(([name, version]) => verifiedPackage(name, version)));

/** What the bin prints: two-space JSON. */
const printed = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const exitWith = (status: number | null, value: unknown): LockfileSpawnResult => ({ status, stdout: printed(value), stderr: "" });
const rawExit = (status: number | null, stdout: string): LockfileSpawnResult => ({ status, stdout, stderr: "" });

interface Recorder {
  readonly calls: LockfileSpawnRequest[];
  readonly spawn: LockfileSpawn;
}
function recorder(answer: LockfileSpawnResult | (() => LockfileSpawnResult | Promise<LockfileSpawnResult>)): Recorder {
  const calls: LockfileSpawnRequest[] = [];
  const spawn: LockfileSpawn = async (request) => {
    calls.push(request);
    return typeof answer === "function" ? answer() : answer;
  };
  return { calls, spawn };
}

function packageItem(name: string, version: string, overrides: { act?: "install" | "pin-starter"; satisfiedInBase?: boolean; id?: string } = {}): ChangeSetItem {
  return {
    id: overrides.id ?? `item-${name}-${version}`,
    act: overrides.act ?? "install",
    planItem: `plan-${name}`,
    package: { name, version, integrity: INTEGRITY },
    placement: "dependencies",
    satisfiedInBase: overrides.satisfiedInBase ?? false,
  };
}

function snapshotOf(packages: readonly { name: string; versions: readonly string[]; status?: "found" | "not-found" }[], overrides: Partial<RegistrySnapshot> = {}): RegistrySnapshot {
  return {
    schemaVersion: 1,
    kind: "clossys.registry-snapshot",
    registry: REGISTRY,
    fetchedAt: "2026-09-24T12:00:00Z",
    fetchedBy: { name: "@clossys/launcher", version: "0.9.30" },
    packages: packages.map((entry) => {
      const status = entry.status ?? "found";
      return {
        name: entry.name,
        status,
        latest: status === "found" ? (entry.versions.at(-1) ?? null) : null,
        versions:
          status === "found"
            ? entry.versions.map((version) => ({ version, integrity: INTEGRITY, tarball: `${REGISTRY}/${entry.name}/-/${version}.tgz`, deprecated: false, publishedAt: "2026-09-01T10:00:00.000Z", hasAttestations: false }))
            : [],
        responseSha256: `sha256:${"a".repeat(64)}`,
      };
    }),
    ...overrides,
  };
}

function inputFor(hub: Hub, items: readonly ChangeSetItem[], overrides: Partial<ProvenanceGateInput> = {}): ProvenanceGateInput {
  return { tree: hub.tree, hubRoot: hub.hub, items, ...overrides };
}

const indeterminate = (rule: string): ApplyCheck => ({ check: "V9", verdict: "indeterminate", rule });
const violated = (rule: string): ApplyCheck => ({ check: "V9", verdict: "violated", rule });
const SATISFIED: ApplyCheck = { check: "V9", verdict: "satisfied" };

/** Runs the gate against a fresh hub with one injected spawn answer. */
async function run(answer: LockfileSpawnResult, items: readonly ChangeSetItem[], overrides: Partial<ProvenanceGateInput> = {}): Promise<{ checks: readonly ApplyCheck[]; calls: LockfileSpawnRequest[] }> {
  const hub = makeHub();
  const { calls, spawn } = recorder(answer);
  const checks = await checkSetProvenance(inputFor(hub, items, overrides), { spawn });
  return { checks, calls };
}

describe("checkSetProvenance: what is gated", () => {
  it("a verified report for the one gated package is satisfied, and the spawn request is exactly the contract", async () => {
    const hub = makeHub();
    const { calls, spawn } = recorder(exitWith(0, verifiedReport([WRITER, "1.0.0"])));
    const checks = await checkSetProvenance(inputFor(hub, [packageItem(WRITER, "1.0.0")]), { spawn });
    expect(checks).toEqual([SATISFIED]);
    expect(calls).toHaveLength(1);
    const request = calls[0] as LockfileSpawnRequest;
    // The verified real path of the bin, never a PATH lookup and never npx.
    expect(request.command).toBe(realpathSync(hub.bin));
    expect(request.command.startsWith(`${realpathSync(hub.hub)}/node_modules/`)).toBe(true);
    expect(request.args).toEqual(["--cwd", hub.tree, "--registry", REGISTRY]);
    expect(request.timeoutMs).toBe(PROVENANCE_CHECK_TIMEOUT_MS);
    expect(request.maxBuffer).toBe(PROVENANCE_CHECK_MAX_BUFFER);
    expect("shell" in request).toBe(false);
    expect(Object.keys(request).sort()).toEqual(["args", "command", "cwd", "env", "maxBuffer", "timeoutMs"]);
    // Neither the tree nor the hub is the working directory: a fresh scratch is.
    expect(request.cwd).not.toBe(hub.tree);
    expect(request.cwd.startsWith(hub.hub)).toBe(false);
    expect(basename(request.cwd).startsWith("launcher-lockfile-")).toBe(true);
  });

  it("exports the limits the contract names", () => {
    expect(PROVENANCE_CHECK_BIN).toBe("integrator-provenance-check");
    expect(PROVENANCE_CHECK_TIMEOUT_MS).toBe(120_000);
    expect(PROVENANCE_CHECK_MAX_BUFFER).toBe(1_000_000);
  });

  it("gates a pin-starter item the same as an install", async () => {
    const { checks, calls } = await run(exitWith(0, verifiedReport([WRITER, "1.0.0"])), [packageItem(WRITER, "1.0.0", { act: "pin-starter" })]);
    expect(checks).toEqual([SATISFIED]);
    expect(calls).toHaveLength(1);
    const missing = await run(exitWith(0, verifiedReport([DESIGNER, "1.0.0"])), [packageItem(WRITER, "1.0.0", { act: "pin-starter" })]);
    expect(missing.checks).toEqual([indeterminate("package-not-in-report")]);
  });

  it("a set with no gated item is satisfied without spawning and without touching the filesystem", async () => {
    const { calls, spawn } = recorder(exitWith(0, verifiedReport()));
    const items: ChangeSetItem[] = [
      { id: "a", act: "write-record", source: "engagement-brief" },
      { id: "b", act: "compose-skills", roles: ["writer"] },
      { id: "c", act: "write-ledger" },
      packageItem(WRITER, "1.0.0", { satisfiedInBase: true }),
      packageItem(DESIGNER, "2.0.0", { act: "pin-starter", satisfiedInBase: true }),
    ];
    // Roots that could never pass the canonical check: proof that nothing looks at them.
    const checks = await checkSetProvenance({ tree: "relative/tree", hubRoot: "relative/hub", items }, { spawn });
    expect(checks).toEqual([SATISFIED]);
    expect(calls).toHaveLength(0);
    expect(await checkSetProvenance({ tree: "x", hubRoot: "y", items: [] }, { spawn })).toEqual([SATISFIED]);
    expect(calls).toHaveLength(0);
  });

  it(
    "an install or pin-starter item whose satisfiedInBase is not exactly true is gated",
    async () => {
      const { calls, spawn } = recorder(exitWith(0, verifiedReport()));
      const shapes: { label: string; apply: (item: Record<string, unknown>) => void }[] = [
        { label: "deleted", apply: (item) => void delete item.satisfiedInBase },
        { label: "undefined", apply: (item) => void (item.satisfiedInBase = undefined) },
        { label: "null", apply: (item) => void (item.satisfiedInBase = null) },
        { label: "0", apply: (item) => void (item.satisfiedInBase = 0) },
        { label: '"false"', apply: (item) => void (item.satisfiedInBase = "false") },
        { label: '"true"', apply: (item) => void (item.satisfiedInBase = "true") },
        { label: "1", apply: (item) => void (item.satisfiedInBase = 1) },
      ];
      for (const act of ["install", "pin-starter"] as const) {
        for (const { label, apply } of shapes) {
          const item = packageItem(WRITER, "1.0.0", { act, satisfiedInBase: true }) as unknown as Record<string, unknown>;
          apply(item);
          // Relative roots: a gated item is refused at the root check, a skipped one is satisfied untouched.
          const checks = await checkSetProvenance({ tree: "relative/tree", hubRoot: "relative/hub", items: [item as unknown as ChangeSetItem] }, { spawn });
          expect(checks, `${act} with satisfiedInBase ${label}`).toEqual([indeterminate("root-not-canonical")]);
        }
      }
      expect(calls).toHaveLength(0);
    },
    30_000,
  );

  it("gates only the packages that are not satisfied in the base", async () => {
    const hub = makeHub();
    const { calls, spawn } = recorder(exitWith(0, verifiedReport([WRITER, "1.0.0"])));
    const checks = await checkSetProvenance(inputFor(hub, [packageItem(DESIGNER, "9.9.9", { satisfiedInBase: true }), packageItem(WRITER, "1.0.0")]), { spawn });
    // The base-satisfied package is absent from the report and that does not matter.
    expect(checks).toEqual([SATISFIED]);
    expect(calls).toHaveLength(1);
  });

  it("compares names exactly and does not special-case the scope", async () => {
    const other = "@other/thing";
    const ok = await run(exitWith(0, verifiedReport([other, "1.0.0"])), [packageItem(other, "1.0.0")]);
    expect(ok.checks).toEqual([SATISFIED]);
    const absent = await run(exitWith(0, verifiedReport([WRITER, "1.0.0"])), [packageItem(other, "1.0.0")]);
    expect(absent.checks).toEqual([indeterminate("package-not-in-report")]);
    const prefix = await run(exitWith(0, verifiedReport([`${WRITER}-extra`, "1.0.0"])), [packageItem(WRITER, "1.0.0")]);
    expect(prefix.checks).toEqual([indeterminate("package-not-in-report")]);
    const cased = await run(exitWith(0, verifiedReport([WRITER.replace("writer", "Writer"), "1.0.0"])), [packageItem(WRITER, "1.0.0")]);
    expect(cased.checks).toEqual([indeterminate("package-not-in-report")]);
    const inherited = await run(exitWith(0, verifiedReport([DESIGNER, "1.0.0"])), [packageItem("__proto__", "1.0.0")]);
    expect(inherited.checks).toEqual([indeterminate("package-not-in-report")]);
  });

  it("the same package and version twice is one gated package", async () => {
    const { checks, calls } = await run(exitWith(0, verifiedReport([WRITER, "1.0.0"])), [packageItem(WRITER, "1.0.0", { id: "one" }), packageItem(WRITER, "1.0.0", { act: "pin-starter", id: "two" })]);
    expect(checks).toEqual([SATISFIED]);
    expect(calls).toHaveLength(1);
  });

  it("one package at two versions is a conflict and nothing is spawned", async () => {
    const { checks, calls } = await run(exitWith(0, verifiedReport([WRITER, "1.0.0"], [WRITER, "1.0.1"])), [packageItem(WRITER, "1.0.0"), packageItem(WRITER, "1.0.1", { act: "pin-starter" })]);
    expect(checks).toEqual([indeterminate("gated-package-conflict")]);
    expect(calls).toHaveLength(0);
  });

  it("a conflict in a base-satisfied item does not gate", async () => {
    const { checks } = await run(exitWith(0, verifiedReport([WRITER, "1.0.0"])), [packageItem(WRITER, "1.0.0"), packageItem(WRITER, "0.9.0", { satisfiedInBase: true })]);
    expect(checks).toEqual([SATISFIED]);
  });
});

describe("checkSetProvenance: the roots", () => {
  it("refuses a relative tree or hub", async () => {
    const hub = makeHub();
    const { calls, spawn } = recorder(exitWith(0, verifiedReport([WRITER, "1.0.0"])));
    const items = [packageItem(WRITER, "1.0.0")];
    expect(await checkSetProvenance(inputFor(hub, items, { tree: "tree" }), { spawn })).toEqual([indeterminate("root-not-canonical")]);
    expect(await checkSetProvenance(inputFor(hub, items, { hubRoot: "hub" }), { spawn })).toEqual([indeterminate("root-not-canonical")]);
    expect(await checkSetProvenance(inputFor(hub, items, { tree: "" }), { spawn })).toEqual([indeterminate("root-not-canonical")]);
    expect(calls).toHaveLength(0);
  });

  it("refuses a tree or hub that is a symlink, or a path that is not spelled as its real path", async () => {
    const hub = makeHub();
    const { calls, spawn } = recorder(exitWith(0, verifiedReport([WRITER, "1.0.0"])));
    const items = [packageItem(WRITER, "1.0.0")];
    const treeLink = join(dirname(hub.tree), "tree-link");
    symlinkSync(hub.tree, treeLink);
    const hubLink = join(dirname(hub.hub), "hub-link");
    symlinkSync(hub.hub, hubLink);
    expect(await checkSetProvenance(inputFor(hub, items, { tree: treeLink }), { spawn })).toEqual([indeterminate("root-not-canonical")]);
    expect(await checkSetProvenance(inputFor(hub, items, { hubRoot: hubLink }), { spawn })).toEqual([indeterminate("root-not-canonical")]);
    expect(await checkSetProvenance(inputFor(hub, items, { tree: `${hub.tree}/../tree` }), { spawn })).toEqual([indeterminate("root-not-canonical")]);
    expect(await checkSetProvenance(inputFor(hub, items, { tree: `${hub.tree}/` }), { spawn })).toEqual([indeterminate("root-not-canonical")]);
    expect(calls).toHaveLength(0);
  });

  it("refuses a tree or hub that does not exist or is not a directory", async () => {
    const hub = makeHub();
    const { calls, spawn } = recorder(exitWith(0, verifiedReport([WRITER, "1.0.0"])));
    const items = [packageItem(WRITER, "1.0.0")];
    expect(await checkSetProvenance(inputFor(hub, items, { tree: join(hub.tree, "absent") }), { spawn })).toEqual([indeterminate("root-not-canonical")]);
    expect(await checkSetProvenance(inputFor(hub, items, { hubRoot: join(hub.hub, "absent") }), { spawn })).toEqual([indeterminate("root-not-canonical")]);
    expect(await checkSetProvenance(inputFor(hub, items, { tree: hub.stub }), { spawn })).toEqual([indeterminate("root-not-canonical")]);
    expect(calls).toHaveLength(0);
  });
});

describe("checkSetProvenance: locating the bin", () => {
  const items = [packageItem(WRITER, "1.0.0")];
  const verified = exitWith(0, verifiedReport([WRITER, "1.0.0"]));

  async function refused(hub: Hub): Promise<void> {
    const { calls, spawn } = recorder(verified);
    expect(await checkSetProvenance(inputFor(hub, items), { spawn })).toEqual([indeterminate("engine-missing-bin")]);
    expect(calls).toHaveLength(0);
  }

  it("refuses a hub with no .bin entry", async () => {
    const hub = makeHub();
    rmSync(hub.bin);
    await refused(hub);
  });

  it("refuses a hub with no node_modules at all", async () => {
    const hub = makeHub();
    rmSync(join(hub.hub, "node_modules"), { recursive: true });
    await refused(hub);
  });

  it("refuses a dangling bin symlink", async () => {
    const hub = makeHub();
    rmSync(hub.bin);
    symlinkSync("../@clossys/integrator/dist/absent.js", hub.bin);
    await refused(hub);
  });

  it("refuses a bin that resolves to a directory", async () => {
    const hub = makeHub();
    rmSync(hub.bin);
    symlinkSync("../@clossys/integrator/dist", hub.bin);
    await refused(hub);
  });

  it("refuses a bin that resolves to a file elsewhere in the hub", async () => {
    const hub = makeHub();
    mkdirSync(join(hub.hub, "node_modules", "another"), { recursive: true });
    writeFileSync(join(hub.hub, "node_modules", "another", "cli.js"), STUB_BIN_TEXT, { mode: 0o755 });
    rmSync(hub.bin);
    symlinkSync("../another/cli.js", hub.bin);
    await refused(hub);
  });

  it("refuses a bin that resolves to a file outside the hub", async () => {
    const hub = makeHub();
    const elsewhere = outsideDir();
    writeFileSync(join(elsewhere, "cli.js"), STUB_BIN_TEXT, { mode: 0o755 });
    rmSync(hub.bin);
    symlinkSync(join(elsewhere, "cli.js"), hub.bin);
    await refused(hub);
  });

  it("refuses a bin that is a regular file, not a link into the integrator package", async () => {
    const hub = makeHub();
    rmSync(hub.bin);
    writeFileSync(hub.bin, STUB_BIN_TEXT, { mode: 0o755 });
    await refused(hub);
  });

  it("refuses an integrator directory that is a symlink to a real directory outside the hub", async () => {
    const hub = makeHub();
    const elsewhere = outsideDir();
    mkdirSync(join(elsewhere, "dist"), { recursive: true });
    writeFileSync(join(elsewhere, "dist", "provenance-check-cli.js"), STUB_BIN_TEXT, { mode: 0o755 });
    rmSync(hub.integrator, { recursive: true });
    symlinkSync(elsewhere, hub.integrator);
    await refused(hub);
  });

  it("refuses an integrator directory that is a symlink to a directory inside the hub but outside node_modules", async () => {
    const hub = makeHub();
    const inside = join(hub.hub, "vendored");
    mkdirSync(join(inside, "dist"), { recursive: true });
    writeFileSync(join(inside, "dist", "provenance-check-cli.js"), STUB_BIN_TEXT, { mode: 0o755 });
    rmSync(hub.integrator, { recursive: true });
    symlinkSync(inside, hub.integrator);
    await refused(hub);
  });

  it("refuses a node_modules that is itself a symlink", async () => {
    const hub = makeHub();
    const moved = join(hub.hub, "moved-modules");
    renameSync(join(hub.hub, "node_modules"), moved);
    symlinkSync(moved, join(hub.hub, "node_modules"));
    await refused(hub);
  });

  it("refuses a hub whose integrator package directory is missing though the bin exists", async () => {
    const hub = makeHub();
    const elsewhere = outsideDir();
    writeFileSync(join(elsewhere, "cli.js"), STUB_BIN_TEXT, { mode: 0o755 });
    rmSync(hub.integrator, { recursive: true });
    rmSync(hub.bin);
    symlinkSync(join(elsewhere, "cli.js"), hub.bin);
    await refused(hub);
  });

  it("accepts the bin when it is a relative symlink into the integrator package", async () => {
    const hub = makeHub();
    const { calls, spawn } = recorder(verified);
    expect(await checkSetProvenance(inputFor(hub, items), { spawn })).toEqual([SATISFIED]);
    expect(calls).toHaveLength(1);
  });
});

describe("checkSetProvenance: the launch", () => {
  const items = [packageItem(WRITER, "1.0.0")];

  it("a spawn that cannot find the command is engine-missing-bin", async () => {
    expect((await run({ status: null, stdout: "", stderr: "", failure: "not-found" }, items)).checks).toEqual([indeterminate("engine-missing-bin")]);
  });

  it("a timeout is engine-timeout", async () => {
    expect((await run({ status: null, stdout: "", stderr: "", failure: "timeout" }, items)).checks).toEqual([indeterminate("engine-timeout")]);
    // Whatever the child printed before it was killed does not matter.
    expect((await run({ status: 0, stdout: printed(verifiedReport([WRITER, "1.0.0"])), stderr: "", failure: "timeout" }, items)).checks).toEqual([indeterminate("engine-timeout")]);
  });

  it("a signal, a null status or an unknown exit code is engine-failed", async () => {
    for (const status of [137, null, 3, 126, 127, -1, 255]) {
      expect((await run(exitWith(status, verifiedReport([WRITER, "1.0.0"])), items)).checks, `status ${String(status)}`).toEqual([indeterminate("engine-failed")]);
    }
  });

  it("exit 2 is engine-indeterminate, whatever it printed", async () => {
    expect((await run(exitWith(2, report("indeterminate", [{ name: WRITER, installedVersion: "1.0.0", state: "indeterminate", reasons: ["registry unreachable"] }])), items)).checks).toEqual([indeterminate("engine-indeterminate")]);
    expect((await run(rawExit(2, "not json at all"), items)).checks).toEqual([indeterminate("engine-indeterminate")]);
    expect((await run(exitWith(2, verifiedReport([WRITER, "1.0.0"])), items)).checks).toEqual([indeterminate("engine-indeterminate")]);
  });

  it("a spawn that throws is engine-failed", async () => {
    const hub = makeHub();
    const spawn: LockfileSpawn = async () => {
      throw new Error("spawn exploded");
    };
    expect(await checkSetProvenance(inputFor(hub, items), { spawn })).toEqual([indeterminate("engine-failed")]);
    const synchronous: LockfileSpawn = () => {
      throw new Error("spawn exploded synchronously");
    };
    expect(await checkSetProvenance(inputFor(hub, items), { spawn: synchronous })).toEqual([indeterminate("engine-failed")]);
  });

  it("removes the scratch directory after a run, however the run ends", async () => {
    const hub = makeHub();
    const seen: string[] = [];
    const answers: (() => LockfileSpawnResult)[] = [() => exitWith(0, verifiedReport([WRITER, "1.0.0"])), () => rawExit(2, ""), () => { throw new Error("boom"); }];
    for (const answer of answers) {
      const spawn: LockfileSpawn = async (request) => {
        expect(existsSync(request.cwd)).toBe(true);
        seen.push(request.cwd);
        return answer();
      };
      await checkSetProvenance(inputFor(hub, items), { spawn });
    }
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
    for (const path of seen) expect(existsSync(path), path).toBe(false);
  });

  it("the child environment is built from the allow-list and carries nothing from the parent", async () => {
    const sentinels: Record<string, string> = {
      NODE_AUTH_TOKEN: "sentinel-node-auth-token-6f1c",
      NPM_TOKEN: "sentinel-npm-token-2b7d",
      GH_TOKEN: "sentinel-gh-token-90aa",
      GITHUB_TOKEN: "sentinel-github-token-51ce",
      HTTPS_PROXY: "http://sentinel-proxy-3d44.invalid:3128",
      NODE_EXTRA_CA_CERTS: "/sentinel-ca-bundle-77be.pem",
      NODE_OPTIONS: "--require=/sentinel-preload-a812.js",
    };
    for (const [key, value] of Object.entries(sentinels)) vi.stubEnv(key, value);
    const { calls } = await run(exitWith(0, verifiedReport([WRITER, "1.0.0"])), items);
    expect(calls).toHaveLength(1);
    const { env } = calls[0] as LockfileSpawnRequest;
    const allowed = new Set<string>(LOCKFILE_TOOL_ENV_KEYS);
    for (const key of Object.keys(env)) expect(allowed.has(key), key).toBe(true);
    const serialized = JSON.stringify(env);
    for (const [key, value] of Object.entries(sentinels)) {
      expect(Object.hasOwn(env, key), key).toBe(false);
      expect(serialized.includes(value), key).toBe(false);
    }
    // The running node's directory leads PATH so the bin's `#!/usr/bin/env node` finds it.
    expect(env.PATH?.startsWith(`${dirname(process.execPath)}${delimiter}`)).toBe(true);
    // Every configuration location points into the scratch, not the real home.
    const scratch = (calls[0] as LockfileSpawnRequest).cwd;
    expect(env.HOME?.startsWith(scratch)).toBe(true);
    expect(env.npm_config_userconfig?.startsWith(scratch)).toBe(true);
    expect(env.npm_config_ignore_scripts).toBe("true");
  });

  it("a real child sees none of the parent's tokens, and gets exactly the arguments and a scratch working directory", async () => {
    const stubText = [
      "#!/usr/bin/env node",
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'fs.writeFileSync(path.join(__dirname, "env-dump.json"), JSON.stringify({ env: process.env, argv: process.argv.slice(2), cwd: process.cwd() }));',
      `process.stdout.write(${JSON.stringify(printed(verifiedReport([WRITER, "1.0.0"])))});`,
      "",
    ].join("\n");
    const hub = makeHub(stubText);
    const sentinels: Record<string, string> = {
      NODE_AUTH_TOKEN: "sentinel-node-auth-token-real-6f1c",
      NPM_TOKEN: "sentinel-npm-token-real-2b7d",
      GH_TOKEN: "sentinel-gh-token-real-90aa",
      GITHUB_TOKEN: "sentinel-github-token-real-51ce",
      HTTPS_PROXY: "http://sentinel-proxy-real-3d44.invalid:3128",
      NODE_EXTRA_CA_CERTS: "/sentinel-ca-bundle-real-77be.pem",
      NODE_OPTIONS: "--max-old-space-size=123",
    };
    for (const [key, value] of Object.entries(sentinels)) vi.stubEnv(key, value);
    const checks = await checkSetProvenance(inputFor(hub, [packageItem(WRITER, "1.0.0")]));
    expect(checks).toEqual([SATISFIED]);
    const dump = JSON.parse(readFileSync(join(hub.integrator, "dist", "env-dump.json"), "utf8")) as { env: Record<string, string>; argv: string[]; cwd: string };
    expect(dump.argv).toEqual(["--cwd", hub.tree, "--registry", REGISTRY]);
    const text = JSON.stringify(dump.env);
    for (const [key, value] of Object.entries(sentinels)) {
      expect(Object.hasOwn(dump.env, key), key).toBe(false);
      expect(text.includes(value), key).toBe(false);
    }
    // Node or the OS adds a few variables to a child on some platforms; every other key must come from the allow-list.
    const allowed = new Set<string>([...LOCKFILE_TOOL_ENV_KEYS, ...ADDED_BY_OS_OR_NODE]);
    for (const key of Object.keys(dump.env)) expect(allowed.has(key), key).toBe(true);
    expect(dump.env.PATH?.startsWith(`${dirname(process.execPath)}${delimiter}`)).toBe(true);
    expect(basename(dump.cwd).startsWith("launcher-lockfile-")).toBe(true);
    expect(existsSync(dump.cwd)).toBe(false);
  });

  it("a real child that exits 1 with a violated report is read as violated", async () => {
    const violating = report("violated", [violatedPackage(WRITER, "1.0.0")]);
    const stubText = `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(printed(violating))});\nprocess.exitCode = 1;\n`;
    const hub = makeHub(stubText);
    expect(await checkSetProvenance(inputFor(hub, [packageItem(WRITER, "1.0.0")]))).toEqual([violated("provenance-unverified")]);
  });
});

describe("checkSetProvenance: reading the report", () => {
  const items = [packageItem(WRITER, "1.0.0")];
  const good = (): Report => verifiedReport([WRITER, "1.0.0"]);

  async function unreadable(stdout: string, status: number = 0): Promise<void> {
    expect((await run(rawExit(status, stdout), items)).checks, stdout.slice(0, 60)).toEqual([indeterminate("report-unreadable")]);
  }

  it("reads the bin's own two-space output and compact JSON alike", async () => {
    expect((await run(rawExit(0, printed(good())), items)).checks).toEqual([SATISFIED]);
    expect((await run(rawExit(0, JSON.stringify(good())), items)).checks).toEqual([SATISFIED]);
  });

  it("refuses output that is not JSON, or not one JSON value", async () => {
    await unreadable("");
    await unreadable("   \n");
    await unreadable("not json");
    await unreadable(`${printed(good())}trailing`);
    await unreadable(`${printed(good())}${printed(good())}`);
    await unreadable("{");
    await unreadable(`﻿${printed(good())}`);
    await unreadable("not json", 1);
  });

  it("refuses a value that is not a plain object", async () => {
    for (const value of ["null", "[]", "1", '"verified"', "true", JSON.stringify([good()])]) await unreadable(value);
  });

  it("refuses a report with an unknown or missing top-level key", async () => {
    await unreadable(printed({ ...good(), extra: 1 }));
    await unreadable(printed({ state: "verified", packages: good().packages }));
    await unreadable(printed({ registryBaseUrl: REGISTRY, packages: good().packages }));
    await unreadable(printed({ state: "verified", registryBaseUrl: REGISTRY }));
    await unreadable(printed({}));
  });

  it("refuses a hostile __proto__ or constructor key without touching the prototype", async () => {
    const before = Object.getPrototypeOf({}) as object;
    await unreadable(`{"__proto__":{"polluted":true},"state":"verified","registryBaseUrl":${JSON.stringify(REGISTRY)},"packages":[]}`);
    await unreadable(`{"state":"verified","registryBaseUrl":${JSON.stringify(REGISTRY)},"packages":${JSON.stringify(good().packages)},"__proto__":{"a":1}}`);
    await unreadable(`{"state":"verified","registryBaseUrl":${JSON.stringify(REGISTRY)},"packages":[{"name":${JSON.stringify(WRITER)},"installedVersion":"1.0.0","state":"verified","reasons":[],"__proto__":{"a":1}}]}`);
    await unreadable(`{"state":"verified","registryBaseUrl":${JSON.stringify(REGISTRY)},"packages":[{"name":${JSON.stringify(WRITER)},"installedVersion":"1.0.0","state":"verified","reasons":[],"constructor":"x"}]}`);
    expect(Object.getPrototypeOf({})).toBe(before);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).a).toBeUndefined();
  });

  it("refuses an object that repeats a key", async () => {
    const packages = JSON.stringify(good().packages);
    await unreadable(`{"state":"violated","state":"verified","registryBaseUrl":${JSON.stringify(REGISTRY)},"packages":${packages}}`);
    await unreadable(`{"state":"verified","registryBaseUrl":${JSON.stringify(REGISTRY)},"packages":[{"name":"@clossys/keeper","name":${JSON.stringify(WRITER)},"installedVersion":"1.0.0","state":"verified","reasons":[]}]}`);
  });

  it("refuses output at or past the buffer limit, even when it would parse", async () => {
    const compact = JSON.stringify(good());
    const exact = `${compact}${" ".repeat(PROVENANCE_CHECK_MAX_BUFFER - compact.length)}`;
    expect(Buffer.byteLength(exact)).toBe(PROVENANCE_CHECK_MAX_BUFFER);
    await unreadable(exact);
    const under = `${compact}${" ".repeat(PROVENANCE_CHECK_MAX_BUFFER - compact.length - 1)}`;
    expect((await run(rawExit(0, under), items)).checks).toEqual([SATISFIED]);
    // Truncation in the middle of a multi-byte character still lands at or past the limit.
    await unreadable(`${compact}${"é".repeat(PROVENANCE_CHECK_MAX_BUFFER)}`);
    await unreadable(`${compact}${" ".repeat(PROVENANCE_CHECK_MAX_BUFFER)}`, 1);
  });

  it("refuses a registry other than the one passed", async () => {
    await unreadable(printed(report("verified", [verifiedPackage(WRITER, "1.0.0")], `${REGISTRY}/`)));
    await unreadable(printed(report("verified", [verifiedPackage(WRITER, "1.0.0")], "https://registry.example.invalid")));
    await unreadable(printed(report("verified", [verifiedPackage(WRITER, "1.0.0")], "")));
    await unreadable(printed({ ...good(), registryBaseUrl: null }));
    await unreadable(printed({ ...good(), registryBaseUrl: 1 }));
  });

  it("refuses a top-level state that is not one of the three", async () => {
    for (const state of ["ok", "", "Verified", "satisfied", null, 0, ["verified"]]) await unreadable(printed({ ...good(), state }));
  });

  it("refuses a packages value that is not an array of well-formed entries", async () => {
    await unreadable(printed({ ...good(), packages: {} }));
    await unreadable(printed({ ...good(), packages: null }));
    await unreadable(printed({ ...good(), packages: ["@clossys/writer"] }));
    await unreadable(printed({ ...good(), packages: [null] }));
    await unreadable(printed({ ...good(), packages: [[]] }));
    await unreadable(printed({ ...good(), packages: [{ ...verifiedPackage(WRITER, "1.0.0"), extra: true }] }));
    await unreadable(printed({ ...good(), packages: [{ installedVersion: "1.0.0", state: "verified", reasons: [] }] }));
    await unreadable(printed({ ...good(), packages: [{ name: WRITER, state: "verified", reasons: [] }] }));
    await unreadable(printed({ ...good(), packages: [{ name: WRITER, installedVersion: "1.0.0", reasons: [] }] }));
    await unreadable(printed({ ...good(), packages: [{ name: WRITER, installedVersion: "1.0.0", state: "verified" }] }));
    await unreadable(printed({ ...good(), packages: [{ name: 1, installedVersion: "1.0.0", state: "verified", reasons: [] }] }));
    await unreadable(printed({ ...good(), packages: [{ name: WRITER, installedVersion: 1, state: "verified", reasons: [] }] }));
    await unreadable(printed({ ...good(), packages: [{ name: WRITER, installedVersion: "1.0.0", state: "fine", reasons: [] }] }));
    await unreadable(printed({ ...good(), packages: [{ name: WRITER, installedVersion: "1.0.0", state: "verified", reasons: "none" }] }));
    await unreadable(printed({ ...good(), packages: [{ name: WRITER, installedVersion: "1.0.0", state: "verified", reasons: [1] }] }));
    await unreadable(printed({ ...good(), packages: [{ ...verifiedPackage(WRITER, "1.0.0"), latestVersion: 2 }] }));
    await unreadable(printed({ ...good(), packages: [{ ...verifiedPackage(WRITER, "1.0.0"), currencyDistance: {} }] }));
  });

  it("accepts the optional fields the bin emits", async () => {
    const withOptional = report("verified", [{ ...verifiedPackage(WRITER, "1.0.0"), latestVersion: "1.2.0", currencyDistance: "minor" }]);
    expect((await run(rawExit(0, printed(withOptional)), items)).checks).toEqual([SATISFIED]);
    const bare = report("verified", [{ name: WRITER, installedVersion: "1.0.0", state: "verified", reasons: [] }]);
    expect((await run(rawExit(0, printed(bare)), items)).checks).toEqual([SATISFIED]);
  });

  it("refuses a report whose contents contradict the exit code", async () => {
    const contradicts = indeterminate("report-contradicts-exit");
    const legacy = violatedPackage(LEGACY, "0.1.0");
    // Exit 0: top verified, non-empty, every package verified.
    expect((await run(exitWith(0, report("verified", [verifiedPackage(WRITER, "1.0.0"), legacy])), items)).checks).toEqual([contradicts]);
    expect((await run(exitWith(0, report("violated", [verifiedPackage(WRITER, "1.0.0")])), items)).checks).toEqual([contradicts]);
    expect((await run(exitWith(0, report("indeterminate", [verifiedPackage(WRITER, "1.0.0")])), items)).checks).toEqual([contradicts]);
    expect((await run(exitWith(0, report("verified", [])), items)).checks).toEqual([contradicts]);
    expect((await run(exitWith(0, report("verified", [verifiedPackage(WRITER, "1.0.0"), { name: LEGACY, installedVersion: "0.1.0", state: "indeterminate", reasons: [] }])), items)).checks).toEqual([contradicts]);
    // Exit 1: top violated, at least one violated package, no indeterminate package.
    expect((await run(exitWith(1, report("verified", [verifiedPackage(WRITER, "1.0.0"), legacy])), items)).checks).toEqual([contradicts]);
    expect((await run(exitWith(1, report("verified", [violatedPackage(WRITER, "1.0.0")])), items)).checks).toEqual([contradicts]);
    expect((await run(exitWith(1, report("violated", [verifiedPackage(WRITER, "1.0.0")])), items)).checks).toEqual([contradicts]);
    expect((await run(exitWith(1, report("violated", [])), items)).checks).toEqual([contradicts]);
    expect((await run(exitWith(1, report("indeterminate", [violatedPackage(WRITER, "1.0.0")])), items)).checks).toEqual([contradicts]);
    expect((await run(exitWith(1, report("violated", [violatedPackage(WRITER, "1.0.0"), { name: LEGACY, installedVersion: "0.1.0", state: "indeterminate", reasons: [] }])), items)).checks).toEqual([contradicts]);
  });
});

describe("checkSetProvenance: per gated package", () => {
  it("a violated gated package is violated", async () => {
    const { checks } = await run(exitWith(1, report("violated", [violatedPackage(WRITER, "1.0.0")])), [packageItem(WRITER, "1.0.0")]);
    expect(checks).toEqual([violated("provenance-unverified")]);
  });

  it("a gated package missing from the report is indeterminate", async () => {
    const { checks } = await run(exitWith(0, verifiedReport([DESIGNER, "1.0.0"])), [packageItem(WRITER, "1.0.0")]);
    expect(checks).toEqual([indeterminate("package-not-in-report")]);
    expect((await run(exitWith(1, report("violated", [violatedPackage(DESIGNER, "1.0.0")])), [packageItem(WRITER, "1.0.0")])).checks).toEqual([indeterminate("package-not-in-report")]);
  });

  it("a verified version other than the act's is a version mismatch", async () => {
    expect((await run(exitWith(0, verifiedReport([WRITER, "1.0.1"])), [packageItem(WRITER, "1.0.0")])).checks).toEqual([violated("version-mismatch")]);
    expect((await run(exitWith(0, verifiedReport([WRITER, "1.0.0-rc.1"])), [packageItem(WRITER, "1.0.0")])).checks).toEqual([violated("version-mismatch")]);
  });

  it("one entry at the act's version and another at a different version is still a mismatch", async () => {
    expect((await run(exitWith(0, verifiedReport([WRITER, "1.0.0"], [WRITER, "0.9.0"])), [packageItem(WRITER, "1.0.0")])).checks).toEqual([violated("version-mismatch")]);
  });

  it("an unverified report entry at another version is a version mismatch, not an unverified package", async () => {
    const { checks } = await run(exitWith(1, report("violated", [violatedPackage(WRITER, "0.9.0")])), [packageItem(WRITER, "1.0.0")]);
    expect(checks).toEqual([violated("version-mismatch")]);
  });

  it("an unrelated violated legacy pin does not gate when every gated package is verified", async () => {
    const { checks } = await run(exitWith(1, report("violated", [verifiedPackage(WRITER, "1.0.0"), violatedPackage(LEGACY, "0.1.0")])), [packageItem(WRITER, "1.0.0")]);
    expect(checks).toEqual([SATISFIED]);
  });

  it("an unrelated legacy pin at any version does not gate, and neither does an extra base-satisfied package", async () => {
    const { checks } = await run(
      exitWith(1, report("violated", [verifiedPackage(WRITER, "1.0.0"), verifiedPackage(DESIGNER, "2.0.0"), violatedPackage(LEGACY, "0.0.1")])),
      [packageItem(WRITER, "1.0.0"), packageItem(DESIGNER, "2.0.0", { satisfiedInBase: true })],
    );
    expect(checks).toEqual([SATISFIED]);
  });

  it("checks each of several gated packages", async () => {
    const both = [packageItem(WRITER, "1.0.0"), packageItem(DESIGNER, "2.0.0")];
    expect((await run(exitWith(0, verifiedReport([WRITER, "1.0.0"], [DESIGNER, "2.0.0"])), both)).checks).toEqual([SATISFIED]);
    expect((await run(exitWith(0, verifiedReport([WRITER, "1.0.0"])), both)).checks).toEqual([indeterminate("package-not-in-report")]);
    expect((await run(exitWith(1, report("violated", [verifiedPackage(WRITER, "1.0.0"), violatedPackage(DESIGNER, "2.0.0")])), both)).checks).toEqual([violated("provenance-unverified")]);
  });
});

describe("checkSetProvenance: an unverified package is never excepted (D20 is not implemented)", () => {
  const items = [packageItem(WRITER, "2.0.0")];
  const failedAttestation = exitWith(1, report("violated", [violatedPackage(WRITER, "2.0.0")]));
  const undecided = exitWith(2, report("indeterminate", [{ name: WRITER, installedVersion: "2.0.0", state: "indeterminate", reasons: ["attestations endpoint unreachable"] }]));
  // What the snapshot step really writes for a package with earlier releases: the one version `latest` names, with attestations.
  const latestOnly = snapshotOf([{ name: WRITER, versions: ["2.0.0"] }]);
  const attested: RegistrySnapshot = { ...latestOnly, packages: latestOnly.packages.map((entry) => ({ ...entry, versions: entry.versions.map((version) => ({ ...version, hasAttestations: true })) })) };
  // Inputs the gate used to accept for the exception. It no longer has them, and passing them changes nothing.
  const formerInputs = (baseLedger: unknown): Partial<ProvenanceGateInput> => ({ baseLedger, snapshot: attested, planSnapshotDigest: registrySnapshotDigest(attested) }) as unknown as Partial<ProvenanceGateInput>;

  it("a package with prior releases whose latest fails attestation verification is violated, whether or not the base has a row for it", async () => {
    expect((await run(failedAttestation, items)).checks).toEqual([violated("provenance-unverified")]);
    expect((await run(failedAttestation, items, formerInputs(null))).checks).toEqual([violated("provenance-unverified")]);
    expect((await run(failedAttestation, items, formerInputs({ packages: [] }))).checks).toEqual([violated("provenance-unverified")]);
    expect((await run(failedAttestation, items, formerInputs({ packages: [{ name: DESIGNER }] }))).checks).toEqual([violated("provenance-unverified")]);
  });

  it("a package with no attestations at all is violated too: an unattested first publication blocks", async () => {
    const unattested = snapshotOf([{ name: WRITER, versions: ["1.0.0"] }]);
    const answer = exitWith(1, report("violated", [violatedPackage(WRITER, "1.0.0")]));
    const inputs = { baseLedger: null, snapshot: unattested, planSnapshotDigest: registrySnapshotDigest(unattested) } as unknown as Partial<ProvenanceGateInput>;
    expect((await run(answer, [packageItem(WRITER, "1.0.0")], inputs)).checks).toEqual([violated("provenance-unverified")]);
  });

  it("a package Integrator cannot decide is indeterminate, never satisfied", async () => {
    expect((await run(undecided, items)).checks).toEqual([indeterminate("engine-indeterminate")]);
    expect((await run(undecided, items, formerInputs(null))).checks).toEqual([indeterminate("engine-indeterminate")]);
    const contradictory = exitWith(1, report("violated", [{ name: WRITER, installedVersion: "2.0.0", state: "indeterminate", reasons: [] }]));
    expect((await run(contradictory, items, formerInputs(null))).checks).toEqual([indeterminate("report-contradicts-exit")]);
  });

  it("one unverified package makes the whole set violated, though the others are verified", async () => {
    const both = [packageItem(DESIGNER, "2.0.0"), packageItem(WRITER, "1.0.0")];
    const answer = exitWith(1, report("violated", [verifiedPackage(DESIGNER, "2.0.0"), violatedPackage(WRITER, "1.0.0")]));
    expect((await run(answer, both)).checks).toEqual([violated("provenance-unverified")]);
  });

  it("no result carries a rule on a satisfied entry, and none names an exception", async () => {
    const answers = [failedAttestation, undecided, exitWith(0, verifiedReport([WRITER, "2.0.0"]))];
    for (const answer of answers) {
      for (const check of (await run(answer, items, formerInputs(null))).checks) {
        if (check.verdict === "satisfied") expect(check).toEqual(SATISFIED);
        expect(JSON.stringify(check)).not.toContain("exception");
      }
    }
  });

  it("stray or malformed input fields, such as a ledger that is not a ledger, can neither throw nor change the verdict", async () => {
    const malformed: unknown[] = [undefined, "ledger", 7, [], {}, { packages: null }, { packages: "x" }, { packages: {} }, { packages: [null] }, { packages: [7] }, { packages: [{}] }, { packages: [{ name: 7 }] }, { packages: [{ name: WRITER }] }];
    const verified = exitWith(0, verifiedReport([WRITER, "2.0.0"]));
    for (const baseLedger of malformed) {
      const stray = { baseLedger, snapshot: null, planSnapshotDigest: 7 } as unknown as Partial<ProvenanceGateInput>;
      expect((await run(verified, items, stray)).checks, JSON.stringify(baseLedger)).toEqual([SATISFIED]);
      expect((await run(failedAttestation, items, stray)).checks, JSON.stringify(baseLedger)).toEqual([violated("provenance-unverified")]);
      expect((await run(undecided, items, stray)).checks, JSON.stringify(baseLedger)).toEqual([indeterminate("engine-indeterminate")]);
    }
  });
});

describe("checkSetProvenance: aggregation", () => {
  it("indeterminate wins over violated, and only the indeterminate entries are returned", async () => {
    const both = [packageItem(WRITER, "1.0.0"), packageItem(DESIGNER, "2.0.0")];
    const answer = exitWith(1, report("violated", [violatedPackage(WRITER, "1.0.0")]));
    expect((await run(answer, both)).checks).toEqual([indeterminate("package-not-in-report")]);
  });

  it("returns each distinct rule once, sorted by rule", async () => {
    const three = [packageItem(WRITER, "1.0.0"), packageItem(DESIGNER, "2.0.0"), packageItem("@clossys/giver", "3.0.0")];
    const mixedViolations = exitWith(1, report("violated", [verifiedPackage(WRITER, "1.0.0"), violatedPackage(DESIGNER, "2.0.0"), verifiedPackage("@clossys/giver", "3.0.1")]));
    expect((await run(mixedViolations, three)).checks).toEqual([violated("provenance-unverified"), violated("version-mismatch")]);
    const twoMissing = exitWith(0, verifiedReport([WRITER, "1.0.0"]));
    expect((await run(twoMissing, three)).checks).toEqual([indeterminate("package-not-in-report")]);
  });

  it("never returns a satisfied entry beside a refusal", async () => {
    const both = [packageItem(WRITER, "1.0.0"), packageItem(DESIGNER, "2.0.0")];
    const answer = exitWith(1, report("violated", [verifiedPackage(WRITER, "1.0.0"), violatedPackage(DESIGNER, "2.0.0")]));
    const { checks } = await run(answer, both);
    expect(checks.every((check) => check.check === "V9" && check.verdict !== "satisfied")).toBe(true);
  });
});

describe("registrySnapshotDigest", () => {
  interface Corpus {
    digests: { name: string; snapshot: RegistrySnapshot; canonical: string; digest: string }[];
  }
  const corpus = JSON.parse(readRepositoryFile("docs/contracts/registry-snapshot.fixture.json")) as Corpus;

  it("equals the shared corpus's digest for every valid snapshot", () => {
    expect(corpus.digests.length).toBeGreaterThan(0);
    for (const entry of corpus.digests) expect(registrySnapshotDigest(entry.snapshot), entry.name).toBe(entry.digest);
  });

  it("does not change with fetchedAt, fetchedBy or responseSha256", () => {
    const base = snapshotOf([{ name: WRITER, versions: ["1.0.0"] }, { name: DESIGNER, versions: ["2.0.0"] }]);
    const changed: RegistrySnapshot = {
      ...base,
      fetchedAt: "2030-01-01T00:00:00Z",
      fetchedBy: { name: "@clossys/observer", version: "9.9.9" },
      packages: base.packages.map((entry) => ({ ...entry, responseSha256: `sha256:${"b".repeat(64)}` })),
    };
    expect(registrySnapshotDigest(changed)).toBe(registrySnapshotDigest(base));
  });

  it("does not change with the order packages or versions are written in", () => {
    const base = snapshotOf([{ name: WRITER, versions: ["0.9.0", "1.0.0"] }, { name: DESIGNER, versions: ["2.0.0"] }]);
    const reordered: RegistrySnapshot = { ...base, packages: [...base.packages].reverse().map((entry) => ({ ...entry, versions: [...entry.versions].reverse() })) };
    expect(registrySnapshotDigest(reordered)).toBe(registrySnapshotDigest(base));
  });

  it("changes with the versions, the registry, or a package", () => {
    const base = snapshotOf([{ name: WRITER, versions: ["1.0.0"] }]);
    const digest = registrySnapshotDigest(base);
    expect(registrySnapshotDigest(snapshotOf([{ name: WRITER, versions: ["1.0.0", "1.0.1"] }]))).not.toBe(digest);
    expect(registrySnapshotDigest(snapshotOf([{ name: WRITER, versions: ["1.0.1"] }]))).not.toBe(digest);
    expect(registrySnapshotDigest(snapshotOf([{ name: DESIGNER, versions: ["1.0.0"] }]))).not.toBe(digest);
    expect(registrySnapshotDigest({ ...base, registry: "https://registry.example.invalid" })).not.toBe(digest);
    const integrityChanged: RegistrySnapshot = { ...base, packages: base.packages.map((entry) => ({ ...entry, versions: entry.versions.map((version) => ({ ...version, integrity: `sha512-${"B".repeat(86)}==` })) })) };
    expect(registrySnapshotDigest(integrityChanged)).not.toBe(digest);
  });

  it("is sha256: and 64 lowercase hexadecimal digits", () => {
    expect(registrySnapshotDigest(snapshotOf([{ name: WRITER, versions: ["1.0.0"] }]))).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("refuses a snapshot that does not validate, with a TypeError", () => {
    const base = snapshotOf([{ name: WRITER, versions: ["1.0.0"] }]);
    expect(() => registrySnapshotDigest({ ...base, packages: [...base.packages, ...base.packages] })).toThrow(TypeError);
    expect(() => registrySnapshotDigest({ ...base, extra: true } as unknown as RegistrySnapshot)).toThrow(TypeError);
    expect(() => registrySnapshotDigest(null as unknown as RegistrySnapshot)).toThrow(TypeError);
    expect(() => registrySnapshotDigest({ ...base, packages: [] })).toThrow(TypeError);
  });

  it("does not mutate the snapshot it is given", () => {
    const base = snapshotOf([{ name: WRITER, versions: ["1.0.0", "0.9.0"] }, { name: DESIGNER, versions: ["2.0.0"] }]);
    const before = JSON.stringify(base);
    registrySnapshotDigest(base);
    expect(JSON.stringify(base)).toBe(before);
  });
});
