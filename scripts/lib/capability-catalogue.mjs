// Capability catalogue generation and pure kit composition (issue #1176,
// owner redirect 2026-09-22).
//
// The owner rejected a hand-maintained, mutually-exclusive kit partition:
// the package catalogue keeps growing and a hand-grouped MECE table does
// not scale. This module builds a GENERATED capability catalogue instead —
// one entry per role, read from docs/contracts/role-loop-archetypes.json
// (job question, owned metric, boundary) and each package manifest's
// `foundry` block, read in exactly the shape
// docs/contracts/package-framework.json defines: `solves` entries
// `{ problem, statement, metric, proofCase, evidence, capability? }`,
// `needs` entries `{ producerRole, artifact }` with `producerRole` a scoped
// package name, `feeds` entries `{ artifact, path }`, `fit` a path to a
// shipped fit-signal file, and `capabilities` (for issue #1382's
// per-capability cycle judgement). No other shape is read. A role that
// declares no `needs` falls back to evidence already in this repository:
// first-party `@clossys/*` runtime dependencies in package.json, and
// `docs/contracts/first-wave-sequence.json`'s `nonRuntimeOrder` (for
// example: customer before publisher, "seal only after a first-person
// keep"). Every edge records which of the two it came from, so a package
// adopting the real fields is never silently overridden by a stale
// fallback.
//
// `composeKit` and `validateKitProposal` are pure: they take an
// already-built catalogue and never touch the filesystem. This file is the
// single implementation of both used by two callers on either side of the
// npm publish boundary:
//
//   - scripts/check-offering-kits.mjs (this repository's gate) imports
//     everything here directly, so the gate stays dependency-free and needs
//     no build step.
//   - packages/advisor/scripts/pack-capability-catalogue.mjs calls
//     `buildCapabilityCatalogue` at advisor's own `npm run build` to freeze
//     a generated snapshot into the published package (mirroring
//     packages/launcher/scripts/pack-skills.mjs). The shipped, published
//     engine in packages/advisor/src/composition.ts is a SEPARATE
//     TypeScript implementation of `composeKit`/`validateKitProposal` —
//     it cannot import this file, because a published npm tarball can only
//     ship packages/advisor's own src/dist, never repository-root scripts/.
//     Keep the two composition algorithms in step; a change to the pure
//     composition rules here belongs in composition.ts too.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const SCOPE_PREFIX = "@clossys/";

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isText(value) {
  return typeof value === "string" && value.trim() !== "";
}

export class CapabilityCatalogueInputError extends Error {
  constructor(message) {
    super(message);
    this.exitCode = 2;
  }
}

