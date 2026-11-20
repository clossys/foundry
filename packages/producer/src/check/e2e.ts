/**
 * `consumer.e2e` (`clossys check --e2e`): the one end-to-end proof. An empty directory, then tarballs, then verbs, then
 * a rendered page:
 *
 * 1. pack: `npm pack` each first-party package of the cohort from the directory this Producer runs from (a checkout's
 *    `packages/<name>`, or a consumer's `node_modules/@clossys/<name>`), or take the tarballs `--from <dir>` holds;
 * 2. install: a fresh empty temp directory gets `git init`, a package.json naming every tarball as a dependency and an
 *    override (docs/releasing/tarball-install.md) and `npm install`, then the third-party peers the scenario's pages
 *    import (`peers`, which the cohort leaves to the consumer); the install must hold exactly one copy of each
 *    first-party package, resolved from its tarball, and `node_modules/.bin/clossys` must be the installed Producer;
 * 3. drive: the scenario shipped inside the installed package (`e2e/scenario.json`) runs, step by step, as child
 *    processes of that installed bin only. A step is a public verb; nothing writes a record, imports package code or
 *    points `CLOSSYS_ROOT` anywhere (every `CLOSSYS_*` variable is dropped from the child environment);
 * 4. render: the publication's latest build must hold an `index.html` for every route the scenario names, holding
 *    every pinned string and marker it names, and a second build of the same pins must name the same digest;
 * 5. portable: no file of the build holds an absolute path of the consumer, and the consumer moved to another
 *    directory (another name, another depth) builds the same pins to the same digest.
 *
 * There are two stand-ins. Agent judgement is scripted: the shipped candidate files, the fixed verdicts and the three
 * fixed design directions, critique scores hard-coded to 4 under the model `e2e-fixture-critic`, and a critique render
 * that is a copy of the candidate's bytes, not a visual render. And network isolation: the shadcn CLI's one base-colour
 * fetch is answered by a loopback stub (`REGISTRY_URL`); the items it installs are the scenario's own inline registry
 * files. Third-party npm packages come from the npm registry or cache as any consumer's install would.
 *
 * `--scenario <file>` runs another scenario: `{ "base": "shipped", "without": [<step id>...] }` is the shipped one
 * minus those steps; `<craft step id>.pin` drops only that craft's pin verb (scripts/rules/fixtures/R-E2E-CONSUMER drops
 * the Writer strings pin, and the gate must go red by name).
 * Exit 0 green, 1 a finding (its cause code, the verb, its exit and stderr tail), 2 it could not run.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const E2E_CHECK = "consumer.e2e";
export const E2E_SCENARIO_SCHEMA = "clossys.e2e-scenario/1";
/** The first-party packages a consumer installs together (scripts/pack-cohort.mjs packs the same six). */
export const E2E_COHORT = ["producer", "director", "designer", "writer", "publisher", "controller"] as const;

/** The rule this check enforces, one line: scripts/rules/registry.json R-E2E-CONSUMER carries it as its note. */
export const E2E_STATEMENT = "A consumer built only from tarballs and public verbs renders its pinned page: clossys check --e2e packs the cohort, installs it into an empty directory, drives the shipped scenario with the installed bin and asserts the built HTML, whose files hold no absolute path of the consumer and build to the same digest from another directory.";

/** Every cause a `consumer.e2e` finding names, with what it means. The doc text below is generated from this table. */
export const E2E_CAUSES = {
  "e2e.usage": "the check could not start: a bad flag, or no cohort package beside this Producer",
  "e2e.pack": "npm pack of a cohort package failed, or --from lacks one of its tarballs",
  "e2e.install": "npm install of the tarballs into the empty directory failed",
  "e2e.one-copy": "the install holds other than one copy of a first-party package, or one not resolved from its tarball",
  "e2e.bin": "node_modules/.bin/clossys is missing or is not the installed @clossys/producer",
  "e2e.scenario": "the scenario is missing, malformed, or names a step or file it does not hold",
  "e2e.step": "a scenario verb exited other than the scenario expects",
  "e2e.render": "the latest build lacks a route's index.html, or the HTML lacks a pinned string or marker",
  "e2e.repeat": "a second build of the same pins named another digest",
  "e2e.portable": "a build file holds an absolute path of the consumer or of the machine (its home or temp folder), or the consumer moved to another directory built the same pins to another digest",
} as const;
export type E2eCause = keyof typeof E2E_CAUSES;

