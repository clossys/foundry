/**
 * `checkDependencyScope` — mechanical enforcement of this repository's own
 * contribution policy, "Dependencies: the default answer is no": every
 * runtime `dependencies` entry declared anywhere in a workspace's
 * package.json under `packages` must be a first-party `<scope>` sibling,
 * unless it is named in a small, checked-in allowlist that itself carries a
 * reason and a review date.
 *
 * Deliberately scoped small. At the time this was written, EVERY runtime
 * dependency across every package in this workspace was verified by
 * inspection — not assumed — to already be `@clossys/*`-scoped, so
 * a full dependency admission-and-retirement register would be a schema
 * with zero rows. This is the floor that actually matches what the
 * repository has today: a single flat allowlist keyed by dependency name,
 * each entry carrying a reason and a review date. It is a deliberate floor,
 * not an unfinished ceiling — it can grow into something richer (e.g.
 * entries scoped per consuming package, not just per dependency name, or a
 * full admission/retirement history) if a third-party runtime dependency is
 * ever legitimately admitted here. Until then, a richer schema would have
 * nothing real to describe.
 *
 * Does no I/O of its own, matching this package's established convention:
 * `catalog` is an already-built `Catalog` (from `buildCatalog`), and
 * `allowlist` is already-parsed JSON. A caller reads the workspace and the
 * allowlist file itself and passes the results in.
 */

import type { Catalog, CatalogEntry } from "../catalog/index.js";

/** One thing wrong with a package's declared dependencies, or with the allowlist itself. */
export interface DependencyScopeFinding {
  /** Stable identifier for what this finding reports. */
  rule:
    | "dependency-scope/third-party-dependency"
    | "dependency-scope/allowlist-shape"
    | "dependency-scope/allowlist-entry-shape"
    | "dependency-scope/allowlist-duplicate"
    | "dependency-scope/allowlist-expired";
  /** Always `"error"` — an allowlist entry either cleanly exempts a dependency or it doesn't; there is no warning-only case. */
  severity: "error";
  /** Human-readable description of the problem. */
  message: string;
  /** Where this finding applies: a package.json location, or a path into the allowlist document. */
  path?: string;
  /** The catalog entry's own package name, when this finding is about one specific package's dependency. */
  package?: string;
}

/** One checked-in exemption: a third-party dependency name, why it's allowed, and when that decision needs revisiting. */
export interface DependencyScopeAllowlistEntry {
  /** The exact, non-`<scope>/*`-scoped dependency name this entry exempts. */
  name: string;
  /** Non-empty: why this dependency was deliberately admitted. */
  reason: string;
  /** `YYYY-MM-DD`. Once this date has passed, the entry no longer exempts anything — see `checkDependencyScope`. */
  reviewBy: string;
}

/** The checked-in allowlist document shape. */
export interface DependencyScopeAllowlistDocument {
  version: 1;
  entries: readonly DependencyScopeAllowlistEntry[];
}