function readJson(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new CapabilityCatalogueInputError(`cannot read ${path}: ${error.code ?? error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new CapabilityCatalogueInputError(`cannot parse ${path}: ${error.message}`);
  }
}

/** Non-private packages/* manifests, keyed by directory name. */
export function collectPackageManifests(repoRoot) {
  const packagesDir = join(repoRoot, "packages");
  if (!existsSync(packagesDir)) {
    throw new CapabilityCatalogueInputError(`missing packages/ at ${repoRoot}`);
  }
  const manifests = new Map();
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(packagesDir, entry.name, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    if (!isRecord(manifest) || manifest.private === true) continue;
    manifests.set(entry.name, manifest);
  }
  return manifests;
}

export function loadRoleArchetypes(repoRoot) {
  const path = join(repoRoot, "docs/contracts/role-loop-archetypes.json");
  const archetypes = readJson(path);
  if (!isRecord(archetypes) || !isRecord(archetypes.roles)) {
    throw new CapabilityCatalogueInputError(`docs/contracts/role-loop-archetypes.json must have a roles object`);
  }
  return archetypes;
}

/** docs/contracts/client-problems.json — the client problem vocabulary (issue #1176). */
export function loadClientProblems(repoRoot) {
  const path = join(repoRoot, "docs/contracts/client-problems.json");
  const contract = readJson(path);
  if (!isRecord(contract) || contract.schemaVersion !== 1 || !Array.isArray(contract.problems)) {
    throw new CapabilityCatalogueInputError(`docs/contracts/client-problems.json must have schemaVersion 1 and a problems array`);
  }
  return contract.problems.filter((item) => isRecord(item) && isText(item.id) && isText(item.statement));
}

/** `nonRuntimeOrder` constraints, tolerant of a missing or malformed contract (returns []). */
export function loadNonRuntimeOrder(repoRoot) {
  const path = join(repoRoot, "docs/contracts/first-wave-sequence.json");
  if (!existsSync(path)) return [];
  const contract = readJson(path);
  if (!isRecord(contract) || !Array.isArray(contract.nonRuntimeOrder)) return [];
  return contract.nonRuntimeOrder.filter(
    (item) => isRecord(item) && isText(item.earlier) && isText(item.later) && isText(item.reason),
  );
}

export const EVIDENCE_LEVELS = Object.freeze(["designed", "qualified", "proven"]);

export function evidenceAtLeast(evidence, floor) {
  const evidenceRank = EVIDENCE_LEVELS.indexOf(evidence);
  const floorRank = EVIDENCE_LEVELS.indexOf(floor);
  if (evidenceRank === -1 || floorRank === -1) return false;
  return evidenceRank >= floorRank;
}

/** `@clossys/<role>` -> `<role>`; anything not under this repository's scope -> null. */
export function roleOfScopedName(scopeName) {
  return isText(scopeName) && scopeName.startsWith(SCOPE_PREFIX) ? scopeName.slice(SCOPE_PREFIX.length) : null;
}

/**
 * `foundry.solves`, in exactly docs/contracts/package-framework.json's
 * shape: `{ problem, statement, metric, proofCase, evidence, capability? }`,
 * where `evidence` is one of {@link EVIDENCE_LEVELS} and `capability` (when
 * present) names one of this role's own `capabilities[].id`. Each entry is
 * rebuilt field by field, so the generated catalogue carries exactly the
 * contract's fields and nothing else a manifest happens to hold. An entry
 * missing a required field is dropped rather than trusted partially;
 * scripts/check-package-framework.mjs is the gate that reports it.
 */
function normalizedManifestSolves(foundry) {
  if (!isRecord(foundry) || !Array.isArray(foundry.solves)) return null;
  return foundry.solves
    .filter(
      (item) =>
        isRecord(item)
        && isText(item.problem)
        && isText(item.statement)
        && isText(item.metric)
        && isText(item.proofCase)
        && EVIDENCE_LEVELS.includes(item.evidence),
    )
    .map((item) => ({
      problem: item.problem,
      statement: item.statement,
      metric: item.metric,
      proofCase: item.proofCase,
      evidence: item.evidence,
      ...(isText(item.capability) ? { capability: item.capability } : {}),
    }));
}

/**
 * Fallback `solves`, used only while a role declares no real
 * `foundry.solves`. Restates the role's own
 * docs/contracts/role-loop-archetypes.json `jobQuestion` via the matching
 * seed entry in client-problems.json (matched by that entry's
 * `groundedInRole`, whose `statement` it reuses), always at `designed`
 * evidence and never higher -- this is a documented placeholder, not a
 * measured claim.
 */
function fallbackSolves(directory, role, clientProblems) {
  const seed = clientProblems.find((problem) => problem.groundedInRole === directory);
  if (!seed) return [];
  return [
    {
      problem: seed.id,
      statement: seed.statement,
      metric: role.metric?.name ?? "",
      proofCase: `Restates ${directory}'s own jobQuestion in docs/contracts/role-loop-archetypes.json ("${role.jobQuestion ?? ""}"); no measured proof case exists yet.`,
      evidence: "designed",
    },
  ];
}

/**
 * `foundry.fit` is a package-relative path to one shipped JSON file in
 * docs/contracts/fit-signal-declarations.json's shape. The catalogue
 * carries that file's signal ids. A path that escapes the package, or a
 * file that is missing, unparseable, or not that shape, yields no signals;
 * scripts/check-package-framework.mjs is the gate that reports it.
 */
function fitSignalIds(foundry, directory, readPackageFile) {
  if (!isRecord(foundry) || !isText(foundry.fit)) return [];
  const path = foundry.fit;
  if (path.startsWith("/") || path.split(/[\\/]/).includes("..")) return [];
  let document;
  try {
    document = JSON.parse(readPackageFile(directory, path));
  } catch {
    return [];
  }
  if (!isRecord(document) || !Array.isArray(document.signals)) return [];
  return document.signals.filter((signal) => isRecord(signal) && isText(signal.id)).map((signal) => signal.id);
}

/**
 * `foundry.needs`, in the contract's shape: `{ producerRole, artifact }`,
 * where `producerRole` is the producer's scoped package name. The edge
 * keeps that name verbatim and resolves `role` to the producer's package
 * directory, the name every other catalogue field uses. A `producerRole`
 * outside this repository's scope resolves to no role, so composition
 * reports it as an unsatisfied need instead of guessing.
 */
