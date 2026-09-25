/**
 * Verbatim copies a package's build step packs into it from elsewhere in
 * this repository (issue #1500).
 *
 * A package that copies a file in declares the copy in its own
 * `scripts/packed-copies.json`, next to the build tool that performs it.
 * That one declaration is read by both sides:
 *
 * - the package's pack step copies exactly what it declares, and nothing
 *   else, so the declaration cannot drift from what the build does; and
 * - `scripts/check-contamination-classes.mjs` judges a declared copy of
 *   ANOTHER PACKAGE's file from that source's position, because the text
 *   was written there and reads correctly there. It is held to the same bar
 *   as its source: a citation that dangles at the source still fails in the
 *   copy. A copy of a repository document (a source outside `packages/`) is
 *   judged at its own position, like any other file of the package that
 *   ships it -- a repository document has no published file set to be
 *   judged against.
 *
 * The declaration is plain data, not code, so the gate never executes a
 * package's build tooling to learn what it copies.
 *
 * Shape:
 *
 *   { "copies": [ { "copy": "<package-relative path>",
 *                   "source": "<repository-relative path>" }, … ] }
 *
 * A `{package}` placeholder, written in both `copy` and `source`, stands for
 * every directory under `packages/` whose expanded `source` exists -- the
 * "each package's own file" case, so adding a package never needs this file
 * edited. An entry without the placeholder names one required source.
 *
 * Only a byte-for-byte copy belongs here. A generated module (a data module
 * rendered from contracts, a copy under a generated-file banner) is new text
 * written at its own position, and is judged there.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Package-relative path of a package's copy declaration. */
export const PACKED_COPIES_FILE = "scripts/packed-copies.json";

const PLACEHOLDER = "{package}";

function checkRelative(value, what, where) {
  if (typeof value !== "string" || value === "") throw new Error(`${where}: "${what}" must be a non-empty string`);
  if (value.startsWith("/") || value.includes("\\") || value.split("/").some((s) => s === "" || s === "." || s === "..")) {
    throw new Error(`${where}: "${what}" must be a plain relative path with no "." or ".." segments: ${value}`);
  }
}

/**
 * The copies `packageRoot` declares, expanded: `[{ copy, source }]`, `copy`
 * package-relative and `source` repository-relative, both with `/`
 * separators. Returns `null` when the package declares none. Throws on a
 * malformed declaration.
 *
 * An explicit entry is returned whether or not its source exists -- the pack
 * step refuses a missing one, and the contamination gate treats a copy whose
 * declared source is missing as a false declaration when CLASS 1 reads that
 * copy. A `{package}` entry expands only over packages whose source exists.
 */
export function loadPackedCopies(packageRoot, repoRoot) {
  const path = join(packageRoot, ...PACKED_COPIES_FILE.split("/"));
  if (!existsSync(path)) return null;
  const where = path;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${where}: cannot parse: ${error.message}`);
  }
  if (!Array.isArray(parsed?.copies)) throw new Error(`${where}: "copies" must be an array`);

  const out = [];
  const seen = new Set();
  const add = (copy, source) => {
    if (seen.has(copy)) throw new Error(`${where}: "${copy}" is declared more than once`);
    seen.add(copy);
    out.push({ copy, source });
  };

  for (const entry of parsed.copies) {
    checkRelative(entry?.copy, "copy", where);
    checkRelative(entry?.source, "source", where);
    const inCopy = entry.copy.includes(PLACEHOLDER);
    const inSource = entry.source.includes(PLACEHOLDER);
    if (inCopy !== inSource) {
      throw new Error(`${where}: ${PLACEHOLDER} must appear in both "copy" and "source", or in neither: ${JSON.stringify(entry)}`);
    }
    if (!inCopy) {
      add(entry.copy, entry.source);
      continue;
    }
    let dirs = [];
    try {
      dirs = readdirSync(join(repoRoot, "packages"), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
    } catch {
      /* no packages/ directory: the placeholder expands to nothing */
    }
    for (const name of dirs) {
      const source = entry.source.split(PLACEHOLDER).join(name);
      if (!existsSync(join(repoRoot, ...source.split("/")))) continue;
      add(entry.copy.split(PLACEHOLDER).join(name), source);
    }
  }
  return out;
}
