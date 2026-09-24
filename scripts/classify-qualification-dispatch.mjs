#!/usr/bin/env node
// classify-qualification-dispatch — of the candidates
// scripts/filter-qualification-dispatch.mjs left for dispatch, which can
// actually qualify RIGHT NOW, and which would only burn a
// qualify-candidate.yml run failing ETARGET on a first-party sibling version
// that is not on the public registry yet?
//
//   node scripts/classify-qualification-dispatch.mjs <unqualified.json> <pending-dispatch.json>
//        [--json] [--summary <path>] [--root <dir>]
//
// <unqualified.json> is select-unqualified-packages.mjs --json's output and
// <pending-dispatch.json> is filter-qualification-dispatch.mjs --json's
// output (both the same `{ package, name, version }[]` shape). Every
// candidate lands in exactly one classification:
//
//   dispatch                  every first-party runtime dependency range has
//                             at least one satisfying published version.
//   skipped-already-recorded  in <unqualified.json> but not in
//                             <pending-dispatch.json>: a qualification branch
//                             for this exact package@version is already on
//                             origin (its record is in flight to main).
//   blocked-on-sibling        at least one first-party range has NO
//                             satisfying published version, so the
//                             qualification install cannot succeed yet.
//   indeterminate             the registry (or the candidate's own manifest)
//                             could not be read, so neither of the above
//                             could be proven.
//
// Only `dispatch` rows are printed (--json keeps the exact array shape the
// dispatch step already reads). --summary appends a Markdown report of all
// four classifications (auto-qualify.yml passes $GITHUB_STEP_SUMMARY).
//
// Exit 0 on a completed classification (a filtering step, not a gate — the
// same contract as filter-qualification-dispatch.mjs). Exit 2 on unusable
// input files.
//
// WHY THIS EXISTS (issue #1476)
// -------------------------------
// On 2026-09-24 every push to main re-dispatched qualification for
// @clossys/publisher, whose first-party sibling ranges had no published
// match yet. All 26 runs failed with ETARGET inside the tarball round-trip
// install, before qualification could start: 14 on designer@^0.5.0
// (designer has never published a 0.5.x), 12 on controller@~0.9.14 (the
// highest controller published then was 0.9.10). npm names only the first
// unsatisfiable edge it hits; this classifier names every one. Each
// re-dispatch carried no new information. The sibling-set redesign
// (#1425/#1435) will later qualify siblings together; this is the phase-0
// fix: do not dispatch a candidate the registry already proves cannot
// install.
//
// WHAT IS RESOLVED, AND HOW
// ---------------------------
// The ranges checked are the candidate's first-party (package-scope.json
// `scope`) `dependencies` plus its non-optional `peerDependencies` — what
// scripts/lib/candidate-runner.mjs's `npm install <tarball>` resolves
// (npm >= 7 installs required peers; peers marked optional in
// peerDependenciesMeta are not installed). Each range is resolved against
// the anonymous public packument (scripts/lib/public-npm-registry.mjs's
// fetchPublicNpmPackument — the abbreviated install document npm itself
// reads) using check-workspace-links.mjs's satisfies(): the repository's one
// shared range evaluator, hand-rolled on purpose (no semver dependency;
// `semver` appears in the lockfile only as an optional transitive of sharp,
// which nothing here may rely on). A published PRERELEASE version never
// satisfies a plain x.y.z range — npm/semver's default — so a sibling that
// only exists as a prerelease still classifies the candidate as blocked.
//
// WHICH WAY EACH UNCERTAINTY FAILS
// ----------------------------------
// - Registry transport error, non-2xx/404 status, malformed document, or a
//   non-public-npm registry in package-scope.json -> `indeterminate`, NOT
//   dispatched. Cost-safe: a dispatch that cannot be justified is not made,
//   and the next push to main re-asks. It is reported separately and never
//   reported as `blocked`, so a reader never mistakes "could not check" for
//   "checked and absent".
// - A public-npm 404 for the sibling's packument is definitive absence (see
//   registry-version-lookup.mjs's header on npmjs 404s) -> `blocked`.
// - A range form satisfies() cannot parse (anything but x.y.z / ^x.y.z /
//   ~x.y.z) -> that edge is NOT treated as blocking. check-workspace-links
//   already rejects such first-party ranges, so this should never occur; if
//   it does, the classifier refuses to hold back what it cannot evaluate
//   (a static manifest property would otherwise suppress the candidate
//   forever) and the pre-#1476 behaviour — dispatch — applies, with the
//   edge named in the summary.
// - `blocked` is only ever the verdict of a registry that ANSWERED: a
//   genuinely satisfiable candidate is never classified blocked.
//
// A blocked candidate is re-examined on every later push to main, so it is
// dispatched automatically on the first push after its sibling publishes.
import { appendFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRange, satisfies } from "./check-workspace-links.mjs";
import { fetchPublicNpmPackument } from "./lib/public-npm-registry.mjs";

