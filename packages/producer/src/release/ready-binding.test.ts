/**
 * Gate review round 1 (foundry-build-0016 R1-R6): the ready-pin is bound to the one manifest the owner signed off,
 * nothing a manifest says is trusted, the release CLI keeps exit 2 for environment errors, a legacy release slot
 * takes no ready-pin, every fail-closed branch of release.ready has a test, and the release loop records
 * release.ready from the check itself. Tmp consumers only (release/__fixtures__/world.ts).
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../cli/main.js";
import { runReleaseCli } from "../cli/release.js";
import { cliHooks } from "../loop/cli.js";
import { raiseEntry } from "../loop/route.js";
import { ledgerDir, resumeRun, startRun } from "../loop/runner.js";
import { answerQueueEntry } from "../queue/answer.js";
import type { Iso, LedgerEntry, Ref } from "../records/types.js";
import { readdirSync } from "node:fs";
import { latestBuild, type ReleaseBuilder } from "./build.js";
import { certifyWorld, resultKey } from "../constitution/certify/index.js";
import { buildContext } from "../constitution/context.js";
import { checkReleaseReady, readyFindings } from "./ready.js";
import { clock, releaseWorld, stubBuilder, type ReleaseWorld } from "./__fixtures__/world.js";

const worlds: ReleaseWorld[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.dispose();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const make = (): ReleaseWorld => { const world = releaseWorld(); worlds.push(world); return world; };

const MANIFESTS = "clossys/agents/publisher/release.site/candidates";
const release = (world: ReleaseWorld, flag: string, now: () => Date, builder: ReleaseBuilder = stubBuilder) => runReleaseCli(["site", flag, "--root", world.root], world.root, { builder, now });
const pin = (world: ReleaseWorld, manifest: string, entry: string) => runCli(["pin", "publisher/release.site", manifest, "--by", `owner:${entry}`, "--root", world.root], world.root);
const pinFile = (world: ReleaseWorld) => join(world.root, "clossys/agents/publisher/release.site/pin.json");
const exists = (file: string): boolean => { try { readFileSync(file); return true; } catch { return false; } };
const iso = (now: () => Date) => now().toISOString().replace(/\.\d{3}Z$/, "Z") as Iso;
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const findings = (world: ReleaseWorld, candidate: string, entry: string) =>
  readyFindings(world.root, "site", { candidate: candidate as never, decidedBy: `owner:${entry}`, basis: "picked", at: "2026-11-21T00:00:00Z" as Iso }).map(row => row.detail);

/** Edits a manifest's content in place (as an agent would, around the CLI). */
function editManifest(world: ReleaseWorld, name: string, edit: (content: Record<string, any>) => void): void {
  const file = join(world.root, MANIFESTS, name);
  const doc = JSON.parse(readFileSync(file, "utf8"));
  edit(doc.content);
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
}

/** Edits a queue entry file in place. */
function editEntry(world: ReleaseWorld, entry: string, edit: (doc: Record<string, any>) => void): void {
  const [queue, id] = entry.split("#");
  const file = join(world.root, "clossys/agents/producer", queue!, "entries", `${id}.json`);
  const doc = JSON.parse(readFileSync(file, "utf8"));
  edit(doc);
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
}

async function built(world: ReleaseWorld, now: () => Date): Promise<string> {
  expect((await release(world, "--build", now)).exitCode).toBe(0);
  const manifest = await release(world, "--manifest", now);
  expect(manifest.exitCode, manifest.message).toBe(0);
  return (manifest.output as { wrote: string[] }).wrote[0]!.split("/").pop()!;
}

