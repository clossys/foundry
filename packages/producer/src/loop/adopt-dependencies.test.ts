/**
 * CP1-DEPS: the code adopt (loop.create's `clossys settle adopt`) declares the npm packages its stock item imports in
 * the consumer's root package.json and installs them, before it writes the item. Only names the pinned registry entry
 * (or its registry's style rows) declares are added, each a valid npm name with a version code writes; the change is
 * one `dependency.add` event; a second run changes nothing; `clossys run loop.create --dry` shows the change.
 *
 * The world is test-fixtures/consumer plus a root package.json: designer/components.resize-handle ships as
 * shadcn-aria/resizable, which imports react-resizable-panels (declared by that row, not in the fixture lockfile);
 * designer/components.menu (empty) ships a stock item that imports only locked packages. npm is a stub that locks what package.json
 * declares, so no network or install script runs.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { ShadcnRunner } from "@clossys/publisher/install";
import { DEPENDENCY_EVENT, DEPENDENCY_INSTALL_ARGV, declareStockDependencies } from "../records/adopt-dependencies.js";
import { AGENT_CREATES, REFERENCE_MANIFEST, npmNameIssue, stockDependencyPlan } from "../records/code-adopt.js";
import { runCli } from "../cli/main.js";
import { runLoopCli } from "./cli.js";
import { startRun, type AgentPacket, type CodeCall, type RunHooks } from "./runner.js";

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const DESIGNER = fileURLToPath(new URL("../../../designer/", import.meta.url));
/** What the adopt reads from the Designer package (manifest, references, standards, provenance rule), for a world-local copy. */
const DESIGNER_DATA = ["references", "standards", "src/catalog/rules"];
const RESIZE = "components.resize-handle";
const MENU = "components.menu";
const PANELS = "react-resizable-panels";
const PACKAGE = { name: "consumer-fixture", private: true, dependencies: { react: "19.2.0", "react-dom": "19.2.0" } };
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); }, 60_000);

/** A fixture consumer with a root package.json; `references` edits a world-local copy of the Designer reference manifest (package-path.ts: a world with packages/ reads its own). */
function world(references?: (items: { registry: string; name: string; dependencies?: string[] }[]) => void): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "adopt-deps-")));
  roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  writeFileSync(join(root, "package.json"), `${JSON.stringify(PACKAGE, null, 2)}\n`);
  if (references) {
    for (const rel of DESIGNER_DATA) {
      mkdirSync(join(root, "packages", "designer", rel), { recursive: true });
      cpSync(join(DESIGNER, rel), join(root, "packages", "designer", rel), { recursive: true });
    }
    const manifest = JSON.parse(readFileSync(join(root, REFERENCE_MANIFEST), "utf8"));
    references(manifest.items);
    writeFileSync(join(root, REFERENCE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return root;
}

/** The version this repository installs (what a real npm install locks, and what R05.1 compares), else 4.0.0. */
const installed = (name: string): string => {
  const file = fileURLToPath(new URL(`../../../../node_modules/${name}/package.json`, import.meta.url));
  return existsSync(file) ? String(JSON.parse(readFileSync(file, "utf8")).version) : "4.0.0";
};

/** npm stub: records each call and locks every package.json dependency the lockfile lacks at its installed version (or exits `code`). */
function stubNpm(code = 0): ShadcnRunner & { readonly calls: { args: readonly string[]; cwd: string }[] } {
  const calls: { args: readonly string[]; cwd: string }[] = [];
  const run = (async (args: readonly string[], { cwd }: { cwd: string }) => {
    calls.push({ args, cwd });
    if (code !== 0) return { code, stdout: "", stderr: "npm ERR! stub failure" };
    const lockFile = join(cwd, "package-lock.json");
    const lock = JSON.parse(readFileSync(lockFile, "utf8"));
    const declared = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).dependencies ?? {};
    for (const name of Object.keys(declared)) lock.packages[`node_modules/${name}`] ??= { version: installed(name) };
    writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
    return { code: 0, stdout: "added 1 package", stderr: "" };
  }) as ShadcnRunner;
  return Object.assign(run, { calls });
}

const bytes = (root: string) => ({ manifest: readFileSync(join(root, "package.json"), "utf8"), lock: readFileSync(join(root, "package-lock.json"), "utf8") });
const eventsFile = (root: string) => join(root, "clossys", ".state", "events.jsonl");
const dependencyEvents = (root: string) => existsSync(eventsFile(root))
  ? readFileSync(eventsFile(root), "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(event => event.kind === DEPENDENCY_EVENT)
  : [];
const settleOf = (root: string, runId: string) => JSON.parse(readFileSync(join(root, "clossys", ".state", "runs", "loops", `${runId}.settle`, "adopt.json"), "utf8"));
const clock = () => { let tick = 0; return () => new Date(Date.parse("2026-11-25T12:30:00Z") + 1000 * tick++); };
function hooks(npm: ShadcnRunner): RunHooks {
  return {
    npm,
    agent(_packet: AgentPacket) { return { exit: 0, model: "stub-model" }; },
    code(_call: CodeCall) { return { exit: 0 }; },
  };
}

describe("CP1-DEPS (a): the code adopt declares and installs exactly the stock item's declared dependencies", () => {
  it("adds react-resizable-panels to package.json, runs the publish npm argv once, logs one dependency.add, then settles the adopt", async () => {
    const root = world();
    const before = JSON.parse(bytes(root).manifest);
    const npm = stubNpm();
    const run = await startRun(root, { loop: "loop.create", slot: `designer/${RESIZE}` }, hooks(npm), { now: clock() });
    const after = JSON.parse(bytes(root).manifest);
    expect(after.dependencies).toEqual({ ...before.dependencies, [PANELS]: "latest" });
    expect(Object.keys(after.dependencies).filter(name => !(name in before.dependencies))).toEqual([PANELS]);
    expect(npm.calls).toEqual([{ args: DEPENDENCY_INSTALL_ARGV, cwd: root }]);
    expect(DEPENDENCY_INSTALL_ARGV).toEqual(["install", "--no-audit", "--no-fund"]);
    const events = dependencyEvents(root);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor: "code:adopt", kind: "dependency.add", subject: `designer/${RESIZE}` });
    expect(events[0].inputs.map((each: { path: string }) => each.path).sort()).toEqual(["package-lock.json", "package.json"]);
    expect(settleOf(root, run.state!.runId)).toMatchObject({ rule: "adopt", outcome: "settled", settles: ["create"], why: expect.stringMatching(/dependencies: shadcn-aria\/resizable@4\.23\.0: package\.json dependencies \+ react-resizable-panels@latest/) });
  });
});

