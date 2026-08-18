/**
 * Toolchain declarations: the runtime pin, the package-manager pin, and the
 * build order, expressed as the same `liveStateSurface` statement every
 * other subject in this package makes — *this is what should exist; go and
 * see whether it does* — and reconciled against a real machine with
 * `reconcileLiveState` from `./live-state.js`.
 *
 * WHY THIS BELONGS HERE, NOT IN A PACKAGE OF ITS OWN
 * ----------------------------------------------------
 * A runtime pin, a machine manifest (`./manifest.js`), and a deployment
 * target (`./deployment/index.js`) are three altitudes of one statement.
 * Before this module existed, a runtime pin and a package-manager pin were
 * the shape most likely to be copied by hand into four repositories'
 * `.nvmrc`, `engines`, and CI setup steps independently, with no channel
 * between the copies — exactly the defect #257 names for the secret-scan
 * gate, one layer beneath CI mechanics and onto the toolchain those
 * mechanics run on top of.
 *
 * SCOPE, DELIBERATELY NARROW
 * ---------------------------
 * A pin here is an EXACT value: one runtime version, one package-manager
 * name and version, one ordered build sequence. There is no range syntax.
 * A caller wanting "any 20.x" declares the exact floor its CI actually
 * enforces and lets its own dependency-freshness process move the pin
 * forward — the same discipline `verify-standards`'s staleness floor
 * applies to itself. Guessing at range syntax this module does not parse
 * would answer confidently about something it does not understand, which is
 * the failure this whole package exists to refuse.
 *
 * Zero I/O. Every declaration and every observation is supplied by the
 * caller.
 */

import type { Finding } from "./types.js";
import type { LiveStateDeclarationValue, LiveStateObservation, LiveStateSubjectReport } from "./live-state.js";
import { reconcileLiveState } from "./live-state.js";

/** One runtime this plane pins — typically the language/interpreter version CI and every consumer must match. */
export interface RuntimePin {
  /** Opaque identifier, e.g. "node". Never validated against a closed list — a plane may pin any runtime. */
  readonly name: string;
  /** An exact version, e.g. "20.11.1". Never a range — see the module header. */
  readonly version: string;
}

/** One package manager this plane pins. */
export interface PackageManagerPin {
  /** Opaque identifier, e.g. "npm", "pnpm", "yarn". */
  readonly name: string;
  /** An exact version, e.g. "10.5.0". Never a range. */
  readonly version: string;
}

/** The order this plane's packages must build in, most-depended-upon first. */
export interface BuildOrderPin {
  /** Package identifiers in required build order. Every entry must be unique. */
  readonly packages: readonly string[];
}

/** The full toolchain a plane declares. */
export interface ToolchainDeclaration {
  readonly runtime: RuntimePin;
  readonly packageManager: PackageManagerPin;
  readonly buildOrder: BuildOrderPin;
}

const EXACT_VERSION = /^\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?$/;
const IDENTIFIER = /^[a-z][a-z0-9-]*$/;

function findingsForPin(kind: "runtime" | "package-manager", name: unknown, version: unknown): Finding[] {
  const findings: Finding[] = [];
  if (typeof name !== "string" || name.trim() === "") {
    findings.push({
      rule: `toolchain/${kind}-missing-name`,
      severity: "high",
      message: `A ${kind} pin requires a non-empty name.`,
    });
  }
  if (typeof version !== "string" || version.trim() === "") {
    findings.push({
      rule: `toolchain/${kind}-missing-version`,
      severity: "high",
      message: `A ${kind} pin requires a non-empty version.`,
    });
  } else if (!EXACT_VERSION.test(version)) {
    findings.push({
      rule: `toolchain/${kind}-not-exact-version`,
      severity: "high",
      message:
        `A ${kind} pin must be an exact version ("20.11.1"), never a range. Got ${JSON.stringify(version)} — a ` +
        "range this module does not parse would answer confidently about syntax it does not understand.",
    });
  }
  return findings;
}

/** Validates a runtime pin's own shape. Pure and offline. */
export function validateRuntimePin(pin: RuntimePin): readonly Finding[] {
  const record = pin as unknown as Record<string, unknown>;
  return findingsForPin("runtime", record.name, record.version);
}

/** Validates a package-manager pin's own shape. Pure and offline. */
export function validatePackageManagerPin(pin: PackageManagerPin): readonly Finding[] {
  const record = pin as unknown as Record<string, unknown>;
  return findingsForPin("package-manager", record.name, record.version);
}