describe("R1: the owner's ready answer is bound to one manifest", () => {
  it("probe A: the loop's sign-off for site-v2 cannot ready-pin site-v1 (another build), and pins site-v2", async () => {
    const world = make();
    const now = clock();
    let n = 0;
    const noisy: ReleaseBuilder = async request => { const output = await stubBuilder(request); writeFileSync(join(request.out, "site", "build.txt"), String(++n)); return output; };
    expect(await built(world, now)).toBe("site-v1.json");
    await release(world, "--build", now, noisy);
    expect((await release(world, "--manifest", now)).exitCode).toBe(0);
    const run = (argv: readonly string[], cwd: string) => argv[0] === "compile" ? Promise.resolve({ exitCode: 0 as const, message: "compiled (stub)" })
      : argv[0] === "release" ? runReleaseCli(argv.slice(1), cwd, { builder: noisy, now }) : runCli(argv, cwd);
    const hooks = cliHooks(world.root, undefined, run);
    const started = await startRun(world.root, { loop: "loop.release", publication: "site" }, hooks, { now });
    const v = started.state!.vars.manifest!;
    expect(v).toMatch(/^site-v[3-9]\.json$/);
    const entry = JSON.parse(readFileSync(join(world.root, "clossys/agents/producer/queue.approve/entries", `${started.entry!.split("#")[1]}.json`), "utf8"));
    expect(entry.options).toContainEqual(expect.objectContaining({ id: "ready", candidate: v }));
    expect(entry.refs).toContainEqual({ to: `publisher/release.site/${v}`, sha256: sha(join(world.root, MANIFESTS, v)), rel: "input" });
    answerQueueEntry(world.root, { entry: started.entry!, answer: "ready", by: "owner", via: "chat", quote: "ship it" }, now());
    const stale = await pin(world, "site-v1.json", started.entry!);
    expect(stale.exitCode).toBe(1);
    // clossys pin refuses on the owner's answer first (cli/pin.ts); release.ready finds the same binding broken.
    expect(stale.message).toContain(`about candidate ${v}, not site-v1.json`);
    const details = findings(world, "site-v1.json", started.entry!);
    expect(details.some(detail => detail.includes(`names ${v}`))).toBe(true);
    expect(details.some(detail => detail.includes("is not bound to this manifest"))).toBe(true);
    expect(exists(pinFile(world))).toBe(false);
    const done = await resumeRun(world.root, started.state!.runId, hooks, { now });
    expect(done.exitCode, done.message).toBe(0);
    expect(JSON.parse(readFileSync(pinFile(world), "utf8")).candidate).toBe(v);
    expect(checkReleaseReady(world.root, "site").status).toBe("pass");
  });

  it("probe B: a manifest edited after the owner's answer is refused (its bytes are not the ones signed off)", async () => {
    const world = make();
    const now = clock();
    const name = await built(world, now);
    const entry = world.signoff(now);
    editManifest(world, name, content => { content.diff = [{ ref: "fake", from: null, to: null }]; });
    const result = await pin(world, name, entry);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("is not bound to this manifest");
    expect(exists(pinFile(world))).toBe(false);
  });

  it("fails closed on a sign-off that names no manifest", async () => {
    const world = make();
    const now = clock();
    const name = await built(world, now);
    const { entry } = raiseEntry(world.root, {
      queue: "queue.approve", subject: { to: "publisher/release.site", rel: "input" } as Ref, decider: "owner", ask: "mark the release ready",
      slug: "release.site", default: "not-ready", options: [{ id: "ready", summary: "ready" }, { id: "not-ready", summary: "keep" }],
    }, iso(now), false);
    const ref = `queue.approve#${entry.id}`;
    answerQueueEntry(world.root, { entry: ref, answer: "ready", by: "owner", via: "chat", quote: "ready" }, now());
    const details = findings(world, name, ref);
    expect(details).toContain(`${ref} has no ready option for ${name}: the sign-off does not name the manifest`);
    expect(details.some(detail => detail.startsWith(`${ref} does not name publisher/release.site/${name}@`))).toBe(true);
    expect((await pin(world, name, ref)).exitCode).toBe(1);
  });
});

