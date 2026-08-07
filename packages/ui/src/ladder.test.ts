import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The ladder invariant: atoms → blocks → views, each rung may only import
 * DOWN the ladder, never up. `blocks/` importing `atoms/` (e.g. `PageHeader`
 * pulling in `Button`) is correct and expected — that's the whole point of
 * a block. The reverse — an atom reaching up into `blocks/` — is a layering
 * violation: it would mean the simplest layer depends on the thing built out
 * of it, which breaks the ladder's whole reason for existing (a consumer who
 * only needs atoms could no longer take just atoms without pulling in every
 * block too, and a change to a block could ripple back down into atoms).
 *
 * This is enforced here structurally — reading real files and checking real
 * import specifiers — rather than left as a comment or a code-review
 * convention, because a comment can drift out of sync with the code the
 * moment someone adds an import under time pressure, and nothing else in
 * this package's toolchain (TypeScript, ESLint, the token-parity test) would
 * catch a `../blocks/...` import landing inside `atoms/`. It compiles clean:
 * both directories live in the same package, so TypeScript's module
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

describe("ladder invariant: atoms → blocks → views (down only, never up)", () => {
  it("no file under src/atoms/ imports from blocks/", () => {
    const violations = findViolations(atomsDir, "blocks");
    if (violations.length > 0) {
      const report = violations.map((v) => `  ${v.file}: imports "${v.specifier}"`).join("\n");
      throw new Error(
        `${violations.length} ladder violation(s): an atom must never import from blocks/.\n` +
          `The ladder is atoms → blocks → views — each rung composes the one below it, never\n` +
          `the one above. An atom depending on a block would mean the simplest layer depends\n` +
          `on something built out of itself.\n${report}`,
      );
    }
    expect(violations).toEqual([]);
  });

  it("sanity (reverse direction): blocks/ DOES import from atoms/, and the scan finds it — proving the scan inspects real code rather than passing on zero coverage, and confirming this direction is the permitted one (no assertion here forbids it)", () => {
    // Deliberately the mirror image of the enforcement test above: same
    // `findViolations` helper, same regex, pointed the other way. If it
    // found nothing here, that would mean either every block secretly
    // reaches atoms through some path this regex can't see (a blind scan is
    // worse than no scan) or — more likely if this package's blocks ever
    // stopped composing atoms at all — the ladder itself would have lost
    // its reason to exist. Either way, a passing "no violations" test above
    // proves nothing on its own without this count also being nonzero.
    const blocksImportingAtoms = findViolations(blocksDir, "atoms");
    expect(blocksImportingAtoms.length).toBeGreaterThan(0);
    // The critical difference from the enforcement test: nothing here
    // asserts this list is empty. Blocks importing atoms is correct and
    // expected — this test would only fail if the scan is broken, never
    // because of what it found.
  });
});
