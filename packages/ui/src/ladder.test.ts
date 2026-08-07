import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The ladder invariant: atoms → blocks → views → shell, each rung may only
 * import DOWN the ladder, never up — with `shell` as the one deliberate
 * exception to "down" meaning "earlier in that list" (see below). `blocks/`
 * importing `atoms/` (e.g. `PageHeader` pulling in `Button`) is correct and
 * expected — that's the whole point of a block. The reverse — an atom
 * reaching up into `blocks/` — is a layering violation: it would mean the
 * simplest layer depends on the thing built out of it, which breaks the
 * ladder's whole reason for existing (a consumer who only needs atoms could
 * no longer take just atoms without pulling in every block too, and a
 * change to a block could ripple back down into atoms).
 *
 * `shell` is the frame `views` fill, not another rung of CONTENT above
 * `views` — see this package's README, "Placement rules" and the ladder
 * diagram at the top. Structurally that makes it a peer of `views` that is
 * allowed to import both `atoms` and `blocks` (a `Shell.Header` slot is
 * commonly filled with atoms the same way a block is), while `views` (once
 * it exists) must never import `shell` — a view fills a slot `shell`
 * provides; it doesn't get to reach into the frame that's rendering it.
 * `shell` importing `views` is equally forbidden, for the same reason
 * `blocks` importing `atoms` is fine but not the reverse: `shell` is
 * lower/more foundational than the content it frames, even though it's
 * listed last in the diagram.
 *
 * This is enforced here structurally — reading real files and checking real
 * import specifiers — rather than left as a comment or a code-review
 * convention, because a comment can drift out of sync with the code the
 * moment someone adds an import under time pressure, and nothing else in
 * this package's toolchain (TypeScript, ESLint, the token-parity test) would
 * catch a `../blocks/...` import landing inside `atoms/`. It compiles clean:
 * every directory here lives in the same package, so TypeScript's module
 * resolution has no opinion about which direction is allowed.
 *
 * Deliberately dependency-free: a regex over each file's import/require
 * specifiers, not an AST parse. This package has no ESLint config to hang a
 * `no-restricted-imports` rule off of, and the check is cheap enough — a
 * handful of small `.ts`/`.tsx` files — that a full parser would be spending
 * a dependency on a problem regexing solves in a few lines.
 */

const srcDir = dirname(fileURLToPath(import.meta.url));
const atomsDir = join(srcDir, "atoms");
const blocksDir = join(srcDir, "blocks");
const shellDir = join(srcDir, "shell");

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectSourceFiles(full, out);
      continue;
    }
    const ext = extname(full);
    if ((ext === ".ts" || ext === ".tsx") && !entry.includes(".test.")) {
      out.push(full);
    }
  }
  return out;
}