function normalizedManifestNeeds(foundry) {
  if (!isRecord(foundry) || !Array.isArray(foundry.needs)) return null;
  return foundry.needs
    .filter((item) => isRecord(item) && isText(item.producerRole) && isText(item.artifact))
    .map((item) => {
      const role = roleOfScopedName(item.producerRole);
      return { artifact: item.artifact, ...(role === null ? {} : { role }), producerRole: item.producerRole, source: "manifest" };
    });
}

/**
 * `foundry.feeds`, verbatim in the contract's shape `{ artifact, path }`
 * and in DECLARED order. Order matters: like
 * scripts/check-package-framework.mjs, a lookup by artifact takes the
 * first declared entry, and nothing in the contract forbids a role from
 * listing one artifact twice.
 */
function normalizedManifestFeeds(foundry) {
  if (!isRecord(foundry) || !Array.isArray(foundry.feeds)) return [];
  return foundry.feeds
    .filter((item) => isRecord(item) && isText(item.artifact) && isText(item.path))
    .map((item) => ({ artifact: item.artifact, path: item.path }));
}

/**
 * Whether a catalogue `needs` edge is met, by the same rule
 * scripts/check-package-framework.mjs applies under --enforce
 * (`unmatched-need`): a manifest need is met only when its producer is a
 * role here AND that producer's own declared `feeds` names the artifact.
 * A fallback need (`<role>-package`, `<role>-sequence-gate`) is evidence
 * the catalogue derived itself, with no declared feed to match, so it is
 * met whenever its producer is a role here.
 */
export function needIsMet(need, producer) {
  if (!need.role || !producer || producer.role !== need.role) return false;
  if (need.source !== "manifest") return true;
  return (producer.declaredFeeds ?? []).some((feed) => feed.artifact === need.artifact);
}

/**
 * `foundry.capabilities`, reduced to what issue #1382's per-capability
 * cycle judgement reads: each capability's `id`, its `inputs`
 * (`{ producerRole, artifact }`), and its `outputs`. As in
 * scripts/check-package-framework.mjs, an `inputs` list with any malformed
 * entry counts as no inputs.
 */
function normalizedCapabilities(foundry) {
  if (!isRecord(foundry) || !Array.isArray(foundry.capabilities)) return [];
  const isInputList = (value) => Array.isArray(value) && value.every((item) => isRecord(item) && isText(item.producerRole) && isText(item.artifact));
  return foundry.capabilities
    .filter((item) => isRecord(item) && isText(item.id))
    .map((item) => ({
      id: item.id,
      inputs: isInputList(item.inputs) ? item.inputs.map((input) => ({ producerRole: input.producerRole, artifact: input.artifact })) : [],
      outputs: Array.isArray(item.outputs) ? item.outputs.filter(isText) : [],
    }));
}

/**
 * Builds the generated capability catalogue: one entry per role in
 * role-loop-archetypes.json, combining that role's charter with its
 * manifest's `foundry.solves`/`needs`/`feeds`/`fit`/`capabilities` where
 * present, and falling back to runtime-dependency and non-runtime-order
 * evidence for `needs` where a package declares no `needs` yet.
 *
 * `declaredFeeds` is the role's own `foundry.feeds`, verbatim and in
 * declared order. `feeds` is the producer's side of every MET need (see
 * {@link needIsMet}): one edge per consumer, naming it, and carrying the
 * producer's first declared `path` for that artifact when it declares one.
 *
 * `options.manifests` (a Map of package directory -> manifest) and
 * `options.readPackageFile(directory, relativePath)` replace the
 * filesystem reads, so a test can compose a real repository's catalogue
 * with one manifest changed without writing anything to disk.
 */
