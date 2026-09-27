import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateHeadInstall } from "./core.js";
import { main } from "./cli.js";
import { compareHeadHiddenLockfile, isRegistrySpec, stagedNpmManifest, validateNpmLockfileSources, validateNpmManifestSources } from "./npm.js";
import { headInstallEnvironment, proveHeadInstall } from "./node-runtime.js";
import type { HeadInstallEvaluationInput } from "./types.js";

const REGISTRY = "https://registry.npmjs.org/";
const integrity = (fill: string) => `sha512-${fill.repeat(85)}A==`;
const gitSha = (fill: string) => fill.repeat(40);
const tarball = (name: string, version: string) => `${REGISTRY}${name}/-/${name.split("/").pop()}-${version}.tgz`;
const entry = (name: string, extra: Record<string, unknown> = {}) => ({ version: "1.0.0", resolved: tarball(name, "1.0.0"), integrity: integrity("C"), ...extra });
const lock = (packages: Record<string, unknown>) => ({ lockfileVersion: 3, packages: { "": { devDependencies: {} }, ...packages } });

function request(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1, phase: "activation", packageManager: "npm",
    snapshot: { repository: "consumer/repository", maxAgeMs: 60_000 },
    starter: { name: "@clossys/starter", version: "0.1.10", integrity: integrity("A"), bin: "foundry-starter" },
    advisor: { name: "@clossys/advisor", version: "0.2.3", integrity: integrity("B"), bin: "advisor-execution-readiness" },
    target: { name: "@clossys/advisor", version: "0.2.3", integrity: integrity("B"), bin: "advisor-check", invocation: "single-json-input" },
    evidence: { assessment: "evidence/assessment.json", targetInput: "evidence/target-input.json" },
    ...overrides,
  };
}
const event = { schemaVersion: 1, provider: "github-actions", eventName: "workflow_run", repository: "consumer/repository", baseSha: gitSha("b"), sourceWorkflowRunId: "7", sourceHeadSha: gitSha("c"), artifactName: "adoption-snapshot-7", sourceConclusion: "success" };
function input(overrides: Partial<HeadInstallEvaluationInput> = {}): HeadInstallEvaluationInput {
  return { request: request(), headRequest: request(), trustedEvent: event, headCommit: gitSha("c"), inputFindings: [], sourceViolations: [], install: { attempted: true, exitCode: 0 }, identityFindings: [], ...overrides };
}