/** The rule's doc text, generated from E2E_STATEMENT and E2E_CAUSES (the registry note and `check --e2e --help`). */
export function e2eDoc(): string {
  return `${E2E_STATEMENT} Causes: ${Object.entries(E2E_CAUSES).map(([code, meaning]) => `${code} (${meaning})`).join("; ")}.`;
}

export interface E2eFinding { readonly check: typeof E2E_CHECK; readonly cause: E2eCause; readonly subject: string; readonly detail: string }
export interface E2eStepRow { readonly id: string; readonly argv: readonly string[]; readonly exit: number; readonly expect: number; readonly ms: number }
export interface E2eReport {
  readonly schema: "clossys.e2e/1";
  readonly status: "pass" | "fail" | "error";
  readonly consumer?: string;
  readonly kept: boolean;
  readonly tarballs: readonly string[];
  readonly steps: readonly E2eStepRow[];
  readonly findings: readonly E2eFinding[];
  readonly build?: { readonly publication: string; readonly id: string; readonly routes: readonly string[] };
}

/** One scenario step: a verb argv (`run`), or `craft`, the P2 create sequence of one slot as public verbs. */
export interface ScenarioStep {
  readonly id: string;
  readonly run?: readonly string[];
  readonly craft?: { readonly ref: string; readonly standard: string; readonly file: string; readonly candidate: string; readonly gap: string; readonly rung: string; readonly skill: string; readonly pin?: string; readonly unpinned?: boolean };
  /** The exit the step must end with (default 0). */
  readonly expect?: number;
}
export interface Scenario {
  readonly schema: typeof E2E_SCENARIO_SCHEMA;
  readonly publication: string;
  /** The model and tier every agent seat and submission names (the seat-llm check stays live). */
  readonly model: string;
  readonly tier: string;
  readonly steps: readonly ScenarioStep[];
  /** The build step: run twice, and the second must name the same digest. */
  readonly build: readonly string[];
  /** route (`site/` relative directory of the page's index.html) -> every string its HTML must hold. */
  readonly render: Readonly<Record<string, readonly string[]>>;
  /**
   * Third-party packages the consumer installs itself after the cohort (`npm install name@version ...`): the peers its
   * pages import, which the cohort leaves to the consumer (docs/releasing/tarball-install.md).
   */
  readonly peers?: Readonly<Record<string, string>>;
}

export interface E2eOptions {
  /** A directory holding `<name>.tgz` or npm's `clossys-<name>-<version>.tgz` for every cohort package. */
  readonly from?: string;
  /** Another scenario file (a full scenario, or `{ base: "shipped", without: [<step id> | <craft id>.pin ...] }`). */
  readonly scenario?: string;
  /** Keep the temp directory and print where it is. */
  readonly keep?: boolean;
  /** Where this Producer's package root is (defaults to the running package). */
  readonly packageRoot?: string;
  readonly log?: (line: string) => void;
}

class E2eStop extends Error {
  constructor(readonly finding: E2eFinding, readonly code: 1 | 2) { super(finding.detail); }
}
const finding = (cause: E2eCause, subject: string, detail: string): E2eFinding => ({ check: E2E_CHECK, cause, subject, detail });
const stop = (cause: E2eCause, subject: string, detail: string, code: 1 | 2 = 1): never => { throw new E2eStop(finding(cause, subject, detail), code); };

