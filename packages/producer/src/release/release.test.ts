/**
 * `clossys publisher release <pub> --build|--manifest|--gates|--ready` and the ready-pin (flows.md F8), on a tmp consumer
 * (release/__fixtures__/world.ts) with a stub builder. Nothing is deployed or published; the ready-pin is written only
 * in the tmp consumer.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../cli/main.js";
import { runReleaseCli } from "../cli/release.js";
import { cliHooks } from "../loop/cli.js";
import { ledgerDir, resumeRun, startRun } from "../loop/runner.js";
import { answerQueueEntry } from "../queue/answer.js";
import { raiseEntry } from "../loop/route.js";
import { readdirSync } from "node:fs";
import type { LedgerEntry } from "../records/types.js";
import { closeWork, raiseWork } from "../records/request.js";
import { cliActor } from "../records/pin.js";
import { writeTargetPin } from "../records/pin-map.js";
import { sha256Hex } from "../records/hash.js";
import { lastRecordState } from "../records/ledger.js";
import { readLedger } from "../records/slots.js";
import { candidateCodec } from "../records/candidate-codec.js";
import { latestBuild } from "./build.js";
import { RELEASE_GATES } from "./gates.js";
import { latestManifest } from "./manifest.js";
import { checkReleaseReady, readyFindings } from "./ready.js";
import { clock, releaseWorld, geographyBrief, stubBuilder, type ReleaseWorld } from "./__fixtures__/world.js";
import { buildCandidateHeader, serializeCandidate } from "../records/candidate.js";
import { candidateIssues, readSlotValue } from "../records/slot-current.js";
import { writeCandidateBytes } from "../records/slot-write.js";
import { STEPS } from "../pipeline/steps/index.js";

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

describe("clossys publisher release --build", () => {
  it("builds into clossys/.state/builds/<id8>/ and names the build by the digest of its bytes", async () => {
    const world = make();
    const result = await release(world, "--build");
    expect(result.exitCode, result.message).toBe(0);
    const build = latestBuild(world.root, "site")!;
    expect(build.id).toMatch(/^[0-9a-f]{64}$/);
    expect(build.path).toBe(`clossys/.state/builds/${build.id.slice(0, 8)}/`);
    expect(build.locales).toEqual(["en", "fr"]);
    expect(existsSync(join(world.root, build.path, "site", "index.html"))).toBe(true);
    expect(build.pins["writer/sections.hero.copy#home.hero"]).toMatch(/^home\.hero-v1\.md@[0-9a-f]{64}$/);
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

describe("clossys publisher release --manifest", () => {
  it("writes publisher/release.site/candidates/site-v1.json with every pin at its full sha256 and the gate results", async () => {
    const world = make();
    await release(world, "--build");
    const result = await release(world, "--manifest");
    expect(result.exitCode, result.message).toBe(0);
    expect(out(result).wrote).toEqual(["publisher/release.site/candidates/site-v1.json"]);
    const manifest = latestManifest(world.root, "site")!;
    expect(manifest.issues).toEqual([]);
    expect(manifest.header).toMatchObject({ createdBy: { actor: "code", cli: "clossys publisher release site --manifest" }, source: { kind: "original" } });
    const content = manifest.content!;
    expect(content.build.id).toBe(latestBuild(world.root, "site")!.id);
    expect(Object.keys(content.pins)).toEqual(["designer/frames.site-shell", "designer/sections.hero", "director/focus.reach.geography", "director/identity.verbal.voice", "publisher/page.home", "writer/sections.hero.copy#home.hero"]);
    for (const value of Object.values(content.pins)) expect(value).toMatch(/@[0-9a-f]{64}$/);
    expect(Object.keys(content.checks)).toEqual([...RELEASE_GATES]);
    expect(Object.values(content.checks).every(status => status === "pass")).toBe(true);
    expect(content.previous).toBeNull();
    // The manifest has provenance like every candidate (R14.1): one submit event with its name and the bytes' sha256,
    // written by Producer code through the publisher.release action; the world's slot.json write is recorded too.
    const dir = join(world.root, "clossys/agents/publisher/release.site");
    const events = (readLedger(dir, "slot")?.events ?? []) as unknown as Record<string, unknown>[];
    const submits = events.filter(event => event.op === "submit");
    expect(submits).toHaveLength(1);
    // It names its ladder rung (R03.1, CP1-U2 G12): the manifest adapts the build it records, its seed.
    expect(submits[0]).toMatchObject({ name: "site-v1.json", sha256: manifest.sha256, rung: "adapt", seed: `build:${content.build.id}` });
    expect(JSON.stringify(submits[0])).toContain("packages/producer/actions/publisher.release/action.json");
    expect(lastRecordState(events, "slot.json")?.sha256).toBe(sha256Hex(readFileSync(join(dir, "slot.json"))));
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

describe("clossys publisher release --gates", () => {
  it("passes a green release and writes the check result for the manifest", async () => {
    const world = make();
    await release(world, "--build");
    await release(world, "--manifest");
    const result = await release(world, "--gates");
    expect(result.exitCode, result.message).toBe(0);
    expect(out(result).wrote).toEqual(["clossys/.state/checks/publisher/release.site/site-v1.json.json"]);
    const doc = JSON.parse(world.read("clossys/.state/checks/publisher/release.site/site-v1.json.json"));
    expect(doc).toMatchObject({ schema: "clossys.check-result/1", subject: "publisher/release.site/site-v1.json", status: "pass", subjectSha256: latestManifest(world.root, "site")!.sha256 });
  });

  it("fails copy.locales when a release locale is missing from a copy record (the brief adds de, the copy carries en and fr)", async () => {
    const world = make();
    world.repin("director/focus.reach.geography", 2, geographyBrief("en, fr, de"));
    await release(world, "--build");
    await release(world, "--manifest");
    const result = await release(world, "--gates");
    expect(result.exitCode).toBe(1);
    expect(out(result).findings).toContainEqual(expect.objectContaining({ check: "copy.locales", subject: "writer/sections.hero.copy#home.hero", detail: "header.heading has no de value" }));
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
    // A fix closes fixed only by its assignee (or the owner), and only when its own check passes again on the target.
    const fix = raiseWork(join(world.root, "clossys"), {
      kind: "fix", target: "designer/sections.hero", from: "owner", why: "the hero did not resolve", source: "check", by: "producer", at: "2026-11-20T07:30:00Z",
      check: "pins.resolve", findings: ["designer/sections.hero does not resolve"], cause: "the hero had no pin",
    }).request;
    closeWork(join(world.root, "clossys"), fix.id, { by: "designer", at: "2026-11-20T07:40:00Z", outcome: "fixed", result: "designer/sections.hero" });
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
    // A consumer may still hold a queue-entry/1 fix written before Q10 (nothing in Producer raises one now).
    const { entry } = raiseEntry(world.root, { queue: "queue.fix", subject: { to: "writer/sections.hero.copy", record: "home.hero", rel: "input" }, decider: "agent:writer", ask: "the hero heading is too long", slug: "sections-hero-copy" }, "2026-11-20T07:35:00Z");
    expect(entry).toMatchObject({ schema: "clossys.queue-entry/1", queue: "queue.fix", decider: "agent:writer", subject: { to: "writer/sections.hero.copy", record: "home.hero" } });
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
    // clossys pin refuses on the owner's answer first (cli/pin.ts); release.ready names the same answer.
    expect(result.message).toContain("was answered not-ready");
    expect(readyFindings(world.root, "site", { candidate: "site-v1.json" as never, decidedBy: `owner:${entry}`, basis: "picked", at: "2026-11-21T00:00:00Z" as never }).map(row => row.detail))
      .toContain(`${entry} was answered not-ready, not ready`);
  });

  it("is refused for an answer raised before the manifest was written", async () => {
    const world = make();
    const entry = world.signoff(clock("2026-11-20T06:00:00Z"));
    await release(world, "--build");
    await release(world, "--manifest");
    const result = await pin(world, "site-v1.json", entry);
    expect(result.exitCode).toBe(1);
    // clossys pin refuses on the owner's answer first (cli/pin.ts): it was raised before the manifest, so it names none.
    expect(result.message).toContain("about no candidate, not site-v1.json");
    expect(readyFindings(world.root, "site", { candidate: "site-v1.json" as never, decidedBy: `owner:${entry}`, basis: "picked", at: "2026-11-21T00:00:00Z" as never }).map(row => row.detail)
      .some(detail => detail.includes("before the manifest was written"))).toBe(true);
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

/**
 * The loop's release steps run `clossys publisher release <pub> --<step>`; here its release step runs over the stub
 * builder. The world's page record predates page bindings, so its publisher.check gate (actions/publisher.test.ts) is
 * not what these tests judge: they judge that the loop calls the publisher release verb and keeps the step's output.
 */