export const CLASSIFICATIONS = Object.freeze(["dispatch", "skipped-already-recorded", "blocked-on-sibling", "indeterminate"]);

function die(message, code = 2) {
  console.error(`classify-qualification-dispatch: ${message}`);
  process.exit(code);
}

const candidateKey = (c) => `${c.package}\0${c.version}`;

/**
 * The first-party runtime dependency edges the qualification install
 * resolves: `dependencies` plus non-optional `peerDependencies` whose name is
 * inside `scope`. Deduplicated on name+range, sorted for stable output.
 */
export function firstPartyRuntimeRanges(manifest, scope) {
  const prefix = `${scope}/`;
  const optionalPeer = (name) => manifest?.peerDependenciesMeta?.[name]?.optional === true;
  const edges = new Map();
  const add = (name, range) => {
    if (typeof name !== "string" || !name.startsWith(prefix) || typeof range !== "string") return;
    edges.set(`${name}\0${range}`, { name, range });
  };
  for (const [name, range] of Object.entries(manifest?.dependencies ?? {})) add(name, range);
  for (const [name, range] of Object.entries(manifest?.peerDependencies ?? {})) if (!optionalPeer(name)) add(name, range);
  return [...edges.values()].sort((a, b) => a.name.localeCompare(b.name) || a.range.localeCompare(b.range));
}

/**
 * Resolve one range against a list of published version strings.
 *   { kind: "satisfied", version }   highest satisfying published version
 *   { kind: "unsatisfied", highest } highest plain x.y.z published (or null)
 *   { kind: "unevaluable" }          the range form is not one satisfies() parses
 */
export function evaluateRange(range, publishedVersions) {
  if (parseRange(range) === null) return { kind: "unevaluable" };
  const stable = publishedVersions.filter((v) => /^\d+\.\d+\.\d+$/.test(v));
  const byVersion = (a, b) => {
    const [x, y] = [a, b].map((v) => v.split(".").map(Number));
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  };
  stable.sort(byVersion);
  // Prerelease strings are unparseable to satisfies() (evaluated: false) and
  // therefore never count as satisfying — npm/semver's default for a plain range.
  const matching = publishedVersions.filter((v) => {
    const outcome = satisfies(v, range);
    return outcome.evaluated && outcome.ok;
  }).sort(byVersion);
  if (matching.length > 0) return { kind: "satisfied", version: matching[matching.length - 1] };
  return { kind: "unsatisfied", highest: stable.length > 0 ? stable[stable.length - 1] : null };
}

/**
 * One anonymous read of a sibling's published version list.
 *   { kind: "found", versions }  { kind: "absent" }  { kind: "error", detail }
 */
