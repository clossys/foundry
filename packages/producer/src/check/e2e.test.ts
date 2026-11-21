/**
 * consumer.e2e (`clossys check --e2e`, src/check/e2e.ts): the parts that run without packing or installing anything.
 * The scenario Producer ships, the fixture that drops one pin, the install and render findings, the child environment,
 * the rule's registry row and loop.audit step, and `release --build --selection`. The full run (tarballs, npm install,
 * every verb, the built HTML) is `npm run check:e2e`, and check:rules runs its fixture.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseArgs } from "../cli/args.js";
import { runReleaseCli } from "../cli/release.js";
import type { BuildRequest, ReleaseBuilder } from "../release/build.js";
import { releaseWorld, stubBuilder, type ReleaseWorld } from "../release/__fixtures__/world.js";
import { E2E_CAUSES, E2E_CHECK, E2E_COHORT, childEnv, e2eDoc, installFindings, machineRoots, movedFinding, portableFindings, producerPackageRoot, readScenario, renderFindings, runScenario, type Clossys, type ScenarioStep } from "./e2e.js";

const PACKAGE = producerPackageRoot();
const SHIPPED = join(PACKAGE, "e2e");
const REPO = join(PACKAGE, "..", "..");
const FIXTURE = join(REPO, "scripts", "rules", "fixtures", "R-E2E-CONSUMER", "scenario.json");

const temps: string[] = [];
const worlds: ReleaseWorld[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const world of worlds.splice(0)) world.dispose();
});
const temp = (): string => { const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "e2e-test-"))); temps.push(dir); return dir; };

describe("check --e2e arguments", () => {
  it("takes --e2e with --from, --scenario and --keep on check only, and alone", () => {
    expect(parseArgs(["check", "--e2e", "--from", "packs", "--scenario", "s.json", "--keep"])).toMatchObject({ verb: "check", e2e: true, from: "packs", scenario: "s.json", keep: true });
    expect(() => parseArgs(["check", "--from", "packs"])).toThrow(/require check --e2e/);
    expect(() => parseArgs(["check", "--e2e", "--constitution"])).toThrow(/runs alone/);
    expect(() => parseArgs(["check", "--e2e", "--strict"])).toThrow(/runs alone/);
    expect(() => parseArgs(["publish", "--e2e"])).toThrow(/--e2e requires check/);
  });
});

describe("the shipped scenario", () => {
  const scenario = readScenario(SHIPPED);
  const crafts = scenario.steps.filter((step): step is ScenarioStep & { craft: NonNullable<ScenarioStep["craft"]> } => step.craft !== undefined);

  it("ships in the package (files lists e2e) and drives every agent from an empty consumer to a built page", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as { files: string[]; scripts: Record<string, string> };
    expect(manifest.files).toContain("e2e");
    expect(manifest.scripts["check:e2e"]).toBe("node dist/cli/index.js check --e2e");
    expect(scenario.steps[0]!.run).toEqual(["config", "--init"]);
    expect(crafts.map(step => step.craft.ref.split("/")[0])).toEqual(expect.arrayContaining(["writer", "designer", "publisher", "director"]));
    expect(scenario.build.slice(0, 3)).toEqual(["release", scenario.publication, "--build"]);
    expect(Object.values(scenario.render).flat().length).toBeGreaterThan(0);
  });

  it("names only public verbs: no step writes a record path, points at a root or imports package code", () => {
    for (const step of scenario.steps) for (const arg of step.run ?? []) {
      expect(arg, step.id).not.toMatch(/^--root$|clossys\/agents\/|clossys\/\.state\/|\.clossys\/|node_modules|dist\//);
    }
    for (const arg of scenario.build) expect(arg).not.toMatch(/^--root$|clossys\/agents\//);
    for (const step of scenario.after ?? []) for (const arg of step.run ?? []) expect(arg, step.id).not.toMatch(/^--root$|clossys\/agents\/|clossys\/\.state\/|\.clossys\/|node_modules|dist\//);
  });

  it("releases the built page: after the build and its repeat, the manifest is written and every release gate runs strict", () => {
    expect((scenario.after ?? []).map(step => [step.id, step.run])).toEqual([
      ["release.manifest", ["release", scenario.publication, "--manifest"]],
      ["release.gates", ["release", scenario.publication, "--gates"]],
    ]);
    for (const step of scenario.after ?? []) expect(step.expect ?? 0, step.id).toBe(0);
  });

  it("holds every file a craft step submits and every {scenario}/ file a step names", () => {
    for (const step of crafts) expect(existsSync(join(SHIPPED, step.craft.file)), `${step.id}: ${step.craft.file}`).toBe(true);
    const named = [...scenario.steps.flatMap(step => step.run ?? []), ...scenario.build].filter(arg => arg.startsWith("{scenario}/"));
    expect(named.length).toBeGreaterThan(0);
    for (const arg of named) expect(existsSync(join(SHIPPED, arg.slice("{scenario}/".length))), arg).toBe(true);
  });

  it("asserts every pinned string the page binds (the Writer strings) in the rendered HTML", () => {
    const strings = readFileSync(join(SHIPPED, "site.md"), "utf8");
    const page = JSON.parse(readFileSync(join(SHIPPED, "home.json"), "utf8")) as { copy: Record<string, string> };
    const html = Object.values(scenario.render).flat().join("\n");
    for (const [slot, ref] of Object.entries(page.copy)) {
      const key = ref.slice(ref.indexOf("#") + 1);
      const line = strings.split("\n").find(each => each.includes(key));
      expect(line, `${slot}: ${key} is a Writer key`).toBeDefined();
      expect(html, slot).toContain(`data-copy="${slot}"`);
    }
  });

  it("asserts the document title is the page's Writer title text, never the page id", () => {
    const strings = readFileSync(join(SHIPPED, "site.md"), "utf8").split("\n");
    const page = JSON.parse(readFileSync(join(SHIPPED, "home.json"), "utf8")) as { title: string };
    const heading = strings.indexOf(`### ${page.title}`);
    expect(heading, `${page.title} is a Writer key`).toBeGreaterThan(-1);
    const text = strings.slice(heading + 1).find(line => line.trim() && !line.startsWith("<!--"))!;
    expect(Object.values(scenario.render).flat()).toContain(`<title>${text}</title>`);
  });
});

describe("runScenario", () => {
  it("runs the shipped steps, the build and its repeat, then release.manifest and release.gates on that build", async () => {
    const scenario = readScenario(SHIPPED);
    const consumer = temp();
    const ran: Array<[string, readonly string[]]> = [];
    // A stand-in for the installed bin: every verb exits 0, a build writes the latest pointer and the routes it renders.
    const clossys: Clossys = async (id, argv) => {
      ran.push([id, argv]);
      if (id === "build" || id === "build.repeat") {
        const builds = join(consumer, "clossys", ".state", "builds");
        mkdirSync(builds, { recursive: true });
        writeFileSync(join(builds, `latest-${scenario.publication}.json`), JSON.stringify({ id: "0123456789abcdef" }));
        for (const [route, strings] of Object.entries(scenario.render)) {
          mkdirSync(join(builds, "01234567", "site", route), { recursive: true });
          writeFileSync(join(builds, "01234567", "site", route, "index.html"), strings.join("\n"));
        }
      }
      return { code: 0, stdout: id.endsWith(".packet") ? JSON.stringify({ manifest: [] }) : "", stderr: "" };
    };
    let built: unknown;
    await runScenario(scenario, SHIPPED, consumer, clossys, { say: () => undefined, findings: [], built: row => { built = row; } });
    expect(built).toMatchObject({ publication: scenario.publication, id: "0123456789abcdef" });
    expect(ran.slice(-4)).toEqual([
      ["build", scenario.build.map(arg => arg.replaceAll("{scenario}", SHIPPED))],
      ["build.repeat", scenario.build.map(arg => arg.replaceAll("{scenario}", SHIPPED))],
      ["release.manifest", ["release", scenario.publication, "--manifest"]],
      ["release.gates", ["release", scenario.publication, "--gates"]],
    ]);
    for (const step of scenario.steps.filter(step => step.run)) expect(ran.map(([id]) => id)).toContain(step.id);
  });
});

describe("readScenario", () => {
  const write = (body: unknown): string => { const file = join(temp(), "scenario.json"); writeFileSync(file, JSON.stringify(body)); return file; };

  it("drops a whole step by id, or only a craft's pin verb by <craft id>.pin", () => {
    const shipped = readScenario(SHIPPED);
    const dropped = readScenario(SHIPPED, write({ base: "shipped", without: ["ia.release"] }));
    expect(dropped.steps.map(step => step.id)).toEqual(shipped.steps.map(step => step.id).filter(id => id !== "ia.release"));
    const unpinned = readScenario(SHIPPED, write({ base: "shipped", without: ["craft.strings.pin"] }));
    expect(unpinned.steps.length).toBe(shipped.steps.length);
    expect(unpinned.steps.find(step => step.id === "craft.strings")!.craft!.unpinned).toBe(true);
    expect(unpinned.steps.filter(step => step.craft?.unpinned).map(step => step.id)).toEqual(["craft.strings"]);
    const ungated = readScenario(SHIPPED, write({ base: "shipped", without: ["release.gates"] }));
    expect(ungated.steps).toEqual(shipped.steps);
    expect(ungated.after!.map(step => step.id)).toEqual(["release.manifest"]);
  });

  it("refuses a step it does not hold, a run step's .pin, bad peers and a malformed scenario", () => {
    expect(() => readScenario(SHIPPED, write({ base: "shipped", without: ["craft.nothing"] }))).toThrow(/without names step craft\.nothing/);
    expect(() => readScenario(SHIPPED, write({ base: "shipped", without: ["config.init.pin"] }))).toThrow(/without names step config\.init\.pin/);
    const shipped = JSON.parse(readFileSync(join(SHIPPED, "scenario.json"), "utf8")) as Record<string, unknown>;
    expect(() => readScenario(SHIPPED, write({ ...shipped, peers: { react: "^19.0.0" } }))).toThrow(/exact versions/);
    expect(() => readScenario(SHIPPED, write({ ...shipped, peers: { "Bad Name": "1.0.0" } }))).toThrow(/exact versions/);
    expect(() => readScenario(SHIPPED, write({ ...shipped, schema: "clossys.e2e-scenario/0" }))).toThrow(/schema is/);
    expect(() => readScenario(SHIPPED, write({ ...shipped, steps: [{ id: "x" }] }))).toThrow(/needs run or craft/);
    expect(() => readScenario(SHIPPED, write({ ...shipped, steps: [{ id: "x", run: ["config"] }, { id: "x", run: ["config"] }] }))).toThrow(/unique/);
    expect(() => readScenario(SHIPPED, write({ ...shipped, after: [{ id: "config.init", run: ["config"] }] }))).toThrow(/unique/);
    expect(() => readScenario(SHIPPED, write({ ...shipped, after: [{ id: "build", run: ["config"] }] }))).toThrow(/unique/);
    expect(() => readScenario(SHIPPED, write({ ...shipped, after: { id: "x" } }))).toThrow(/after is a list/);
    const craft = (shipped.steps as ScenarioStep[]).find(step => step.craft)!;
    expect(() => readScenario(SHIPPED, write({ ...shipped, after: [{ ...craft, id: "after.craft" }] }))).toThrow(/after runs verbs only/);
  });

  it("the R-E2E-CONSUMER fixture drops exactly the Writer strings pin, an input the page's brief requires pinned", () => {
    const fixture = readScenario(SHIPPED, FIXTURE);
    expect(fixture.steps.filter(step => step.craft?.unpinned).map(step => step.craft!.ref)).toEqual(["writer/strings.site"]);
    const page = fixture.steps.find(step => step.id === "ia.page")!.run!;
    expect(page[page.indexOf("--inputs") + 1]!.split(",")).toContain("strings.site");
  });
});

describe("install and render findings", () => {
  /** A consumer whose lock resolves each cohort package to `pack/<name>.tgz` and whose bin is the installed Producer. */
  const consumer = (): { root: string; packed: Record<string, string> } => {
    const root = temp();
    const packed: Record<string, string> = {};
    const packages: Record<string, { resolved: string }> = {};
    mkdirSync(join(root, "pack"));
    for (const name of E2E_COHORT) {
      mkdirSync(join(root, "node_modules", "@clossys", name, "dist", "cli"), { recursive: true });
      packed[name] = join(root, "pack", `${name}.tgz`);
      packages[`node_modules/@clossys/${name}`] = { resolved: `file:pack/${name}.tgz` };
    }
    writeFileSync(join(root, "node_modules", "@clossys", "producer", "dist", "cli", "index.js"), "");
    mkdirSync(join(root, "node_modules", ".bin"));
    symlinkSync("../@clossys/producer/dist/cli/index.js", join(root, "node_modules", ".bin", "clossys"));
    writeFileSync(join(root, "package-lock.json"), JSON.stringify({ packages }));
    return { root, packed };
  };

  it("passes one copy of each first-party package from its tarball and the installed bin", () => {
    const { root, packed } = consumer();
    expect(installFindings(root, packed)).toEqual([]);
  });

  it("names a nested second copy, a copy not from its tarball and a bin outside the installed Producer", () => {
    const { root, packed } = consumer();
    mkdirSync(join(root, "node_modules", "@clossys", "publisher", "node_modules", "@clossys", "writer"), { recursive: true });
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as { packages: Record<string, { resolved: string }> };
    lock.packages["node_modules/@clossys/designer"] = { resolved: "https://registry.npmjs.org/@clossys/designer/-/designer-0.12.0.tgz" };
    writeFileSync(join(root, "package-lock.json"), JSON.stringify(lock));
    rmSync(join(root, "node_modules", ".bin", "clossys"));
    writeFileSync(join(root, "elsewhere.js"), "");
    symlinkSync("../../elsewhere.js", join(root, "node_modules", ".bin", "clossys"));
    const findings = installFindings(root, packed);
    expect(findings.map(row => `${row.cause} ${row.subject}`)).toEqual(["e2e.one-copy @clossys/designer", "e2e.one-copy @clossys/writer", "e2e.bin node_modules/.bin/clossys"]);
    expect(findings.every(row => row.check === E2E_CHECK)).toBe(true);
  });

  it("names a route with no index.html and every string its HTML lacks", () => {
    const build = temp();
    mkdirSync(join(build, "site", "install-home", "site", "home"), { recursive: true });
    writeFileSync(join(build, "site", "install-home", "site", "home", "index.html"), '<main data-frame="plain"><h1>Pages built from pinned records</h1></main>');
    expect(renderFindings(build, { "install-home/site/home": ['<main data-frame="plain">', "Pages built from pinned records"] })).toEqual([]);
    const rows = renderFindings(build, { "install-home/site/home": ["Every word on this page"], "install-about/site/about": ["x"] });
    expect(rows.map(row => `${row.cause} ${row.subject} ${row.detail}`)).toEqual([
      'e2e.render install-home/site/home index.html lacks "Every word on this page"',
      "e2e.render install-about/site/about the build holds no site/install-about/site/about/index.html",
    ]);
  });

  it("names every build file holding an absolute path of the consumer, and passes one that holds none", () => {
    const root = temp(), build = join(root, "consumer", "clossys", ".state", "builds", "abc");
    mkdirSync(join(build, "site", "install-home", ".clossys"), { recursive: true });
    writeFileSync(join(build, "site", "install-home", "index.html"), "<title>Plain Studio home</title>");
    writeFileSync(join(build, "site", "install-home", "app.js"), 'import "../../node_modules/react/index.js";');
    expect(portableFindings(build, [join(root, "consumer"), root])).toEqual([]);
    writeFileSync(join(build, "site", "install-home", ".clossys", "render-1.mjs"), `import "${join(root, "consumer", "node_modules", "react", "index.js")}";`);
    writeFileSync(join(build, "site", "install-home", "pack.json"), JSON.stringify({ from: join(root, "pack") }));
    expect(portableFindings(build, [join(root, "consumer"), root]).map(row => `${row.cause} ${row.subject} ${row.detail}`)).toEqual([
      `e2e.portable site/install-home/.clossys/render-1.mjs holds the consumer's absolute path ${join(root, "consumer")}`,
      `e2e.portable site/install-home/pack.json holds the consumer's absolute path ${root}`,
    ]);
  });

  it("names a build file holding the machine's home or temp path, a path that does not depend on where the consumer lives", () => {
    const root = temp(), build = join(root, "consumer", "clossys", ".state", "builds", "abc");
    mkdirSync(join(build, "site"), { recursive: true });
    const machine = { home: "/Users/someone", tmp: "/private/var/folders/xy/T" };
    writeFileSync(join(build, "site", "index.html"), "<title>Plain Studio home</title>");
    expect(portableFindings(build, [join(root, "consumer")], machine)).toEqual([]);
    writeFileSync(join(build, "site", "cache.js"), 'import "/Users/someone/.npm/_cacache/react/index.js";');
    writeFileSync(join(build, "site", "scratch.js"), 'import "/private/var/folders/xy/T/esbuild-1/out.js";');
    expect(portableFindings(build, [join(root, "consumer")], machine).map(row => `${row.cause} ${row.subject} ${row.detail}`)).toEqual([
      "e2e.portable site/cache.js holds the machine's home path /Users/someone",
      "e2e.portable site/scratch.js holds the machine's temp path /private/var/folders/xy/T",
    ]);
    // A home of "/" would match every file: it is no needle.
    expect(portableFindings(build, [join(root, "consumer")], { home: "/", tmp: "" }).map(row => row.subject)).toEqual([]);
  });

  it("searches the unresolved temp folder and /tmp/ as well as the real temp folder", () => {
    const root = temp(), build = join(root, "consumer", "clossys", ".state", "builds", "abc"), real = join(root, "real-temp"), link = join(root, "link-temp");
    mkdirSync(join(build, "site"), { recursive: true });
    mkdirSync(real);
    symlinkSync(real, link);
    const saved = process.env.TMPDIR;
    process.env.TMPDIR = link;
    let machine: ReturnType<typeof machineRoots>;
    try { machine = machineRoots(); } finally { if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved; }
    expect(machine.tmp).toEqual([realpathSync(link), link, "/tmp/"]);
    writeFileSync(join(build, "site", "index.html"), "<title>Plain Studio home</title>");
    expect(portableFindings(build, [join(root, "consumer")], machine)).toEqual([]);
    writeFileSync(join(build, "site", "raw.js"), `import "${link}/esbuild-1/out.js";`);
    writeFileSync(join(build, "site", "slash-tmp.js"), 'import "/tmp/esbuild-out/x.js";');
    expect(portableFindings(build, [join(root, "consumer")], machine).map(row => `${row.cause} ${row.subject} ${row.detail}`)).toEqual([
      `e2e.portable site/raw.js holds the machine's temp path ${link}`,
      "e2e.portable site/slash-tmp.js holds the machine's temp path /tmp/",
    ]);
  });

  it("the consumer moved elsewhere must build the same digest: another digest or none is a blocking e2e.portable", () => {
    const at = { work: "/w", origin: "/w/consumer", moved: "/w/moved/elsewhere/consumer" };
    const first = { id: "94d3f99e3be3aaaa" };
    expect(movedFinding("example-site", first, { id: "94d3f99e3be3aaaa" }, at)).toBeUndefined();
    expect(movedFinding("example-site", first, { id: "f842824a595ebbbb" }, at)).toEqual({ check: E2E_CHECK, cause: "e2e.portable", subject: "example-site", detail: "the consumer moved to moved/elsewhere/consumer builds f842824a595e, at consumer it built 94d3f99e3be3" });
    expect(movedFinding("example-site", first, undefined, at)?.detail).toBe("the consumer moved to moved/elsewhere/consumer builds nothing, at consumer it built 94d3f99e3be3");
  });

  it("drops every CLOSSYS_* and npm_* variable from the child environment and points the registry at the stub", () => {
    const env = childEnv("http://127.0.0.1:1/r", { PATH: "/bin", CLOSSYS_ROOT: "/elsewhere", CLOSSYS_SKIP: "1", npm_config_prefix: "/x", INIT_CWD: "/y" });
    expect(env).toEqual({ PATH: "/bin", REGISTRY_URL: "http://127.0.0.1:1/r", NO_COLOR: "1", FORCE_COLOR: "0" });
  });
});

