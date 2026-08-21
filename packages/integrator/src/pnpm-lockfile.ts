import { IntegratorValidationError } from "./errors.js";

/**
 * A minimal, purpose-built parser for exactly the slice of a `pnpm-lock.yaml`
 * document `readInstalledInventoryReport` (`./inventory.ts`) needs: the root
 * importer's (`"."`) resolved dependency versions.
 *
 * THIS IS NOT A GENERAL YAML PARSER, and is not trying to be one. It
 * understands only plain, unquoted-or-quoted-scalar block mappings at
 * increasing indentation -- exactly the shape pnpm writes for the
 * `importers` section (`importers: -> ".": -> dependencies: -> <name>: ->
 * specifier: / version:`). It does not understand flow-style mappings
 * (`{ a: 1 }`), sequences (`- item`), block scalars (`|`/`>`), anchors,
 * aliases, or multi-document files -- none of which pnpm ever emits inside
 * `importers`, which is the only section this module reads. `packages:`
 * (which DOES use flow-style `resolution: {integrity: ...}` entries) is
 * never parsed at all: the resolved version this package needs is already
 * present on each `importers["."]` dependency entry, so the `packages`
 * block's fuller resolution graph is unnecessary for this reader's job.
 *
 * Deliberately not a dependency: see `readInstalledInventoryReport`'s own
 * doc comment in `./inventory.ts` for why a real YAML parser was not added.
 *
 * Every exported function here throws `IntegratorValidationError` on
 * anything it cannot trust -- consistent with every other parser in this
 * package (`parseJsonObject`, `parseManifestNames`, `parseSupersessionMap`).
 * `readInstalledInventoryReport` is the public, never-throwing entry point
 * that catches these and folds them into a reported `indeterminate` result.
 */

function fail(message: string): never {
  throw new IntegratorValidationError("INVALID_INVENTORY_SOURCE", `pnpm-lock.yaml ${message}`);
}

/** One parsed YAML-subset node: either a nested block mapping or a leaf scalar string. */
type YamlNode = string | Map<string, YamlNode>;

function isBlankOrComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length === 0 || trimmed.startsWith("#");
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Strips a single layer of single- or double-quoting, unescaping `''` (YAML's single-quote escape) and `\"`. */
function unquoteScalar(value: string): string {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }
  return value;
}

/**
 * Finds the index of the colon that separates a mapping key from its value
 * (or trailing nothing, for a nested block), respecting a quoted key so a
 * colon inside quotes (never actually seen in pnpm keys, but not assumed
 * away) is not mistaken for the separator.
 */
function findKeyColon(trimmedLine: string): number | undefined {
  if (trimmedLine.startsWith("'") || trimmedLine.startsWith('"')) {
    const quote = trimmedLine[0];
    let end = 1;
    while (end < trimmedLine.length) {
      if (trimmedLine[end] === quote) {
        if (quote === "'" && trimmedLine[end + 1] === "'") {
          end += 2;
          continue;
        }
        break;
      }
      end += 1;
    }
    const colonRelative = trimmedLine.slice(end + 1).indexOf(":");
    return colonRelative === -1 ? undefined : end + 1 + colonRelative;
  }
  const colon = trimmedLine.indexOf(":");
  return colon === -1 ? undefined : colon;
}

function peekIndent(lines: readonly string[], fromIndex: number): number | undefined {
  for (let i = fromIndex; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (isBlankOrComment(line)) continue;
    return indentOf(line);
  }
  return undefined;
}

interface Cursor {
  index: number;
}

/**
 * Parses one block mapping starting at `cursor.index`, whose entries all
 * share `indent`. Advances `cursor.index` past every line it consumes.
 * Throws on anything that does not fit the supported subset (a sequence
 * item, an unindented continuation, a line with no key/colon).
 */
