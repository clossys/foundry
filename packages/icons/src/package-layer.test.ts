import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The layer invariant for THIS package: `@vespeneventures/icons` is a
 * SEPARATE package at the same layer as `@vespeneventures/tokens` — never a
 * subpath of `@vespeneventures/ui` (unlike `charts`, which IS a subpath of
 * `ui`; see this package's README.md "Package or `ui` subpath?" for the
 * full reasoning: `ui`'s own atoms deliberately render a plain Unicode
 * glyph, `×`/`▾`, in `Chip`/`Banner`/`Select`/`ComboBox` rather than import
 * any icon, specifically to avoid taking on an icon-library dependency —
 * making icons a subpath of `ui` would force every consumer who wants only
 * icons to accept `ui`'s own dependency graph, `react-aria-components` and
 * `tailwind-merge` included, even completely unused).
 *
 * `@vespeneventures/ui/src/ladder.test.ts` enforces its OWN internal
 * layering the same structural way — scanning real files for real import
 * specifiers rather than trusting a comment or code review to catch a
 * layering violation. This test enforces the layer boundary ONE LEVEL UP,
 * for this package as a whole: no dependency this package's own
 * `package.json` declares (`dependencies`, `peerDependencies`,
 * `devDependencies`) may be `@vespeneventures/ui` or one of the two
 * packages that only exist because `ui` needs component-behavior/utility
 * machinery this package has no reason to need
 * (`react-aria-components`, `tailwind-merge`) — the same reasoning
 * `ladder.test.ts`'s own header comment gives for why an atom must never
 * import from `blocks/`: the simpler, more foundational layer must never
 * depend on something built out of it.
 */

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));

const FORBIDDEN_DEPENDENCIES = [
  "@vespeneventures/ui",
  "react-aria-components",
  "tailwind-merge",
] as const;

const DEPENDENCY_FIELDS = ["dependencies", "peerDependencies", "devDependencies"] as const;

function allDeclaredDependencyNames(): string[] {
  const names: string[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const section = manifest[field] as Record<string, string> | undefined;
    if (!section) continue;
    names.push(...Object.keys(section));
  }
  return names;
}

describe("layer invariant: @vespeneventures/icons is a sibling of tokens, never a ui subpath", () => {
  it("declares no dependency on @vespeneventures/ui, react-aria-components, or tailwind-merge", () => {
    const declared = allDeclaredDependencyNames();
    for (const forbidden of FORBIDDEN_DEPENDENCIES) {
      expect(declared, `package.json must not depend on "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it("sanity (the check reads real data, not a hardcoded empty list): this package DOES declare a real dependency (@vespeneventures/tokens), proving allDeclaredDependencyNames() isn't vacuously empty", () => {
    const declared = allDeclaredDependencyNames();
    expect(declared).toContain("@vespeneventures/tokens");
  });

  it("declares no runtime `dependencies` at all — react and tokens are peers, nothing is bundled in", () => {
    // A consumer who wants only icons should never pull in a transitive
    // dependency tree just for SVG path data + a size/accessibility
    // wrapper. Everything this package needs from the outside world is a
    // peer the CONSUMER already provides (react) or already has installed
    // for its own reasons (tokens) — never something this package installs
    // FOR them.
    expect(manifest.dependencies ?? {}).toEqual({});
  });
});