describe("the rule and its wiring", () => {
  it("is R-E2E-CONSUMER in scripts/rules/registry.json, its note generated from E2E_STATEMENT and E2E_CAUSES", () => {
    const registry = JSON.parse(readFileSync(join(REPO, "scripts", "rules", "registry.json"), "utf8")) as { rules: { id: string; status: string; checks: string[]; fixture: string; fixture_runs: { check: string; run: string; expect: string }[]; note: string }[] };
    const row = registry.rules.find(rule => rule.id === "R-E2E-CONSUMER")!;
    expect(row).toMatchObject({ status: "enforced", checks: ["packages/producer#check:e2e"], fixture: "scripts/rules/fixtures/R-E2E-CONSUMER" });
    expect(row.note).toBe(e2eDoc());
    for (const cause of Object.keys(E2E_CAUSES)) expect(row.note).toContain(cause);
    expect(row.fixture_runs).toHaveLength(1);
    expect(row.fixture_runs[0]!.run).toContain("check --e2e --scenario {fixture}/scenario.json");
    expect(new RegExp(row.fixture_runs[0]!.expect, "m").test("  e2e.step  craft.page.brief  clossys next ... refused: craft:brief refused: input writer/strings.site is unpinned; fix: ...")).toBe(true);
  });

  it("runs under check:studio and as loop.audit's last step, whose failure the owner hears about", () => {
    const studio = JSON.parse(readFileSync(join(PACKAGE, "scripts", "check-studio.json"), "utf8")) as { checks: { id: string; run: string; cwd: string }[] };
    expect(studio.checks).toContainEqual(expect.objectContaining({ id: "producer check:e2e", cwd: "packages/producer", run: "npm run check:e2e" }));
    const audit = JSON.parse(readFileSync(join(PACKAGE, "loops", "loop.audit", "audit-v1.json"), "utf8")) as { content: { steps: { id: string; cli: string; checks: string[]; decider: { by: string }; onFail?: { raise: string } }[] } };
    const last = audit.content.steps.at(-1)!;
    expect(last).toMatchObject({ id: "e2e", cli: "clossys check --e2e", checks: [E2E_CHECK], decider: { by: "code" }, onFail: { raise: "queue.clarify" } });
  });
});

