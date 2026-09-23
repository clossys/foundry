// Capability catalogue generation and pure kit composition (issue #1176,
// owner redirect 2026-09-22).
//
// The owner rejected a hand-maintained, mutually-exclusive kit partition:
// the package catalogue keeps growing and a hand-grouped MECE table does
// not scale. This module builds a GENERATED capability catalogue instead —
// one entry per role, read from docs/contracts/role-loop-archetypes.json
// (job question, owned metric, boundary) and each package manifest's
// `foundry` block (`solves`, `needs`, `feeds`, `fit` — added by the
// framework lane, issue #1172, in progress on another branch). No package
// currently carries those fields, so `buildCapabilityCatalogue` falls back
// to evidence already in this repository for the `needs`/`feeds` handoff
// graph: first-party `@clossys/*` runtime dependencies in package.json, and
// `docs/contracts/first-wave-sequence.json`'s `nonRuntimeOrder` (for
// example: customer before publisher, "seal only after a first-person
// keep"). Every derived edge records which of the two it came from, so a
// package adopting #1172's real fields is never silently overridden by a
// stale fallback.
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

/**
 * `foundry.solves` once a package adopts issue #1172: each entry names a
 * `problem` id from docs/contracts/client-problems.json, the `metric` it
 * would move, a `proofCase` describing how that would be shown, and an
 * `evidence` tier (`designed`, `qualified`, or `proven`). Malformed entries
 * are dropped rather than trusted partially.
 */
function normalizedManifestSolves(foundry) {
  if (!isRecord(foundry) || !Array.isArray(foundry.solves)) return null;
  return foundry.solves.filter(
    (item) => isRecord(item) && isText(item.problem) && isText(item.metric) && isText(item.proofCase) && EVIDENCE_LEVELS.includes(item.evidence),
  );
}

/**
 * Fallback `solves`, used only while a role declares no real
 * `foundry.solves` (true for every role today; issue #1172 has not
 * landed). Restates the role's own docs/contracts/role-loop-archetypes.json
 * `jobQuestion` via the matching seed entry in client-problems.json
 * (matched by that entry's `groundedInRole`), always at `designed`
 * evidence and never higher -- this is a documented placeholder, not a
 * measured claim.
 */
function fallbackSolves(directory, role, clientProblems) {
  const seed = clientProblems.find((problem) => problem.groundedInRole === directory);
  if (!seed) return [];
  return [
    {
      problem: seed.id,
      metric: role.metric?.name ?? "",
      proofCase: `Restates ${directory}'s own jobQuestion in docs/contracts/role-loop-archetypes.json ("${role.jobQuestion ?? ""}"); no measured proof case exists yet.`,
      evidence: "designed",
    },
  ];
}

function normalizedFit(foundry) {
  if (!isRecord(foundry) || !Array.isArray(foundry.fit)) return [];
  return foundry.fit.filter((item) => isText(item));
}

function normalizedManifestEdges(foundry, key) {
  if (!isRecord(foundry) || !Array.isArray(foundry[key])) return null;
  return foundry[key]
    .filter((item) => isRecord(item) && isText(item.artifact))
    .map((item) => ({
      artifact: item.artifact,
      role: isText(item.fromRole ?? item.toRole ?? item.role) ? item.fromRole ?? item.toRole ?? item.role : undefined,
      source: "manifest",
    }));
}

/**
 * Builds the generated capability catalogue: one entry per role in
 * role-loop-archetypes.json, combining that role's charter with its
 * manifest's `foundry.solves`/`needs`/`feeds`/`fit` where present, and
 * falling back to runtime-dependency and non-runtime-order evidence for
 * `needs`/`feeds` where a package declares neither field yet.
 */