/** Options for `checkDependencyScope`. */
export interface DependencyScopeOptions {
  /** The instant "now" is evaluated against for `reviewBy` expiry. Defaults to `new Date()`; pass an explicit value for deterministic tests or a fixed audit date. */
  now?: Date;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidCalendarDate(value: string): boolean {
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const asDate = new Date(Date.UTC(year, month - 1, day));
  return asDate.getUTCFullYear() === year && asDate.getUTCMonth() === month - 1 && asDate.getUTCDate() === day;
}

function rawDependencyNamesOf(entry: CatalogEntry): string[] {
  const deps = entry.packageJson.dependencies;
  return isPlainObject(deps) ? Object.keys(deps) : [];
}

/**
 * Parses and validates the allowlist document. Fails closed at every step:
 * a malformed document, a malformed entry, or a duplicate name each produce
 * a finding AND are excluded from the returned map — a malformed entry
 * never silently exempts the dependency it names.
 */
function parseAllowlist(value: unknown): {
  entries: Map<string, DependencyScopeAllowlistEntry>;
  findings: DependencyScopeFinding[];
} {
  const findings: DependencyScopeFinding[] = [];

  // No allowlist provided at all is not malformed — it is the same as a
  // present-but-empty one, and is this repository's actual state today.
  if (value === undefined) return { entries: new Map(), findings };

  if (!isPlainObject(value) || value.version !== 1 || !Array.isArray(value.entries)) {
    findings.push({
      rule: "dependency-scope/allowlist-shape",
      severity: "error",
      message:
        'Dependency-scope allowlist must be a version 1 object with an "entries" array when provided. A ' +
        "malformed allowlist is a finding, never a silent exemption.",
      path: "allowlist",
    });
    return { entries: new Map(), findings };
  }

  const entries = new Map<string, DependencyScopeAllowlistEntry>();
  for (const [index, item] of value.entries.entries()) {
    const path = `allowlist.entries[${index}]`;
    if (
      !isPlainObject(item) ||
      typeof item.name !== "string" ||
      item.name.trim().length === 0 ||
      typeof item.reason !== "string" ||
      item.reason.trim().length === 0 ||
      typeof item.reviewBy !== "string" ||
      !isValidCalendarDate(item.reviewBy)
    ) {
      findings.push({
        rule: "dependency-scope/allowlist-entry-shape",
        severity: "error",
        message:
          'Allowlist entry requires a non-empty "name", a non-empty "reason", and a "reviewBy" date in ' +
          "YYYY-MM-DD form. An entry missing any of these is a finding, never a silent exemption.",
        path,
      });
      continue;
    }
    if (entries.has(item.name)) {
      findings.push({
        rule: "dependency-scope/allowlist-duplicate",
        severity: "error",
        message: `Allowlist entry for ${JSON.stringify(item.name)} is duplicated.`,
        path,
      });
      continue;
    }
    entries.set(item.name, { name: item.name, reason: item.reason, reviewBy: item.reviewBy });
  }

  return { entries, findings };
}

/**
 * Checks every catalog entry's real `dependencies` against `scope`: a
 * dependency name starting with `"<scope>/"` is first-party and always
 * fine. Anything else must be named, with an unexpired `reviewBy`, in
 * `allowlist` — otherwise it is a `"dependency-scope/third-party-dependency"`
 * finding.
 *
 * `allowlist` is `unknown`, exactly like `checkValueFreeSecretCatalog`'s own
 * catalog parameter elsewhere in this package: it is exactly the kind of
 * value read straight from a parsed, untrusted allowlist file, and this
 * function validates rather than trusts it. An allowlist entry whose
 * `reviewBy` date has passed produces a `"dependency-scope/allowlist-expired"`
 * finding AND stops exempting its dependency from this run onward — an
 * allowlist entry is a standing exemption only up to its own stated review
 * date, never an indefinite one; letting an expired entry keep exempting
 * silently would make this tripwire exactly the loophole it exists to close.
 */
export function checkDependencyScope(
  catalog: Catalog,
  scope: string,
  allowlist: unknown,
  options: DependencyScopeOptions = {},
): DependencyScopeFinding[] {
  const now = options.now ?? new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  const { entries: allowlistEntries, findings } = parseAllowlist(allowlist);

  const activeAllowlist = new Set<string>();
  for (const entry of allowlistEntries.values()) {
    // isValidCalendarDate already guaranteed reviewBy parses as a real
    // calendar date; comparing UTC calendar dates (not exact instants)
    // keeps expiry deterministic regardless of what time of day this runs.
    const [, yearText, monthText, dayText] = CALENDAR_DATE_PATTERN.exec(entry.reviewBy) as RegExpExecArray;
    const reviewByUtc = Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText));
    if (reviewByUtc < today) {
      findings.push({
        rule: "dependency-scope/allowlist-expired",
        severity: "error",
        message:
          `Allowlist entry for ${JSON.stringify(entry.name)} expired on ${entry.reviewBy} and no longer ` +
          "exempts it. An expired review date is a finding, not an indefinite exemption — renew it with a new " +
          "date after review, or remove the dependency.",
        path: `allowlist.entries[${entry.name}]`,
      });
      continue;
    }
    activeAllowlist.add(entry.name);
  }

  for (const entry of catalog.entries) {
    for (const depName of rawDependencyNamesOf(entry)) {
      if (depName.startsWith(`${scope}/`)) continue;
      if (activeAllowlist.has(depName)) continue;
      findings.push({
        rule: "dependency-scope/third-party-dependency",
        severity: "error",
        message:
          `${entry.name} declares a "dependencies" entry on ${JSON.stringify(depName)}, which is not ` +
          `${scope}-scoped and is not in the checked-in allowlist. This repository's rule is "the default ` +
          'answer is no" — add an entry to the allowlist (with a reason and a review date) only if this ' +
          "dependency was deliberately admitted, or remove it.",
        path: `${entry.dir}/package.json#dependencies.${depName}`,
        package: entry.name,
      });
    }
  }

  return findings;
}