const viaPublisherRelease = (argv: readonly string[], cwd: string, now: () => Date) => {
  expect(argv.slice(0, 2)).toEqual(["publisher", "release"]);
  return runReleaseCli(argv.slice(2), cwd, { builder: stubBuilder, now });
};

describe("loop.release through clossys publisher release", () => {
  it("runs compile, build, manifest, gates, the owner sign-off and the ready-pin, and ends on release.ready", async () => {
    const world = make();
    const now = clock();
    const run = (argv: readonly string[], cwd: string) => argv[0] === "compile"
      ? Promise.resolve({ exitCode: 0 as const, message: "compiled (stub)" })
      : argv[0] === "publisher" && argv[1] === "release" ? viaPublisherRelease(argv, cwd, now) : runCli(argv, cwd);
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
    world.repin("director/focus.reach.geography", 2, geographyBrief("en, fr, de"));
    const now = clock();
    const run = (argv: readonly string[], cwd: string) => argv[0] === "compile"
      ? Promise.resolve({ exitCode: 0 as const, message: "compiled (stub)" })
      : argv[0] === "publisher" && argv[1] === "release" ? viaPublisherRelease(argv, cwd, now) : runCli(argv, cwd);
    const result = await startRun(world.root, { loop: "loop.release", publication: "site" }, cliHooks(world.root, undefined, run), { now });
    expect(result.exitCode).toBe(1);
    expect(result.state!.raised.some(name => name.startsWith("queue.fix#"))).toBe(true);
    expect(result.state!.raised.some(name => name.startsWith("queue.approve#"))).toBe(false);
    expect(existsSync(join(world.root, "clossys/agents/publisher/release.site/pin.json"))).toBe(false);
  });
});