/** This Producer's package root: dist/check/e2e.js and src/check/e2e.ts both sit two levels below it. */
export const producerPackageRoot = (): string => resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The cohort package directories beside `packageRoot` (a checkout's packages/ or a consumer's node_modules/@clossys/). */
export function cohortDirs(packageRoot: string): Record<string, string> {
  const parent = dirname(packageRoot);
  const out: Record<string, string> = {};
  for (const name of E2E_COHORT) {
    const dir = name === "producer" ? packageRoot : join(parent, name);
    let manifest: { name?: unknown } | undefined;
    try { manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: unknown }; } catch { manifest = undefined; }
    if (manifest?.name !== `@clossys/${name}`) stop("e2e.usage", `@clossys/${name}`, `no @clossys/${name} package at ${dir}: the cohort is packed from the directory Producer runs from`, 2);
    out[name] = dir;
  }
  return out;
}

interface Ran { readonly code: number; readonly stdout: string; readonly stderr: string }
/** Runs a command asynchronously (the loopback stub must keep answering while a child runs). */
function exec(command: string, args: readonly string[], options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }): Promise<Ran> {
  return new Promise(done => {
    const child = spawn(command, [...args], { cwd: options.cwd, env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    const timer = setTimeout(() => { stderr += `\n(timed out after ${options.timeoutMs} ms)`; child.kill("SIGTERM"); }, options.timeoutMs ?? 600_000);
    child.on("error", error => { clearTimeout(timer); done({ code: 127, stdout, stderr: `${stderr}${error.message}` }); });
    child.on("close", code => { clearTimeout(timer); done({ code: code ?? 1, stdout, stderr }); });
  });
}
const tail = (text: string, lines = 6): string => text.trim().split("\n").slice(-lines).join(" | ");

/** Packs every cohort package into `out` (`npm pack --ignore-scripts`), or reads them from `from`. Returns name -> tarball. */
async function tarballs(options: E2eOptions, out: string): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  if (options.from) {
    const from = resolve(options.from);
    const files = existsSync(from) ? readdirSync(from) : [];
    for (const name of E2E_COHORT) {
      const file = files.find(entry => entry === `${name}.tgz`) ?? files.find(entry => new RegExp(`^clossys-${name}-\\d[^/]*\\.tgz$`).test(entry));
      if (!file) stop("e2e.pack", `@clossys/${name}`, `--from ${from} holds no ${name}.tgz or clossys-${name}-<version>.tgz`);
      found[name] = join(from, file!);
    }
    return found;
  }
  const dirs = cohortDirs(options.packageRoot ?? producerPackageRoot());
  for (const name of E2E_COHORT) {
    const ran = await exec("npm", ["pack", dirs[name]!, "--pack-destination", out, "--ignore-scripts", "--json"], { cwd: out });
    let file: string | undefined;
    try { file = (JSON.parse(ran.stdout) as { filename?: string }[])[0]?.filename; } catch { file = undefined; }
    if (ran.code !== 0 || !file || !existsSync(join(out, basename(file)))) stop("e2e.pack", `@clossys/${name}`, `npm pack ${dirs[name]} exited ${ran.code}: ${tail(ran.stderr || ran.stdout)}`);
    found[name] = join(out, basename(file!));
  }
  return found;
}

/** Every `node_modules/@clossys/<name>` directory under `root`, nested ones included. */
function installedCopies(root: string): Record<string, string[]> {
  const copies: Record<string, string[]> = {};
  const walk = (modules: string): void => {
    if (!existsSync(modules)) return;
    for (const entry of readdirSync(modules)) {
      if (entry.startsWith(".")) continue;
      const path = join(modules, entry);
      if (entry === "@clossys") for (const name of readdirSync(path)) { (copies[name] ??= []).push(relative(root, join(path, name))); walk(join(path, name, "node_modules")); }
      else if (entry.startsWith("@")) for (const name of readdirSync(path)) walk(join(path, name, "node_modules"));
      else walk(join(path, "node_modules"));
    }
  };
  walk(join(root, "node_modules"));
  return copies;
}

/** Install findings: one top-level copy of each cohort package, resolved from its tarball, and the installed bin. */
export function installFindings(consumer: string, packed: Readonly<Record<string, string>>): E2eFinding[] {
  const out: E2eFinding[] = [];
  const copies = installedCopies(consumer);
  let lock: { packages?: Record<string, { resolved?: string; version?: string }> } = {};
  try { lock = JSON.parse(readFileSync(join(consumer, "package-lock.json"), "utf8")) as typeof lock; } catch { out.push(finding("e2e.one-copy", "package-lock.json", "the install wrote no readable package-lock.json")); }
  for (const name of E2E_COHORT) {
    const at = copies[name] ?? [];
    const top = join("node_modules", "@clossys", name);
    if (at.length !== 1 || at[0] !== top) out.push(finding("e2e.one-copy", `@clossys/${name}`, `${at.length} installed copies (${at.join(", ") || "none"}); exactly one, at ${top}`));
    const entry = lock.packages?.[top.split(sep).join("/")];
    const tarball = packed[name]!;
    const resolved = entry?.resolved ?? "";
    if (!resolved.startsWith("file:") || resolve(consumer, resolved.slice(5)) !== tarball) out.push(finding("e2e.one-copy", `@clossys/${name}`, `package-lock resolves it to ${resolved || "nothing"}, not its tarball ${tarball}`));
  }
  const bin = join(consumer, "node_modules", ".bin", "clossys");
  const target = existsSync(bin) ? realpathSync(bin) : undefined;
  const producer = existsSync(join(consumer, "node_modules", "@clossys", "producer")) ? realpathSync(join(consumer, "node_modules", "@clossys", "producer")) : undefined;
  if (!target || !producer || !target.startsWith(`${producer}${sep}`)) out.push(finding("e2e.bin", "node_modules/.bin/clossys", target ? `resolves to ${target}, outside the installed @clossys/producer` : "is not installed"));
  return out;
}

/**
 * Reads the scenario: the shipped one, or `file` (a full scenario, or the shipped one minus `without` step ids, where
 * `<craft id>.pin` keeps that craft but drops its pin verb).
 */
export function readScenario(shippedDir: string, file?: string): Scenario {
  const read = (path: string): unknown => {
    try { return JSON.parse(readFileSync(path, "utf8")) as unknown; } catch (error) { return stop("e2e.scenario", path, `cannot read: ${(error as Error).message}`); }
  };
  const shippedFile = join(shippedDir, "scenario.json");
  const raw = (file ? read(file) : read(shippedFile)) as Record<string, unknown>;
  let scenario: Scenario;
  if (raw.base === "shipped") {
    const shipped = read(shippedFile) as Scenario;
    const without = Array.isArray(raw.without) ? raw.without.filter((id): id is string => typeof id === "string") : [];
    const pinOf = (step: ScenarioStep): string | undefined => step.craft ? `${step.id}.pin` : undefined;
    for (const id of without) if (!shipped.steps?.some(step => step.id === id || pinOf(step) === id)) stop("e2e.scenario", file!, `without names step ${id}, which the shipped scenario does not hold`);
    scenario = {
      ...shipped,
      steps: shipped.steps.filter(step => !without.includes(step.id)).map(step => without.includes(pinOf(step) ?? "") ? { ...step, craft: { ...step.craft!, unpinned: true } } : step),
    };
  } else scenario = raw as unknown as Scenario;
  const where = file ?? shippedFile;
  if (scenario.schema !== E2E_SCENARIO_SCHEMA) stop("e2e.scenario", where, `schema is ${String(scenario.schema)}, not ${E2E_SCENARIO_SCHEMA}`);
  if (typeof scenario.publication !== "string" || !Array.isArray(scenario.steps) || !Array.isArray(scenario.build) || !scenario.render || typeof scenario.render !== "object") stop("e2e.scenario", where, "needs publication, steps, build and render");
  const peers = scenario.peers ?? {};
  if (typeof peers !== "object" || Array.isArray(peers) || Object.entries(peers).some(([name, version]) => !/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/.test(name) || typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version))) {
    stop("e2e.scenario", where, "peers maps package names to exact versions (x.y.z)");
  }
  const ids = new Set<string>();
  for (const step of scenario.steps) {
    if (typeof step.id !== "string" || ids.has(step.id)) stop("e2e.scenario", where, `step ids must be unique strings (${String(step.id)})`);
    ids.add(step.id);
    if (!step.run === !step.craft) stop("e2e.scenario", where, `step ${step.id} needs run or craft, not both`);
  }
  return scenario;
}

