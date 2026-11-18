/**
 * `clossys release <pub> --build|--manifest|--gates|--ready` and the ready-pin (flows.md F8), on a tmp consumer
 * (release/__fixtures__/world.ts) with a stub builder. Nothing is deployed or published; the ready-pin is written only
 * in the tmp consumer.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../cli/main.js";
import { runReleaseCli } from "../cli/release.js";
import { cliHooks } from "../loop/cli.js";
import { ledgerDir, resumeRun, startRun } from "../loop/runner.js";
import { answerQueueEntry } from "../queue/answer.js";
import { raiseFeedback } from "../queue/feedback.js";
import { readdirSync } from "node:fs";
import type { LedgerEntry } from "../records/types.js";
import { closeWork, raiseWork } from "../records/request.js";
import { latestBuild } from "./build.js";
import { RELEASE_GATES } from "./gates.js";
import { latestManifest } from "./manifest.js";
import { checkReleaseReady } from "./ready.js";
import { clock, releaseWorld, stubBuilder, type ReleaseWorld } from "./__fixtures__/world.js";

const worlds: ReleaseWorld[] = [];
afterEach(() => { for (const world of worlds.splice(0)) world.dispose(); });
const make = (...args: Parameters<typeof releaseWorld>): ReleaseWorld => { const world = releaseWorld(...args); worlds.push(world); return world; };

const release = (world: ReleaseWorld, flag: string, now = clock()) => runReleaseCli(["site", flag, "--root", world.root], world.root, { builder: stubBuilder, now });
const out = (result: Awaited<ReturnType<typeof runReleaseCli>>) => result.output as { wrote: string[]; findings: { check?: string; subject: string; detail: string }[]; [key: string]: unknown };
const pin = (world: ReleaseWorld, manifest: string, entry: string) => runCli(["pin", "publisher/release.site", manifest, "--by", `owner:${entry}`, "--root", world.root], world.root);

/** build, manifest, gates, owner sign-off and the ready-pin, all green. Returns the manifest name and the entry. */
async function ready(world: ReleaseWorld, now = clock()): Promise<{ manifest: string; entry: string }> {
  expect((await release(world, "--build", now)).exitCode).toBe(0);
  const manifest = await release(world, "--manifest", now);
  expect(manifest.exitCode, manifest.message).toBe(0);
  expect((await release(world, "--gates", now)).exitCode).toBe(0);
  const name = out(manifest).wrote[0]!.split("/").pop()!;
  const entry = world.signoff(now);
  const pinned = await pin(world, name, entry);
  expect(pinned.exitCode, pinned.message).toBe(0);
  return { manifest: name, entry };
}

describe("clossys release --build", () => {
  it("builds into .clossys/builds/<id8>/ and names the build by the digest of its bytes", async () => {
    const world = make();
    const result = await release(world, "--build");
    expect(result.exitCode, result.message).toBe(0);
    const build = latestBuild(world.root, "site")!;
    expect(build.id).toMatch(/^[0-9a-f]{64}$/);
    expect(build.path).toBe(`.clossys/builds/${build.id.slice(0, 8)}/`);
    expect(build.locales).toEqual(["en", "fr"]);
    expect(existsSync(join(world.root, build.path, "site", "index.html"))).toBe(true);
    expect(build.pins["writer/sections.hero.copy#home.hero"]).toMatch(/^home\.hero-v1\.json@[0-9a-f]{64}$/);
    expect(existsSync(join(world.root, "clossys", "agents", "publisher", "release.site", "pin.json"))).toBe(false);
  });

  it("refuses a publication with no release slot", async () => {
    const world = make();
    const result = await runReleaseCli(["blog", "--build", "--root", world.root], world.root, { builder: stubBuilder });
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("no release slot for blog");
  });

  it("takes exactly one action and no skip flag", async () => {
    const world = make();
    expect((await runReleaseCli(["site", "--build", "--gates", "--root", world.root], world.root)).exitCode).toBe(2);
    expect((await runReleaseCli(["site", "--gates", "--skip", "copy.locales", "--root", world.root], world.root)).exitCode).toBe(2);
    expect((await runReleaseCli(["site", "--root", world.root], world.root)).exitCode).toBe(2);
  });
});