describe("npm head lockfile source policy", () => {
  it("accepts only single-SHA-512 tarballs from the fixed registry", () => {
    expect(validateNpmLockfileSources(lock({ "node_modules/@clossys/starter": entry("@clossys/starter"), "node_modules/a/node_modules/b": { inBundle: true, version: "1.0.0" } }))).toEqual({ violations: [], unsupported: [] });
  });

  it("refuses git, file, link, foreign-host, query, and SHA-1-only entries as violations, each named only by its ordinal position, never its key", () => {
    const entries = {
      "node_modules/git": entry("git", { resolved: "git+ssh://git@github.com/owner/repository.git#0123" }),
      "node_modules/file": entry("file", { resolved: "file:../outside.tgz" }),
      "node_modules/linked": { link: true, resolved: "../linked" },
      "node_modules/foreign": entry("foreign", { resolved: "https://registry.npmjs.org.attacker.test/foreign/-/foreign-1.0.0.tgz" }),
      "node_modules/plain": entry("plain", { resolved: "http://registry.npmjs.org/plain/-/plain-1.0.0.tgz" }),
      "node_modules/query": entry("query", { resolved: `${tarball("query", "1.0.0")}?x=1` }),
      "node_modules/sha1": entry("sha1", { integrity: "sha1-2jmj7l5rSw0yVb/vlWAYkK/YBwk=" }),
      "node_modules/two": entry("two", { integrity: `${integrity("C")} ${integrity("D")}` }),
    };
    const result = validateNpmLockfileSources(lock(entries));
    expect(result.unsupported).toEqual([]);
    // "" (the root entry) is entry #1, so the entries above, in the order written, are #2..#9.
    Object.keys(entries).forEach((key, index) => {
      const position = `entry #${index + 2}`;
      expect(result.violations.join("\n"), key).toContain(position);
      expect(result.violations.join("\n"), key).not.toContain(key);
    });
  });

  it("marks workspaces, non-node_modules entries, and old lockfiles unsupported rather than guessing", () => {
    expect(validateNpmLockfileSources({ lockfileVersion: 1, dependencies: {} }).unsupported).toHaveLength(1);
    expect(validateNpmLockfileSources({ lockfileVersion: 3, packages: { "": { workspaces: ["packages/*"] }, "packages/member": { version: "1.0.0" } } }).unsupported).toHaveLength(2);
  });

  it("stages only dependency fields of the head manifest", () => {
    const staged = stagedNpmManifest({ name: "consumer", scripts: { preinstall: "curl" }, packageManager: "pnpm@10.0.0", devDependencies: { a: "1.0.0" }, config: { x: 1 } });
    expect(staged).toEqual({ manifest: { name: "consumer", devDependencies: { a: "1.0.0" } }, unsupported: [] });
    expect(stagedNpmManifest({ workspaces: ["packages/*"] }).unsupported).toHaveLength(1);
    expect(stagedNpmManifest([]).manifest).toBeNull();
  });

  it("ties a tarball to the entry that names it, refusing another package's tarball and an alias entry whose path does not match its own name field", () => {
    const evil = lock({ "node_modules/@clossys/starter": entry("@clossys/starter", { resolved: `${REGISTRY}evil/-/evil-1.0.0.tgz` }) });
    expect(validateNpmLockfileSources(evil).violations.some((message) => message.includes("packages entry #2"))).toBe(true);
    const misnamed = lock({ "node_modules/alias-target": { name: "@scope/real", ...entry("alias-target") } });
    expect(validateNpmLockfileSources(misnamed).violations.length).toBeGreaterThan(0);
    const aliased = lock({ "node_modules/alias-target": { name: "@scope/real", version: "1.0.0", resolved: tarball("@scope/real", "1.0.0"), integrity: integrity("C") } });
    expect(validateNpmLockfileSources(aliased).violations).toEqual([]);
  });
});

