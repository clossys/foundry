/**
 * foundry-build-0048 U8a round 2: slots.stale binds every pin the release ships to a judged check on the same slot,
 * record, candidate and sha256. The resolver refuses the aliases the model reader refuses (release.test.ts), so to
 * prove the binding alone this file turns the resolver's alias probe off (modelAlias -> false): the resolver then
 * follows a symbolic link and ships a pin the model reader never judged, the divergence the binding must catch.
 * Synthetic: the release world (release/__fixtures__/world.ts).
 */
import { mkdirSync, renameSync, symlinkSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runReleaseCli } from "../cli/release.js";
import { latestManifest } from "./manifest.js";
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

const UNJUDGED = "ships home-v2.json unjudged: the model reader could not read it or its slot (an alias or an unreadable file), so no verdict covers the bytes the release ships";

describe("slots.stale: a shipped pin with no judged check fails closed (resolver alias probe off)", () => {
  it.each([
    ["candidate", "clossys/agents/publisher/page.home/candidates/home-v2.json"],
    ["pin.json", "clossys/agents/publisher/page.home/pin.json"],
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
});