function parseBlockMapping(lines: readonly string[], cursor: Cursor, indent: number): Map<string, YamlNode> {
  const map = new Map<string, YamlNode>();
  while (cursor.index < lines.length) {
    const line = lines[cursor.index] as string;
    if (isBlankOrComment(line)) {
      cursor.index += 1;
      continue;
    }
    const lineIndent = indentOf(line);
    if (lineIndent < indent) break; // end of this block -- caller's turn
    if (lineIndent > indent) fail(`has unexpected indentation at line ${cursor.index + 1}`);

    const trimmed = line.trim();
    if (trimmed.startsWith("- ") || trimmed === "-") fail(`contains an unsupported sequence entry at line ${cursor.index + 1}`);

    const colon = findKeyColon(trimmed);
    if (colon === undefined) fail(`has a line with no "key:" at line ${cursor.index + 1}`);
    const key = unquoteScalar(trimmed.slice(0, colon).trim());
    const rest = trimmed.slice(colon + 1).trim();
    cursor.index += 1;

    if (rest.length === 0) {
      const childIndent = peekIndent(lines, cursor.index);
      map.set(key, childIndent === undefined || childIndent <= indent ? new Map() : parseBlockMapping(lines, cursor, childIndent));
    } else {
      map.set(key, unquoteScalar(rest));
    }
  }
  return map;
}

/** Slices out the `importers:` top-level section's body lines (everything more indented than it, up to the next top-level key or EOF). */
function extractImportersLines(content: string): readonly string[] | undefined {
  const lines = content.split(/\r\n|\r|\n/);
  const startIndex = lines.findIndex((line) => /^importers:\s*$/.test(line));
  if (startIndex === -1) return undefined;
  const body: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.trim().length > 0 && indentOf(line) === 0) break; // next top-level key
    body.push(line);
  }
  return body;
}

function asMap(node: YamlNode | undefined): Map<string, YamlNode> | undefined {
  return node instanceof Map ? node : undefined;
}

const DEPENDENCY_BLOCKS = ["devDependencies", "optionalDependencies", "dependencies"] as const;

/**
 * Parses a `pnpm-lock.yaml` document's text and returns the root importer's
 * (`"."`) resolved dependency name -> version map. Throws
 * `IntegratorValidationError` when the document does not contain a
 * recognizable `importers` section, when the root importer (`"."`) is
 * missing, or when anything inside that section falls outside the supported
 * subset described in this module's own header.
 *
 * Read in the same field-precedence order `./inventory.ts`'s
 * `declaredRanges` uses for the manifest -- `dependencies` wins over a
 * duplicate name in `devDependencies` or `optionalDependencies` -- so the
 * two readers agree about which entry governs when a name is (unusually)
 * declared in more than one block.
 *
 * A dependency entry with no `version` field (a workspace-protocol entry
 * pnpm sometimes emits without one) is skipped, the same tolerance
 * `resolvedVersion` extends to an npm lockfile's link/workspace entries.
 */
export function parsePnpmRootImporterVersions(content: string): ReadonlyMap<string, string> {
  const importerLines = extractImportersLines(content);
  if (importerLines === undefined) fail('has no top-level "importers:" section -- only the current importers-based lockfile shape is supported');

  const rootIndent = peekIndent(importerLines, 0);
  if (rootIndent === undefined) fail('has an empty "importers:" section');

  const cursor: Cursor = { index: 0 };
  const importers = parseBlockMapping(importerLines, cursor, rootIndent);

  const rootImporter = asMap(importers.get("."));
  if (rootImporter === undefined) fail('has no root ("." ) importer under "importers:"');

  const versions = new Map<string, string>();
  for (const blockName of DEPENDENCY_BLOCKS) {
    const block = asMap(rootImporter.get(blockName));
    if (block === undefined) continue;
    for (const [name, entry] of block) {
      const entryMap = asMap(entry);
      const version = entryMap?.get("version");
      if (typeof version === "string" && version.length > 0) versions.set(name, version);
    }
  }
  return versions;
}