export function buildCapabilityCatalogue(repoRoot, options = {}) {
  const manifests = options.manifests ?? collectPackageManifests(repoRoot);
  const readPackageFile = options.readPackageFile ?? ((directory, relativePath) => readFileSync(join(repoRoot, "packages", directory, relativePath), "utf8"));
  const archetypes = loadRoleArchetypes(repoRoot);
  const nonRuntimeOrder = loadNonRuntimeOrder(repoRoot);
  const clientProblems = loadClientProblems(repoRoot);

  const roleDirectories = new Set();
  const byDirectory = new Map();

  for (const [scopeName, role] of Object.entries(archetypes.roles)) {
    if (!scopeName.startsWith(SCOPE_PREFIX) || !isRecord(role)) continue;
    const directory = scopeName.slice(SCOPE_PREFIX.length);
    const manifest = manifests.get(directory);
    if (!manifest) continue; // a role with no current package manifest cannot be composed
    roleDirectories.add(directory);

    const foundry = isRecord(manifest.foundry) ? manifest.foundry : {};
    const manifestNeeds = normalizedManifestNeeds(foundry);
    const manifestSolves = normalizedManifestSolves(foundry);

    byDirectory.set(directory, {
      role: directory,
      scopeName,
      jobQuestion: isText(role.jobQuestion) ? role.jobQuestion : "",
      primaryMode: isText(role.primaryMode) ? role.primaryMode : "",
      metric: {
        name: role.metric?.name ?? "",
        direction: role.metric?.direction ?? "increase",
      },
      boundary: {
        owns: role.boundary?.owns ?? "",
        excludes: Array.isArray(role.boundary?.excludes) ? role.boundary.excludes.filter(isText) : [],
      },
      solves: manifestSolves ?? fallbackSolves(directory, role, clientProblems),
      fit: fitSignalIds(foundry, directory, readPackageFile),
      needs: manifestNeeds ?? [],
      declaredFeeds: normalizedManifestFeeds(foundry),
      capabilities: normalizedCapabilities(foundry),
      usesFallbackNeeds: manifestNeeds === null,
    });
  }

  // Fallback needs from first-party runtime dependencies: a consumer needs
  // the role it imports as a library.
  for (const directory of roleDirectories) {
    const consumer = byDirectory.get(directory);
    if (!consumer.usesFallbackNeeds) continue;
    const manifest = manifests.get(directory);
    const dependencies = isRecord(manifest.dependencies) ? manifest.dependencies : {};
    for (const depName of Object.keys(dependencies)) {
      const depDirectory = roleOfScopedName(depName);
      if (depDirectory === null || !roleDirectories.has(depDirectory) || depDirectory === directory) continue;
      consumer.needs.push({ artifact: `${depDirectory}-package`, role: depDirectory, source: "fallback-runtime-dependency", reason: `runtime dependency on ${depName} in package.json` });
    }
  }

  // Fallback needs from the committed non-runtime closed-loop order: the
  // later package needs the earlier one's handoff before it makes sense.
  for (const constraint of nonRuntimeOrder) {
    if (!roleDirectories.has(constraint.earlier) || !roleDirectories.has(constraint.later)) continue;
    const later = byDirectory.get(constraint.later);
    if (!later.usesFallbackNeeds) continue;
    later.needs.push({
      artifact: `${constraint.earlier}-sequence-gate`,
      role: constraint.earlier,
      source: "fallback-non-runtime-order",
      reason: constraint.reason,
    });
  }

  // Feeds: the producer's side of every met need.
  const feedsByDirectory = new Map([...roleDirectories].map((directory) => [directory, []]));
  for (const directory of roleDirectories) {
    for (const need of byDirectory.get(directory).needs) {
      if (need.role === directory) continue;
      const producer = byDirectory.get(need.role);
      if (!needIsMet(need, producer)) continue;
      const declared = producer.declaredFeeds.find((feed) => feed.artifact === need.artifact);
      feedsByDirectory.get(need.role).push({
        artifact: need.artifact,
        role: directory,
        ...(declared ? { path: declared.path } : {}),
        source: need.source,
        ...(need.reason ? { reason: need.reason } : {}),
      });
    }
  }

  const roles = [...byDirectory.keys()]
    .sort()
    .map((directory) => {
      const entry = byDirectory.get(directory);
      const sortEdges = (edges) => [...edges].sort((a, b) => (a.role ?? "").localeCompare(b.role ?? "") || a.artifact.localeCompare(b.artifact));
      return {
        role: entry.role,
        scopeName: entry.scopeName,
        jobQuestion: entry.jobQuestion,
        primaryMode: entry.primaryMode,
        metric: entry.metric,
        boundary: entry.boundary,
        solves: entry.solves,
        fit: entry.fit,
        needs: sortEdges(entry.needs),
        feeds: sortEdges(feedsByDirectory.get(directory)),
        declaredFeeds: entry.declaredFeeds,
        capabilities: entry.capabilities,
      };
    });

  return { schemaVersion: 1, roles };
}