// Matches the specifier of every static `import ... from "..."`, bare
// `import "..."`, and `export ... from "..."`, plus dynamic `import("...")`
// and `require("...")` — every shape a specifier can appear in, even though
// this package today only uses the static ESM form.
const IMPORT_SPECIFIER_RE =
  /(?:\bimport\s*\(|\brequire\s*\(|\b(?:import|export)\b[^'"]*?\bfrom\s*|\bimport\s+)\s*["']([^"']+)["']/g;

function importSpecifiers(code: string): string[] {
  const specifiers: string[] = [];
  for (const match of code.matchAll(IMPORT_SPECIFIER_RE)) {
    specifiers.push(match[1] as string);
  }
  return specifiers;
}

// A specifier "references" the given layer directory name if it is a
// relative import that climbs into a path segment with that name — e.g.
// `../blocks/PageHeader.js` or `../../blocks/index.js` reference "blocks";
// `./Blocksmith.js` (a hypothetically-named sibling file, not a real one in
// this package) does not, because "blocksmith" is a path SEGMENT check, not
// a substring check on the whole specifier.
function referencesLayer(specifier: string, layer: string): boolean {
  return specifier
    .split("/")
    .some((segment) => segment === layer);
}

interface Violation {
  file: string;
  specifier: string;
}

function findViolations(dir: string, forbiddenLayer: string): Violation[] {
  const violations: Violation[] = [];
  for (const file of collectSourceFiles(dir)) {
    const code = readFileSync(file, "utf8");
    for (const specifier of importSpecifiers(code)) {
      if (referencesLayer(specifier, forbiddenLayer)) {
        violations.push({ file: file.slice(srcDir.length + 1), specifier });
      }
    }
  }
  return violations;
}

// A single enforcement case: `dir` must contain no import referencing the
// `forbiddenLayer` path segment. `why` explains the reason for THIS specific
// pair of directories, so a failure message is legible on its own, without
// having to go re-read the big comment at the top of this file.
function expectNoImportsOf(dir: string, dirLabel: string, forbiddenLayer: string, why: string) {
  const violations = findViolations(dir, forbiddenLayer);
  if (violations.length > 0) {
    const report = violations.map((v) => `  ${v.file}: imports "${v.specifier}"`).join("\n");
    throw new Error(
      `${violations.length} ladder violation(s): ${dirLabel} must never import from ${forbiddenLayer}/.\n` +
        `The ladder is atoms → blocks → views, with shell as the frame views fill — each rung\n` +
        `(and shell) may only import DOWN toward something more foundational than itself, never\n` +
        `up toward something built out of it. ${why}\n${report}`,
    );
  }
  expect(violations).toEqual([]);
}

describe("ladder invariant: atoms → blocks → views, shell as the frame views fill (down only, never up)", () => {
  it("no file under src/atoms/ imports from blocks/", () => {
    expectNoImportsOf(
      atomsDir,
      "an atom",
      "blocks",
      "An atom depending on a block would mean the simplest layer depends on something built out of itself.",
    );
  });

  it("no file under src/atoms/ imports from views/", () => {
    expectNoImportsOf(
      atomsDir,
      "an atom",
      "views",
      "Views are wired-up content built from blocks and atoms; an atom depending on one would be even further backwards than an atom depending on a block.",
    );
  });

  it("no file under src/atoms/ imports from shell/", () => {
    expectNoImportsOf(
      atomsDir,
      "an atom",
      "shell",
      "Shell is the persistent frame content is rendered INSIDE of; an atom — the most foundational content primitive — must never depend on the frame around it.",
    );
  });

  it("no file under src/blocks/ imports from views/", () => {
    expectNoImportsOf(
      blocksDir,
      "a block",
      "views",
      "A view is a block (or set of blocks) wired to real data and routing; a block depending on a view would be circular.",
    );
  });

  it("no file under src/blocks/ imports from shell/", () => {
    expectNoImportsOf(
      blocksDir,
      "a block",
      "shell",
      "Shell is the frame content is rendered inside of; a block must never depend on the frame around it, the same reason an atom must not.",
    );
  });

  it("no file under src/shell/ imports from views/", () => {
    expectNoImportsOf(
      shellDir,
      "shell",
      "views",
      "Shell PROVIDES the slots a view fills; a view is content rendered inside shell, so shell depending on one would be exactly backwards — the frame would depend on what's framed.",
    );
  });

  it("sanity (permitted direction): shell/ DOES import from atoms/, and the scan finds it — proving the scan inspects real code rather than passing on zero coverage, and confirming this direction is the permitted one (no assertion here forbids it)", () => {
    // Deliberately the mirror image of the enforcement tests above: same
    // `findViolations` helper, same regex, pointed the other way. If it
    // found nothing here, that would mean either shell secretly reaches
    // atoms through some path this regex can't see (a blind scan is worse
    // than no scan) or — more likely if shell ever stopped composing atoms
    // at all (`Shell`'s skip link uses token-derived classes; `Toaster`'s
    // close control is this package's own `Button` atom) — the ladder's
    // "shell may import atoms and blocks" rule would have lost its reason
    // to exist. Either way, a passing "no violations" test above proves
    // nothing on its own without this count also being nonzero.
    const shellImportingAtoms = findViolations(shellDir, "atoms");
    expect(shellImportingAtoms.length).toBeGreaterThan(0);
    // The critical difference from the enforcement tests: nothing here
    // asserts this list is empty. Shell importing atoms (or blocks, not
    // separately asserted here since this package's shell layer doesn't
    // currently compose a block — nothing requires it to) is correct and
    // expected — this test would only fail if the scan itself is broken,
    // never because of what it found.
  });

  it("sanity (reverse direction): blocks/ DOES import from atoms/, and the scan finds it — proving the scan inspects real code rather than passing on zero coverage, and confirming this direction is the permitted one (no assertion here forbids it)", () => {
    const blocksImportingAtoms = findViolations(blocksDir, "atoms");
    expect(blocksImportingAtoms.length).toBeGreaterThan(0);
  });
});