describe("registry-spec grammar", () => {
  it("accepts a semver version, a range, a comparator set, a dist-tag, and a scoped npm alias", () => {
    for (const spec of ["1.2.3", "^1.2.3", ">=1 <2", "latest", "npm:@scope/name@^1.0.0"]) expect(isRegistrySpec(spec), spec).toBe(true);
  });

  it("refuses every non-registry spec form structurally, never by name, each paired with a clean lock entry", () => {
    const forms: Record<string, string> = {
      "git colon": "git://github.com/owner/repository.git",
      "git ssh": "git+ssh://git@github.com/owner/repository.git#0123",
      "git https": "git+https://github.com/owner/repository.git#0123",
      "git file": "git+file:///tmp/repository",
      github: "github:owner/repository#0123",
      gitlab: "gitlab:owner/repository",
      bitbucket: "bitbucket:owner/repository",
      gist: "gist:11081aaa281",
      "owner/repo shorthand": "owner/repository",
      "owner/repo shorthand with ref": "owner/repository#0123",
      http: "http://registry.npmjs.org/x/-/x-1.0.0.tgz",
      https: "https://example.invalid/x-1.0.0.tgz",
      file: "file:../x",
      link: "link:../x",
      workspace: "workspace:*",
      portal: "portal:../x",
      "dot path": "./x",
      "slash path": "/x",
      "tilde path": "~/x",
      "alias onto a git target": "npm:x@git+https://example.invalid/x.git",
      "tarball filename tgz": "x.tgz",
      "tarball filename tar": "x.tar",
      "tarball filename tar.gz": "x.tar.gz",
      "semver with tarball suffix": "1.0.0-a.tgz",
    };
    for (const [label, spec] of Object.entries(forms)) {
      expect(isRegistrySpec(spec), label).toBe(false);
      const manifest = stagedNpmManifest({ dependencies: { x: spec } }).manifest;
      const findings = validateNpmManifestSources(manifest);
      expect(findings.violations.length, label).toBeGreaterThan(0);
      // Paired with a clean lock entry of the same name and version: the lockfile alone gives no reason for refusal.
      const cleanLock = lock({ "node_modules/x": entry("x") });
      expect(validateNpmLockfileSources(cleanLock).violations, label).toEqual([]);
    }
  });

  it("refuses non-registry overrides forms at any depth, and accepts a $name reference", () => {
    const manifest = {
      overrides: {
        x: "git+https://example.invalid/x.git",
        "not a valid key!!": "1.0.0",
        y: { ".": "^1.0.0", "z": { "w@^2.0.0": "$x" } },
      },
    };
    const result = validateNpmManifestSources(manifest);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
    for (const message of result.violations) expect(message).not.toMatch(/git\+https|example\.invalid|not a valid key/);
  });

  it("accepts a well-formed overrides tree with no violation", () => {
    const manifest = { overrides: { foo: "^1.0.0", "bar@^2.0.0": { baz: "$foo", ".": "1.2.3" } } };
    expect(validateNpmManifestSources(manifest).violations).toEqual([]);
  });

  it("refuses a non-registry spec inside a lock entry's own dependency map, by position only", () => {
    const withBadDependency = lock({ "node_modules/a": { ...entry("a"), dependencies: { b: "git+https://example.invalid/b.git" } } });
    const result = validateNpmLockfileSources(withBadDependency);
    expect(result.violations.some((message) => message.includes("dependencies entry #1"))).toBe(true);
    for (const message of result.violations) expect(message).not.toMatch(/git\+https|example\.invalid/);
  });
});

describe("post-install hidden lockfile comparison", () => {
  const headLock = { packages: { "": {}, "node_modules/a": { version: "1.0.0", resolved: tarball("a", "1.0.0"), integrity: integrity("C") }, "node_modules/opt": { version: "2.0.0", resolved: tarball("opt", "2.0.0"), integrity: integrity("D") } } };

  it("passes an identical hidden lockfile", () => {
    expect(compareHeadHiddenLockfile(headLock, headLock)).toEqual({ state: "satisfied", violations: [] });
  });

  it("is indeterminate, never satisfied, when the hidden lockfile is missing", () => {
    expect(compareHeadHiddenLockfile(headLock, null).state).toBe("indeterminate");
    expect(compareHeadHiddenLockfile(headLock, undefined).state).toBe("indeterminate");
  });

  it("allows a head entry npm skipped, such as an optional dependency for another platform", () => {
    const hidden = { packages: { "": {}, "node_modules/a": headLock.packages["node_modules/a"] } };
    expect(compareHeadHiddenLockfile(headLock, hidden).state).toBe("satisfied");
  });

  it("is violated when a hidden entry's resolved differs from the head lockfile's", () => {
    const hidden = { packages: { "": {}, "node_modules/a": { ...headLock.packages["node_modules/a"], resolved: tarball("a", "9.9.9") } } };
    expect(compareHeadHiddenLockfile(headLock, hidden).state).toBe("violated");
  });

  it("is violated when a hidden entry's integrity differs from the head lockfile's", () => {
    const hidden = { packages: { "": {}, "node_modules/a": { ...headLock.packages["node_modules/a"], integrity: integrity("Z") } } };
    expect(compareHeadHiddenLockfile(headLock, hidden).state).toBe("violated");
  });

  it("is violated when the hidden lockfile has an entry absent from the head lockfile", () => {
    const hidden = { packages: { "": {}, "node_modules/a": headLock.packages["node_modules/a"], "node_modules/extra": { version: "1.0.0", resolved: tarball("extra", "1.0.0"), integrity: integrity("E") } } };
    expect(compareHeadHiddenLockfile(headLock, hidden).state).toBe("violated");
  });
});