describe("CP1-DEPS (b): a second run is a no-op", () => {
  it("runs no npm, writes no byte and logs no event once the lockfile holds every import", async () => {
    const root = world();
    const first = await declareStockDependencies(root, RESIZE, { npm: stubNpm() });
    expect(first).toMatchObject({ exit: 0, wrote: ["package.json", "package-lock.json"] });
    const held = bytes(root);
    const npm = stubNpm();
    const second = await declareStockDependencies(root, RESIZE, { npm });
    expect(second).toMatchObject({ exit: 0, wrote: [], plan: { install: [], add: {} } });
    expect(npm.calls).toEqual([]);
    expect(bytes(root)).toEqual(held);
    expect(dependencyEvents(root)).toHaveLength(1);
  });
});

describe("CP1-DEPS (c): an undeclared or invalid name is refused, and nothing is written", () => {
  it("refuses an import the pinned entry does not declare (mutation: let an undeclared name through)", async () => {
    const root = world(items => { for (const row of items) if (row.registry === "shadcn-aria" && row.name === "resizable") row.dependencies = ["cn"]; });
    const held = bytes(root);
    const npm = stubNpm();
    const outcome = await declareStockDependencies(root, RESIZE, { npm });
    expect(outcome.exit).toBe(1);
    expect(outcome.refused).toMatch(/imports react-resizable-panels, which the consumer lockfile does not hold and shadcn-aria\/resizable@4\.23\.0, .* do not declare; code adds only declared dependencies$/);
    expect(outcome.wrote).toEqual([]);
    expect(npm.calls).toEqual([]);
    expect(bytes(root)).toEqual(held);
    expect(dependencyEvents(root)).toEqual([]);
    const cli = await runLoopCli(["loop.create", "--slot", `designer/${RESIZE}`, "--dry", "--root", root], root);
    expect(cli).toMatchObject({ exitCode: 1, message: expect.stringMatching(/adopt dependencies: refused: .*code adds only declared dependencies/) });
    expect(bytes(root)).toEqual(held);
  });

  it("refuses a declared range that is not one code writes (a git or URL spec)", async () => {
    const root = world(items => { for (const row of items) if (row.registry === "shadcn-aria" && row.name === "resizable") row.dependencies = ["cn", `${PANELS}@git+https://example.invalid/panels.git`]; });
    const held = bytes(root);
    const npm = stubNpm();
    const outcome = await declareStockDependencies(root, RESIZE, { npm });
    expect(outcome).toMatchObject({ exit: 1, wrote: [], refused: expect.stringMatching(/react-resizable-panels@git\+https:\/\/example\.invalid\/panels\.git is not a version code writes/) });
    expect(npm.calls).toEqual([]);
    expect(bytes(root)).toEqual(held);
    expect(dependencyEvents(root)).toEqual([]);
  });

  it("validates each name as an npm package name", () => {
    for (const name of ["react-resizable-panels", "lucide-react", "@radix-ui/react-slot", "class-variance-authority"]) expect(npmNameIssue(name), name).toBeUndefined();
    for (const name of ["", "React", "../evil", ".hidden", "_private", "-flag", "--ignore-scripts", "fs", "node:fs", "node_modules", "favicon.ico", "a b", "x".repeat(215), "@scope/", "git+https://x"]) expect(npmNameIssue(name), name).toEqual(expect.any(String));
  });

  it("puts package.json back and logs nothing when npm fails", async () => {
    const root = world();
    const held = bytes(root);
    const npm = stubNpm(1);
    const outcome = await declareStockDependencies(root, RESIZE, { npm });
    expect(outcome).toMatchObject({ exit: 1, wrote: [], refused: expect.stringMatching(/exited 1 .*npm ERR! stub failure/) });
    expect(npm.calls).toHaveLength(1);
    expect(bytes(root)).toEqual(held);
    expect(dependencyEvents(root)).toEqual([]);
  });
});

