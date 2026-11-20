/**
 * foundry-build-0048 U8a round 2: slots.stale binds every pin the release ships to a judged check on the same slot,
 * record, candidate and sha256. The resolver refuses the aliases the model reader refuses (release.test.ts), so to
 * prove the binding alone this file turns the resolver's alias probe off (modelAlias -> false): the resolver then
 * follows a symbolic link and ships a pin the model reader never judged, the divergence the binding must catch.
 * An aliased pin.json is refused earlier still: the manifest writer (records/slot-write.ts writeCandidateBytes, U29b)
 * reads the agent's slots through the model reader, so no manifest is written and the aliased pin never ships. The
 * binding's own branch is then reached directly, on the aliased tree, by calling the slots.stale gate.
 * Synthetic: the release world (release/__fixtures__/world.ts).
 */
import { mkdirSync, readdirSync, renameSync, symlinkSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runReleaseCli } from "../cli/release.js";
import { gateRunners, SLOTS_STALE } from "./gates.js";
import { latestManifest } from "./manifest.js";
import { releaseDir } from "./paths.js";
import { clock, releaseWorld, stubBuilder, type ReleaseWorld } from "./__fixtures__/world.js";

vi.mock("../records/slots.js", async original => ({ ...await original<typeof import("../records/slots.js")>(), modelAlias: () => false }));

const worlds: ReleaseWorld[] = [];
afterEach(() => { for (const world of worlds.splice(0)) world.dispose(); });
const make = (): ReleaseWorld => { const world = releaseWorld(); worlds.push(world); return world; };
const release = (world: ReleaseWorld, flag: string, now = clock()) => runReleaseCli(["site", flag, "--root", world.root], world.root, { builder: stubBuilder, now });
const findings = (result: Awaited<ReturnType<typeof runReleaseCli>>) => (result.output as { findings: { check?: string; subject: string; detail: string }[] }).findings;

/** Moves a model file out of the model tree and leaves a relative symbolic link to it in its place. */
function alias(world: ReleaseWorld, rel: string): void {
  const file = join(world.root, rel);
  const moved = join(world.root, "outside", rel.replaceAll("/", "__"));
  mkdirSync(dirname(moved), { recursive: true });
  renameSync(file, moved);
  symlinkSync(relative(dirname(file), moved), file);
}

const PIN_JSON = "clossys/agents/publisher/page.home/pin.json";
/** The release slot's candidate files on disk (the manifests); [] when it has none. */
function manifestFiles(world: ReleaseWorld): string[] {
  try { return readdirSync(join(releaseDir(world.root, "site"), "candidates")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

const UNJUDGED = "ships home-v2.json unjudged: the model reader could not read it or its slot (an alias or an unreadable file), so no verdict covers the bytes the release ships";

describe("slots.stale: a shipped pin with no judged check fails closed (resolver alias probe off)", () => {
  it.each([
    ["candidate", "clossys/agents/publisher/page.home/candidates/home-v2.json"],
  ])("a legacy pin whose %s is a symbolic link ships in the manifest and fails --gates by name", async (_what, rel) => {
    const world = make();
    world.handPin("publisher/page.home", 2);
    alias(world, rel);
    expect((await release(world, "--build")).exitCode).toBe(0);
    expect((await release(world, "--manifest")).exitCode).toBe(0);
    expect(latestManifest(world.root, "site")!.content!.pins["publisher/page.home"]).toMatch(/^home-v2\.json@/);
    const gates = await release(world, "--gates");
    expect(gates.exitCode).toBe(1);
    expect(findings(gates).find(row => row.check === "slots.stale" && row.subject === "publisher/page.home")?.detail).toBe(UNJUDGED);
  });

  it("a legacy pin whose pin.json is a symbolic link is refused at --manifest: no manifest is written, so the aliased pin never ships", async () => {
    const world = make();
    world.handPin("publisher/page.home", 2);
    alias(world, PIN_JSON);
    expect((await release(world, "--build")).exitCode).toBe(0);
    const manifest = await release(world, "--manifest");
    expect(manifest.exitCode).toBe(1);
    expect(manifest.message).toBe("release site --manifest refused: Symbolic links are not followed in the slot model");
    expect(manifest.output).toMatchObject({ wrote: [] });
    expect(findings(manifest)).toEqual([{ check: "release.manifest", subject: "publisher/release.site", detail: "Symbolic links are not followed in the slot model" }]);
    expect(latestManifest(world.root, "site")).toBeUndefined();
    expect(manifestFiles(world)).toEqual([]);
  });

  it("the slots.stale gate itself names a shipped pin whose pin.json is a symbolic link unjudged (the binding branch, reached directly)", () => {
    const world = make();
    world.handPin("publisher/page.home", 2);
    alias(world, PIN_JSON);
    const stale = gateRunners(world.root, "site", undefined)[SLOTS_STALE]!();
    expect(stale.filter(row => row.subject === "publisher/page.home")).toEqual([{ check: SLOTS_STALE, subject: "publisher/page.home", detail: UNJUDGED }]);
  });
});