describe("pure head-install evaluation", () => {
  it("proves the head request's exact identities and names pins that changed from the base", () => {
    const bumped = request({ advisor: { ...request().advisor, version: "0.2.4" }, target: { ...request().target, version: "0.2.4" } });
    const report = evaluateHeadInstall(input({ headRequest: bumped }));
    expect(report).toMatchObject({ schemaVersion: 1, kind: "head-install", state: "satisfied", headSha: gitSha("c"), baseSha: gitSha("b"), changedFromBase: ["advisor", "target"], findings: [] });
    expect(report.proved?.map((entry) => `${entry.role}:${entry.version}`)).toEqual(["starter:0.1.10", "advisor:0.2.4", "target:0.2.4"]);
  });

  it("keeps unestablished inputs indeterminate", () => {
    const cases: Array<[Partial<HeadInstallEvaluationInput>, string]> = [
      [{ request: {} }, "request-shape"],
      [{ trustedEvent: { ...event, sourceHeadSha: "c".repeat(64) } }, "trusted-event-shape"],
      [{ trustedEvent: { ...event, repository: "other/repository" } }, "trusted-event-join"],
      [{ headCommit: gitSha("d") }, "head-commit"],
      [{ headCommit: null }, "head-commit"],
      [{ headRequest: { ...request(), run: "sh -c evil" } }, "head-request-shape"],
      [{ headRequest: request({ packageManager: "pnpm" }) }, "head-manager-unsupported"],
      [{ request: request({ packageManager: "pnpm" }) }, "head-manager-unsupported"],
      [{ headRequest: request({ snapshot: { repository: "other/repository", maxAgeMs: 60_000 } }) }, "head-request-join"],
      [{ inputFindings: [{ rule: "decision-credential", message: "token" }] }, "decision-credential"],
      [{ install: undefined }, "head-install-not-run"],
      [{ install: { attempted: true, exitCode: null, timedOut: true } }, "head-install-timeout"],
      [{ install: { attempted: true, exitCode: 1 } }, "head-install-failed"],
    ];
    for (const [overrides, rule] of cases) {
      const report = evaluateHeadInstall(input(overrides));
      expect(report.state, rule).toBe("indeterminate");
      expect(report.proved, rule).toBeNull();
      expect(report.findings.map((entry) => entry.rule), rule).toContain(rule);
    }
  });

  it("reports forbidden sources and identity mismatches as known violations, never as proof", () => {
    const source = evaluateHeadInstall(input({ sourceViolations: [{ rule: "head-lockfile-source", message: "git" }] }));
    expect(source).toMatchObject({ state: "violated", proved: null });
    const identity = evaluateHeadInstall(input({ identityFindings: [{ rule: "head-identity", message: "integrity" }] }));
    expect(identity).toMatchObject({ state: "violated", proved: null });
  });
});

describe("hardened head-install environment", () => {
  it("is a literal that carries no ambient token, npmrc, or registry override", () => {
    const previous = { ...process.env };
    Object.assign(process.env, { NODE_AUTH_TOKEN: "fixture", NPM_CONFIG_USERCONFIG: "/hostile", npm_config_registry: "http://127.0.0.1:9/", npm_config_ignore_scripts: "false" });
    try {
      const environment = headInstallEnvironment("/staging");
      expect(environment.NODE_AUTH_TOKEN).toBeUndefined();
      expect(environment.NPM_CONFIG_USERCONFIG).toBeUndefined();
      expect(environment).toMatchObject({ npm_config_registry: REGISTRY, npm_config_ignore_scripts: "true", npm_config_userconfig: "/staging/config/user-npmrc", npm_config_globalconfig: "/staging/config/global-npmrc" });
    } finally { process.env = previous; }
  });
});

// ---------------------------------------------------------------------------
// End to end: a real npm ci over a pull-request head, against a local registry
// served from a separate process (proveHeadInstall blocks on spawnSync).
// ---------------------------------------------------------------------------

