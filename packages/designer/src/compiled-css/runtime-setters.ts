/**
 * Runtime-only custom properties: the variables this package's own sources
 * set inline at run time and no stylesheet declares (CONTAM-U1, decision G4).
 *
 * A bare read of such a variable has no declared value to fall back to, yet
 * it is not an undeclared token either: the component sets it on the element
 * itself. `addDeclaredFallbacks` writes `var(--x, unset)` for these, which
 * computes the same as a read of an unset variable today.
 *
 * The set is found by code, never by a hand list. A variable counts as set
 * inline when a package source (any `.ts`/`.tsx`/`.js`/`.jsx` file under the
 * package's `src/`, tests, fixtures, mocks and snapshots excluded) carries
 *
 * - a quoted custom-property object key, `"--x": value`, the shape of a React
 *   `style={{ "--x": ... }}` object or an override object spread onto one; or
 * - `.setProperty("--x", ...)`, or `.setProperty(NAME, ...)` where `NAME` is
 *   a `const NAME = "--x"` declared once in the package sources.
 *
 * Whether a variable also has a declared value is not decided here: a
 * declared value always wins in `addDeclaredFallbacks`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"]);
const SKIP_DIRS = new Set(["__fixtures__", "__tests__", "__mocks__", "__snapshots__", "node_modules"]);
const SKIP_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/;

const NAME = "--[A-Za-z0-9_-]+";
const OBJECT_KEY_RE = new RegExp(`(?<![\\w$.\\\\])(["'])(${NAME})\\1\\s*:(?!:)`, "g");
const SET_PROPERTY_LITERAL_RE = new RegExp(`\\.setProperty\\(\\s*(["'\`])(${NAME})\\1\\s*,`, "g");
const SET_PROPERTY_IDENT_RE = /\.setProperty\(\s*([A-Za-z_$][\w$]*)\s*,/g;
const CONST_NAME_RE = new RegExp(`\\bconst\\s+([A-Za-z_$][\\w$]*)\\s*(?::\\s*[^=;]+)?=\\s*(["'\`])(${NAME})\\2`, "g");

/** What one source file contributes: names it sets directly, identifiers it passes to `setProperty`, and its `const NAME = "--x"` declarations. */
export interface RuntimeSetterScan {
  names: Set<string>;
  setPropertyIdentifiers: Set<string>;
  constNames: Map<string, Set<string>>;
}

/** Block comments, and line comments that start a line or follow whitespace (so `https://` inside a string survives). */
const COMMENT_RE = /\/\*[\s\S]*?\*\/|(^|\s)\/\/[^\n]*/g;

/** Scans one source text for inline custom-property setters, comments ignored. */
export function scanRuntimeSetters(text: string, into: RuntimeSetterScan = { names: new Set(), setPropertyIdentifiers: new Set(), constNames: new Map() }): RuntimeSetterScan {
  const source = text.replace(COMMENT_RE, "$1");
  for (const m of source.matchAll(OBJECT_KEY_RE)) into.names.add(m[2] as string);
  for (const m of source.matchAll(SET_PROPERTY_LITERAL_RE)) into.names.add(m[2] as string);
  for (const m of source.matchAll(SET_PROPERTY_IDENT_RE)) into.setPropertyIdentifiers.add(m[1] as string);
  for (const m of source.matchAll(CONST_NAME_RE)) {
    const values = into.constNames.get(m[1] as string) ?? new Set<string>();
    values.add(m[3] as string);
    into.constNames.set(m[1] as string, values);
  }
  return into;
}

/** The custom properties a completed scan shows are set inline. An identifier passed to `setProperty` counts only when exactly one `const` declares it. */
export function runtimeSetNames(scan: RuntimeSetterScan): Set<string> {
  const out = new Set(scan.names);
  for (const ident of scan.setPropertyIdentifiers) {
    const values = scan.constNames.get(ident);
    if (values?.size === 1) out.add([...values][0] as string);
  }
  return out;
}

const cache = new Map<string, ReadonlySet<string>>();

/** Every custom property the package rooted at `packageRoot` sets inline in its `src/` sources. Cached per root. */
export function runtimeSetVariables(packageRoot: string): ReadonlySet<string> {
  const hit = cache.get(packageRoot);
  if (hit) return hit;
  const scan: RuntimeSetterScan = { names: new Set(), setPropertyIdentifiers: new Set(), constNames: new Map() };
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile() && SOURCE_EXTENSIONS.has(extname(entry)) && !SKIP_FILE_RE.test(entry)) scanRuntimeSetters(readFileSync(full, "utf8"), scan);
    }
  };
  walk(join(packageRoot, "src"));
  const names = runtimeSetNames(scan);
  cache.set(packageRoot, names);
  return names;
}