describe("R2: release.ready re-derives what the manifest says", () => {
  it("refuses a diff edited before the sign-off", async () => {
    const world = make();
    const now = clock();
    const name = await built(world, now);
    editManifest(world, name, content => { content.diff = []; });
    const entry = world.signoff(now);
    expect(findings(world, name, entry)).toContain(`manifest ${name} diff does not match its pins against no previous version`);
    expect((await pin(world, name, entry)).exitCode).toBe(1);
  });

  it("refuses build.routes, build.locales and build.exports that are not the build stamp's", async () => {
    const world = make();
    const now = clock();
    const name = await built(world, now);
    editManifest(world, name, content => { content.build.routes = 9; content.build.locales = ["en"]; content.build.exports = []; });
    const entry = world.signoff(now);
    const details = findings(world, name, entry);
    expect(details).toContain(`manifest ${name} build.routes is 9, the build stamp says 1`);
    expect(details).toContain(`manifest ${name} build.locales is ["en"], the build stamp says ["en","fr"]`);
    expect(details).toContain(`manifest ${name} build.exports is [], the build stamp says [{"kind":"react-static","path":"site/"}]`);
    expect((await pin(world, name, entry)).exitCode).toBe(1);
  });

  it("refuses a previous version that is not the ready version the pin replaces", async () => {
    const world = make();
    const now = clock();
    const name = await built(world, now);
    editManifest(world, name, content => { content.previous = "site-v0.json"; });
    const entry = world.signoff(now);
    const details = findings(world, name, entry);
    expect(details).toContain(`manifest ${name} follows site-v0.json, but site has no ready version`);
    expect(details).toContain(`manifest ${name} follows site-v0.json, which is not an older manifest`);
    expect((await pin(world, name, entry)).exitCode).toBe(1);
  });

  it("refuses a next manifest that hides the ready version it replaces", async () => {
    const world = make();
    const now = clock();
    const v1 = await built(world, now);
    expect((await pin(world, v1, world.signoff(now))).exitCode).toBe(0);
    world.repin("designer/sections.hero", 2);
    const v2 = await built(world, now);
    expect(v2).toBe("site-v2.json");
    editManifest(world, v2, content => { content.previous = null; content.diff = []; });
    const entry = world.signoff(now);
    const details = findings(world, v2, entry);
    expect(details).toContain(`manifest ${v2} follows null, but the ready version it replaces is ${v1}`);
    expect(details).toContain(`manifest ${v2} diff does not match its pins against no previous version`);
    expect(details).toContain(`manifest ${v2} header source {"kind":"derived","ref":["publisher/release.site/${v1}"]} does not match previous null`);
    expect((await pin(world, v2, entry)).exitCode).toBe(1);
  });

  it("keeps an honest next manifest ready once pinned", async () => {
    const world = make();
    const now = clock();
    const v1 = await built(world, now);
    expect((await pin(world, v1, world.signoff(now))).exitCode).toBe(0);
    world.repin("designer/sections.hero", 2);
    const v2 = await built(world, now);
    const pinned = await pin(world, v2, world.signoff(now));
    expect(pinned.exitCode, pinned.message).toBe(0);
    expect(checkReleaseReady(world.root)).toMatchObject({ status: "pass", findings: [] });
  });
});

describe("R3: clossys release exits 2 on an environment error", () => {
  it("outside a workspace (--root with no clossys/) is exit 2, through runReleaseCli and runCli", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "release-no-workspace-")));
    dirs.push(dir);
    for (const flag of ["--build", "--manifest", "--gates", "--ready"]) {
      const direct = await runReleaseCli(["site", flag, "--root", dir], dir);
      expect(direct.exitCode, direct.message).toBe(2);
      const viaMain = await runCli(["release", "site", flag, "--root", dir], dir);
      expect(viaMain.exitCode, viaMain.message).toBe(2);
    }
    expect((await runReleaseCli(["site", "--gates", "--root", join(dir, "nonexistent")], dir)).exitCode).toBe(2);
  });
});

describe("R4: a legacy or unparseable release slot takes no ready-pin", () => {
  for (const [label, text] of [["legacy", "slot/1"], ["unparseable", "{"]] as const) {
    it(`refuses the pin on a ${label} slot.json and fails release.ready for a pin already on disk`, async () => {
      const world = make();
      const now = clock();
      const name = await built(world, now);
      const entry = world.signoff(now);
      const slotFile = join(world.root, "clossys/agents/publisher/release.site/slot.json");
      const good = readFileSync(slotFile, "utf8");
      writeFileSync(slotFile, text === "{" ? "{" : `${JSON.stringify({ ...JSON.parse(good), schema: "clossys.slot/1" }, null, 2)}\n`);
      const refused = await pin(world, name, entry);
      expect(refused.exitCode).toBe(1);
      expect(refused.message).toContain("release slot");
      expect(exists(pinFile(world))).toBe(false);
      writeFileSync(slotFile, good);
      expect((await pin(world, name, entry)).exitCode).toBe(0);
      writeFileSync(slotFile, text === "{" ? "{" : `${JSON.stringify({ ...JSON.parse(good), schema: "clossys.slot/1" }, null, 2)}\n`);
      const ready = checkReleaseReady(world.root);
      expect(ready.status).toBe("fail");
      expect(ready.findings.some(row => row.detail.startsWith("publisher/release.site/slot.json is"))).toBe(true);
    });
  }
});