describe("release --build --selection", () => {
  it("hands the selection module and export to the builder, resolved from the caller's directory", async () => {
    const world = releaseWorld(); worlds.push(world);
    let seen: BuildRequest | undefined;
    const builder: ReleaseBuilder = async request => { seen = request; return stubBuilder(request); };
    const result = await runReleaseCli(["site", "--build", "--selection", "./selection.js#componentSelection", "--root", world.root], world.root, { builder });
    expect(result.exitCode, result.message).toBe(0);
    expect(seen?.selection).toEqual({ module: "./selection.js", export: "componentSelection" });
    expect(seen?.cwd).toBe(world.root);
    await runReleaseCli(["site", "--build", "--selection", "./selection.js", "--root", world.root], world.root, { builder });
    expect(seen?.selection).toEqual({ module: "./selection.js" });
  });

  it("takes --selection only with --build, and only with a value", async () => {
    const world = releaseWorld(); worlds.push(world);
    expect((await runReleaseCli(["site", "--manifest", "--selection", "./s.js", "--root", world.root], world.root, { builder: stubBuilder })).exitCode).toBe(2);
    expect((await runReleaseCli(["site", "--build", "--selection", "--root", world.root], world.root, { builder: stubBuilder })).exitCode).toBe(2);
  });
});