export function buildCapabilityCatalogue(repoRoot) {
  const manifests = collectPackageManifests(repoRoot);
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
    const manifestNeeds = normalizedManifestEdges(foundry, "needs");
    const manifestFeeds = normalizedManifestEdges(foundry, "feeds");
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
      fit: normalizedFit(foundry),
      needs: manifestNeeds ?? [],
      feeds: manifestFeeds ?? [],
      usesFallbackNeeds: manifestNeeds === null,
      usesFallbackFeeds: manifestFeeds === null,
    });
  }

  // Fallback edges from first-party runtime dependencies: a consumer needs
  // the role it imports as a library; the producer feeds it back.
  for (const directory of roleDirectories) {
    const manifest = manifests.get(directory);
    const dependencies = isRecord(manifest.dependencies) ? manifest.dependencies : {};
    for (const depName of Object.keys(dependencies)) {
      if (!depName.startsWith(SCOPE_PREFIX)) continue;
      const depDirectory = depName.slice(SCOPE_PREFIX.length);
      if (!roleDirectories.has(depDirectory) || depDirectory === directory) continue;
      const reason = `runtime dependency on ${depName} in package.json`;
      const consumer = byDirectory.get(directory);
      if (consumer.usesFallbackNeeds) {
        consumer.needs.push({ artifact: `${depDirectory}-package`, role: depDirectory, source: "fallback-runtime-dependency", reason });
      }
      const producer = byDirectory.get(depDirectory);
      if (producer.usesFallbackFeeds) {
        producer.feeds.push({ artifact: `${depDirectory}-package`, role: directory, source: "fallback-runtime-dependency", reason });
      }
    }
  }

  // Fallback edges from the committed non-runtime closed-loop order: the
  // later package needs the earlier one's handoff before it makes sense.
  for (const constraint of nonRuntimeOrder) {
    if (!roleDirectories.has(constraint.earlier) || !roleDirectories.has(constraint.later)) continue;
    const later = byDirectory.get(constraint.later);
    if (later.usesFallbackNeeds) {
      later.needs.push({
        artifact: `${constraint.earlier}-sequence-gate`,
        role: constraint.earlier,
        source: "fallback-non-runtime-order",
        reason: constraint.reason,
      });
    }
    const earlier = byDirectory.get(constraint.earlier);
    if (earlier.usesFallbackFeeds) {
      earlier.feeds.push({
        artifact: `${constraint.earlier}-sequence-gate`,
        role: constraint.later,
        source: "fallback-non-runtime-order",
        reason: constraint.reason,
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
        feeds: sortEdges(entry.feeds),
      };
    });

  return { schemaVersion: 1, roles };
}

/**
 * Pure composition: given a selection of role directories and an
 * already-built catalogue, pulls in every role a `needs` edge names that
 * was not already selected, orders roles so a producer always precedes its
 * consumer, and reports any need that names no resolvable role plus any
 * role added purely to satisfy someone else's need. An unknown selected
 * role or a needs cycle is reported as `indeterminate`, never guessed past.
 */
export function composeKit({ selectedRoles, catalogue, context } = {}) {
  const byRole = new Map((catalogue?.roles ?? []).map((role) => [role.role, role]));
  const roles = Array.isArray(selectedRoles) ? selectedRoles : [];

  for (const role of roles) {
    if (!byRole.has(role)) {
      return { state: "indeterminate", reason: `unknown role: ${role}`, roles: [], sequence: [], unsatisfiedNeeds: [], addedForDependencies: [] };
    }
  }

  const included = new Set();
  const order = [];
  const unsatisfiedNeeds = [];
  const addedForDependencies = new Set();

  function visit(role, path) {
    if (included.has(role)) return true;
    if (path.has(role)) return { cycle: [...path, role] };
    path.add(role);
    const capability = byRole.get(role);
    for (const need of capability.needs) {
      if (need.role && byRole.has(need.role)) {
        if (!roles.includes(need.role)) addedForDependencies.add(need.role);
        const result = visit(need.role, path);
        if (result !== true) return result;
      } else {
        unsatisfiedNeeds.push({ role, artifact: need.artifact, wantedRole: need.role ?? null });
      }
    }
    path.delete(role);
    included.add(role);
    order.push(role);
    return true;
  }

  for (const role of roles) {
    const result = visit(role, new Set());
    if (result !== true) {
      return {
        state: "indeterminate",
        reason: `needs cycle: ${result.cycle.join(" -> ")}`,
        roles: [],
        sequence: [],
        unsatisfiedNeeds: [],
        addedForDependencies: [],
      };
    }
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
    };
  }

  return {
    state: "composed",
    primaryProblemId: primaryEntries[0].id,
    roles: composed.roles.map((role) => ({ ...role, confirmedProblemIds: roleTrace.get(role.role) ?? [], isDirect: roleTrace.has(role.role) })),
    sequence: composed.sequence,
    unsatisfiedNeeds: composed.unsatisfiedNeeds,
    addedForDependencies: composed.addedForDependencies,
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
 * qualified" cannot be enforced as a hard gate today, because every
 * current `solves` entry is the `designed`-only fallback documented above
 * (issue #1172 has not landed real evidence for any role yet) -- enforcing
 * it now would fail every preset the owner already approved. This
 * function makes the gap visible and testable so it is ready to enforce
 * the moment real evidence exists, consistent with this repository's own
 * rule that a package's state is derived from evidence, never declared
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
