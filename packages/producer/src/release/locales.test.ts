/**
 * foundry-build-0048 U8a: the release locales come from the one `- Language: <comma list>` line under `## Direction`
 * of director/focus.reach.geography (the line brief.keys checks). A `## Language` heading is never read (no such brief
 * pins); a missing,
 * empty or repeated line fails closed with a message naming the line expected. Synthetic: the release world
 * (release/__fixtures__/world.ts); the briefs below are placed and pinned by hand, as the reader sees any pin.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cliActor } from "../records/pin.js";
import { writeTargetPin } from "../records/pin-map.js";
import { serializeFrontmatter } from "../records/slot-model/index.js";
import { releaseLocales } from "./locales.js";
import { releaseWorld, type ReleaseWorld } from "./__fixtures__/world.js";

const worlds: ReleaseWorld[] = [];
afterEach(() => { for (const world of worlds.splice(0)) world.dispose(); });
const make = (): ReleaseWorld => { const world = releaseWorld(); worlds.push(world); return world; };
const EXPECTED = 'locales from director/focus.reach.geography:Language: geography-v2.md has no Language (expected one "- Language: <comma list>" line under ## Direction)';

/** Places geography-v2.md with `body` and pins it by hand. */
function brief(world: ReleaseWorld, body: string): void {
  const file = join(world.root, "clossys/agents/director/focus.reach.geography/candidates/geography-v2.md");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, serializeFrontmatter({ slot: "focus.reach.geography", source: { kind: "derived", ref: ["finding:geography-buyers"] }, feeds: [], functions: [] }, body));
  writeTargetPin(world.root, { agent: "director", slotId: "focus.reach.geography", candidate: "geography-v2.md", decidedBy: "planner", basis: "planner", at: "2026-11-20T07:00:00Z" as never, refs: [], createdBy: cliActor("test") });
}
const rest = "\n## Because\n- Buyers read the languages listed (finding:geography-buyers).\n\n## Watch\n- If sessions in a listed language fall below 5% in any quarter, then review the release locales.\n";

describe("release locales from the geography brief's Direction line", () => {
  it("reads the comma list of the one - Language: line under ## Direction", () => {
    const world = make();
    expect(releaseLocales(world.root, "site")).toEqual({ locales: ["en", "fr"], issues: [] });
    brief(world, `## Direction\n- Language: en, fr-CA, de\n${rest}`);
    expect(releaseLocales(world.root, "site")).toEqual({ locales: ["en", "fr-CA", "de"], issues: [] });
  });

  it("has no ## Language heading path: such a brief never pins, and a Direction with no Language line fails closed", () => {
    const world = make();
    expect(() => brief(world, `## Direction\n- Where: Europe first\n\n## Language\nen, fr\n${rest}`)).toThrow("body must be ## Direction, ## Because, ## Watch");
    expect(releaseLocales(world.root, "site")).toEqual({ locales: ["en", "fr"], issues: [] });
    brief(world, `## Direction\n- Where: Europe first\n${rest}`);
    expect(releaseLocales(world.root, "site")).toEqual({ locales: [], issues: [EXPECTED] });
  });

  it("fails closed on an empty line, on two lines, and on a line outside ## Direction", () => {
    const world = make();
    brief(world, `## Direction\n- Language:\n${rest}`);
    expect(releaseLocales(world.root, "site").issues).toEqual([EXPECTED]);
    brief(world, `## Direction\n- Language: en\n- Language: fr\n${rest}`);
    expect(releaseLocales(world.root, "site").issues).toEqual([EXPECTED]);
    brief(world, `## Direction\n- Where: Europe first\n${rest}- Language: en, fr\n`);
    expect(releaseLocales(world.root, "site").issues).toEqual([EXPECTED]);
  });
});