describe("CP1-DEPS (d): an item with nothing to install changes nothing", () => {
  it("leaves package.json and the lockfile alone, runs no npm and logs no event for the menu", async () => {
    const root = world();
    const held = bytes(root);
    const npm = stubNpm();
    expect(stockDependencyPlan(root, MENU)).toMatchObject({ plan: { install: [], add: {} } });
    expect(await declareStockDependencies(root, MENU, { npm })).toMatchObject({ exit: 0, wrote: [] });
    const run = await startRun(root, { loop: "loop.create", slot: `designer/${MENU}` }, hooks(npm), { now: clock() });
    expect(settleOf(root, run.state!.runId)).toMatchObject({ rule: "adopt", outcome: "settled" });
    expect(npm.calls).toEqual([]);
    expect(bytes(root)).toEqual(held);
    expect(dependencyEvents(root)).toEqual([]);
  });
});

describe("CP1-DEPS: clossys run loop.create --dry shows the dependency change and writes nothing", () => {
  it("lists the adopt step's package.json change and leaves the world as it was", async () => {
    const root = world();
    const held = bytes(root);
    const cli = await runLoopCli(["loop.create", "--slot", `designer/${RESIZE}`, "--dry", "--root", root], root);
    expect(cli.exitCode).toBe(0);
    expect(cli.message).toMatch(/nothing ran, nothing was written/);
    expect(cli.message).toMatch(/adopt dependencies: shadcn-aria\/resizable@4\.23\.0: package\.json dependencies \+ react-resizable-panels@latest, then npm install --no-audit --no-fund for react-resizable-panels/);
    expect(bytes(root)).toEqual(held);
    expect(existsSync(join(root, "clossys", ".state", "runs", "loops"))).toBe(false);
    expect(dependencyEvents(root)).toEqual([]);
    const menu = await runLoopCli(["loop.create", "--slot", `designer/${MENU}`, "--dry", "--root", root, "--json"], root);
    expect(menu.exitCode).toBe(0);
    expect(menu.message).toMatch(/every package it imports is in the consumer lockfile; package\.json is not changed/);
    expect(await runLoopCli(["loop.create", "--resume", "--dry", "--root", root], root)).toMatchObject({ exitCode: 2 });
  });
});

/**
 * CP1-PKGS: the cold consumer's lockfile lacks lucide-react (the fixture lockfile holds it), so the world drops it.
 * designer/frames.app-header ships shadcn-aria/sidebar-07 (lucide-react, declared by the shadcn-aria style row) and holds
 * no candidate; designer/components.tag-group ships diceui/tags-input, whose rows do not declare lucide-react.
 */