describe("clossys release --manifest", () => {
  it("writes publisher/release.site/candidates/site-v1.json with every pin at its full sha256 and the gate results", async () => {
    const world = make();
    await release(world, "--build");
    const result = await release(world, "--manifest");
    expect(result.exitCode, result.message).toBe(0);
    expect(out(result).wrote).toEqual(["publisher/release.site/candidates/site-v1.json"]);
    const manifest = latestManifest(world.root, "site")!;
    expect(manifest.issues).toEqual([]);
    expect(manifest.header).toMatchObject({ createdBy: { actor: "code", cli: "clossys release site --manifest" }, source: { kind: "original" } });
    const content = manifest.content!;
    expect(content.build.id).toBe(latestBuild(world.root, "site")!.id);
    expect(Object.keys(content.pins)).toEqual(["designer/sections.hero", "director/focus.reach.geography", "publisher/page.home", "writer/sections.hero.copy#home.hero"]);
    for (const value of Object.values(content.pins)) expect(value).toMatch(/@[0-9a-f]{64}$/);
    expect(Object.keys(content.checks)).toEqual([...RELEASE_GATES]);
    expect(Object.values(content.checks).every(status => status === "pass")).toBe(true);
    expect(content.previous).toBeNull();
  });

  it("does not write the same manifest twice, and refuses when the pins moved since the build", async () => {
    const world = make();
    const now = clock();
    await release(world, "--build", now);
    await release(world, "--manifest", now);
    const again = await release(world, "--manifest", now);
    expect(out(again).wrote).toEqual(["publisher/release.site/candidates/site-v1.json"]);
    expect(again.message).toContain("already lists this build");
    world.repin("designer/sections.hero", 2);
    const moved = await release(world, "--manifest", now);
    expect(moved.exitCode).toBe(1);
    expect(moved.message).toContain("pins changed since build");
  });
});

describe("clossys release --gates", () => {
  it("passes a green release and writes the check result for the manifest", async () => {
    const world = make();
    await release(world, "--build");
    await release(world, "--manifest");
    const result = await release(world, "--gates");
    expect(result.exitCode, result.message).toBe(0);
    expect(out(result).wrote).toEqual([".clossys/checks/publisher/release.site/site-v1.json.json"]);
    const doc = JSON.parse(world.read(".clossys/checks/publisher/release.site/site-v1.json.json"));
    expect(doc).toMatchObject({ schema: "clossys.check-result/1", subject: "publisher/release.site/site-v1.json", status: "pass", subjectSha256: latestManifest(world.root, "site")!.sha256 });
  });

  it("fails copy.locales when a release locale is missing from a copy record", async () => {
    const world = make();
    world.repin("writer/sections.hero.copy", 2, { fields: { "header.heading": { en: "placeholder" } } });
    await release(world, "--build");
    await release(world, "--manifest");
    const result = await release(world, "--gates");
    expect(result.exitCode).toBe(1);
    expect(out(result).findings).toContainEqual(expect.objectContaining({ check: "copy.locales", subject: "writer/sections.hero.copy#home.hero", detail: "header.heading has no fr value" }));
  });

  it("fails release.locales when the locales key is still unresolved", async () => {
    const world = make({ locales: { from: "director/focus.reach.geography:Markets" } });
    await release(world, "--build");
    await release(world, "--manifest");
    const result = await release(world, "--gates");
    expect(result.exitCode).toBe(1);
    expect(out(result).findings.map(row => row.check)).toContain("release.locales");
  });

  it("fails an unknown gate the release contract adds (fail closed)", async () => {
    const world = make();
    const file = join(world.root, "clossys/agents/publisher/release.site/slot.json");
    const slot = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, `${JSON.stringify({ ...slot, contract: { ...slot.contract, gates: ["release.made-up"] } }, null, 2)}\n`);
    await release(world, "--build");
    await release(world, "--manifest");
    const result = await release(world, "--gates");
    expect(result.exitCode).toBe(1);
    expect(out(result).checks).toMatchObject({ "release.made-up": "fail" });
  });
});