/** Validates a build-order pin's own shape: non-empty, every entry a real-looking identifier, no duplicates. */
export function validateBuildOrderPin(pin: BuildOrderPin): readonly Finding[] {
  const findings: Finding[] = [];
  const record = pin as unknown as Record<string, unknown>;
  const packages = record.packages;
  if (!Array.isArray(packages) || packages.length === 0) {
    findings.push({
      rule: "toolchain/build-order-empty",
      severity: "high",
      message: "A build-order pin requires a non-empty \"packages\" list. An empty order verifies nothing.",
    });
    return findings;
  }
  const seen = new Set<string>();
  for (const [index, entry] of packages.entries()) {
    if (typeof entry !== "string" || !IDENTIFIER.test(entry)) {
      findings.push({
        rule: "toolchain/build-order-malformed-entry",
        severity: "high",
        message: `packages[${index}] (${JSON.stringify(entry)}) is not a lowercase hyphenated package identifier.`,
      });
      continue;
    }
    if (seen.has(entry)) {
      findings.push({
        rule: "toolchain/build-order-duplicate-entry",
        severity: "high",
        message: `packages[${index}] ("${entry}") is duplicated. Build order names each package once.`,
      });
    }
    seen.add(entry);
  }
  return findings;
}

/** Validates a whole toolchain declaration's own shape. Pure and offline. */
export function validateToolchainDeclaration(declaration: ToolchainDeclaration): readonly Finding[] {
  const record = declaration as unknown as Record<string, unknown>;
  return [
    ...validateRuntimePin(record.runtime as RuntimePin),
    ...validatePackageManagerPin(record.packageManager as PackageManagerPin),
    ...validateBuildOrderPin(record.buildOrder as BuildOrderPin),
  ];
}

/**
 * What was actually found on the machine this run executes on, supplied by
 * the caller. This module never runs `process.version`, spawns a shell to
 * ask `npm --version`, or reads a root manifest itself — see the package
 * README's "Injected, never ambient" section for why: a function that reads
 * its own runtime cannot be tested for the disagreeing case without
 * actually running on a disagreeing machine.
 */
export interface ToolchainObservation {
  readonly runtime: LiveStateObservation<string>;
  readonly packageManager: LiveStateObservation<string>;
  readonly buildOrder: LiveStateObservation<readonly string[]>;
}

/** Strips an optional leading "v" (as `process.version` carries) before comparing. */
function normalizeVersion(value: string): string {
  return value.startsWith("v") ? value.slice(1) : value;
}

/**
 * Reconciles a declared toolchain against one observation of the live
 * machine, returning one `LiveStateSubjectReport` per pin. Each report is
 * independently `verified`, `drifted`, or `could-not-verify` — see
 * `./live-state.js` for why a two-state result cannot be constructed here.
 */
export function reconcileToolchain(
  declaration: ToolchainDeclaration,
  observation: ToolchainObservation,
): readonly [LiveStateSubjectReport, LiveStateSubjectReport, LiveStateSubjectReport] {
  const runtimeDeclared: LiveStateDeclarationValue<string> = { value: normalizeVersion(declaration.runtime.version) };
  const runtimeObservation: LiveStateObservation<string> = {
    ...observation.runtime,
    ...(observation.runtime.live === undefined ? {} : { live: normalizeVersion(observation.runtime.live) }),
  };

  const runtime = reconcileLiveState({
    subject: `toolchain.runtime.${declaration.runtime.name}`,
    declared: runtimeDeclared,
    observation: runtimeObservation,
    agrees: (declaredVersion, liveVersion) => declaredVersion === liveVersion,
    describeDrift: (declaredVersion, liveVersion) =>
      `Declared ${declaration.runtime.name} runtime "${declaredVersion}" does not match live "${liveVersion}".`,
  });

  const packageManager = reconcileLiveState({
    subject: `toolchain.packageManager.${declaration.packageManager.name}`,
    declared: { value: declaration.packageManager.version },
    observation: observation.packageManager,
    agrees: (declaredVersion, liveVersion) => declaredVersion === liveVersion,
    describeDrift: (declaredVersion, liveVersion) =>
      `Declared ${declaration.packageManager.name} "${declaredVersion}" does not match live "${liveVersion}".`,
  });

  const buildOrder = reconcileLiveState({
    subject: "toolchain.buildOrder",
    declared: { value: declaration.buildOrder.packages },
    observation: observation.buildOrder,
    agrees: (declaredOrder, liveOrder) =>
      declaredOrder.length === liveOrder.length && declaredOrder.every((entry, index) => entry === liveOrder[index]),
    describeDrift: (declaredOrder, liveOrder) =>
      `Declared build order [${declaredOrder.join(", ")}] does not match live [${liveOrder.join(", ")}].`,
  });

  return [runtime, packageManager, buildOrder];
}
