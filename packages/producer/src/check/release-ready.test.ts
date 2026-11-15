/**
 * `release.ready` fails closed. Tallyhouse (test-fixtures/tallyhouse) pins a release whose manifest lists excerpted
 * pins and a build that is not on disk: it fails. The four ways a ready-pin can lie each fail on a tmp consumer
 * (release/__fixtures__/world.ts; structure and real slot ids only):
 *
 * 1. a ready-pin written while one gate is red;
 * 2. a manifest missing a pinned candidate's sha256;
 * 3. a manifest whose build id no longer matches the built output;
 * 4. a ready-pin that survives a later pin change.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../cli/main.js";
import { runReleaseCli } from "../cli/release.js";
import { buildCandidateHeader, candidatePath, serializeCandidate, writeCandidateFile } from "../records/candidate.js";
import { cliActor } from "../records/pin.js";
import { latestBuild } from "../release/build.js";
import { latestManifest } from "../release/manifest.js";
import { readyFindings } from "../release/ready.js";
import { clock, releaseWorld, stubBuilder, type ReleaseWorld } from "../release/__fixtures__/world.js";
import { releaseReady, RELEASE_READY } from "./release-ready.js";

const TALLYHOUSE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test-fixtures", "tallyhouse");

const worlds: ReleaseWorld[] = [];
afterEach(() => { for (const world of worlds.splice(0)) world.dispose(); });
const make = (): ReleaseWorld => { const world = releaseWorld(); worlds.push(world); return world; };

const release = (world: ReleaseWorld, flag: string, now: () => Date) => runReleaseCli(["site", flag, "--root", world.root], world.root, { builder: stubBuilder, now });
const pin = (world: ReleaseWorld, manifest: string, entry: string) => runCli(["pin", "publisher/release.site", manifest, "--by", `owner:${entry}`, "--root", world.root], world.root);
const details = (world: ReleaseWorld) => releaseReady.run(world.root).findings.map(row => row.detail);

async function readyWorld(): Promise<{ world: ReleaseWorld; now: () => Date; manifest: string }> {
  const world = make();
  const now = clock();
  await release(world, "--build", now);
  const manifest = (await release(world, "--manifest", now)).output as { wrote: string[] };
  const name = manifest.wrote[0]!.split("/").pop()!;
  const pinned = await pin(world, name, world.signoff(now));
  expect(pinned.exitCode, pinned.message).toBe(0);
  expect(releaseReady.run(world.root)).toMatchObject({ check: RELEASE_READY, status: "pass" });
  return { world, now, manifest: name };
}

describe("release.ready on Tallyhouse", () => {
  it("fails: the ready-pin names a manifest with excerpted pins and a build that is not on disk", () => {
    const result = releaseReady.run(TALLYHOUSE);
    expect(result.status).toBe("fail");
    const text = result.findings.map(row => row.detail).join("\n");
    expect(text).toContain("with no sha256");
    expect(text).toContain("build .clossys/builds/637f0615/ is not on disk");
  });
});

describe("release.ready mutations", () => {
  it("1: a ready-pin written while one gate is red is refused, and one put on disk fails the check", async () => {
    const world = make();
    const now = clock();
    world.repin("writer/sections.hero.copy", 2, { fields: { "header.heading": { en: "placeholder" } } });
    await release(world, "--build", now);
    const manifest = await release(world, "--manifest", now);
    expect(manifest.exitCode).toBe(0);
    const entry = world.signoff(now);
    const refused = await pin(world, "site-v1.json", entry);
    expect(refused.exitCode).toBe(1);
    expect(refused.message).toContain("records gate copy.locales as fail");
    // Written around the CLI (as a hand edit would): the check still fails it.
    const sha256 = latestManifest(world.root, "site")!.sha256;
    world.write("clossys/agents/publisher/release.site/pin.json", `${JSON.stringify({
      schema: "clossys.pin/2", id: "publisher/release.site/pin", agent: "publisher", kind: "pin", status: "pinned",
      createdBy: { actor: "code", cli: "clossys pin", version: "0.0.0" }, createdAt: "2026-11-20T09:00:00Z",
      refs: [{ to: "producer/queue.approve", record: entry.split("#")[1], rel: "answers" }],
      candidate: "site-v1.json", sha256, decidedBy: `owner:${entry}`, basis: "picked", at: "2026-11-20T09:00:00Z",
    }, null, 2)}\n`);
    expect(details(world)).toContain("manifest site-v1.json records gate copy.locales as fail");
    expect(details(world)).toContain("gate copy.locales fails now");
  });

  it("2: a manifest missing a pinned candidate's sha256 fails", async () => {
    const { world } = await readyWorld();
    const now = clock("2026-11-21T08:00:00Z");
    const built = latestBuild(world.root, "site")!;
    const good = latestManifest(world.root, "site")!.content!;
    // A code-written manifest that drops one pin and shortens another to the spec excerpt's sha8.
    const pins = { ...good.pins };
    delete pins["designer/sections.hero"];
    pins["publisher/page.home"] = pins["publisher/page.home"]!.replace(/@([0-9a-f]{8})[0-9a-f]{56}$/, "@$1");
    const name = "site-v2.json";
    const header = buildCandidateHeader({ agent: "publisher", slotId: "release.site", name, createdBy: cliActor("clossys release site --manifest"), createdAt: now().toISOString().replace(/\.\d{3}Z$/, "Z"), source: { kind: "derived", ref: ["publisher/release.site/site-v1.json"] } });
    writeCandidateFile(candidatePath(world.root, "publisher", "release.site", name), serializeCandidate(name, header, { ...good, pins, build: { ...good.build, id: built.id } }));
    const entry = world.signoff(now);
    const findings = readyFindings(world.root, "site", { candidate: name, decidedBy: `owner:${entry}`, basis: "picked", at: "2026-11-21T09:00:00Z" }).map(row => row.detail);
    expect(findings).toContain(`manifest ${name} is missing designer/sections.hero (${good.pins["designer/sections.hero"]})`);
    expect(findings).toContain(`manifest ${name} lists publisher/page.home as ${pins["publisher/page.home"]}, with no sha256`);
    expect((await pin(world, name, entry)).exitCode).toBe(1);
  });

  it("3: a manifest whose build no longer matches the built output fails", async () => {
    const { world } = await readyWorld();
    const build = latestBuild(world.root, "site")!;
    appendFileSync(join(world.root, build.path, "site", "index.html"), "<!-- changed after the build -->\n");
    expect(details(world).some(detail => detail.includes(`digests to`) && detail.includes("the output changed after the build"))).toBe(true);
    expect((await runReleaseCli(["site", "--ready", "--root", world.root], world.root)).exitCode).toBe(1);
  });

  it("4: a ready-pin does not survive a later pin change", async () => {
    const { world } = await readyWorld();
    world.repin("designer/sections.hero", 2);
    expect(details(world).some(detail => /^designer\/sections\.hero is hero-v2\.json@[0-9a-f]{64} now, not hero-v1\.json@/.test(detail))).toBe(true);
  });

  it("fails a ready-pin whose sha256 is not the manifest's bytes", async () => {
    const { world } = await readyWorld();
    const file = join(world.root, "clossys/agents/publisher/release.site/pin.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, `${JSON.stringify({ ...doc, sha256: "0".repeat(64) }, null, 2)}\n`);
    expect(releaseReady.run(world.root).status).toBe("fail");
  });

  it("passes a tree with no release pin", () => {
    const world = make();
    expect(releaseReady.run(world.root)).toMatchObject({ status: "pass", findings: [] });
  });
});