/** `{scenario}` (the installed scenario directory) and `{model}`/`{tier}` in a step argument. */
const fill = (arg: string, scenarioDir: string, scenario: Scenario): string =>
  arg.replaceAll("{scenario}", scenarioDir).replaceAll("{model}", scenario.model).replaceAll("{tier}", scenario.tier);

/** The loopback answer to the shadcn CLI's base-colour fetch (the only network the build would reach). */
async function registryStub(): Promise<{ url: string; server: Server }> {
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/r/colors/")) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ inlineColors: { light: {}, dark: {} }, cssVars: { light: {}, dark: {} }, cssVarsV4: { light: {}, dark: {} }, inlineColorsTemplate: "", cssVarsTemplate: "" }));
    } else { response.statusCode = 404; response.end("{}"); }
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  return { url: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/r`, server };
}

/** The child environment: no `CLOSSYS_*` variable (no root redirect, no skip), the loopback registry, no colour codes. */
export function childEnv(registry: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) if (!key.startsWith("CLOSSYS_") && !key.startsWith("npm_") && key !== "INIT_CWD") env[key] = value;
  return { ...env, REGISTRY_URL: registry, NO_COLOR: "1", FORCE_COLOR: "0" };
}

/** The publication's latest build: `.clossys/builds/latest-<pub>.json` names it, its stamp lists the build path. */
function latest(consumer: string, publication: string): { id: string; dir: string } | undefined {
  try {
    const pointer = JSON.parse(readFileSync(join(consumer, ".clossys", "builds", `latest-${publication}.json`), "utf8")) as { id?: unknown };
    if (typeof pointer.id !== "string") return undefined;
    return { id: pointer.id, dir: join(consumer, ".clossys", "builds", pointer.id.slice(0, 8)) };
  } catch { return undefined; }
}

/** Render findings: every route's index.html under the build's site/ holds each string the scenario names. */
export function renderFindings(buildDir: string, render: Scenario["render"]): E2eFinding[] {
  const out: E2eFinding[] = [];
  for (const [route, strings] of Object.entries(render)) {
    const file = join(buildDir, "site", route, "index.html");
    if (!existsSync(file)) { out.push(finding("e2e.render", route, `the build holds no ${relative(buildDir, file)}`)); continue; }
    const html = readFileSync(file, "utf8");
    for (const text of strings) if (!html.includes(text)) out.push(finding("e2e.render", route, `index.html lacks ${JSON.stringify(text)}`));
  }
  return out;
}

/** This machine's own absolute directories a build must not hold either: the home folder (an npm cache, a checkout) and the real temp folder. */
export function machineRoots(): { readonly home: string; readonly tmp: string } {
  return { home: homedir(), tmp: realpathSync(tmpdir()) };
}

/**
 * Portable findings: every build file holding one of `roots` (the consumer's absolute directories) or one of the
 * machine's directories (`machine`: home, real temp) as bytes. A build is the same bytes wherever the consumer lives;
 * an absolute path in it leaks the machine's layout, and a consumer path makes the digest depend on where it is.
 */
export function portableFindings(buildDir: string, roots: readonly string[], machine: { readonly home?: string; readonly tmp?: string } = machineRoots()): E2eFinding[] {
  const out: E2eFinding[] = [];
  // A root of "/" (or a relative one) would match every file; only absolute paths below the root are needles.
  const absolute = (path: string | undefined): path is string => typeof path === "string" && path.startsWith("/") && path.length > 1;
  const labelled = [
    ...roots.filter(absolute).map(root => ({ root, what: "the consumer's absolute path" })),
    ...(absolute(machine.home) ? [{ root: machine.home, what: "the machine's home path" }] : []),
    ...(absolute(machine.tmp) ? [{ root: machine.tmp, what: "the machine's temp path" }] : []),
  ];
  const needles = labelled.filter((row, index) => labelled.findIndex(other => other.root === row.root) === index).map(row => ({ ...row, bytes: Buffer.from(row.root) }));
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      if (!entry.isFile()) continue;
      const bytes = readFileSync(path);
      const hit = needles.find(needle => bytes.includes(needle.bytes));
      if (hit) out.push(finding("e2e.portable", relative(buildDir, path).split(sep).join("/"), `holds ${hit.what} ${hit.root}`));
    }
  };
  walk(buildDir);
  return out;
}

const disk = (dir: string): number => {
  let bytes = 0;
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path); else if (entry.isFile()) bytes += statSync(path).size;
    }
  };
  try { walk(dir); } catch { /* a partly removed tree: the count is a floor */ }
  return bytes;
};

/** Runs the whole gate. Never throws: a stop is a finding with its exit. */
export async function runE2e(options: E2eOptions = {}): Promise<{ exitCode: 0 | 1 | 2; report: E2eReport; lines: string[] }> {
  const log = options.log ?? (() => undefined);
  const lines: string[] = [];
  const say = (line: string): void => { lines.push(line); log(line); };
  const work = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "clossys-e2e-")));
  const pack = join(work, "pack");
  let consumer = join(work, "consumer");
  mkdirSync(consumer); mkdirSync(pack);
  const steps: E2eStepRow[] = [];
  const findings: E2eFinding[] = [];
  let packed: Record<string, string> = {};
  let build: E2eReport["build"];
  let code: 0 | 1 | 2 = 0;
  const stub = await registryStub();
  try {
    packed = await tarballs(options, pack);
    say(`pack: ${E2E_COHORT.map(name => basename(packed[name]!)).join(", ")}`);
    const deps = Object.fromEntries(E2E_COHORT.map(name => [`@clossys/${name}`, `file:${packed[name]}`]));
    writeFileSync(join(consumer, "package.json"), `${JSON.stringify({ name: "clossys-e2e-consumer", version: "0.0.0", private: true, dependencies: deps, overrides: deps }, null, 2)}\n`);
    const npmEnv = childEnv(stub.url);
    for (const [command, args] of [["git", ["init", "-q"]], ["git", ["config", "user.email", "e2e@clossys.invalid"]], ["git", ["config", "user.name", "clossys e2e"]]] as const) {
      const ran = await exec(command, args, { cwd: consumer, env: npmEnv });
      if (ran.code !== 0) stop("e2e.install", command, `${command} ${args.join(" ")} exited ${ran.code}: ${tail(ran.stderr)}`, 2);
    }
    const started = Date.now();
    const installed = await exec("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: consumer, env: npmEnv, timeoutMs: 1_200_000 });
    if (installed.code !== 0) stop("e2e.install", "npm install", `exited ${installed.code}: ${tail(installed.stderr || installed.stdout)}`);
    say(`install: npm install exited 0 (${Math.round((Date.now() - started) / 1000)}s)`);
    const shippedIn = (at: string): string => join(at, "node_modules", "@clossys", "producer", "e2e");
    const shipped = shippedIn(consumer);
    const scenario = readScenario(shipped, options.scenario ? resolve(options.scenario) : undefined);
    const peers = Object.entries(scenario.peers ?? {}).map(([name, version]) => `${name}@${version}`);
    if (peers.length) {
      const ran = await exec("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", "--save-exact", ...peers], { cwd: consumer, env: npmEnv, timeoutMs: 1_200_000 });
      if (ran.code !== 0) stop("e2e.install", "npm install (peers)", `exited ${ran.code}: ${tail(ran.stderr || ran.stdout)}`);
      say(`peers: npm install ${peers.join(" ")} exited 0 (${Math.round(disk(consumer) / 1e6)} MB installed)`);
    }
    const install = installFindings(consumer, packed);
    if (install.length) { findings.push(...install); stop(install[0]!.cause, install[0]!.subject, install[0]!.detail); }
    say(`one-copy: ${E2E_COHORT.length} first-party packages, one copy each, from their tarballs; bin: node_modules/.bin/clossys`);
    const clossys = async (id: string, argv: readonly string[], expect = 0): Promise<Ran> => {
      const at = Date.now();
      const ran = await exec(join(consumer, "node_modules", ".bin", "clossys"), argv, { cwd: consumer, env: npmEnv });
      steps.push({ id, argv, exit: ran.code, expect, ms: Date.now() - at });
      say(`${ran.code === expect ? "ok  " : "FAIL"} ${id}: clossys ${argv.join(" ")} (exit ${ran.code})`);
      if (ran.code !== expect) stop("e2e.step", id, `clossys ${argv.join(" ")} exited ${ran.code}, expected ${expect}: ${tail(ran.stderr || ran.stdout)}`);
      return ran;
    };
    for (const step of scenario.steps) {
      if (step.run) { await clossys(step.id, step.run.map(arg => fill(arg, shipped, scenario)), step.expect ?? 0); continue; }
      await craft(step, scenario, shipped, consumer, clossys);
    }
    const buildArgv = scenario.build.map(arg => fill(arg, shipped, scenario));
    await clossys("build", buildArgv);
    const first = latest(consumer, scenario.publication);
    if (!first) stop("e2e.render", scenario.publication, `release --build wrote no .clossys/builds/latest-${scenario.publication}.json`);
    build = { publication: scenario.publication, id: first!.id, routes: Object.keys(scenario.render) };
    const render = renderFindings(first!.dir, scenario.render);
    if (render.length) { findings.push(...render); stop(render[0]!.cause, render[0]!.subject, render[0]!.detail); }
    say(`render: ${Object.keys(scenario.render).length} route(s) hold ${Object.values(scenario.render).flat().length} pinned string(s) in build ${first!.id.slice(0, 12)}`);
    await clossys("build.repeat", buildArgv);
    const second = latest(consumer, scenario.publication);
    if (second?.id !== first!.id) stop("e2e.repeat", scenario.publication, `the second build names ${second?.id.slice(0, 12) ?? "nothing"}, the first ${first!.id.slice(0, 12)}`);
    say(`repeat: the second build names the same digest ${first!.id.slice(0, 12)}`);
    const origin = consumer;
    const leaks = portableFindings(first!.dir, [origin, work]);
    if (leaks.length) { findings.push(...leaks); stop(leaks[0]!.cause, leaks[0]!.subject, leaks[0]!.detail); }
    // The same consumer at another name and depth: its build must be the same bytes, so the same digest.
    const moved = join(work, "moved", "elsewhere", "consumer");
    mkdirSync(dirname(moved), { recursive: true });
    renameSync(origin, moved);
    consumer = moved;
    await clossys("build.moved", scenario.build.map(arg => fill(arg, shippedIn(moved), scenario)));
    const third = latest(moved, scenario.publication);
    if (third) {
      const movedLeaks = portableFindings(third.dir, [origin, moved, work]);
      if (movedLeaks.length) { findings.push(...movedLeaks); stop(movedLeaks[0]!.cause, movedLeaks[0]!.subject, movedLeaks[0]!.detail); }
    }
    if (third?.id !== first!.id) stop("e2e.portable", scenario.publication, `the consumer moved to ${relative(work, moved)} builds ${third?.id.slice(0, 12) ?? "nothing"}, at ${relative(work, origin)} it built ${first!.id.slice(0, 12)}`);
    say(`portable: no build file holds the consumer's path, and moved to ${relative(work, moved)} it builds the same digest ${first!.id.slice(0, 12)}`);
  } catch (error) {
    if (error instanceof E2eStop) {
      if (!findings.includes(error.finding) && !findings.some(row => row.cause === error.finding.cause && row.subject === error.finding.subject && row.detail === error.finding.detail)) findings.push(error.finding);
      code = error.code;
    } else {
      findings.push(finding("e2e.usage", E2E_CHECK, (error as Error).message));
      code = 2;
    }
  } finally {
    await new Promise(done => stub.server.close(done));
  }
  if (!code && findings.length) code = 1;
  for (const row of findings) say(`  ${row.cause}  ${row.subject}  ${row.detail}`);
  if (options.keep) say(`kept: ${work}`);
  else rmSync(work, { recursive: true, force: true });
  const report: E2eReport = {
    schema: "clossys.e2e/1", status: code === 0 ? "pass" : code === 1 ? "fail" : "error", ...(options.keep ? { consumer } : {}), kept: options.keep === true,
    tarballs: E2E_COHORT.filter(name => packed[name]).map(name => basename(packed[name]!)), steps, findings, ...(build ? { build } : {}),
  };
  return { exitCode: code, report, lines };
}