describe("requests.open-fix", () => {
  const fixOn = (world: ReleaseWorld, target: string) => raiseWork(join(world.root, "clossys"), {
    kind: "fix", target, from: "owner", why: "the hero overflows at 320px", source: "check", by: "producer", at: "2026-11-20T07:30:00Z",
    check: "render.overflow", findings: ["hero heading overflows at 320px"], cause: "the heading has no wrap rule",
  }).request;

  it("refuses a release while an open fix is about a section a page of the release reads", async () => {
    const world = make();
    const fix = fixOn(world, "designer/sections.hero");
    await release(world, "--build");
    await release(world, "--manifest");
    const result = await release(world, "--gates");
    expect(result.exitCode).toBe(1);
    expect(out(result).checks).toMatchObject({ "requests.open-fix": "fail" });
    expect(out(result).findings).toContainEqual(expect.objectContaining({ check: "requests.open-fix", subject: "designer/sections.hero", detail: expect.stringContaining(`queue.fix#${fix.id}`) }));
  });

  it("passes once that fix closes with its result", async () => {
    const world = make();
    const fix = fixOn(world, "designer/sections.hero");
    closeWork(join(world.root, "clossys"), fix.id, { by: "producer", at: "2026-11-20T07:40:00Z", outcome: "fixed", result: "designer/sections.hero" });
    await release(world, "--build");
    await release(world, "--manifest");
    const result = await release(world, "--gates");
    expect(result.exitCode, result.message).toBe(0);
  });

  it("refuses a release while an open fix is about a Writer record slot (the release reads writer/sections.hero.copy#home.hero)", async () => {
    const world = make();
    const fix = fixOn(world, "writer/sections.hero.copy");
    await release(world, "--build");
    await release(world, "--manifest");
    const result = await release(world, "--gates");
    expect(result.exitCode).toBe(1);
    expect(out(result).findings).toContainEqual(expect.objectContaining({ check: "requests.open-fix", subject: "writer/sections.hero.copy", detail: expect.stringContaining(`queue.fix#${fix.id}`) }));
  });

  it("refuses a release over an open queue-entry/1 fix about a Writer record (the older fix path)", async () => {
    const world = make();
    const entry = raiseFeedback(world.root, { ref: "writer/sections.hero.copy#home.hero", words: "the hero heading is too long", via: "chat" }, new Date("2026-11-20T07:35:00Z"));
    expect(entry).toMatchObject({ queue: "queue.fix", decider: "agent:writer", subject: { to: "writer/sections.hero.copy", record: "home.hero" } });
    await release(world, "--build");
    await release(world, "--manifest");
    const result = await release(world, "--gates");
    expect(result.exitCode).toBe(1);
    expect(out(result).findings).toContainEqual(expect.objectContaining({ check: "requests.open-fix", subject: "writer/sections.hero.copy", detail: expect.stringContaining(`queue.fix#${entry.id}`) }));
  });

  it("fails closed on a fix entry that does not read", async () => {
    const world = make();
    world.write("clossys/agents/producer/queue.fix/entries/20261120T0700Z-fix-broken.json", `${JSON.stringify({ schema: "clossys.queue-entry/2", id: "20261120T0700Z-fix-broken", kind: "fix" })}\n`);
    await release(world, "--build");
    await release(world, "--manifest");
    const result = await release(world, "--gates");
    expect(result.exitCode).toBe(1);
    expect(out(result).findings.map(row => row.check)).toContain("requests.open-fix");
  });
});