describe("the release verb is clossys publisher release", () => {
  it("retires the top-level clossys release: runCli runs no release step for it, and publisher release names the flags", async () => {
    const world = make();
    const retired = await runCli(["release", "site", "--gates", "--root", world.root], world.root);
    expect(retired.exitCode, retired.message).toBe(2);
    expect(retired.message).toMatch(/^Unknown argument: release\n/);
    expect(retired.message).not.toContain("clossys publisher release <publication>");
    expect(existsSync(join(world.root, "clossys/.state/checks/publisher/release.site"))).toBe(false);
    const help = await runCli(["publisher", "release", "--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.message).toContain("clossys publisher release <publication> [--build|--manifest|--gates|--ready]... [--selection <module>[#export]]");
  });
});

/**
 * foundry-build-0048 U8a: slots.stale judges every IA-placed slot and every slot a pinned release input resolves from
 * (release slots aside), and a pinned candidate with no verdict recorded for its bytes fails it closed. Every world
 * pin goes through the CHOOSE gate; the legacy pins here are written by hand (world.handPin), as recut writes a pin/1.
 */
describe("slots.stale on the release inputs (U8a)", () => {
  const stale = (result: Awaited<ReturnType<typeof runReleaseCli>>) => out(result).findings.filter(row => row.check === "slots.stale");
  /** Drops slot ids from an agent's ia.json, so they are no longer placed in the IA (their folders and pins stay). */
  function unplace(world: ReleaseWorld, agent: string, ids: readonly string[]): void {
    const rel = `clossys/agents/${agent}/ia.json`;
    const ia = JSON.parse(world.read(rel)) as { nodes: { children: { slots: string[] }[] }[] };
    for (const node of ia.nodes) for (const child of node.children) child.slots = child.slots.filter(id => !ids.includes(id));
    world.write(rel, `${JSON.stringify(ia, null, 2)}\n`);
  }

  it("passes after the ready-pin in a world whose release slot is placed in the IA: pin, then --ready and --gates are green", async () => {
    const world = make();
    const now = clock();
    expect(JSON.parse(world.read("clossys/agents/publisher/ia.json")).nodes.flatMap((node: { children: { slots: string[] }[] }) => node.children.flatMap(child => child.slots))).toContain("release.site");
    await ready(world, now);
    const readyRun = await release(world, "--ready", now);
    expect(readyRun.exitCode, readyRun.message).toBe(0);
    const gates = await release(world, "--gates", now);
    expect(gates.exitCode, gates.message).toBe(0);
    expect(stale(gates)).toEqual([]);
    expect(checkReleaseReady(world.root, "site").status).toBe("pass");
  });

  it("refuses legacy pins outside the IA that the manifest ships, naming each owner's choose loop", async () => {
    const world = make();
    const now = clock();
    const refs = ["director/focus.reach.geography", "designer/sections.hero", "writer/sections.hero.copy"];
    for (const ref of refs) world.handPin(ref, 2);
    unplace(world, "director", ["focus.reach.geography"]);
    unplace(world, "designer", ["sections.hero"]);
    unplace(world, "writer", ["sections.hero.copy"]);
    expect((await release(world, "--build", now)).exitCode).toBe(0);
    expect((await release(world, "--manifest", now)).exitCode).toBe(0);
    const pins = latestManifest(world.root, "site")!.content!.pins;
    expect(pins["director/focus.reach.geography"]).toMatch(/^geography-v2\.md@/);
    expect(pins["designer/sections.hero"]).toMatch(/^hero-v2\.json@/);
    expect(pins["writer/sections.hero.copy#home.hero"]).toMatch(/^home\.hero-v2\.md@/);
    const gates = await release(world, "--gates", now);
    expect(gates.exitCode).toBe(1);
    for (const ref of refs) {
      const row = stale(gates).find(finding => finding.subject === ref);
      expect(row?.detail, ref).toMatch(/is a legacy pin with no recorded pinSet or verdict \(as clossys migrate recut writes a pin\/1\)/);
      expect(row?.detail, ref).toContain(`agent:${ref.split("/")[0]} must re-verdict it (run its loop.choose: clossys run loop.choose --slot ${ref})`);
    }
  });

  it("fails a pinned candidate whose bytes changed after its verdict, and says so (the verdict binds the sha256)", async () => {
    const world = make();
    const rel = "clossys/agents/designer/sections.hero/candidates/hero-v1.json";
    // The bytes change and the pin is written again over them with no CHOOSE gate (as recut rewrites a candidate and
    // its pin): the pin resolves, and the scorecard holds a verdict for the old bytes only.
    world.write(rel, `${world.read(rel).trimEnd()}\n\n`);
    writeTargetPin(world.root, { agent: "designer", slotId: "sections.hero", candidate: "hero-v1.json", decidedBy: "planner", basis: "planner", at: "2026-11-20T07:00:00Z" as never, refs: [], createdBy: cliActor("test") });
    const gates = await release(world, "--gates");
    expect(out(gates).findings.filter(row => row.check === "pins.resolve")).toEqual([]);
    expect(gates.exitCode).toBe(1);
    expect(stale(gates).find(row => row.subject === "designer/sections.hero")?.detail)
      .toBe("pinned hero-v1.json has no verdict for its bytes: the candidate file changed after it was judged: agent:designer must re-verdict it (run its loop.choose: clossys run loop.choose --slot designer/sections.hero)");
  });

  /** Moves a model file out of the model tree and leaves a relative symbolic link to it in its place. */
  function alias(world: ReleaseWorld, rel: string): void {
    const file = join(world.root, rel);
    const moved = join(world.root, "outside", rel.replaceAll("/", "__"));
    mkdirSync(dirname(moved), { recursive: true });
    renameSync(file, moved);
    symlinkSync(relative(dirname(file), moved), file);
  }

  it("fails closed when a legacy pin's candidate is a symbolic link: the resolver refuses the alias the model reader refuses", async () => {
    const world = make();
    world.handPin("publisher/page.home", 2);
    alias(world, "clossys/agents/publisher/page.home/candidates/home-v2.json");
    const gates = await release(world, "--gates");
    expect(gates.exitCode).toBe(1);
    expect(out(gates).findings.find(row => row.check === "pins.resolve" && row.subject === "publisher/page.home")?.detail)
      .toContain("pin names home-v2.json, which is a symbolic link, or sits under one: aliases are not followed");
  });

  it("fails closed when a slot's pin.json is a symbolic link, even over a judged pin", async () => {
    const world = make();
    alias(world, "clossys/agents/publisher/page.home/pin.json");
    const gates = await release(world, "--gates");
    expect(gates.exitCode).toBe(1);
    expect(out(gates).findings.find(row => row.check === "pins.resolve" && row.subject === "publisher/page.home")?.detail)
      .toContain("publisher/page.home pin.json is a symbolic link, or sits under one: aliases are not followed");
  });

  it("fails a pin on another candidate with the same bytes as a judged one (the verdict binds the candidate name)", async () => {
    const world = make();
    // The candidate as its rules read it is copied (its view: the item with its source), not the headered file:
    // each candidate's header names its own file, so the copy's content bytes equal the judged one's.
    const judged = candidateCodec.parse("hero-v1.json", world.read("clossys/agents/designer/sections.hero/candidates/hero-v1.json"));
    const name = world.handPin("designer/sections.hero", 2, JSON.parse(judged.view));
    const copied = candidateCodec.parse(name, world.read(`clossys/agents/designer/sections.hero/candidates/${name}`));
    expect(copied.header).toBeDefined();
    expect(copied.content).toBe(judged.content);
    expect(copied.view).toBe(judged.view);
    const gates = await release(world, "--gates");
    expect(gates.exitCode).toBe(1);
    expect(stale(gates).find(row => row.subject === "designer/sections.hero")?.detail).toMatch(/^pinned hero-v2\.json is a legacy pin with no recorded pinSet or verdict/);
  });
});

describe("a release slot holds the manifest, never a publication record (U39b fix r1)", () => {
  const AT_SUBMIT = "2026-11-20T08:00:00Z";
  const RECORD = {
    schema: "clossys.publication/1", format: "web.page.responsive", entryOrder: ["home"], routePack: { packId: "site", homeRouteId: "home" },
    meta: { source: { kind: "derived", ref: ["publisher:ia.json"] }, tree: { id: "site", name: "site.publication", children: [{ id: "site.pages", name: "site.pages", cells: ["page.home"] }] } },
  };
  const SKILL = STEPS.find(step => step.id === "publisher.candidates")!.command.skill!;
  const REFUSAL = "publisher/release.site is a release slot: it holds the manifest clossys publisher release <pub> --manifest writes, not a page or publication record";
  const candidates = (world: ReleaseWorld) => readdirSync(join(world.root, "clossys/agents/publisher/release.site/candidates")).sort();

  it("refuses a publication/1 record at next --submit, names it in clossys check and refuses it at clossys pin", async () => {
    const world = make();
    const now = clock();
    expect((await release(world, "--build", now)).exitCode).toBe(0);
    expect((await release(world, "--manifest", now)).exitCode).toBe(0);
    // The submit verb (clossys next --submit): the reader's rules refuse the record before any byte lands.
    world.write("drafts/site.json", `${JSON.stringify(RECORD, null, 2)}\n`);
    const submit = await runCli(["next", "publisher/release.site", "--submit", join(world.root, "drafts/site.json"), "--model", "fixture-model", "--tier", "mid", "--basis", "agent", "--skill", SKILL, "--rung", "adopt", "--seed", "release.site/site-v1.json", "--root", world.root], world.root);
    expect(submit.exitCode, submit.message).not.toBe(0);
    expect(submit.message).toContain(REFUSAL);
    expect(candidates(world)).toEqual(["site-v1.json"]);
    // The code writer takes bytes as given (it judges no kind): the headered record lands as site-v2.json with its submit event.
    const header = buildCandidateHeader({ agent: "publisher" as never, slotId: "release.site" as never, name: "site-v2.json" as never, createdBy: cliActor("clossys publisher release site --manifest"), createdAt: AT_SUBMIT as never, source: { kind: "derived", ref: ["publisher:ia.json"] } });
    const { meta: _meta, ...content } = RECORD;
    writeCandidateBytes(join(world.root, "clossys"), "publisher", "release.site", "site-v2.json", serializeCandidate("site-v2.json" as never, header, { ...content, meta: { tree: RECORD.meta.tree } }), { at: AT_SUBMIT }, { by: "code", skill: "packages/producer/actions/publisher.release/action.json", model: "none", tier: "none" });
    expect(candidates(world)).toEqual(["site-v1.json", "site-v2.json"]);
    // clossys check names it under the slot reader's rule.
    const check = await runCli(["check", "--root", world.root], world.root);
    expect(JSON.stringify(check.output ?? check.message)).toContain(REFUSAL);
    // clossys pin refuses it even with the owner's ready answer naming its bytes.
    const entry = world.signoff(now, "ready", "site-v2.json");
    const pinned = await pin(world, "site-v2.json", entry);
    expect(pinned.exitCode).toBe(1);
    expect(pinned.message).toContain("pin refused: publisher/release.site site-v2.json is not ready");
    expect(existsSync(join(world.root, "clossys/agents/publisher/release.site/pin.json"))).toBe(false);
  });

  it("refuses it on a release.<pub> slot that declares kind publication: the rule keys on the slot id too", () => {
    const world = make();
    const doc = JSON.parse(world.read("clossys/agents/publisher/release.site/slot.json")) as Record<string, unknown>;
    const bytes = `${JSON.stringify(RECORD, null, 2)}\n`;
    for (const kind of ["release", "publication"]) {
      const read = readSlotValue({ ...doc, kind }, "slot.json")!;
      expect(read.current?.kind).toBe(kind);
      expect(candidateIssues(read, "publisher", "release.site", "site-v2.json", bytes).map(issue => issue.message), kind).toContain(REFUSAL);
    }
    // A publication slot not named release.<pub> keeps the publication record rules.
    const other = readSlotValue({ ...doc, kind: "publication" }, "slot.json")!;
    expect(candidateIssues(other, "publisher", "publication.site", "site-v2.json", bytes).map(issue => issue.message)).not.toContain(REFUSAL.replace("release.site", "publication.site"));
  });
});
