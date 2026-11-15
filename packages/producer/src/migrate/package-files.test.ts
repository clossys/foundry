/**
 * What the agent package tarballs ship for a migrated consumer to read: the view prompts (`views/*.md`) of the
 * Director, Designer, Writer and Publisher, the Writer `defaults/` and `facts.schema.json`, the Publisher
 * `defaults/` and `starters/`; and the Producer resolver reads the Writer and Publisher defaults from the package's `defaults/`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUCER_ROOT } from "../package-path.js";
import { packageDefaultDir, packageDefaultsRel } from "../records/candidate.js";
import { packageDefaults } from "../read/slot.js";

const PACKAGES = join(PRODUCER_ROOT, "..");
const REPO = join(PACKAGES, "..");

/** The file paths `npm pack --dry-run` would put in a package tarball (lifecycle scripts not run). */
function packed(name: string): string[] {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: join(PACKAGES, name), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const [result] = JSON.parse(out) as { files: { path: string }[] }[];
  return result!.files.map(file => file.path);
}

describe("agent package tarballs", () => {
  const cases: Record<string, readonly string[]> = {
    director: [],
    designer: [],
    writer: ["defaults/", "facts.schema.json"],
    publisher: ["defaults/", "starters/"],
  };
  for (const [name, extra] of Object.entries(cases)) {
    it(`@clossys/${name} ships views/*.md${extra.length ? ` and ${extra.join(", ")}` : ""}`, () => {
      const files = packed(name);
      const views = readdirSync(join(PACKAGES, name, "views")).filter(file => file.endsWith(".md"));
      expect(views.length).toBeGreaterThan(0);
      for (const view of views) expect(files).toContain(`views/${view}`);
      for (const entry of extra) {
        if (entry.endsWith("/")) expect(files.some(file => file.startsWith(entry)), `${name} tarball has no ${entry}`).toBe(true);
        else expect(files).toContain(entry);
      }
    }, 60_000);
  }
});

describe("package default resolver", () => {
  it("reads the Writer and Publisher defaults from the package's defaults/, every other agent from src/catalog/defaults/", () => {
    expect(packageDefaultsRel("writer")).toBe("defaults");
    expect(packageDefaultsRel("publisher")).toBe("defaults");
    expect(packageDefaultsRel("director")).toBe("src/catalog/defaults");
    const writer = packageDefaultDir(REPO, "writer", "lexicon.energy");
    expect(writer).toBe(join(REPO, "packages", "writer", "defaults", "lexicon.energy"));
    expect(existsSync(writer)).toBe(true);
    expect(packageDefaultDir(REPO, "director", "advantage.proposition.promise")).toBe(join(REPO, "packages", "director", "src", "catalog", "defaults", "advantage.proposition.promise"));
    const listed = packageDefaults({ packageRoot: agent => join(PACKAGES, agent) }, "writer", "lexicon.energy").map(candidate => candidate.name);
    expect(listed).toEqual(readdirSync(writer).filter(name => /-v\d+\.json$/.test(name)).sort());
    expect(listed.length).toBeGreaterThan(0);
    const [publisherSlot] = readdirSync(join(PACKAGES, "publisher", "defaults")).filter(name => !name.startsWith(".")).sort();
    const publisher = packageDefaultDir(REPO, "publisher", publisherSlot!);
    expect(publisher).toBe(join(REPO, "packages", "publisher", "defaults", publisherSlot!));
    expect(existsSync(publisher)).toBe(true);
  });
});
