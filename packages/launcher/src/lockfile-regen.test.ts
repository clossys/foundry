import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, lstatSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PACKAGE_SCOPE } from "./generated/package-scope.generated.js";
import type { LockfileInvariantPackage } from "./lockfile-invariants.js";
import {
  LOCKFILE_OUTPUT_TAIL_BYTES,
  regenerateLockfile,
  scanRepositoryConfig,
  spawnLockfileTool,
  type LockfileRegenInput,
  type LockfileRegenResult,
  type LockfileSpawn,
  type LockfileSpawnRequest,
  type LockfileSpawnResult,
} from "./lockfile-regen.js";
import { LOCKFILE_TOOL_ENV_KEYS } from "./lockfile-tool-env.js";

const scope = PACKAGE_SCOPE.scope;
const DEAD = "http://127.0.0.1:9/";
const temporary: string[] = [];
const sha256hex = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");

function tempDir(prefix: string): string {
  const path = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), prefix)));
  temporary.push(path);
  return path;
}

afterAll(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Every entry under root, relative, with a content digest for files; the same view the runner's footprint check takes. */
function treeView(root: string, relative = ""): Record<string, string> {
  const view: Record<string, string> = {};
  for (const name of readdirSync(join(root, relative)).sort()) {
    const path = relative === "" ? name : `${relative}/${name}`;
    const stats = lstatSync(join(root, path));
    if (stats.isDirectory()) Object.assign(view, { [path]: "dir" }, treeView(root, path));
    else view[path] = stats.isFile() ? sha256hex(readFileSync(join(root, path))) : "other";
  }
  return view;
}

// ---------------------------------------------------------------------------
// Configuration scan
// ---------------------------------------------------------------------------

describe("scanRepositoryConfig", () => {
  // -------------------------------------------------------------------------
  // .npmrc: strict allow-list grammar that fails closed (fix 1).
  // -------------------------------------------------------------------------

  const npmrcRefusals: readonly (readonly [string, string])[] = [
    ["git hidden by a lone CR", "color=false\rgit=./evil.sh\n"],
    ["git hidden by an unescaped ;", "git;x=./evil.sh\n"],
    ["git hidden by an unescaped #", "git#x=./evil.sh\n"],
    ["git hidden by a quoted key", '"git"=./evil.sh\n'],
    ["strict-ssl hidden by a lone CR", "a=b\rstrict-ssl=false\n"],
    ["strict-ssl with a trailing ;", "strict-ssl=false ;x\n"],
    ["a host-prefixed credential hidden by a lone CR", "a=b\r//registry.example/:_authToken=abc\n"],
  ];
  it.each(npmrcRefusals)(".npmrc %s is refused (never refused: false)", (_label, npmrc) => {
    expect(scanRepositoryConfig({ npmrc })).toMatchObject({ refused: true });
  });

  const npmrcUnrecognized: readonly (readonly [string, string])[] = [
    ["a non-ASCII byte", "registry=café\n"],
    ["a section header", "[registry]\ngit=./evil.sh\n"],
    ["a quoted key", '"cafile"=fixture.pem\n'],
    ["a quoted value", 'color="true"\n'],
    ["key[]=v", "ca[]=fixture\n"],
    ["a bare key", "git\n"],
    ["a duplicate key", "color=true\ncolor=false\n"],
    ["${ substitution", "registry=${FIXTURE_REGISTRY}\n"],
    ["${ substitution in a comment", "# ${FIXTURE}\n"],
    ["an unlisted key", "registry=https://fixture.invalid/\n"],
    ["a listed key with a bad value", "engine-strict=yes\n"],
    ["_auth (fails the key grammar, not a recognized credential)", "_auth=dXNlcjpwYXNz\n"],
    ["host-prefixed _authToken (fails the key grammar)", "//fixture.invalid/:_authToken=fixture\n"],
    ["scope-prefixed _authToken (fails the key grammar)", `${scope}:_authToken=fixture\n`],
    ["strict-ssl=true (not on the allow-list at all)", "strict-ssl=true\n"],
  ];
  it.each(npmrcUnrecognized)(".npmrc %s is package-manager-config-unrecognized", (_label, npmrc) => {
    expect(scanRepositoryConfig({ npmrc })).toMatchObject({ refused: true, reason: "package-manager-config-unrecognized" });
  });

  const npmrcCredential: readonly (readonly [string, string])[] = [
    ["username", "username=fixture\n"],
    ["certfile", "certfile=cert.pem\n"],
    ["keyfile", "keyfile=key.pem\n"],
  ];
  it.each(npmrcCredential)(".npmrc %s (inside the grammar, not on the allow-list) needs a credential", (_label, npmrc) => {
    expect(scanRepositoryConfig({ npmrc })).toMatchObject({ refused: true, reason: "registry-config-needs-credential" });
  });

  it(".npmrc accepts every allow-listed key with a valid value, plus blank and comment lines", () => {
    const npmrc = [
      "engine-strict=true",
      "save-exact=false",
      "save-prefix=^",
      "legacy-peer-deps=true",
      "strict-peer-deps=false",
      "auto-install-peers=true",
      "strict-peer-dependencies=false",
      "fund=true",
      "audit=false",
      "update-notifier=true",
      "progress=false",
      "loglevel=info",
      "color=always",
      "min-release-age=7",
      "before=2020-01-01",
      "",
      "# a comment",
      "; another comment",
      "",
    ].join("\n");
    expect(scanRepositoryConfig({ npmrc })).toEqual({ refused: false, minReleaseAge: true, before: true });
  });

  it.each([["empty", ""]])(".npmrc %s is accepted", (_label, npmrc) => {
    expect(scanRepositoryConfig({ npmrc })).toEqual({ refused: false, minReleaseAge: false, before: false });
  });

  it("reports min-release-age and before, and not min-release-age-exclude", () => {
    expect(scanRepositoryConfig({ npmrc: "min-release-age=7\n" })).toEqual({ refused: false, minReleaseAge: true, before: false });
    expect(scanRepositoryConfig({ npmrc: "before=2020-01-01\n" })).toEqual({ refused: false, minReleaseAge: false, before: true });
    expect(scanRepositoryConfig({ npmrc: `min-release-age-exclude=${scope}/*\n` })).toMatchObject({ refused: true, reason: "package-manager-config-unrecognized" });
  });

  it("lets a credential finding win over an unrecognized one, in one file and across files", () => {
    expect(scanRepositoryConfig({ npmrc: "git=./evil.sh\nusername=fixture\n" })).toMatchObject({ reason: "registry-config-needs-credential" });
    expect(scanRepositoryConfig({ pnpmWorkspace: "configDependencies:\n  fixture: 1.0.0\n", npmrc: "username=fixture\n" })).toMatchObject({ reason: "registry-config-needs-credential" });
  });

  it("lets an unrecognized .npmrc finding win over pnpm-workspace.yaml's unsafe one (file scan order)", () => {
    expect(scanRepositoryConfig({ pnpmWorkspace: "configDependencies:\n  fixture: 1.0.0\n", npmrc: "registry=https://fixture.invalid/\n" })).toMatchObject({ reason: "package-manager-config-unrecognized" });
  });

  // -------------------------------------------------------------------------
  // pnpm-workspace.yaml: restricted block-mapping grammar (fix 2).
  // -------------------------------------------------------------------------

  it.each([
    ["document marker + flow mapping", "--- {configDependencies: {x: 1.0.0}}\n"],
    ["%YAML directive + flow mapping", "%YAML 1.2\n---\n{configDependencies: {x: 1.0.0}}\n"],
    ["!!str tag", "!!str configDependencies:\n  x: 1.0.0\n"],
    ["quoted key with a hex escape", '"config\\x44ependencies":\n  x: 1.0.0\n'],
    ["configDependencies hidden by a lone CR", "a: 1\rconfigDependencies:\r  x: 1.0.0\r"],
  ])("pnpm-workspace.yaml bypass: %s is refused", (_label, pnpmWorkspace) => {
    expect(scanRepositoryConfig({ pnpmWorkspace })).toMatchObject({ refused: true, reason: "package-manager-config-unsafe" });
  });

  it.each([
    ["top-level configDependencies", "packages:\n  - 'packages/*'\nconfigDependencies:\n  fixture: 1.0.0+sha512-x\n", true],
    ["quoted configDependencies", '"configDependencies": {}\n', true],
    ["flow-mapping configDependencies", "{packages: ['packages/*'], configDependencies: {}}\n", true],
    ["top-level merge key", "base: &base\n  x: 1\n<<: *base\n", true],
    ["top-level quoted key", "'packages':\n  - 'a'\n", true],
    ["tagged key", "!!str packages:\n  - 'a'\n", true],
    ["trailing comment", "packages: # comment\n  - 'a'\n", true],
    ["tab indent", "packages:\n\t- 'a'\n", true],
    ["double-quoted value", 'packages:\n  - "a"\n', true],
    ["flow-sequence packages", "packages: ['a']\n", true],
    ["unlisted top-level key", "strictSsl: false\n", true],
    ["nested configDependencies", "catalog:\n  configDependencies: 1.0.0\n", false],
    ["commented configDependencies", "# configDependencies:\npackages:\n  - 'packages/*'\n", false],
    ["plain workspace", "packages:\n  - 'packages/*'\n", false],
  ])("pnpm-workspace.yaml %s", (_label, pnpmWorkspace, refused) => {
    const scan = scanRepositoryConfig({ pnpmWorkspace });
    if (refused) expect(scan).toMatchObject({ refused: true, reason: "package-manager-config-unsafe" });
    else expect(scan).toEqual({ refused: false, minReleaseAge: false, before: false });
  });

  it("accepts a file pnpm itself writes: packages, catalog, catalogs, onlyBuiltDependencies and a minimumReleaseAgeExclude entry", () => {
    const pnpmWorkspace = [
      "packages:",
      "  - 'packages/*'",
      "  - '!**/test/**'",
      "catalog:",
      `  '${scope}/fixture-dep': ^1.0.0`,
      "catalogs:",
      "  legacy:",
      `    '${scope}/fixture-dep': 1.0.0`,
      "onlyBuiltDependencies:",
      "  - esbuild",
      "minimumReleaseAgeExclude:",
      `  - '${scope}/*'`,
      "",
    ].join("\n");
    expect(scanRepositoryConfig({ pnpmWorkspace })).toEqual({ refused: false, minReleaseAge: false, before: false });
  });

  // -------------------------------------------------------------------------
  // .yarnrc.yml: the same restricted grammar as fix 2 (fix 3).
  // -------------------------------------------------------------------------

  it.each([
    ["document marker + flow mapping", "--- {yarnPath: ./x.cjs}\n"],
    ["!!str tag", "!!str yarnPath: ./x.cjs\n"],
    ["quoted key with a hex escape", '"yarn\\x50ath": ./x.cjs\n'],
    ["yarnPath hidden by a lone CR", "a: 1\ryarnPath: ./x.cjs\r"],
  ])(".yarnrc.yml bypass: %s is refused", (_label, yarnrc) => {
    expect(scanRepositoryConfig({ yarnrc })).toMatchObject({ refused: true });
  });

  it.each([
    ["npmAuthToken", "npmAuthToken: fixture\n", "registry-config-needs-credential"],
    ["npmAuthIdent", "npmAuthIdent: fixture\n", "registry-config-needs-credential"],
    ["nested npmAuthToken", `npmScopes:\n  ${scope.slice(1)}:\n    npmAuthToken: fixture\n`, "registry-config-needs-credential"],
    ["${ substitution (now unrecognized, same as .npmrc)", "npmRegistryServer: ${FIXTURE}\n", "package-manager-config-unrecognized"],
    ["yarnPath", "yarnPath: .yarn/releases/fixture.cjs\n", "package-manager-config-unrecognized"],
    ["plugins", "plugins:\n  - path: fixture.cjs\n", "package-manager-config-unrecognized"],
    ["httpsProxy", "httpsProxy: http://127.0.0.1:9/\n", "package-manager-config-unrecognized"],
    ["npmRegistryServer", "npmRegistryServer: https://fixture.invalid/\n", "package-manager-config-unrecognized"],
    ["nodeLinker", "nodeLinker: node-modules\n", null],
    ["enableTelemetry: false", "enableTelemetry: false\n", null],
    ["enableTelemetry: true (only false is allowed)", "enableTelemetry: true\n", "package-manager-config-unrecognized"],
    ["enableGlobalCache", "enableGlobalCache: true\n", null],
    ["npmPreapprovedPackages", `npmPreapprovedPackages:\n  - '${scope}/fixture-dep'\n`, null],
  ])(".yarnrc.yml %s", (_label, yarnrc, reason) => {
    const scan = scanRepositoryConfig({ yarnrc });
    if (reason === null) expect(scan).toEqual({ refused: false, minReleaseAge: false, before: false });
    else expect(scan).toMatchObject({ refused: true, reason });
  });
});

// ---------------------------------------------------------------------------
// Spawn port
// ---------------------------------------------------------------------------

describe("spawnLockfileTool", () => {
  const base = { cwd: realpathSync(tmpdir()), env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, maxBuffer: 2_000_000 };

  it("captures output and status with shell false", async () => {
    const result = await spawnLockfileTool({ ...base, command: process.execPath, args: ["-e", "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)"], timeoutMs: 30_000 });
    expect(result).toEqual({ status: 3, stdout: "out", stderr: "err" });
  });

  it("kills at timeoutMs with SIGKILL and reports timeout", async () => {
    const started = Date.now();
    const result = await spawnLockfileTool({ ...base, command: process.execPath, args: ["-e", "setTimeout(()=>{},10000)"], timeoutMs: 200 });
    expect(result.failure).toBe("timeout");
    expect(result.status).toBeNull();
    expect(Date.now() - started).toBeLessThan(8_000);
  });

  it("settles with failure timeout, after the grace period, when a detached grandchild keeps the pipe open", async () => {
    const dir = tempDir("lockfile-regen-grace-");
    const pidFile = join(dir, "gc.pid");
    // The immediate child spawns a detached grandchild sharing its own stdout/stderr fds, then exits at once.
    // The grandchild outlives it and is in a different process group, so SIGKILL to the child's group never
    // reaches it and `close` never fires on the immediate child alone.
    const script = [
      'const { spawn } = require("node:child_process");',
      'const fs = require("node:fs");',
      'const gc = spawn(process.execPath, ["-e", "setInterval(()=>{}, 100000)"], { detached: true, stdio: ["ignore", 1, 2] });',
      `fs.writeFileSync(${JSON.stringify(pidFile)}, String(gc.pid));`,
      "gc.unref();",
      "process.exit(0);",
    ].join(" ");
    const started = Date.now();
    let result: LockfileSpawnResult | undefined;
    try {
      result = await spawnLockfileTool({ ...base, command: process.execPath, args: ["-e", script], timeoutMs: 200 });
      expect(result.failure).toBe("timeout");
      expect(result.status).toBeNull();
      expect(Date.now() - started).toBeLessThan(8_000);
    } finally {
      try {
        const pid = Number(readFileSync(pidFile, "utf8"));
        if (Number.isInteger(pid)) process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }, 15_000);

  it("reports a missing command as not-found", async () => {
    const result = await spawnLockfileTool({ ...base, command: "launcher-lockfile-no-such-command", args: [], timeoutMs: 30_000 });
    expect(result.failure).toBe("not-found");
  });

  it("keeps at most maxBuffer bytes per stream", async () => {
    const result = await spawnLockfileTool({ ...base, maxBuffer: 10, command: process.execPath, args: ["-e", "process.stdout.write('x'.repeat(100000))"], timeoutMs: 30_000 });
    expect(result.stdout).toBe("x".repeat(10));
    expect(result.status).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Preconditions and runner behaviour with fake tools
// ---------------------------------------------------------------------------

const FAKE_BASE = '{\n  "name": "fixture",\n  "lockfileVersion": 3,\n  "packages": {}\n}\n';

function fakeRoot(options: { lockfile?: string; base?: string } = {}): string {
  const root = tempDir("lockfile-regen-root-");
  writeJson(join(root, "package.json"), { name: "fixture", version: "1.0.0", private: true });
  writeFileSync(join(root, options.lockfile ?? "package-lock.json"), options.base ?? FAKE_BASE);
  return root;
}

function npmInput(root: string, overrides: Partial<LockfileRegenInput> = {}): LockfileRegenInput {
  return { root, packageManager: "npm", lockfile: "package-lock.json", toolVersion: null, baseLockfile: FAKE_BASE, packages: [], now: () => new Date("2026-01-02T03:04:05.000Z"), ...overrides };
}

interface Recorder {
  readonly calls: LockfileSpawnRequest[];
  readonly spawn: LockfileSpawn;
}

/** A fake tool: answers `--version`, then runs `install` against the request. */
function fakeTool(install: (request: LockfileSpawnRequest) => LockfileSpawnResult | Promise<LockfileSpawnResult>, version = "11.0.0"): Recorder {
  const calls: LockfileSpawnRequest[] = [];
  return {
    calls,
    spawn: async (request) => {
      calls.push(request);
      if (request.args.includes("--version")) return { status: 0, stdout: `${version}\n`, stderr: "" };
      return install(request);
    },
  };
}

const ok: LockfileSpawnResult = { status: 0, stdout: "", stderr: "" };
const scratchOf = (request: LockfileSpawnRequest): string => dirname(request.env.HOME ?? "");

describe("regenerateLockfile preconditions", () => {
  const never: LockfileSpawn = () => { throw new Error("spawn must not be called"); };

  it("refuses packageManager none as manifest-absent", async () => {
    expect(await regenerateLockfile(npmInput(fakeRoot(), { packageManager: "none", lockfile: "none" }), { spawn: never })).toEqual({ verdict: "indeterminate", reason: "manifest-absent", tooling: null });
  });

  it("refuses a non-canonical root", async () => {
    const root = fakeRoot();
    const link = join(tempDir("lockfile-regen-link-"), "root");
    symlinkSync(root, link);
    for (const candidate of ["relative/root", `${root}/`, link, join(root, "package.json"), join(root, "missing")]) {
      expect(await regenerateLockfile(npmInput(candidate), { spawn: never }), candidate).toMatchObject({ verdict: "indeterminate", reason: "root-not-canonical" });
    }
  });

  it("refuses a missing or linked package.json as manifest-absent", async () => {
    const root = fakeRoot();
    rmSync(join(root, "package.json"));
    expect(await regenerateLockfile(npmInput(root), { spawn: never })).toMatchObject({ reason: "manifest-absent" });
    writeJson(join(root, "real.json"), {});
    symlinkSync("real.json", join(root, "package.json"));
    expect(await regenerateLockfile(npmInput(root), { spawn: never })).toMatchObject({ reason: "manifest-absent" });
  });

  it("refuses an absent lockfile, an empty base and lockfile none as lockfile-absent", async () => {
    const root = fakeRoot();
    expect(await regenerateLockfile(npmInput(root, { baseLockfile: "" }), { spawn: never })).toMatchObject({ reason: "lockfile-absent" });
    expect(await regenerateLockfile(npmInput(root, { lockfile: "none" }), { spawn: never })).toMatchObject({ reason: "lockfile-absent" });
    rmSync(join(root, "package-lock.json"));
    expect(await regenerateLockfile(npmInput(root), { spawn: never })).toMatchObject({ reason: "lockfile-absent" });
  });

  it("refuses a lockfile that is a symlink or not a regular file as lockfile-is-link", async () => {
    const root = fakeRoot();
    rmSync(join(root, "package-lock.json"));
    writeFileSync(join(root, "elsewhere.json"), FAKE_BASE);
    symlinkSync("elsewhere.json", join(root, "package-lock.json"));
    expect(await regenerateLockfile(npmInput(root), { spawn: never })).toEqual({ verdict: "indeterminate", reason: "lockfile-is-link", tooling: null });
    rmSync(join(root, "package-lock.json"));
    mkdirSync(join(root, "package-lock.json"));
    expect(await regenerateLockfile(npmInput(root), { spawn: never })).toMatchObject({ reason: "lockfile-is-link" });
  });

  it("reports a lockfile not at base as violated lockfile-not-at-base", async () => {
    const root = fakeRoot({ base: `${FAKE_BASE} ` });
    expect(await regenerateLockfile(npmInput(root), { spawn: never })).toEqual({ verdict: "violated", rule: "lockfile-not-at-base", violations: [], paths: [], tooling: null });
  });

  it("refuses a lockfile that does not belong to the package manager", async () => {
    const root = fakeRoot({ lockfile: "pnpm-lock.yaml" });
    expect(await regenerateLockfile(npmInput(root, { lockfile: "pnpm-lock.yaml" }), { spawn: never })).toMatchObject({ reason: "lockfile-format-unsupported" });
  });

  it.each([
    ["pnpm", "pnpm-lock.yaml", null],
    ["pnpm", "pnpm-lock.yaml", "^10.0.0"],
    ["pnpm", "pnpm-lock.yaml", "10"],
    ["yarn", "yarn.lock", null],
    ["yarn", "yarn.lock", "4.x"],
    ["npm", "package-lock.json", "latest"],
    ["npm", "package-lock.json", "11.0"],
  ] as const)("refuses %s with tool version %s as package-manager-version-unknown", async (packageManager, lockfile, toolVersion) => {
    const root = fakeRoot({ lockfile });
    expect(await regenerateLockfile(npmInput(root, { packageManager, lockfile, toolVersion }), { spawn: never })).toMatchObject({ verdict: "indeterminate", reason: "package-manager-version-unknown" });
  });

  it("refuses Yarn classic before any launch", async () => {
    const root = fakeRoot({ lockfile: "yarn.lock" });
    expect(await regenerateLockfile(npmInput(root, { packageManager: "yarn", lockfile: "yarn.lock", toolVersion: "1.22.22" }), { spawn: never })).toEqual({ verdict: "indeterminate", reason: "package-manager-unsupported", tooling: null });
  });

  it.each([
    ["npm", "package-lock.json", ".npmrc", "//fixture.invalid/:_authToken=fixture\n", "package-manager-config-unrecognized"],
    ["npm", "package-lock.json", ".npmrc", "username=fixture\n", "registry-config-needs-credential"],
    ["npm", "package-lock.json", ".npmrc", "registry=https://fixture.invalid/\n", "package-manager-config-unrecognized"],
    ["pnpm", "pnpm-lock.yaml", ".npmrc", "_auth=fixture\n", "package-manager-config-unrecognized"],
    ["pnpm", "pnpm-lock.yaml", "pnpm-workspace.yaml", "configDependencies:\n  fixture: 1.0.0\n", "package-manager-config-unsafe"],
    ["yarn", "yarn.lock", ".yarnrc.yml", "yarnPath: .yarn/releases/fixture.cjs\n", "package-manager-config-unrecognized"],
    ["yarn", "yarn.lock", ".yarnrc.yml", "npmAuthToken: fixture\n", "registry-config-needs-credential"],
  ] as const)("refuses %s with %s %s end to end without a launch", async (packageManager, lockfile, file, content, reason) => {
    const root = fakeRoot({ lockfile });
    writeFileSync(join(root, file), content);
    const recorder = fakeTool(() => ok);
    const toolVersion = packageManager === "npm" ? null : packageManager === "pnpm" ? "10.33.0" : "4.5.0";
    expect(await regenerateLockfile(npmInput(root, { packageManager, lockfile, toolVersion }), { spawn: recorder.spawn })).toEqual({ verdict: "indeterminate", reason, tooling: null });
    expect(recorder.calls).toEqual([]);
  });

  it("does not scan a file the tool does not read", async () => {
    const root = fakeRoot();
    writeFileSync(join(root, ".yarnrc.yml"), "yarnPath: .yarn/releases/fixture.cjs\n");
    const recorder = fakeTool(() => ({ status: 1, stdout: "", stderr: "" }));
    expect(await regenerateLockfile(npmInput(root), { spawn: recorder.spawn })).toMatchObject({ reason: "tool-failed" });
  });

  it("refuses a linked configuration file as package-manager-config-unsafe", async () => {
    const root = fakeRoot();
    writeFileSync(join(root, "shared.npmrc"), "");
    symlinkSync("shared.npmrc", join(root, ".npmrc"));
    const recorder = fakeTool(() => ok);
    expect(await regenerateLockfile(npmInput(root), { spawn: recorder.spawn })).toMatchObject({ reason: "package-manager-config-unsafe" });
    expect(recorder.calls).toEqual([]);
  });

  const COREPACK_ENV_FIXTURE = "FIXTURE_COREPACK_ENV_LINE=must-not-appear-in-refusal\n";

  it.each([
    ["npm", "package-lock.json", null],
    ["pnpm", "pnpm-lock.yaml", "10.33.0"],
    ["yarn", "yarn.lock", "4.5.0"],
  ] as const)("refuses %s when the only extra root entry is .corepack.env, before launch", async (packageManager, lockfile, toolVersion) => {
    const root = fakeRoot({ lockfile });
    writeFileSync(join(root, ".corepack.env"), COREPACK_ENV_FIXTURE);
    const recorder = fakeTool(() => ok);
    const result = await regenerateLockfile(npmInput(root, { packageManager, lockfile, toolVersion }), { spawn: recorder.spawn });
    expect(result).toEqual({ verdict: "indeterminate", reason: "package-manager-config-unsafe", tooling: null });
    expect(recorder.calls).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("must-not-appear-in-refusal");
  });

  it("refuses when .corepack.env is a symlink, before launch", async () => {
    const root = fakeRoot();
    writeFileSync(join(root, "shared.corepack.env"), COREPACK_ENV_FIXTURE);
    symlinkSync("shared.corepack.env", join(root, ".corepack.env"));
    const recorder = fakeTool(() => ok);
    const result = await regenerateLockfile(npmInput(root), { spawn: recorder.spawn });
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "package-manager-config-unsafe" });
    expect(recorder.calls).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("must-not-appear-in-refusal");
  });
});

describe("regenerateLockfile with fake tools", () => {
  it("launches npm from PATH with an allow-listed environment and no shell", async () => {
    const root = fakeRoot();
    const recorder = fakeTool(() => ({ status: 1, stdout: "", stderr: "" }));
    process.env.NODE_OPTIONS = "--require /fixture/never.cjs";
    process.env.NPM_TOKEN = "fixture";
    try {
      await regenerateLockfile(npmInput(root), { spawn: recorder.spawn, registry: "http://127.0.0.1:1/" });
    } finally {
      delete process.env.NODE_OPTIONS;
      delete process.env.NPM_TOKEN;
    }
    expect(recorder.calls.map((call) => [call.command, ...call.args])).toEqual([
      ["npm", "--version"],
      ["npm", "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund", `--${scope}:registry=http://127.0.0.1:1/`],
    ]);
    expect(recorder.calls[0]?.cwd).toBe(scratchOf(recorder.calls[0]!));
    expect(recorder.calls[1]?.cwd).toBe(root);
    for (const call of recorder.calls) {
      expect(call.timeoutMs).toBe(180_000);
      expect(call.maxBuffer).toBe(2_000_000);
      for (const key of Object.keys(call.env)) expect(LOCKFILE_TOOL_ENV_KEYS as readonly string[]).toContain(key);
    }
  });

  it("launches pnpm and Yarn through corepack at the exact version", async () => {
    const pnpmRoot = fakeRoot({ lockfile: "pnpm-lock.yaml" });
    const pnpm = fakeTool(() => ({ status: 1, stdout: "", stderr: "" }), "10.33.0");
    await regenerateLockfile(npmInput(pnpmRoot, { packageManager: "pnpm", lockfile: "pnpm-lock.yaml", toolVersion: "10.33.0" }), { spawn: pnpm.spawn });
    expect(pnpm.calls.map((call) => [call.command, ...call.args])).toEqual([
      ["corepack", "pnpm@10.33.0", "--version"],
      ["corepack", "pnpm@10.33.0", "install", "--lockfile-only", "--ignore-scripts", "--ignore-pnpmfile", `--config.${scope}:registry=${PACKAGE_SCOPE.registry.replace(/\/+$/, "")}/`, `--config.minimum-release-age-exclude=${scope}/*`],
    ]);
    expect(pnpm.calls[0]?.env.COREPACK_NPM_REGISTRY).toBe(PACKAGE_SCOPE.registry.replace(/\/+$/, ""));
  });

  it("reports Yarn berry as package-manager-unsupported after the run", async () => {
    const root = fakeRoot({ lockfile: "yarn.lock", base: "# yarn lockfile\n" });
    const recorder = fakeTool(() => ok, "4.5.0");
    const result = await regenerateLockfile(npmInput(root, { packageManager: "yarn", lockfile: "yarn.lock", toolVersion: "4.5.0", baseLockfile: "# yarn lockfile\n" }), { spawn: recorder.spawn });
    expect(result).toEqual({ verdict: "indeterminate", reason: "package-manager-unsupported", tooling: { tool: "yarn", version: "4.5.0" } });
    expect(recorder.calls.map((call) => [call.command, ...call.args])).toEqual([["corepack", "yarn@4.5.0", "--version"], ["corepack", "yarn@4.5.0", "install", "--mode=update-lockfile"]]);
  });

  it("reports a tool that also writes another file as tree-changed-outside-lockfile", async () => {
    const root = fakeRoot();
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "kept.txt"), "kept");
    writeFileSync(join(root, "mode.txt"), "mode");
    const recorder = fakeTool((request) => {
      writeFileSync(join(request.cwd, "package-lock.json"), `${FAKE_BASE}\n`);
      writeFileSync(join(request.cwd, "stray.txt"), "stray");
      writeFileSync(join(request.cwd, "src", "kept.txt"), "changed");
      chmodSync(join(request.cwd, "mode.txt"), 0o755);
      mkdirSync(join(request.cwd, "node_modules", ".cache"), { recursive: true });
      return ok;
    });
    expect(await regenerateLockfile(npmInput(root), { spawn: recorder.spawn })).toEqual({
      verdict: "violated",
      rule: "tree-changed-outside-lockfile",
      violations: [],
      paths: ["mode.txt", "node_modules", "src/kept.txt", "stray.txt"],
      tooling: { tool: "npm", version: "11.0.0" },
    });
    expect(readFileSync(join(root, "stray.txt"), "utf8")).toBe("stray");
  });

  it("ignores top-level .git and reads a pre-existing node_modules by its entry names", async () => {
    const root = fakeRoot();
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, "node_modules", "kept"), { recursive: true });
    const recorder = fakeTool((request) => {
      writeFileSync(join(request.cwd, ".git", "index"), "x");
      writeFileSync(join(request.cwd, "node_modules", "kept", "inner.txt"), "x");
      return ok;
    });
    // The footprint holds, so the run proceeds to the invariants.
    expect(await regenerateLockfile(npmInput(root), { spawn: recorder.spawn })).not.toMatchObject({ rule: "tree-changed-outside-lockfile" });
    const adding = fakeTool((request) => { mkdirSync(join(request.cwd, "node_modules", "added")); return ok; });
    expect(await regenerateLockfile(npmInput(root), { spawn: adding.spawn })).toMatchObject({ verdict: "violated", rule: "tree-changed-outside-lockfile", paths: ["node_modules"] });
  });

  it("reports a timeout as tool-timeout and removes the scratch directory", async () => {
    const root = fakeRoot();
    const recorder = fakeTool(() => ({ status: null, stdout: "partial", stderr: "", failure: "timeout" }));
    expect(await regenerateLockfile(npmInput(root), { spawn: recorder.spawn })).toEqual({ verdict: "indeterminate", reason: "tool-timeout", output: "partial", tooling: { tool: "npm", version: "11.0.0" } });
    const scratch = scratchOf(recorder.calls[0]!);
    expect(scratch).toMatch(/launcher-lockfile-/);
    expect(existsSync(scratch)).toBe(false);
  });

  it("reports a missing tool as tool-unavailable", async () => {
    const root = fakeRoot();
    const missing: LockfileSpawn = async () => ({ status: null, stdout: "", stderr: "", failure: "not-found" });
    expect(await regenerateLockfile(npmInput(root), { spawn: missing })).toEqual({ verdict: "indeterminate", reason: "tool-unavailable", tooling: { tool: "npm", version: null } });
  });

  it("keeps a version probe failure as a null version", async () => {
    const root = fakeRoot();
    const calls: string[][] = [];
    const spawn: LockfileSpawn = async (request) => {
      calls.push([...request.args]);
      return request.args.includes("--version") ? { status: 1, stdout: "", stderr: "no" } : { status: 2, stdout: "", stderr: "" };
    };
    expect(await regenerateLockfile(npmInput(root), { spawn })).toMatchObject({ reason: "tool-failed", tooling: { tool: "npm", version: null } });
    expect(calls).toHaveLength(2);
  });

  it("returns at most 4 KiB of tool output with scratch and root redacted, and removes the scratch directory", async () => {
    const root = fakeRoot();
    const recorder = fakeTool((request) => {
      const scratch = scratchOf(request);
      const line = `cache at ${scratch}/npm-cache, root ${request.cwd}/package.json é\n`;
      return { status: 1, stdout: line.repeat(200), stderr: `error: ${scratch}/home/.npm ${request.cwd}\n` };
    });
    const result = await regenerateLockfile(npmInput(root), { spawn: recorder.spawn });
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "tool-failed" });
    const output = (result as Extract<LockfileRegenResult, { verdict: "indeterminate" }>).output ?? "";
    const scratch = scratchOf(recorder.calls[0]!);
    expect(Buffer.byteLength(output, "utf8")).toBeLessThanOrEqual(LOCKFILE_OUTPUT_TAIL_BYTES);
    expect(Buffer.byteLength(output, "utf8")).toBeGreaterThan(LOCKFILE_OUTPUT_TAIL_BYTES - 4);
    expect(output).not.toContain("�");
    expect(output).not.toContain(scratch);
    expect(output).not.toContain(root);
    expect(output).toContain("$SCRATCH/npm-cache");
    expect(output).toContain("$ROOT/package.json");
    expect(output.endsWith("error: $SCRATCH/home/.npm $ROOT\n")).toBe(true);
    expect(existsSync(scratch)).toBe(false);
  });

  it("redacts the home directory (and a non-empty parent COREPACK_HOME) from tool output", async () => {
    const root = fakeRoot();
    const { homedir } = await import("node:os");
    const home = homedir();
    const fixtureCorepackHome = "/fixture/corepack-home";
    const recorder = fakeTool(() => ({ status: 1, stdout: "", stderr: `error: could not write ${home}/.npm/cache and ${fixtureCorepackHome}/pnpm\n` }));
    process.env.COREPACK_HOME = fixtureCorepackHome;
    try {
      const result = await regenerateLockfile(npmInput(root), { spawn: recorder.spawn });
      expect(result).toMatchObject({ verdict: "indeterminate", reason: "tool-failed" });
      const output = (result as Extract<LockfileRegenResult, { verdict: "indeterminate" }>).output ?? "";
      expect(output).not.toContain(home);
      expect(output).not.toContain(fixtureCorepackHome);
      expect(output).toContain("$HOME/.npm/cache");
      expect(output).toContain("$COREPACK_HOME/pnpm");
    } finally {
      delete process.env.COREPACK_HOME;
    }
  });

  it("removes the scratch directory when the tool succeeds and when the spawn port throws", async () => {
    const root = fakeRoot();
    const succeeding = fakeTool(() => ok);
    await regenerateLockfile(npmInput(root), { spawn: succeeding.spawn });
    expect(existsSync(scratchOf(succeeding.calls[0]!))).toBe(false);
    const seen: string[] = [];
    const throwing: LockfileSpawn = async (request) => { seen.push(scratchOf(request)); throw new Error("fixture spawn failure"); };
    await expect(regenerateLockfile(npmInput(root), { spawn: throwing })).rejects.toThrow("fixture spawn failure");
    expect(seen).toHaveLength(1);
    expect(existsSync(seen[0]!)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Real npm and pnpm against a local fixture registry
// ---------------------------------------------------------------------------

/** A minimal ustar archive of `package/<name>` files, gzipped as npm packs them. */
function tarball(files: Readonly<Record<string, string>>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, "utf8");
    const header = Buffer.alloc(512);
    header.write(`package/${name}`, 0, 100, "utf8");
    header.write("0000644\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write("00000000000\0", 136);
    header.write("        ", 148);
    header.write("0", 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

interface FixturePackage {
  readonly name: string;
  readonly version: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly bytes: Buffer;
  readonly integrity: string;
}

function fixturePackage(name: string, version: string, dependencies: Record<string, string> = {}): FixturePackage {
  const bytes = tarball({ "package.json": JSON.stringify({ name, version, dependencies }) });
  return { name, version, dependencies, bytes, integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}` };
}

const FIXTURE = {
  a: fixturePackage(`${scope}/fixture-a`, "1.0.0", { [`${scope}/fixture-dep`]: "1.0.0" }),
  dep: fixturePackage(`${scope}/fixture-dep`, "1.0.0"),
  other: fixturePackage(`${scope}/fixture-other`, "2.0.0"),
  member: fixturePackage(`${scope}/fixture-member-dep`, "3.0.0"),
};

interface FixtureRegistry {
  readonly url: string;
  /** Every request path, decoded. */
  readonly requests: string[];
  /** Every path the registry serves. */
  readonly served: ReadonlySet<string>;
  close(): Promise<void>;
}

const tarballPath = (entry: FixturePackage): string => `/${entry.name}/-/${entry.name.slice(entry.name.indexOf("/") + 1)}-${entry.version}.tgz`;

/** Serves packuments and tarballs on 127.0.0.1, tarballs on the registry origin at `/<name>/-/<basename>-<version>.tgz`. Versions are published an hour ago. */
async function fixtureRegistry(packages: readonly FixturePackage[]): Promise<FixtureRegistry> {
  const requests: string[] = [];
  const byPackument = new Map(packages.map((entry) => [`/${entry.name}`, entry]));
  const byTarball = new Map(packages.map((entry) => [tarballPath(entry), entry]));
  const published = new Date(Date.now() - 3_600_000).toISOString();
  const server = createServer((request, response) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? "/", "http://fixture.invalid").pathname);
    } catch {
      pathname = request.url ?? "";
    }
    requests.push(pathname);
    const archive = byTarball.get(pathname);
    if (archive !== undefined) {
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.end(archive.bytes);
      return;
    }
    const entry = byPackument.get(pathname);
    if (entry === undefined) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end("{}");
      return;
    }
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      name: entry.name,
      "dist-tags": { latest: entry.version },
      time: { created: published, modified: published, [entry.version]: published },
      versions: { [entry.version]: { name: entry.name, version: entry.version, dependencies: entry.dependencies, dist: { tarball: `${origin}${tarballPath(entry)}`, integrity: entry.integrity } } },
    }));
  });
  await new Promise<void>((resolveListen, rejectListen) => { server.once("error", rejectListen); server.listen(0, "127.0.0.1", resolveListen); });
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    requests,
    served: new Set([...byPackument.keys(), ...byTarball.keys()]),
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
  };
}

const probeHome = tempDir("lockfile-regen-probe-");
const probeEnv = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: probeHome, XDG_CONFIG_HOME: probeHome, XDG_CACHE_HOME: probeHome, XDG_DATA_HOME: probeHome, XDG_STATE_HOME: probeHome, npm_config_update_notifier: "false", pnpm_config_update_notifier: "false" };
/** The pnpm on PATH: inside `npm run test` that is the repository's own pinned devDependency. */
const pnpmProbe = spawnSync("pnpm", ["--version"], { encoding: "utf8", env: probeEnv, cwd: probeHome });
const PNPM_VERSION = pnpmProbe.status === 0 ? (pnpmProbe.stdout.trim().split(/\r?\n/).at(-1) ?? "") : null;
const pnpmMissing = PNPM_VERSION === null || !/^\d+\.\d+\.\d+$/.test(PNPM_VERSION);
const npmProbe = spawnSync("npm", ["--version"], { encoding: "utf8", env: probeEnv, cwd: probeHome });
const NPM_VERSION = npmProbe.status === 0 ? npmProbe.stdout.trim() : null;

/**
 * Runs pnpm from PATH where the runner would launch `corepack pnpm@<v>`, as Starter's canary does.
 * The request's environment is passed through unchanged.
 */
function pnpmFromPath(record?: LockfileSpawnRequest[]): LockfileSpawn {
  return (request) => {
    record?.push(request);
    if (request.command === "corepack" && request.args[0]?.startsWith("pnpm@") === true) {
      return spawnLockfileTool({ ...request, command: "pnpm", args: request.args.slice(1), });
    }
    return spawnLockfileTool(request);
  };
}

function recordingSpawn(record: LockfileSpawnRequest[]): LockfileSpawn {
  return (request) => {
    record.push(request);
    return spawnLockfileTool(request);
  };
}

describe("regenerateLockfile with real npm and pnpm", () => {
  let registry: FixtureRegistry;
  let toolHome: string;
  let outside: string;

  beforeAll(async () => {
    registry = await fixtureRegistry(Object.values(FIXTURE));
    toolHome = tempDir("lockfile-regen-tool-home-");
    outside = tempDir("lockfile-regen-outside-");
    writeFileSync(join(toolHome, "user-npmrc"), "");
    writeFileSync(join(toolHome, "global-npmrc"), "");
  });
  afterAll(async () => { await registry.close(); });
  afterEach(() => {
    for (const name of readdirSync(outside)) rmSync(join(outside, name), { force: true, recursive: true });
  });

  /** The tool run directly with a clean environment and the scope pinned to the fixture on the command line: independent of the runner. */
  async function generateBase(root: string, tool: "npm" | "pnpm"): Promise<void> {
    const env = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: toolHome,
      XDG_CONFIG_HOME: join(toolHome, "xdg-config"),
      XDG_CACHE_HOME: join(toolHome, "xdg-cache"),
      XDG_DATA_HOME: join(toolHome, "xdg-data"),
      XDG_STATE_HOME: join(toolHome, "xdg-state"),
      npm_config_userconfig: join(toolHome, "user-npmrc"),
      npm_config_globalconfig: join(toolHome, "global-npmrc"),
      npm_config_cache: join(toolHome, "npm-cache"),
      npm_config_update_notifier: "false",
      pnpm_config_update_notifier: "false",
    };
    const args = tool === "npm"
      ? ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund", `--${scope}:registry=${registry.url}`]
      : ["install", "--lockfile-only", "--ignore-scripts", "--ignore-pnpmfile", `--config.${scope}:registry=${registry.url}`, "--config.minimum-release-age=0"];
    const result = await spawnLockfileTool({ command: tool, args, cwd: root, env, timeoutMs: 60_000, maxBuffer: 2_000_000 });
    if (result.status !== 0) throw new Error(`base ${tool} lockfile failed (${String(result.status)}): ${result.stderr}${result.stdout}`);
  }

  interface Scenario {
    readonly tool: "npm" | "pnpm";
    readonly baseDependencies?: Record<string, string>;
    /** Runs after the base lockfile exists and before package.json gains the approved package. */
    readonly prepare?: (root: string) => void;
    readonly beforeBase?: (root: string) => void;
    readonly manifest?: Record<string, unknown>;
  }

  async function scenario(options: Scenario): Promise<{ root: string; input: LockfileRegenInput; lockfile: string }> {
    const root = tempDir(`lockfile-regen-${options.tool}-`);
    const manifest = { name: "fixture-consumer", version: "1.0.0", private: true, dependencies: options.baseDependencies ?? { [FIXTURE.other.name]: FIXTURE.other.version } };
    writeJson(join(root, "package.json"), manifest);
    options.beforeBase?.(root);
    await generateBase(root, options.tool);
    const lockfile = options.tool === "npm" ? "package-lock.json" : "pnpm-lock.yaml";
    const baseLockfile = readFileSync(join(root, lockfile), "utf8");
    options.prepare?.(root);
    writeJson(join(root, "package.json"), { ...manifest, ...options.manifest, dependencies: { ...manifest.dependencies, [FIXTURE.a.name]: FIXTURE.a.version } });
    const packages: LockfileInvariantPackage[] = [{ name: FIXTURE.a.name, version: FIXTURE.a.version, integrity: FIXTURE.a.integrity, placement: "dependencies" }];
    const input: LockfileRegenInput = {
      root,
      packageManager: options.tool,
      lockfile,
      toolVersion: options.tool === "pnpm" ? PNPM_VERSION : null,
      baseLockfile,
      packages,
      now: () => new Date(),
    };
    return { root, input, lockfile };
  }

  const portsFor = (tool: "npm" | "pnpm", record?: LockfileSpawnRequest[]) => ({ registry: registry.url, spawn: tool === "pnpm" ? pnpmFromPath(record) : record === undefined ? spawnLockfileTool : recordingSpawn(record) });

  function expectSatisfied(result: LockfileRegenResult, tool: "npm" | "pnpm"): asserts result is Extract<LockfileRegenResult, { verdict: "satisfied" }> {
    expect(result, JSON.stringify(result)).toMatchObject({ verdict: "satisfied" });
    expect(result).toMatchObject({ tooling: { tool, version: tool === "npm" ? NPM_VERSION : PNPM_VERSION } });
  }

  const scriptManifest = (sentinel: string) => {
    const write = (name: string) => `node -e "require('fs').writeFileSync(${JSON.stringify(join(sentinel, name))}, 'fired')"`;
    return { scripts: { preinstall: write("preinstall"), install: write("install"), postinstall: write("postinstall"), prepare: write("prepare") } };
  };

  it("npm happy path: satisfied, I1 holds, transitive counted, only the lockfile changed", async () => {
    const { root, input } = await scenario({ tool: "npm" });
    const before = treeView(root);
    const record: LockfileSpawnRequest[] = [];
    const result = await regenerateLockfile(input, portsFor("npm", record));
    expectSatisfied(result, "npm");
    const regenerated = readFileSync(join(root, "package-lock.json"));
    expect(result).toEqual({ verdict: "satisfied", path: "package-lock.json", before: sha256hex(input.baseLockfile), after: sha256hex(regenerated), tooling: { tool: "npm", version: NPM_VERSION }, transitive: { added: 2, removed: 0 } });
    const lock = JSON.parse(regenerated.toString("utf8")) as { packages: Record<string, { version?: string; integrity?: string; resolved?: string }> };
    expect(lock.packages[`node_modules/${FIXTURE.a.name}`]).toMatchObject({ version: "1.0.0", integrity: FIXTURE.a.integrity, resolved: `${registry.url.replace(/\/$/, "")}${tarballPath(FIXTURE.a)}` });
    const after = treeView(root);
    delete before["package-lock.json"];
    delete after["package-lock.json"];
    expect(after).toEqual(before);
    expect(existsSync(scratchOf(record[0]!))).toBe(false);
  }, 60_000);

  it.skipIf(pnpmMissing)("pnpm happy path: satisfied with transitive counts", async () => {
    const { root, input } = await scenario({ tool: "pnpm" });
    const before = treeView(root);
    const result = await regenerateLockfile(input, portsFor("pnpm"));
    expectSatisfied(result, "pnpm");
    expect(result.transitive).toEqual({ added: 2, removed: 0 });
    expect(result.after).toBe(sha256hex(readFileSync(join(root, "pnpm-lock.yaml"))));
    const after = treeView(root);
    delete before["pnpm-lock.yaml"];
    delete after["pnpm-lock.yaml"];
    expect(after).toEqual(before);
  }, 60_000);

  it.skipIf(pnpmMissing)("pnpm workspace root: root invariants read from importers['.']", async () => {
    const { root, input } = await scenario({
      tool: "pnpm",
      baseDependencies: {},
      beforeBase: (directory) => {
        writeFileSync(join(directory, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
        mkdirSync(join(directory, "packages", "member"), { recursive: true });
        writeJson(join(directory, "packages", "member", "package.json"), { name: "fixture-member", version: "1.0.0", private: true, dependencies: { [FIXTURE.member.name]: FIXTURE.member.version } });
      },
    });
    const result = await regenerateLockfile(input, portsFor("pnpm"));
    expectSatisfied(result, "pnpm");
    const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
    expect(lock).toContain("packages/member:");
    expect(lock).toContain(FIXTURE.member.name);
  }, 60_000);

  it.each(["npm", "pnpm"] as const)("%s never fires root preinstall, install, postinstall or prepare scripts", async (tool) => {
    if (tool === "pnpm" && pnpmMissing) return;
    const { input } = await scenario({ tool, manifest: scriptManifest(outside) });
    expectSatisfied(await regenerateLockfile(input, portsFor(tool)), tool);
    expect(readdirSync(outside)).toEqual([]);
  }, 60_000);

  it.skipIf(pnpmMissing)("pnpm never loads a .pnpmfile.cjs", async () => {
    const sentinel = join(outside, "pnpmfile");
    const { input } = await scenario({
      tool: "pnpm",
      prepare: (root) => writeFileSync(join(root, ".pnpmfile.cjs"), `require("fs").writeFileSync(${JSON.stringify(sentinel)}, "fired");\nmodule.exports = { hooks: {} };\n`),
    });
    expectSatisfied(await regenerateLockfile(input, portsFor("pnpm")), "pnpm");
    expect(existsSync(sentinel)).toBe(false);
  }, 60_000);

  it.each(["npm", "pnpm"] as const)("%s ignores a hostile parent environment", async (tool) => {
    if (tool === "pnpm" && pnpmMissing) return;
    const { input } = await scenario({ tool });
    const hostileConfig = join(outside, "hostile.npmrc");
    const sentinel = join(outside, "node-options-fired");
    const preload = join(outside, "preload.cjs");
    writeFileSync(hostileConfig, `registry=${DEAD}\n${scope}:registry=${DEAD}\nignore-scripts=false\n`);
    writeFileSync(preload, `require("fs").writeFileSync(${JSON.stringify(sentinel)}, "fired");\n`);
    const hostile: Record<string, string> = {
      npm_config_registry: DEAD,
      NPM_CONFIG_REGISTRY: DEAD,
      [`npm_config_${scope}:registry`]: DEAD,
      NPM_CONFIG_USERCONFIG: hostileConfig,
      npm_config_userconfig: hostileConfig,
      NPM_CONFIG_GLOBALCONFIG: hostileConfig,
      npm_config_ignore_scripts: "false",
      PNPM_CONFIG_REGISTRY: DEAD,
      NODE_OPTIONS: `--require ${preload}`,
      NPM_TOKEN: "fixture",
      NODE_AUTH_TOKEN: "fixture",
    };
    const previous = new Map(Object.keys(hostile).map((name) => [name, process.env[name]]));
    Object.assign(process.env, hostile);
    const seen = registry.requests.length;
    let result: LockfileRegenResult;
    try {
      result = await regenerateLockfile(input, portsFor(tool));
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
    expectSatisfied(result, tool);
    expect(existsSync(sentinel)).toBe(false);
    expect(registry.requests.slice(seen)).toContain(`/${FIXTURE.a.name}`);
  }, 60_000);

  // `registry` and `@scope:registry` are not on the fix-1 allow-list at all (the command-line scope
  // override made them harmless before; the allow-list now refuses the file outright instead), so a
  // repository .npmrc naming either one is package-manager-config-unrecognized before any tool launches --
  // it can no longer even attempt to redirect the scope.
  it.each(["npm", "pnpm"] as const)("%s: a repository .npmrc naming registry or @scope:registry is refused, never launched", async (tool) => {
    if (tool === "pnpm" && pnpmMissing) return;
    const { root, input } = await scenario({ tool, prepare: (directory) => writeFileSync(join(directory, ".npmrc"), `${scope}:registry=${DEAD}\nregistry=${DEAD}\n`) });
    const seen = registry.requests.length;
    const record: LockfileSpawnRequest[] = [];
    const result = await regenerateLockfile(input, { registry: registry.url, spawn: recordingSpawn(record) });
    expect(result).toEqual({ verdict: "indeterminate", reason: "package-manager-config-unrecognized", tooling: null });
    expect(record).toEqual([]);
    expect(registry.requests.slice(seen)).toEqual([]);
    expect(readFileSync(join(root, ".npmrc"), "utf8")).toBe(`${scope}:registry=${DEAD}\nregistry=${DEAD}\n`);
  }, 60_000);

  it("npm: min-release-age in .npmrc is overridden with --min-release-age=0, .npmrc untouched", async () => {
    const { root, input } = await scenario({ tool: "npm", prepare: (directory) => writeFileSync(join(directory, ".npmrc"), "min-release-age=7\n") });
    const record: LockfileSpawnRequest[] = [];
    expectSatisfied(await regenerateLockfile(input, portsFor("npm", record)), "npm");
    expect(record.at(-1)?.args).toContain("--min-release-age=0");
    expect(record.at(-1)?.args.some((arg) => arg.startsWith("--before"))).toBe(false);
    expect(readFileSync(join(root, ".npmrc"), "utf8")).toBe("min-release-age=7\n");
  }, 60_000);

  it("npm: before in .npmrc is overridden with --before=<now>, .npmrc untouched", async () => {
    const now = new Date();
    const { root, input } = await scenario({ tool: "npm", prepare: (directory) => writeFileSync(join(directory, ".npmrc"), "before=2020-01-01\n") });
    const record: LockfileSpawnRequest[] = [];
    expectSatisfied(await regenerateLockfile({ ...input, now: () => now }, portsFor("npm", record)), "npm");
    expect(record.at(-1)?.args).toContain(`--before=${now.toISOString()}`);
    expect(record.at(-1)?.args).not.toContain("--min-release-age=0");
    expect(readFileSync(join(root, ".npmrc"), "utf8")).toBe("before=2020-01-01\n");
  }, 60_000);

  it("npm: a package outside the approved integrity is violated through the invariants", async () => {
    const { input } = await scenario({ tool: "npm" });
    const result = await regenerateLockfile({ ...input, packages: [{ ...input.packages[0]!, integrity: FIXTURE.other.integrity }] }, portsFor("npm"));
    expect(result).toMatchObject({ verdict: "violated", rule: "lockfile-invariants", violations: [{ invariant: "I1", name: FIXTURE.a.name }], paths: [] });
  }, 60_000);

  it("every fixture request is a served packument or tarball; none is an audit endpoint", () => {
    expect(registry.requests.length).toBeGreaterThan(0);
    for (const path of registry.requests) {
      expect(path.startsWith("/-/"), path).toBe(false);
      expect(registry.served.has(path), path).toBe(true);
    }
  });
});