describe("the ready-pin", () => {
  it("is pinned through clossys pin by the owner's ready answer, and release.ready passes", async () => {
    const world = make();
    const { manifest, entry } = await ready(world);
    const doc = JSON.parse(world.read("clossys/agents/publisher/release.site/pin.json"));
    expect(doc).toMatchObject({ schema: "clossys.pin/2", candidate: manifest, sha256: latestManifest(world.root, "site")!.sha256, decidedBy: `owner:${entry}`, basis: "picked" });
    expect(checkReleaseReady(world.root)).toMatchObject({ status: "pass", findings: [] });
    expect((await release(world, "--ready")).exitCode).toBe(0);
  });

  it("is refused for an owner answer of not-ready", async () => {
    const world = make();
    const now = clock();
    await release(world, "--build", now);
    await release(world, "--manifest", now);
    const entry = world.signoff(now, "not-ready");
    const result = await pin(world, "site-v1.json", entry);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("not ready");
  });

  it("is refused for an answer raised before the manifest was written", async () => {
    const world = make();
    const entry = world.signoff(clock("2026-11-20T06:00:00Z"));
    await release(world, "--build");
    await release(world, "--manifest");
    const result = await pin(world, "site-v1.json", entry);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("before the manifest was written");
  });

  it("is refused for a planner or agent pin", async () => {
    const world = make();
    await release(world, "--build");
    await release(world, "--manifest");
    const result = await runCli(["pin", "publisher/release.site", "site-v1.json", "--by", "planner", "--root", world.root], world.root);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("basis planner");
  });

  it("follows the ready version: the next manifest derives from it and diffs its pins", async () => {
    const world = make();
    const now = clock();
    await ready(world, now);
    world.repin("designer/sections.hero", 2);
    await release(world, "--build", now);
    const next = await release(world, "--manifest", now);
    expect(out(next).wrote).toEqual(["publisher/release.site/candidates/site-v2.json"]);
    const content = latestManifest(world.root, "site")!;
    expect(content.content!.previous).toBe("site-v1.json");
    expect(content.content!.diff.map(row => row.ref)).toEqual(["designer/sections.hero"]);
    expect(content.header!.source).toEqual({ kind: "derived", ref: ["publisher/release.site/site-v1.json"] });
  });
});

describe("loop.release through clossys release", () => {
  it("runs compile, build, manifest, gates, the owner sign-off and the ready-pin, and ends on release.ready", async () => {
    const world = make();
    const now = clock();
    const run = (argv: readonly string[], cwd: string) => argv[0] === "compile"
      ? Promise.resolve({ exitCode: 0 as const, message: "compiled (stub)" })
      : argv[0] === "release" ? runReleaseCli(argv.slice(1), cwd, { builder: stubBuilder, now }) : runCli(argv, cwd);
    const hooks = cliHooks(world.root, undefined, run);
    const started = await startRun(world.root, { loop: "loop.release", publication: "site" }, hooks, { now });
    expect(started.entry, started.message).toMatch(/^queue\.approve#/);
    expect(started.state!.vars.manifest).toBe("site-v1.json");
    answerQueueEntry(world.root, { entry: started.entry!, answer: "ready", by: "owner", via: "chat", quote: "owner said: ready" }, now());
    const done = await resumeRun(world.root, started.state!.runId, hooks, { now });
    expect(done.exitCode, done.message).toBe(0);
    const dir = ledgerDir(world.root, "loop.release");
    const ledger = JSON.parse(readFileSync(join(dir, readdirSync(dir).sort().pop()!), "utf8")) as LedgerEntry;
    expect(ledger.status).toBe("pinned-ready");
    expect(ledger.steps.map(step => `${step.id}:${step.exit}`)).toEqual(["compile:0", "build:0", "manifest:0", "gates:0", "signoff:0", "pin:0"]);
    expect(ledger.checks["release.ready"]).toBe("pass");
    expect(checkReleaseReady(world.root).status).toBe("pass");
  });

  it("stops at a red gate and routes its findings to queue.fix: no sign-off, no ready-pin", async () => {
    const world = make();
    world.repin("writer/sections.hero.copy", 2, { fields: { "header.heading": { en: "placeholder" } } });
    const now = clock();
    const run = (argv: readonly string[], cwd: string) => argv[0] === "compile"
      ? Promise.resolve({ exitCode: 0 as const, message: "compiled (stub)" })
      : argv[0] === "release" ? runReleaseCli(argv.slice(1), cwd, { builder: stubBuilder, now }) : runCli(argv, cwd);
    const result = await startRun(world.root, { loop: "loop.release", publication: "site" }, cliHooks(world.root, undefined, run), { now });
    expect(result.exitCode).toBe(1);
    expect(result.state!.raised.some(name => name.startsWith("queue.fix#"))).toBe(true);
    expect(result.state!.raised.some(name => name.startsWith("queue.approve#"))).toBe(false);
    expect(existsSync(join(world.root, "clossys/agents/publisher/release.site/pin.json"))).toBe(false);
  });
});

describe("clossys release dispatch", () => {
  it("reaches the release CLI from runCli", async () => {
    const result = await runCli(["release", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("clossys release <publication>");
  });
});