const REGISTRY_SERVER = `import { createServer } from "node:http";
import { readFileSync } from "node:fs";
const packages = JSON.parse(readFileSync(process.argv[2], "utf8"));
// The real registry.npmjs.org always serves a tarball at <name>/-/<unscoped>-<version>.tgz; this fixture
// registry matches that path shape, because prove-head now requires a lock entry's resolved tarball to be
// named exactly for its own entry (name and version), not merely hosted on the right origin.
function tarballPath(name, version) { return "/" + name + "/-/" + name.split("/").pop() + "-" + version + ".tgz"; }
const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname);
  const port = server.address().port;
  const byTarball = packages.find((entry) => path === tarballPath(entry.name, entry.version));
  if (byTarball) { response.writeHead(200); response.end(readFileSync(byTarball.path)); return; }
  const entry = packages.find((candidate) => path === "/" + candidate.name);
  if (!entry) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ name: entry.name, "dist-tags": { latest: entry.version }, versions: { [entry.version]: { name: entry.name, version: entry.version, dist: { tarball: "http://127.0.0.1:" + port + tarballPath(entry.name, entry.version), integrity: entry.integrity } } } }));
});
server.listen(0, "127.0.0.1", () => console.log(server.address().port));
`;

interface Fixture { readonly root: string; readonly registry: string; readonly base: Record<string, unknown>; readonly head: Record<string, unknown>; readonly manifest: Record<string, unknown>; readonly lock: Record<string, unknown> }
let fixture: Fixture; let server: ChildProcess | undefined;