describe("R5: every fail-closed branch of the owner's answer and the pin on disk", () => {
  async function signed(): Promise<{ world: ReleaseWorld; now: () => Date; name: string; entry: string }> {
    const world = make();
    const now = clock();
    const name = await built(world, now);
    const entry = world.signoff(now);
    expect(findings(world, name, entry)).toEqual([]);
    return { world, now, name, entry };
  }

  it("refuses an answer by someone other than the owner", async () => {
    const { world, name, entry } = await signed();
    editEntry(world, entry, doc => { doc.events[doc.events.length - 1].by = "agent:publisher"; });
    expect(findings(world, name, entry)).toContain(`${entry} was answered by agent:publisher, not the owner`);
  });

  it("refuses an entry about another subject", async () => {
    const { world, name, entry } = await signed();
    editEntry(world, entry, doc => { doc.subject = { to: "publisher/page.home", rel: "input" }; });
    expect(findings(world, name, entry)).toContain(`${entry} asks about publisher/page.home, not publisher/release.site`);
  });

  it("refuses an entry whose ready option or ref names another candidate", async () => {
    const { world, name, entry } = await signed();
    editEntry(world, entry, doc => { doc.options[0].candidate = "site-v9.json"; });
    expect(findings(world, name, entry)).toContain(`${entry} answered ready for site-v9.json, not ${name}`);
    editEntry(world, entry, doc => { doc.options[0].candidate = name; doc.refs.push({ to: "publisher/release.site/site-v9.json", sha256: "0".repeat(64), rel: "input" }); });
    expect(findings(world, name, entry).some(detail => detail.startsWith(`${entry} names site-v9.json@000000000000, not ${name}@`))).toBe(true);
  });

  it("refuses an owner answer to queue.pick in place of queue.approve", async () => {
    const world = make();
    const now = clock();
    const name = await built(world, now);
    const file = join(world.root, MANIFESTS, name);
    const { entry } = raiseEntry(world.root, {
      queue: "queue.pick", subject: { to: "publisher/release.site", rel: "input" } as Ref, decider: "owner", ask: "pick the release",
      slug: "release.site", default: null, refs: [{ to: `publisher/release.site/${name}`, sha256: sha(file), rel: "input" } as Ref],
      options: [{ id: "ready", candidate: name as never, summary: "ready" }],
    }, iso(now), false);
    const ref = `queue.pick#${entry.id}`;
    answerQueueEntry(world.root, { entry: ref, answer: "ready", by: "owner", via: "chat", quote: "ready" }, now());
    expect(findings(world, name, ref)).toEqual([`decidedBy owner:${ref} is not an owner answer to queue.approve (owner:queue.approve#<id>)`]);
  });

  it("fails an unreadable pin.json on disk", async () => {
    const { world, name, entry } = await signed();
    expect((await pin(world, name, entry)).exitCode).toBe(0);
    writeFileSync(pinFile(world), "{ not json");
    const ready = checkReleaseReady(world.root);
    expect(ready.status).toBe("fail");
    expect(ready.findings.some(row => row.detail.startsWith("pin.json is not JSON"))).toBe(true);
  });

  it("fails a build with no stamp", async () => {
    const { world, name, entry } = await signed();
    expect((await pin(world, name, entry)).exitCode).toBe(0);
    const build = latestBuild(world.root, "site")!;
    unlinkSync(join(world.root, ".clossys/builds", `${build.id.slice(0, 8)}.json`));
    const ready = checkReleaseReady(world.root);
    expect(ready.status).toBe("fail");
    expect(ready.findings.map(row => row.detail)).toContain(`build ${build.id.slice(0, 12)} has no stamp: what it read is unknown`);
  });
});