/** Three-color DFS over an adjacency map (the same walk as scripts/check-package-framework.mjs). Returns the first cycle found, repeated node at both ends, or null. */
function findCycle(edges) {
  const color = new Map();
  const stack = [];
  function visit(node) {
    color.set(node, 1);
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      const state = color.get(next) ?? 0;
      if (state === 1) return stack.slice(stack.indexOf(next)).concat(next);
      if (state === 0 && edges.has(next)) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(node, 2);
    return null;
  }
  for (const node of [...edges.keys()].sort()) {
    if ((color.get(node) ?? 0) === 0) {
      const found = visit(node);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Issue #1382's cycle decision (docs/contracts/package-framework.json,
 * `fields.needs.enforcedRule` and `cycleDecision`), applied to the roles of
 * one kit. It is the same graph scripts/check-package-framework.mjs
 * `detectNeedsCycles` judges, restricted to `roleNames`:
 *
 *   - Nodes are `<role>#<capability id>` for every capability a role
 *     declares, and the bare `<role>` for a role with no capability map.
 *   - Edges are each capability's own `inputs`, and a bare role's `needs`.
 *     A role with capabilities is judged by their `inputs`; one of its
 *     `needs` that no capability's `inputs` covers (same producer and
 *     artifact, or resolving to the same node) becomes an edge from EVERY
 *     one of its capabilities.
 *   - `{ producer, artifact }` resolves to the producer capability whose
 *     `id` is the artifact, else to the capability whose `outputs` holds the
 *     path of the producer's FIRST declared `feeds` entry for it (its
 *     `declaredFeeds`, in declared order, as the gate reads it), else (for
 *     a producer with no capability map) to the bare producer. Anything else, including a
 *     producer outside `roleNames`, adds no edge. A catalogue fallback need
 *     (`<role>-package`, `<role>-sequence-gate`) is resolved the same way.
 *
 * `capabilityCycle` is a cycle among capability nodes only: a deadlock.
 * `unjudgedCycle` is a cycle the capability graph cannot account for, so
 * it cannot be told apart from a deadlock. There are two kinds:
 *   - a cycle that exists only through a bare role (the gate's rule);
 *   - a role-level loop closed by a catalogue fallback need that resolves
 *     to no node. A fallback need (`<role>-package`, `<role>-sequence-gate`)
 *     is inferred evidence, never a declared capability dependency, so
 *     where its producer has a capability map it names no capability and
 *     adds no edge. Dropping it must not make the loop it closes look
 *     legitimate (review of PR #1403, F2). The gate never sees fallback
 *     needs, so this kind never arises from declared data alone.
 * A role-level loop with neither behind it (the Customer/Publisher keep
 * loop) is legitimate.
 */
export function judgeNeedsCycles({ roleNames, catalogue }) {
  const byRole = new Map((catalogue?.roles ?? []).map((role) => [role.role, role]));
  const inScope = new Set((roleNames ?? []).filter((role) => byRole.has(role)));
  const capabilitiesOf = (role) => byRole.get(role)?.capabilities ?? [];
  const resolve = (producer, artifact) => {
    if (!producer || !inScope.has(producer)) return null;
    const capabilities = capabilitiesOf(producer);
    if (capabilities.length === 0) return producer;
    const byId = capabilities.find((capability) => capability.id === artifact);
    if (byId) return `${producer}#${byId.id}`;
    const feed = (byRole.get(producer).declaredFeeds ?? []).find((item) => item.artifact === artifact);
    const byOutput = feed ? capabilities.find((capability) => capability.outputs.includes(feed.path)) : undefined;
    return byOutput ? `${producer}#${byOutput.id}` : null;
  };
  const resolveInput = (input) => resolve(roleOfScopedName(input.producerRole), input.artifact);
  const resolveNeed = (need) => resolve(need.role, need.artifact);
  const edges = new Map();
  for (const role of [...inScope].sort()) {
    const needs = byRole.get(role).needs ?? [];
    const capabilities = capabilitiesOf(role);
    if (capabilities.length === 0) {
      edges.set(role, needs.map(resolveNeed).filter((node) => node !== null));
      continue;
    }
    const covered = (need) => capabilities.some((capability) => capability.inputs.some((input) =>
      (roleOfScopedName(input.producerRole) === need.role && input.artifact === need.artifact)
      || (resolveInput(input) !== null && resolveInput(input) === resolveNeed(need))));
    const uncoveredTargets = needs.filter((need) => !covered(need)).map(resolveNeed).filter((node) => node !== null);
    for (const capability of capabilities) {
      edges.set(`${role}#${capability.id}`, [...capability.inputs.map(resolveInput).filter((node) => node !== null), ...uncoveredTargets]);
    }
  }
  const capabilityOnly = new Map([...edges].filter(([node]) => node.includes("#")).map(([node, next]) => [node, next.filter((target) => target.includes("#"))]));
  const capabilityCycle = findCycle(capabilityOnly);
  if (capabilityCycle) return { capabilityCycle, unjudgedCycle: null };
  return { capabilityCycle: null, unjudgedCycle: findCycle(edges) ?? loopClosedByDroppedFallback(byRole, inScope, resolveNeed) };
}

/**
 * The first role-level loop, among `inScope` roles, that a catalogue
 * fallback need closes although it resolved to no capability-graph node:
 * `[consumer, producer, ..., consumer]`, or null. Deterministic: consumers,
 * their needs, and each breadth-first frontier are walked in sorted order.
 */
function loopClosedByDroppedFallback(byRole, inScope, resolveNeed) {
  const roles = [...inScope].sort();
  const next = new Map(roles.map((role) => [role, [...new Set((byRole.get(role).needs ?? []).map((need) => need.role).filter((producer) => producer && inScope.has(producer)))].sort()]));
  const pathBetween = (from, to) => {
    const previous = new Map([[from, null]]);
    const queue = [from];
    while (queue.length > 0) {
      const role = queue.shift();
      if (role === to) {
        const path = [];
        for (let at = to; at !== null; at = previous.get(at)) path.unshift(at);
        return path;
      }
      for (const producer of next.get(role) ?? []) {
        if (!previous.has(producer)) {
          previous.set(producer, role);
          queue.push(producer);
        }
      }
    }
    return null;
  };
  for (const consumer of roles) {
    const dropped = (byRole.get(consumer).needs ?? [])
      .filter((need) => need.source !== "manifest" && need.role && need.role !== consumer && inScope.has(need.role) && resolveNeed(need) === null)
      .map((need) => need.role)
      .sort();
    for (const producer of dropped) {
      const back = pathBetween(producer, consumer);
      if (back) return [consumer, ...back];
    }
  }
  return null;
}

/**
 * Pure composition: given a selection of role directories and an
 * already-built catalogue, pulls in every role a `needs` edge names that
 * was not already selected, orders roles so a producer precedes its
 * consumer, and reports any role added purely to satisfy someone else's
 * need. A need that is not met ({@link needIsMet}: no such role, or a
 * manifest need whose producer declares no matching `feeds` entry) is
 * reported in `unsatisfiedNeeds`; its producer, when it is a role here,
 * is still pulled in. An unknown selected role comes back
 * `indeterminate`, never guessed past.
 *
 * Needs cycles follow issue #1382's decision ({@link judgeNeedsCycles}):
 *   - a cycle among the kit's capabilities is a deadlock: `indeterminate`;
 *   - every role-level loop the walk meets is listed in `roleCycles`. The
 *     sequence cannot put every role in a loop strictly before the others,
 *     so within a loop it is the walk order;
 *   - a loop with no capability cycle behind it is legitimate, unless the
 *     capability graph cannot account for it: a cycle only visible through
 *     a role with no capability map, or a loop closed by a fallback need
 *     that resolves to no node. Then the kit composes (never failed) and
 *     `unjudgedCycle` names it (never silently passed).
 */
export function composeKit({ selectedRoles, catalogue, context } = {}) {
  const byRole = new Map((catalogue?.roles ?? []).map((role) => [role.role, role]));
  const roles = Array.isArray(selectedRoles) ? selectedRoles : [];
  const indeterminate = (reason) => ({ state: "indeterminate", reason, roles: [], sequence: [], unsatisfiedNeeds: [], addedForDependencies: [] });

  for (const role of roles) {
    if (!byRole.has(role)) return indeterminate(`unknown role: ${role}`);
  }

  const included = new Set();
  const order = [];
  const unsatisfiedNeeds = [];
  const addedForDependencies = new Set();
  const roleCycles = [];

  function visit(role, path) {
    if (included.has(role)) return;
    const onPath = path.indexOf(role);
    if (onPath !== -1) {
      roleCycles.push([...path.slice(onPath), role]);
      return;
    }
    path.push(role);
    const capability = byRole.get(role);
    for (const need of capability.needs) {
      if (need.role && byRole.has(need.role)) {
        if (!roles.includes(need.role)) addedForDependencies.add(need.role);
        visit(need.role, path);
      }
      if (!needIsMet(need, byRole.get(need.role))) {
        unsatisfiedNeeds.push({ role, artifact: need.artifact, wantedRole: need.role ?? need.producerRole ?? null });
      }
    }
    path.pop();
    included.add(role);
    order.push(role);
  }

  for (const role of roles) visit(role, []);

  const { capabilityCycle, unjudgedCycle } = judgeNeedsCycles({ roleNames: order, catalogue });
  if (capabilityCycle) {
    return indeterminate(`needs cycle between capabilities, so none of them can ever run first (issue #1382): ${capabilityCycle.join(" -> ")}`);
  }

  const composedRoles = order.map((role) => {
    const capability = byRole.get(role);
    const isAddedDependency = addedForDependencies.has(role) && !roles.includes(role);
    const why = isAddedDependency
      ? `Needed by ${[...byRole.values()]
          .filter((candidate) => candidate.needs.some((need) => need.role === role))
          .map((candidate) => candidate.role)
          .join(", ")} for its handoff.`
      : capability.jobQuestion;
    return {
      role,
      why,
      goal: { metric: capability.metric.name, direction: capability.metric.direction },
      inputsFrom: capability.needs.filter((need) => need.role).map((need) => need.role),
      outputsTo: capability.feeds.filter((need) => need.role).map((need) => need.role),
    };
  });

  return {
    state: "composed",
    roles: composedRoles,
    sequence: order,
    unsatisfiedNeeds,
    addedForDependencies: [...addedForDependencies],
    roleCycles,
    unjudgedCycle,
    context: context ?? null,
  };
}

export const FIRST_ENGAGEMENT_ROLE_CAP = 5;

/**
 * Deterministically maps a client's CONFIRMED problems to roles (issue
 * #1176, owner comment "De-risking dynamic composition", 2026-09-22): the
 * client confirms problem cards, never picks packages. A role is selected
 * when one of its own `solves` entries names a confirmed problem id --
 * the same input always produces the same role set and order, because the
 * matching is a pure lookup and {@link composeKit}'s closure/ordering is
 * itself deterministic over a fixed catalogue.
 *
 * Guardrails, enforced before any roles are returned:
 *   - exactly one confirmed problem must be marked `primary` (one primary
 *     problem per kit);
 *   - the closed, composed role count over `FIRST_ENGAGEMENT_ROLE_CAP`
 *     (5) requires a caller-supplied `overCapReason`, or comes back as
 *     `state: "over-cap"` instead of `"composed"` so nothing is silently
 *     over-staffed on a first engagement.
 *
 * Each composed role carries `confirmedProblemIds` (its own two-way trace:
 * which confirmed problems it itself solves) and `isDirect` (false for a
 * role pulled in only to satisfy another role's `needs`, exactly as
 * {@link composeKit}'s `addedForDependencies` already distinguishes).
 */
export function composeKitFromProblems({ confirmedProblems, catalogue, overCapReason, cap = FIRST_ENGAGEMENT_ROLE_CAP } = {}) {
  const list = Array.isArray(confirmedProblems) ? confirmedProblems.filter((item) => isRecord(item) && isText(item.id)) : [];
  if (list.length === 0) {
    return { state: "indeterminate", reason: "confirmedProblems must be a nonempty array of { id, primary? }" };
  }

  const primaryEntries = list.filter((item) => item.primary === true);
  if (primaryEntries.length !== 1) {
    return {
      state: "indeterminate",
      reason: `exactly one confirmed problem must be marked primary; found ${primaryEntries.length}`,
    };
  }

  const confirmedIds = new Set(list.map((item) => item.id));
  const roleTrace = new Map();
  for (const role of catalogue?.roles ?? []) {
    const matched = role.solves.filter((item) => confirmedIds.has(item.problem)).map((item) => item.problem);
    if (matched.length > 0) roleTrace.set(role.role, matched);
  }

  const directRoles = [...roleTrace.keys()].sort();
  if (directRoles.length === 0) {
    return { state: "indeterminate", reason: "no role's solves entries match any confirmed problem id" };
  }

  const composed = composeKit({ selectedRoles: directRoles, catalogue });
  if (composed.state !== "composed") return composed;

  const roleCount = composed.roles.length;
  const effectiveCap = typeof cap === "number" ? cap : FIRST_ENGAGEMENT_ROLE_CAP;
  if (roleCount > effectiveCap && !isText(overCapReason)) {
    return {
      state: "over-cap",
      cap: effectiveCap,
      roleCount,
      reason: `composing ${roleCount} roles exceeds the first-engagement cap of ${effectiveCap}; provide overCapReason to proceed anyway`,
      roles: composed.roles.map((role) => ({ ...role, confirmedProblemIds: roleTrace.get(role.role) ?? [], isDirect: roleTrace.has(role.role) })),
      sequence: composed.sequence,
      roleCycles: composed.roleCycles,
      unjudgedCycle: composed.unjudgedCycle,
    };
  }

  return {
    state: "composed",
    primaryProblemId: primaryEntries[0].id,
    roles: composed.roles.map((role) => ({ ...role, confirmedProblemIds: roleTrace.get(role.role) ?? [], isDirect: roleTrace.has(role.role) })),
    sequence: composed.sequence,
    unsatisfiedNeeds: composed.unsatisfiedNeeds,
    addedForDependencies: composed.addedForDependencies,
    roleCycles: composed.roleCycles,
    unjudgedCycle: composed.unjudgedCycle,
    ...(isText(overCapReason) ? { overCapReason } : {}),
  };
}

/**
 * Checks a skill-proposed kit against the deterministic mapping: every
 * proposed role must appear in what {@link composeKitFromProblems} itself
 * would produce from the same confirmed problems -- either as a direct
 * solver of a confirmed problem, or as a role another direct solver's
 * `needs` requires. A proposed role that traces to neither is not removed
 * automatically; it is reported as a removal candidate so the skill (or a
 * human) makes that call. This is the two-way trace: a role links to a
 * confirmed problem AND to its own `solves` entry, or it does not belong.
 */
export function validateKitProposal({ proposal, confirmedProblems, catalogue }) {
  if (!isRecord(proposal) || !isText(proposal.problem) || !Array.isArray(proposal.roles) || proposal.roles.length === 0) {
    return { state: "indeterminate", findings: [{ rule: "invalid-proposal", message: "proposal must have problem and a nonempty roles[]" }] };
  }

  const deterministic = composeKitFromProblems({
    confirmedProblems,
    catalogue,
    overCapReason: isText(proposal.overCapReason) ? proposal.overCapReason : undefined,
  });
  if (deterministic.state === "indeterminate") {
    return { state: "indeterminate", findings: [{ rule: "invalid-confirmed-problems", message: deterministic.reason }] };
  }

  const findings = [];
  if (deterministic.state === "over-cap") {
    findings.push({ rule: "over-cap", message: deterministic.reason });
  }

  const justified = new Map((deterministic.roles ?? []).map((role) => [role.role, role]));
  const removalCandidates = [];

  for (const [index, claim] of proposal.roles.entries()) {
    if (!isRecord(claim) || !isText(claim.role) || !isText(claim.why)) {
      findings.push({ rule: "invalid-claim", message: `roles[${index}] must have role and why` });
      continue;
    }
    const grounded = justified.get(claim.role);
    if (!grounded) {
      removalCandidates.push(claim.role);
      findings.push({
        rule: "ungrounded-role",
        message: `${claim.role} links to no confirmed problem and is not needed by any role that does; propose removing it`,
        role: claim.role,
      });
      continue;
    }
    if (grounded.isDirect && isText(claim.problemId) && !grounded.confirmedProblemIds.includes(claim.problemId)) {
      findings.push({
        rule: "claim-problem-mismatch",
        message: `${claim.role}'s claimed problem ${JSON.stringify(claim.problemId)} is not one of its confirmed matches: ${grounded.confirmedProblemIds.join(", ")}`,
        role: claim.role,
      });
    }
  }

  return { state: findings.length === 0 ? "valid" : "indeterminate", findings, removalCandidates, deterministic };
}

/**
 * Advisory only, not wired into scripts/check-offering-kits.mjs's exit
 * code: "presets may only include roles whose claims are at least
 * qualified" cannot be enforced as a hard gate yet, because most roles
 * still carry only the `designed` fallback `solves` documented above --
 * enforcing it now would fail presets the owner already approved. This
 * function makes the gap visible and testable so it is ready to enforce
 * once real evidence exists, consistent with this repository's own rule
 * that a package's state is derived from evidence, never declared
 * (docs/LIFECYCLE.md).
 */
export function presetEvidenceFindings({ presets, catalogue, floor = "qualified" }) {
  const byRole = new Map((catalogue?.roles ?? []).map((role) => [role.role, role]));
  const findings = [];
  for (const preset of presets ?? []) {
    for (const role of preset?.roles ?? []) {
      const capability = byRole.get(role);
      if (!capability) continue;
      const bestRank = capability.solves.reduce((acc, item) => Math.max(acc, EVIDENCE_LEVELS.indexOf(item.evidence)), -1);
      const best = bestRank === -1 ? null : EVIDENCE_LEVELS[bestRank];
      if (best === null || !evidenceAtLeast(best, floor)) {
        findings.push({
          rule: "preset-role-below-evidence-floor",
          message: `preset ${preset.id} role ${role} has no solves claim at or above "${floor}" evidence (best: ${best ?? "none"})`,
          preset: preset.id,
          role,
        });
      }
    }
  }
  return findings;
}