type Clossys = (id: string, argv: readonly string[], expect?: number) => Promise<Ran>;

/**
 * The P2 create sequence of one slot, every write a public verb: options, a create verdict naming the gap, the brief,
 * three directions that differ on one axis, the render stage, a critique packet whose render is a copy of the candidate's bytes,
 * the critique record carrying that packet's manifest, the submit at the contract's rung, and the CHOOSE pin (`pin`, when
 * the slot pins per record, names the `<ref>#<record>` the pin verb takes; `unpinned` skips it).
 * The files it hands the verbs (verdict, diverge, critique) are inputs under the consumer's `e2e/` folder, never records.
 */
async function craft(step: ScenarioStep, scenario: Scenario, shipped: string, consumer: string, clossys: Clossys): Promise<void> {
  const c = step.craft!;
  const [agent, slot] = c.ref.split("/") as [string, string];
  const candidateFile = join(shipped, c.file);
  if (!existsSync(candidateFile)) stop("e2e.scenario", step.id, `the shipped scenario holds no ${c.file}`);
  const inputs = join(consumer, "e2e", slot);
  mkdirSync(inputs, { recursive: true });
  const llm = ["--model", scenario.model, "--tier", scenario.tier];
  const skill = ["--skill", c.skill];
  await clossys(`${step.id}.options`, ["options", c.ref]);
  writeFileSync(join(inputs, "verdict.json"), JSON.stringify({ schema: "clossys.verdict/1", slot, create: true, reason: "a fresh consumer holds no candidate", gaps: [{ id: c.gap }] }));
  await clossys(`${step.id}.verdict`, ["verdict", c.ref, "--record", join(inputs, "verdict.json"), ...llm, "--by", `agent:${agent}.verdict`]);
  await clossys(`${step.id}.brief`, ["next", c.ref, "--stage", "brief", ...llm, ...skill]);
  writeFileSync(join(inputs, "diverge.json"), JSON.stringify([
    { id: "d1", idea: "plain", axes: { tone: "plain" } }, { id: "d2", idea: "warm", axes: { tone: "warm" } }, { id: "d3", idea: "crisp", axes: { tone: "crisp" } },
  ]));
  await clossys(`${step.id}.diverge`, ["next", c.ref, "--stage", "diverge", "--file", join(inputs, "diverge.json"), ...llm, ...skill]);
  await clossys(`${step.id}.render`, ["next", c.ref, "--stage", "render", ...llm, ...skill]);
  const render = join("renders", `${slot}${c.file.slice(c.file.lastIndexOf("."))}`);
  mkdirSync(join(consumer, "renders"), { recursive: true });
  writeFileSync(join(consumer, render), readFileSync(candidateFile));
  const packet = await clossys(`${step.id}.packet`, ["critique-packet", c.ref, "--standard", c.standard, "--render", render, "--json"]);
  let manifest: unknown;
  try { manifest = (JSON.parse(packet.stdout) as { manifest?: unknown }).manifest; } catch { manifest = undefined; }
  if (!Array.isArray(manifest)) stop("e2e.step", `${step.id}.packet`, "critique-packet --json printed no manifest");
  writeFileSync(join(inputs, "critique.json"), JSON.stringify({ schema: "clossys.critique/1", slot, candidate: c.candidate, standard: c.standard, scores: { [c.gap]: 4 }, packet: { manifest } }));
  await clossys(`${step.id}.critique`, ["critique", c.ref, "--record", join(inputs, "critique.json"), "--model", `${scenario.model}-critic`, "--tier", scenario.tier]);
  await clossys(`${step.id}.submit`, ["next", c.ref, "--submit", candidateFile, ...llm, "--basis", "planner", ...skill, "--rung", c.rung, "--reason", "no seed: a fresh consumer holds none"]);
  if (!c.unpinned) await clossys(`${step.id}.pin`, ["pin", c.pin ?? c.ref, c.candidate, "--by", `agent:${agent}`]);
}