function fixtureEnvironment(root: string): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, HOME: root, TMPDIR: process.env.TMPDIR, npm_config_userconfig: join(root, "empty-npmrc"), npm_config_globalconfig: join(root, "empty-global-npmrc"), npm_config_cache: join(root, "author-cache"), npm_config_update_notifier: "false" };
}
function npm(args: readonly string[], cwd: string, root: string): string {
  const result = spawnSync("npm", args, { cwd, encoding: "utf8", env: fixtureEnvironment(root), timeout: 60_000 });
  if (result.status !== 0) throw new Error(`npm ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}
function writeJson(path: string, value: unknown): void { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), "starter-head-")); writeFileSync(join(root, "empty-npmrc"), ""); writeFileSync(join(root, "empty-global-npmrc"), "");
  const packed = join(root, "packed"); mkdirSync(packed);
  const marker = join(root, "dependency-script-ran");
  const sources = [
    { name: "@clossys/starter", version: "0.1.10", bin: "foundry-starter", scripts: {} },
    { name: "@clossys/advisor", version: "0.2.4", bin: "advisor-execution-readiness", extraBin: "advisor-check", scripts: { install: `node -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')"` } },
  ];
  const entries = sources.map((source) => {
    const directory = join(root, "source", source.name.split("/")[1] as string); mkdirSync(join(directory, "bin"), { recursive: true });
    writeFileSync(join(directory, "bin", "cli.js"), "#!/usr/bin/env node\nthrow new Error('head-installed code must never run');\n");
    const bin: Record<string, string> = { [source.bin]: "bin/cli.js" }; if (source.extraBin) bin[source.extraBin] = "bin/cli.js";
    writeJson(join(directory, "package.json"), { name: source.name, version: source.version, bin, scripts: source.scripts, files: ["bin"] });
    const file = (JSON.parse(npm(["pack", "--json", "--ignore-scripts", "--pack-destination", packed], directory, root)) as Array<{ filename: string }>)[0]?.filename as string;
    const path = join(packed, file);
    return { name: source.name, version: source.version, file, path, integrity: `sha512-${createHash("sha512").update(readFileSync(path)).digest("base64")}` };
  });
  const packagesPath = join(root, "packages.json"); writeJson(packagesPath, entries);
  const serverPath = join(root, "registry.mjs"); writeFileSync(serverPath, REGISTRY_SERVER);
  server = spawn(process.execPath, [serverPath, packagesPath], { stdio: ["ignore", "pipe", "inherit"] });
  const port = await new Promise<string>((resolvePort, rejectPort) => { server?.stdout?.once("data", (chunk: Buffer) => resolvePort(chunk.toString().trim())); server?.once("error", rejectPort); });
  const registry = `http://127.0.0.1:${port}/`;
  const [starter, advisor] = entries as [typeof entries[0], typeof entries[0]];

  const author = join(root, "author"); mkdirSync(author);
  const manifest = { name: "consumer", version: "1.0.0", private: true, scripts: { preinstall: `node -e "require('fs').writeFileSync(${JSON.stringify(join(root, "root-script-ran"))}, 'ran')"` }, devDependencies: { "@clossys/starter": starter.version, "@clossys/advisor": advisor.version } };
  writeJson(join(author, "package.json"), manifest);
  writeFileSync(join(author, ".npmrc"), `@clossys:registry=${registry}\n`);
  npm(["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], author, root);
  const lock = JSON.parse(readFileSync(join(author, "package-lock.json"), "utf8")) as Record<string, unknown>;

  const base = request({ starter: { name: starter.name, version: starter.version, integrity: starter.integrity, bin: "foundry-starter" } });
  const head = request({ starter: base.starter, advisor: { name: advisor.name, version: advisor.version, integrity: advisor.integrity, bin: "advisor-execution-readiness" }, target: { name: advisor.name, version: advisor.version, integrity: advisor.integrity, bin: "advisor-check", invocation: "single-json-input" } });
  fixture = { root, registry, base, head, manifest, lock };
}, 120_000);

afterAll(() => { server?.kill("SIGKILL"); if (fixture) rmSync(fixture.root, { recursive: true, force: true }); });

let caseNumber = 0;
/** One pull-request head plus a protected base whose installed Starter matches the base request. */
function scenario(change: { head?: Record<string, unknown>; manifest?: Record<string, unknown>; lock?: Record<string, unknown>; headCommit?: string; hostile?: boolean } = {}) {
  caseNumber += 1;
  const directory = join(fixture.root, `case-${caseNumber}`); const baseRoot = join(directory, "base"); const headRoot = join(directory, "head");
  const starter = fixture.base.starter as { name: string; version: string; integrity: string };
  mkdirSync(join(baseRoot, ".starter"), { recursive: true }); mkdirSync(join(baseRoot, "node_modules", "@clossys", "starter", "bin"), { recursive: true });
  writeJson(join(baseRoot, ".starter", "request.json"), fixture.base);
  writeJson(join(baseRoot, "package.json"), { devDependencies: { [starter.name]: starter.version } });
  writeJson(join(baseRoot, "package-lock.json"), { lockfileVersion: 3, packages: { "": { devDependencies: { [starter.name]: starter.version } }, [`node_modules/${starter.name}`]: { version: starter.version, integrity: starter.integrity } } });
  writeJson(join(baseRoot, "node_modules", "@clossys", "starter", "package.json"), { name: starter.name, version: starter.version, bin: { "foundry-starter": "bin/cli.js" } });
  writeFileSync(join(baseRoot, "node_modules", "@clossys", "starter", "bin", "cli.js"), "");
  mkdirSync(join(headRoot, ".starter"), { recursive: true }); mkdirSync(join(headRoot, ".git"));
  writeJson(join(headRoot, ".starter", "request.json"), change.head ?? fixture.head);
  writeJson(join(headRoot, "package.json"), change.manifest ?? fixture.manifest);
  writeJson(join(headRoot, "package-lock.json"), change.lock ?? fixture.lock);
  writeFileSync(join(headRoot, ".git", "HEAD"), `${change.headCommit ?? gitSha("c")}\n`);
  // A hostile head .npmrc would redirect every fetch to a dead port if it were read.
  if (change.hostile !== false) writeFileSync(join(headRoot, ".npmrc"), "registry=http://127.0.0.1:9/\n@clossys:registry=http://127.0.0.1:9/\nignore-scripts=false\n");
  const eventPath = join(directory, "event.json"); writeJson(eventPath, event);
  const staging = join(directory, "staging"); const reportPath = join(directory, "report.json");
  const cwd = process.cwd(); process.chdir(baseRoot);
  try { return { report: proveHeadInstall(".starter/request.json", headRoot, eventPath, staging, reportPath, { registry: fixture.registry, baseRoot, timeoutMs: 60_000 }), staging, reportPath, directory }; }
  finally { process.chdir(cwd); }
}

describe("proveHeadInstall end to end", () => {
  it("proves the head's own bumped pins with a real npm ci and runs no script or installed code", () => {
    const { report, staging, reportPath } = scenario();
    expect(report.findings).toEqual([]);
    expect(report).toMatchObject({ state: "satisfied", headSha: gitSha("c"), changedFromBase: ["advisor", "target"] });
    expect(report.proved?.map((entry) => `${entry.role}:${entry.name}@${entry.version}`)).toEqual(["starter:@clossys/starter@0.1.10", "advisor:@clossys/advisor@0.2.4", "target:@clossys/advisor@0.2.4"]);
    expect(JSON.parse(readFileSync(reportPath, "utf8"))).toEqual(report);
    expect(existsSync(join(staging, "project", "node_modules", "@clossys", "advisor", "package.json"))).toBe(true);
    expect(existsSync(join(staging, "project", ".npmrc"))).toBe(false);
    expect(JSON.parse(readFileSync(join(staging, "project", "package.json"), "utf8")).scripts).toBeUndefined();
    expect(existsSync(join(fixture.root, "dependency-script-ran"))).toBe(false);
    expect(existsSync(join(fixture.root, "root-script-ran"))).toBe(false);
  }, 60_000);

  it("refuses a foreign lockfile source before installing anything", () => {
    const packages = { ...(fixture.lock.packages as Record<string, Record<string, unknown>>) };
    packages["node_modules/@clossys/advisor"] = { ...packages["node_modules/@clossys/advisor"], resolved: "git+ssh://git@github.com/owner/advisor.git#0123" };
    const { report, staging } = scenario({ lock: { ...fixture.lock, packages } });
    expect(report.state).toBe("violated");
    expect(report.findings.map((entry) => entry.rule)).toContain("head-lockfile-source");
    expect(existsSync(staging)).toBe(false);
  });

  it("refuses a non-registry manifest dependency spec before installing anything, even one naming the fixture registry host", () => {
    const manifest = { ...fixture.manifest, dependencies: { widget: `${fixture.registry}some-other-path` } };
    const packages = { ...(fixture.lock.packages as Record<string, Record<string, unknown>>) };
    packages["node_modules/widget"] = { version: "1.0.0", resolved: `${fixture.registry}widget/-/widget-1.0.0.tgz`, integrity: integrity("F") };
    const { report, staging } = scenario({ manifest, lock: { ...fixture.lock, packages } });
    expect(report.state).toBe("violated");
    expect(report.findings.map((entry) => entry.rule)).toContain("head-manifest-source");
    expect(existsSync(staging)).toBe(false);
  });

  it("never echoes head-supplied text in a finding: a marker lock key and invalid manifest JSON both stay out of every message", () => {
    const packages = { ...(fixture.lock.packages as Record<string, Record<string, unknown>>) };
    packages["node_modules/MARKER-9f3c"] = { version: "1.0.0", resolved: "https://example.invalid/x-1.0.0.tgz", integrity: integrity("C") };
    const { report: lockReport, staging: lockStaging } = scenario({ lock: { ...fixture.lock, packages } });
    expect(lockReport.state).toBe("violated");
    for (const found of lockReport.findings) expect(found.message).not.toContain("MARKER-9f3c");
    expect(existsSync(lockStaging)).toBe(false);

    const directory = mkdtempSync(join(tmpdir(), "starter-head-json-"));
    const baseRoot = join(directory, "base"); const headRoot = join(directory, "head");
    const starter = fixture.base.starter as { name: string; version: string; integrity: string };
    mkdirSync(join(baseRoot, ".starter"), { recursive: true }); mkdirSync(join(baseRoot, "node_modules", "@clossys", "starter", "bin"), { recursive: true });
    writeJson(join(baseRoot, ".starter", "request.json"), fixture.base);
    writeJson(join(baseRoot, "package.json"), { devDependencies: { [starter.name]: starter.version } });
    writeJson(join(baseRoot, "package-lock.json"), { lockfileVersion: 3, packages: { "": { devDependencies: { [starter.name]: starter.version } }, [`node_modules/${starter.name}`]: { version: starter.version, integrity: starter.integrity } } });
    writeJson(join(baseRoot, "node_modules", "@clossys", "starter", "package.json"), { name: starter.name, version: starter.version, bin: { "foundry-starter": "bin/cli.js" } });
    writeFileSync(join(baseRoot, "node_modules", "@clossys", "starter", "bin", "cli.js"), "");
    mkdirSync(join(headRoot, ".starter"), { recursive: true }); mkdirSync(join(headRoot, ".git"));
    writeJson(join(headRoot, ".starter", "request.json"), fixture.head);
    writeFileSync(join(headRoot, "package.json"), '{"a": MARKER-9f3c}');
    writeJson(join(headRoot, "package-lock.json"), fixture.lock);
    writeFileSync(join(headRoot, ".git", "HEAD"), `${gitSha("c")}\n`);
    const eventPath = join(directory, "event.json"); writeJson(eventPath, event);
    const staging = join(directory, "staging");
    const cwd = process.cwd(); process.chdir(baseRoot);
    try {
      const report = proveHeadInstall(".starter/request.json", headRoot, eventPath, staging, undefined, { registry: fixture.registry, baseRoot, timeoutMs: 60_000 });
      expect(existsSync(staging)).toBe(false);
      expect(report.findings.map((entry) => entry.rule)).toContain("head-manifest");
      for (const found of report.findings) expect(found.message).not.toContain("MARKER-9f3c");
    } finally { process.chdir(cwd); rmSync(directory, { recursive: true, force: true }); }
  });

  it("reports a head request pin its own lockfile does not contain as a violation", () => {
    const head = { ...fixture.head, target: { ...(fixture.head.target as Record<string, unknown>), integrity: integrity("E") } };
    const { report } = scenario({ head });
    expect(report.state).toBe("violated");
    expect(report.findings.map((entry) => entry.rule)).toContain("head-identity");
  }, 60_000);

  it("is indeterminate when the checkout is not the trusted head commit, or a credential is present", () => {
    expect(scenario({ headCommit: gitSha("d") }).report.findings.map((entry) => entry.rule)).toContain("head-commit");
    process.env.NODE_AUTH_TOKEN = "fixture";
    try { expect(scenario().report).toMatchObject({ state: "indeterminate" }); }
    finally { delete process.env.NODE_AUTH_TOKEN; }
  });

  it("refuses a non-empty staging directory", () => {
    const first = scenario();
    const cwd = process.cwd(); process.chdir(join(first.directory, "base"));
    try {
      const again = proveHeadInstall(".starter/request.json", join(first.directory, "head"), join(first.directory, "event.json"), first.staging, undefined, { registry: fixture.registry, baseRoot: join(first.directory, "base") });
      expect(again.findings.map((entry) => entry.rule)).toContain("head-staging");
      expect(again.state).toBe("indeterminate");
    } finally { process.chdir(cwd); }
  }, 60_000);

  it("keeps the CLI surface fixed: prove-head accepts no registry or command argument", () => {
    expect(() => main(["prove-head", "a", "b", "c"])).toThrow();
    expect(() => main(["prove-head", "a", "b", "c", "d", "--registry", "http://127.0.0.1:9/"])).toThrow();
  });
});