const LUCIDE = "lucide-react";
const APP_HEADER = "frames.app-header";
const TAG_GROUP = "components.tag-group";
function coldWorld(): string {
  const root = world();
  const lockFile = join(root, "package-lock.json");
  const lock = JSON.parse(readFileSync(lockFile, "utf8"));
  delete lock.packages[`node_modules/${LUCIDE}`];
  writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
  return root;
}
/** Every file under the world's clossys/ records (candidates, slot entries), as path -> bytes, outside the run state. */
function records(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name), at = rel ? `${rel}/${name}` : name;
      if (at === ".state") continue;
      if (statSync(path).isDirectory()) walk(path, at); else out[at] = readFileSync(path, "utf8");
    }
  };
  walk(join(root, "clossys"), "");
  return out;
}
const manifestHash = (registry: string, name: string): string =>
  (JSON.parse(readFileSync(join(DESIGNER, "..", "..", REFERENCE_MANIFEST), "utf8")).items as { registry: string; name: string; hash: string }[]).find(row => row.registry === registry && row.name === name)!.hash;

describe("CP1-PKGS (a): options --reference tells the truth and writes nothing", () => {
  it("options --reference prints the item, its hash and the dependency plan for an unlocked lucide-react import, and writes nothing", async () => {
    const root = coldWorld();
    const held = bytes(root), heldRecords = records(root);
    const hash = manifestHash("shadcn-aria", "sidebar-07");
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const text = await runCli(["options", `designer/${APP_HEADER}`, "--reference", "--root", root], root);
    expect(text.exitCode).toBe(0);
    expect(text.message).toContain(`designer/${APP_HEADER}: reference shadcn-aria/sidebar-07`);
    expect(text.message).toContain(`hash ${hash}`);
    expect(text.message).toMatch(/dependencies: shadcn-aria\/sidebar-07@4\.23\.0: package\.json dependencies \+ lucide-react@latest, then npm install --no-audit --no-fund for lucide-react/);
    expect(text.message).toContain(`apply: clossys run loop.create --slot designer/${APP_HEADER} adds them`);
    expect(text.message).toMatch(/--- file \S+/);
    const json = await runCli(["options", `designer/${APP_HEADER}`, "--reference", "--root", root, "--json"], root);
    expect(json.exitCode).toBe(0);
    expect(json.output).toMatchObject({ reference: expect.stringMatching(/^shadcn-aria\/sidebar-07@/), hash, dependencies: { plan: { install: [LUCIDE] } }, apply: { run: `clossys run loop.create --slot designer/${APP_HEADER}`, adopts: false } });
    expect(bytes(root)).toEqual(held);
    expect(records(root)).toEqual(heldRecords);
    expect(dependencyEvents(root)).toEqual([]);
  });

  it("prints the hash for a reference item that needs nothing (cold3 item 5)", async () => {
    const root = world();
    const text = await runCli(["options", `designer/${MENU}`, "--reference", "--root", root], root);
    expect(text.exitCode).toBe(0);
    expect(text.message.split("\n")[0]).toMatch(/: reference \S+ \(seed \S+\), hash sha256:[0-9a-f]{64}, \d+ file\(s\)/);
  });

  it("options --reference refuses an undeclared import and names it", async () => {
    const root = coldWorld();
    const held = bytes(root);
    const cli = await runCli(["options", `designer/${TAG_GROUP}`, "--reference", "--root", root], root);
    expect(cli.exitCode).toBe(1);
    expect(cli.message).toMatch(/options refused: designer\/components\.tag-group's reference diceui\/tags-input@\S+ \(hash sha256:[0-9a-f]{64}\): .*imports lucide-react, which the consumer lockfile does not hold and .* do not declare/);
    expect(cli.message).toContain(`clossys request --kind change --subject designer/${TAG_GROUP}`);
    expect(cli.message).toContain(AGENT_CREATES);
    expect(bytes(root)).toEqual(held);
  });

  it("no stock row refuses with what create means, the one wording the Designer skill step cites", async () => {
    const root = world();
    const skill = readFileSync(join(DESIGNER, "skill", "SKILL.md"), "utf8").replace(/\s+/g, " ");
    expect(skill).toContain(AGENT_CREATES);
    const cli = await runCli(["options", "designer/components.icon", "--reference", "--root", root], root);
    expect(cli).toMatchObject({ exitCode: 1, message: expect.stringMatching(/^options refused: designer\/components\.icon has no reference item: no shadcn-aria or diceui stock item ships/) });
    expect(cli.message).toContain(AGENT_CREATES);
  });
});

describe("CP1-PKGS (b): the dependency step covers a stock-shipped frames or sections slot", () => {
  it("loop.create on a stock-shipped frames slot adds the declared packages with one dependency.add, writes no candidate, and hands the slot to the agent", async () => {
    const root = coldWorld();
    const before = JSON.parse(bytes(root).manifest);
    const heldRecords = records(root);
    const npm = stubNpm();
    const packets: AgentPacket[] = [];
    const run = await startRun(root, { loop: "loop.create", slot: `designer/${APP_HEADER}` }, { ...hooks(npm), agent(packet) { packets.push(packet); return { exit: 0, model: "stub-model" }; } }, { now: clock() });
    const after = JSON.parse(bytes(root).manifest);
    expect(after.dependencies).toEqual({ ...before.dependencies, [LUCIDE]: "latest" });
    expect(npm.calls).toEqual([{ args: DEPENDENCY_INSTALL_ARGV, cwd: root }]);
    const events = dependencyEvents(root);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor: "code:adopt", kind: DEPENDENCY_EVENT, subject: `designer/${APP_HEADER}` });
    expect(settleOf(root, run.state!.runId)).toMatchObject({ rule: "adopt", outcome: "agent", settles: [], why: expect.stringMatching(/\(dependencies: shadcn-aria\/sidebar-07@4\.23\.0: package\.json dependencies \+ lucide-react@latest/) });
    const candidates = (r: Record<string, string>) => Object.keys(r).filter(path => path.startsWith(`agents/designer/${APP_HEADER}/`) && path.includes("candidate"));
    expect(candidates(records(root))).toEqual(candidates(heldRecords));
    expect(packets.some(packet => JSON.stringify(packet).includes(`designer/${APP_HEADER}`))).toBe(true);
  });

  it("a second run is a no-op", async () => {
    const root = coldWorld();
    await startRun(root, { loop: "loop.create", slot: `designer/${APP_HEADER}` }, hooks(stubNpm()), { now: clock() });
    const held = bytes(root);
    const npm = stubNpm();
    const second = await declareStockDependencies(root, APP_HEADER, { npm });
    expect(second).toMatchObject({ exit: 0, wrote: [], plan: { install: [], add: {} } });
    await startRun(root, { loop: "loop.create", slot: `designer/${APP_HEADER}` }, hooks(npm), { now: clock() });
    expect(npm.calls).toEqual([]);
    expect(bytes(root)).toEqual(held);
    expect(dependencyEvents(root)).toHaveLength(1);
  });

  it("--dry lists the change and writes nothing", async () => {
    const root = coldWorld();
    const held = bytes(root), heldRecords = records(root);
    const cli = await runLoopCli(["loop.create", "--slot", `designer/${APP_HEADER}`, "--dry", "--root", root], root);
    expect(cli.exitCode).toBe(0);
    expect(cli.message).toMatch(/adopt dependencies: shadcn-aria\/sidebar-07@4\.23\.0: package\.json dependencies \+ lucide-react@latest, then npm install --no-audit --no-fund for lucide-react \(declared by shadcn-aria\/sidebar-07@4\.23\.0, [^)]*\); code adopts no candidate here/);
    expect(bytes(root)).toEqual(held);
    expect(records(root)).toEqual(heldRecords);
    expect(dependencyEvents(root)).toEqual([]);
  });

  it("refuses an undeclared import on the sections path and installs nothing (mutation: let an undeclared name through)", async () => {
    const root = coldWorld();
    const plan = stockDependencyPlan(root, "sections.settings");
    expect(plan).toMatchObject({ refused: expect.stringMatching(/imports input-otp, which the consumer lockfile does not hold and .* not declare; code adds only declared dependencies$/) });
    const held = bytes(root);
    const npm = stubNpm();
    const run = await startRun(root, { loop: "loop.create", slot: "designer/sections.settings" }, hooks(npm), { now: clock() });
    expect(npm.calls).toEqual([]);
    expect(bytes(root)).toEqual(held);
    expect(dependencyEvents(root)).toEqual([]);
    expect(settleOf(root, run.state!.runId)).toMatchObject({ outcome: "agent", settles: [], why: expect.stringMatching(/no dependency was added: .*imports input-otp, which the consumer lockfile does not hold and .* not declare; code adds only declared dependencies$/) });
  });
});