describe("R6: loop.release records release.ready from the check, not the pin step's exit code", () => {
  it("a pin step that exits 0 without a ready-pin records release.ready fail and does not end pinned-ready", async () => {
    const world = make();
    const now = clock();
    const run = (argv: readonly string[], cwd: string) => argv[0] === "compile" ? Promise.resolve({ exitCode: 0 as const, message: "compiled (stub)" })
      : argv[0] === "pin" ? Promise.resolve({ exitCode: 0 as const, message: "pinned (stub, wrote nothing)" })
        : argv[0] === "release" ? runReleaseCli(argv.slice(1), cwd, { builder: stubBuilder, now }) : runCli(argv, cwd);
    const hooks = cliHooks(world.root, undefined, run);
    const started = await startRun(world.root, { loop: "loop.release", publication: "site" }, hooks, { now });
    answerQueueEntry(world.root, { entry: started.entry!, answer: "ready", by: "owner", via: "chat", quote: "ready" }, now());
    await resumeRun(world.root, started.state!.runId, hooks, { now });
    const dir = ledgerDir(world.root, "loop.release");
    const ledger = JSON.parse(readFileSync(join(dir, readdirSync(dir).sort().pop()!), "utf8")) as LedgerEntry;
    // Merge with foundry-build-0013 B3: the pin verb itself exits 0, but recordStep verifies release.ready from the files
    // and records the step failed (exit 1) when the check fails, so the run stops at pin instead of ending done.
    expect(ledger.steps.map(step => `${step.id}:${step.exit}`)).toContain("pin:1");
    expect(ledger.status).toBe("stopped");
    expect(ledger.checks["release.ready"]).toBe("fail");
    expect(ledger.status).not.toBe("pinned-ready");
  });
});

describe("the release certifier (R05.1, conform K3)", () => {
  /** The certification reasons of a release manifest, judged afresh by the certifier R05 runs. */
  const reasons = (world: ReleaseWorld, name: string) => {
    const ctx = buildContext(world.root, join(world.root, "clossys"));
    return certifyWorld(ctx, { cache: false }).results.get(resultKey("publisher", "release.site", name))!.certification.reasons;
  };

  it("judges a manifest by the release criteria, not as a publication record", async () => {
    const world = make();
    const name = await built(world, clock());
    const honest = reasons(world, name);
    expect(honest.filter(item => item.code === "release" || item.code === "invalid")).toEqual([]);
    expect(honest.map(item => item.message).join("; ")).not.toContain("clossys.publication/1");
  });

  it("certifies a release slot afresh with the cache on: a manifest whose build is gone is never certified from the cache", async () => {
    const world = make();
    const name = await built(world, clock());
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "release-certify-cache-")));
    dirs.push(dir);
    const cache = join(dir, "certify.json");
    const judged = () => certifyWorld(buildContext(world.root, join(world.root, "clossys")), { cache });
    const releaseReasons = (reasons: readonly { code: string; message: string }[]) => reasons.filter(item => item.code === "release").map(item => item.message);
    const first = judged().results.get(resultKey("publisher", "release.site", name))!.certification;
    expect(releaseReasons(first.reasons)).toEqual([]);
    expect(exists(cache)).toBe(true);
    // The build the manifest names leaves the disk (its stamp removed): nothing in the manifest's cache key changed.
    const build = latestBuild(world.root, "site")!;
    unlinkSync(join(world.root, ".clossys/builds", `${build.id.slice(0, 8)}.json`));
    const again = judged();
    // The cache is on and serves the other slots; the release slot is judged afresh and fails on the missing build.
    expect(again.hits).toBeGreaterThan(0);
    const second = again.results.get(resultKey("publisher", "release.site", name))!.certification;
    expect(second.certified).toBe(false);
    expect(releaseReasons(second.reasons)).toContain(`build ${build.id.slice(0, 12)} has no stamp: what it read is unknown`);
  });

  it("refuses a manifest whose build fields are not the build stamp's, and one whose lineage was edited", async () => {
    const world = make();
    const name = await built(world, clock());
    editManifest(world, name, content => { content.build.routes = 9; content.diff = []; });
    const messages = reasons(world, name).filter(item => item.code === "release").map(item => item.message);
    expect(messages).toContain(`manifest ${name} build.routes is 9, the build stamp says 1`);
    expect(messages).toContain(`manifest ${name} diff does not match its pins against no previous version`);
  });
});