export async function lookupPublishedVersions(name, { registry, fetchImpl = fetch }) {
  let result;
  try {
    result = await fetchPublicNpmPackument({ registry, name, fetchImpl });
  } catch (error) {
    return { kind: "error", detail: `packument read threw: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (result.kind === "found") return { kind: "found", versions: Object.keys(result.document.versions) };
  if (result.kind === "not-found") return { kind: "absent" };
  return { kind: "error", detail: result.detail ?? `registry answered ${result.kind}` };
}

/**
 * Pure apart from the injected `readManifest(pkg)` and
 * `lookupVersions(name)`; every registry read goes through `lookupVersions`
 * and is cached per sibling name for the whole batch.
 */
export async function classifyCandidates({ unqualified, pending, scope, readManifest, lookupVersions }) {
  const pendingKeys = new Set(pending.map(candidateKey));
  const cache = new Map();
  const lookup = (name) => {
    if (!cache.has(name)) {
      cache.set(name, Promise.resolve().then(() => lookupVersions(name)).catch((error) => ({ kind: "error", detail: error instanceof Error ? error.message : String(error) })));
    }
    return cache.get(name);
  };

  const rows = [];
  for (const candidate of unqualified) {
    if (!pendingKeys.has(candidateKey(candidate))) {
      rows.push({ ...candidate, classification: "skipped-already-recorded", detail: `qualification branch claude/qualify-${candidate.package}-${candidate.version} already exists on origin` });
    }
  }

  for (const candidate of pending) {
    const base = { package: candidate.package, name: candidate.name, version: candidate.version };
    let manifest;
    try {
      manifest = readManifest(candidate.package);
    } catch (error) {
      rows.push({ ...base, classification: "indeterminate", detail: `could not read packages/${candidate.package}/package.json: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    if (manifest?.name !== candidate.name || manifest?.version !== candidate.version) {
      rows.push({ ...base, classification: "indeterminate", detail: `packages/${candidate.package}/package.json is ${manifest?.name}@${manifest?.version}, not the selected ${candidate.name}@${candidate.version}` });
      continue;
    }

    const blockers = [];
    const uncertain = [];
    const unevaluated = [];
    for (const edge of firstPartyRuntimeRanges(manifest, scope)) {
      const published = await lookup(edge.name);
      if (published.kind === "absent") {
        blockers.push({ ...edge, highest: null, detail: `no version of ${edge.name} is published` });
      } else if (published.kind === "found") {
        const verdict = evaluateRange(edge.range, published.versions);
        if (verdict.kind === "unsatisfied") blockers.push({ ...edge, highest: verdict.highest, detail: `highest published ${edge.name} is ${verdict.highest ?? "none (prerelease only)"}` });
        else if (verdict.kind === "unevaluable") unevaluated.push(edge);
      } else {
        uncertain.push({ ...edge, detail: published.detail ?? "registry read failed" });
      }
    }

    if (blockers.length > 0) rows.push({ ...base, classification: "blocked-on-sibling", blockers, ...(uncertain.length ? { uncertain } : {}) });
    else if (uncertain.length > 0) rows.push({ ...base, classification: "indeterminate", uncertain });
    else rows.push({ ...base, classification: "dispatch", ...(unevaluated.length ? { unevaluated } : {}) });
  }
  return rows;
}

const edgeText = (e) => `\`${e.name}@${e.range}\``;

function rowLine(row) {
  const id = `\`${row.package}\` — ${row.name}@${row.version}`;
  switch (row.classification) {
    case "dispatch":
      return row.unevaluated ? `${id} (range form not evaluated, dispatched as before #1476: ${row.unevaluated.map(edgeText).join(", ")})` : id;
    case "skipped-already-recorded":
      return `${id}: ${row.detail}`;
    case "blocked-on-sibling":
      return `${id} needs ${row.blockers.map((b) => `${edgeText(b)} (${b.detail})`).join("; ")}`;
    default:
      return `${id}: ${row.detail ?? row.uncertain.map((u) => `${edgeText(u)}: ${u.detail}`).join("; ")}`;
  }
}

/** Markdown step summary listing every classification, including empty ones. */
export function renderSummary(rows) {
  const titles = {
    dispatch: "Dispatched",
    "skipped-already-recorded": "Skipped — qualification branch already pushed (record in flight)",
    "blocked-on-sibling": "Blocked on an unpublished first-party sibling (not dispatched; re-checked on the next push to main)",
    indeterminate: "Indeterminate (not dispatched; re-checked on the next push to main)",
  };
  const lines = ["## Auto-qualify dispatch classification", "", "| Classification | Count |", "| --- | --- |"];
  for (const kind of CLASSIFICATIONS) lines.push(`| ${kind} | ${rows.filter((r) => r.classification === kind).length} |`);
  for (const kind of CLASSIFICATIONS) {
    const matching = rows.filter((r) => r.classification === kind);
    lines.push("", `### ${titles[kind]}`, "");
    if (matching.length === 0) lines.push("_none_");
    for (const row of matching) lines.push(`- ${rowLine(row)}`);
  }
  lines.push("", "Packages that already have a retained qualification record on main are never selected and do not appear here.");
  return `${lines.join("\n")}\n`;
}

const USAGE = `Usage: node scripts/classify-qualification-dispatch.mjs <unqualified.json> <pending-dispatch.json> [--json] [--summary <path>] [--root <dir>]

  <unqualified.json>       select-unqualified-packages.mjs --json output.
  <pending-dispatch.json>  filter-qualification-dispatch.mjs --json output.
  (no flag)   one "<package> -- <name>@<version>" line per candidate to dispatch.
  --json      the same dispatch selection as JSON ({ package, name, version }[]).
  --summary   append a Markdown report of every classification to <path>.
  --root      repository root holding package-scope.json and packages/ (default: cwd).
  --help      print this message and exit 0.
`;

function flagValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) die(`${flag} needs a value`);
  return value;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  const json = argv.includes("--json");
  const summaryPath = flagValue(argv, "--summary");
  const root = resolve(flagValue(argv, "--root") ?? process.cwd());
  const positional = argv.filter((a, i) => !a.startsWith("--") && !["--summary", "--root"].includes(argv[i - 1]));
  if (positional.length !== 2) die(`expected <unqualified.json> <pending-dispatch.json>, got ${positional.length} positional argument(s)`);

  const readJsonArray = (path) => {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      die(`could not read/parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!Array.isArray(parsed)) die(`${path} must hold a JSON array`);
    return parsed;
  };
  const unqualified = readJsonArray(positional[0]);
  const pending = readJsonArray(positional[1]);

  let scopeConfig;
  try {
    scopeConfig = JSON.parse(readFileSync(join(root, "package-scope.json"), "utf8"));
  } catch (error) {
    die(`could not read package-scope.json: ${error instanceof Error ? error.message : String(error)}`);
  }

  const rows = await classifyCandidates({
    unqualified,
    pending,
    scope: scopeConfig.scope,
    readManifest: (pkg) => JSON.parse(readFileSync(join(root, "packages", pkg, "package.json"), "utf8")),
    lookupVersions: (name) => lookupPublishedVersions(name, { registry: scopeConfig.registry }),
  });

  for (const row of rows) {
    if (row.classification !== "dispatch") console.error(`classify-qualification-dispatch: ${row.classification}: ${rowLine(row)}`);
  }
  if (summaryPath) appendFileSync(summaryPath, renderSummary(rows));

  const dispatch = rows.filter((r) => r.classification === "dispatch").map(({ package: pkg, name, version }) => ({ package: pkg, name, version }));
  if (json) process.stdout.write(`${JSON.stringify(dispatch)}\n`);
  else if (dispatch.length === 0) console.log("classify-qualification-dispatch: nothing to dispatch.");
  else for (const d of dispatch) console.log(`${d.package} -- ${d.name}@${d.version}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => die(`unexpected error: ${error?.stack ?? error}`, 1));
