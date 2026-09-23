/**
 * Orchestrates `integrator-provenance-check`: for every already-installed
 * `@clossys` package a plane supplies, verify its registry provenance
 * anonymously via the public attestations endpoint (works under pnpm, which
 * implements no `npm audit signatures`) and report its currency against the
 * registry's own `latest` dist-tag, scoped to that ONE package -- never one
 * hard-coded endpoint asked to answer for the whole run, which is exactly the
 * bug this repository's own consumer-adoption document and issue #885
 * describe in the pre-existing `check-currency.mjs` gate this package does
 * not replace.
 *
 * Every registry read goes through an injected `Transport` (the same port
 * `reachability.ts` already defines), never a real `fetch` in this module or
 * its tests -- only the CLI's own `main()` wires up the real network.
 *
 * THE TERNARY, AND WHY ZERO PACKAGES IS NEVER A PASS
 * ----------------------------------------------------
 * `verified` (0), `violated` (1), `indeterminate` (2). A plane with zero
 * installed `@clossys` packages has verified nothing -- it is indeterminate,
 * the same way `assessPackageCurrencyRate` treats an empty evaluated set as
 * indeterminate rather than a perfect rate, never a vacuous `verified`.
 *
 * INDETERMINATE WINS OVER VIOLATED, deliberately, the same precedence
 * `bouncer`, `butler`, `giver`, and `keeper`'s interaction gates already use
 * (see this repository's own architecture-decision record,
 * "Indeterminate-over-violated precedence"): a run in
 * which some packages are confirmed violated and some could not be reached at
 * all reports indeterminate, because the violation set is known to be
 * incomplete -- an unreachable registry is never a pass, and it must not be
 * silently absorbed into "everything else looked fine" either. Every
 * package's own report is still returned in full regardless of which state
 * wins the overall verdict.
 */
import {
  PUBLIC_REGISTRY,
  inspectInstalledPackageProvenance,
  type InstalledPackageProvenanceState,
} from "./provenance.js";
import { classifyCurrencyDistance, type CurrencyDistance, type CurrencyIndeterminateReason } from "./currency.js";
import type { Transport } from "./reachability.js";

export interface InstalledPackageRef {
  readonly name: string;
  readonly installedVersion: string;
}

/** A consumer-declared currency policy: an exact expected pin per package name. Omitted entries are informational-only. */
export interface CurrencyPolicy {
  readonly pins?: Readonly<Record<string, string>>;
}

export type PackageProvenanceState = "verified" | "violated" | "indeterminate";

export interface PackageProvenanceReport {
  readonly name: string;
  readonly installedVersion: string;
  readonly latestVersion?: string;
  readonly currencyDistance?: CurrencyDistance | CurrencyIndeterminateReason;
  readonly state: PackageProvenanceState;
  readonly reasons: readonly string[];
}

export interface ProvenanceCheckInput {
  readonly packages: readonly InstalledPackageRef[];
  readonly transport: Transport;
  readonly registryBaseUrl?: string;
  readonly currencyPolicy?: CurrencyPolicy;
  readonly signal?: AbortSignal;
}

export type ProvenanceCheckState = "verified" | "violated" | "indeterminate";

export interface ProvenanceCheckResult {
  readonly state: ProvenanceCheckState;
  readonly registryBaseUrl: string;
  readonly packages: readonly PackageProvenanceReport[];
}

/**
 * A scoped package's registry-path encoding: the leading `@` stays literal
 * and only the slash is percent-encoded (`@scope%2Fname`) -- the same
 * convention `reachability.ts`'s own `registryPath` already establishes and
 * every npm-compatible registry (npm itself, GitHub Packages, a private
 * Verdaccio) shares. `encodeURIComponent` on the whole name would also
 * encode the leading `@` itself, which none of them expect.
 */
function registryEncodedName(name: string): string {
  const slash = name.indexOf("/");
  if (slash === -1) return encodeURIComponent(name);
  return `@${encodeURIComponent(name.slice(1, slash))}%2F${encodeURIComponent(name.slice(slash + 1))}`;
}

function attestationsPath(name: string, version: string): string {
  return `-/npm/v1/attestations/${registryEncodedName(name)}@${version}`;
}

function packumentPath(name: string): string {
  return registryEncodedName(name);
}

async function readJson(transport: Transport, url: URL, signal: AbortSignal | undefined): Promise<{ ok: true; body: unknown } | { ok: false; reason: string }> {
  let response: Response;
  try {
    response = await transport(url, signal ? { signal } : {});
  } catch (error) {
    return { ok: false, reason: `registry unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, reason: `registry answered ${url.pathname} with HTTP ${response.status}` };
  }
  try {
    return { ok: true, body: await response.json() };
  } catch (error) {
    return { ok: false, reason: `registry response for ${url.pathname} is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function latestVersionOf(packument: unknown): string | undefined {
  if (typeof packument !== "object" || packument === null) return undefined;
  const distTags = (packument as Record<string, unknown>)["dist-tags"];
  if (typeof distTags !== "object" || distTags === null) return undefined;
  const latest = (distTags as Record<string, unknown>)["latest"];
  return typeof latest === "string" && latest.length > 0 ? latest : undefined;
}

async function checkOnePackage(pkg: InstalledPackageRef, registryBaseUrl: string, transport: Transport, policy: CurrencyPolicy | undefined, signal: AbortSignal | undefined): Promise<PackageProvenanceReport> {
  const base = registryBaseUrl.endsWith("/") ? registryBaseUrl : `${registryBaseUrl}/`;

  const packumentResult = await readJson(transport, new URL(packumentPath(pkg.name), base), signal);
  if (!packumentResult.ok) {
    return { name: pkg.name, installedVersion: pkg.installedVersion, state: "indeterminate", reasons: [packumentResult.reason] };
  }

  const attestationsResult = await readJson(transport, new URL(attestationsPath(pkg.name, pkg.installedVersion), base), signal);
  if (!attestationsResult.ok) {
    return { name: pkg.name, installedVersion: pkg.installedVersion, state: "indeterminate", reasons: [attestationsResult.reason] };
  }

  const provenance = inspectInstalledPackageProvenance({
    name: pkg.name,
    version: pkg.installedVersion,
    packument: packumentResult.body,
    attestationsResponse: attestationsResult.body,
  });

  const latestVersion = latestVersionOf(packumentResult.body);
  const distance = latestVersion !== undefined ? classifyCurrencyDistance(pkg.installedVersion, latestVersion) : undefined;
  const currencyDistance = distance === undefined ? undefined : distance.kind === "graded" ? distance.distance : distance.reason;

  const reasons: string[] = [...provenance.failures];
  let state: PackageProvenanceState = provenanceStateToPackageState(provenance.state);

  const pin = policy?.pins?.[pkg.name];
  if (pin !== undefined && pin !== pkg.installedVersion) {
    reasons.push(`declared currency policy pins ${pkg.name} to ${pin}, but ${pkg.installedVersion} is installed`);
    state = "violated";
  }

  return {
    name: pkg.name,
    installedVersion: pkg.installedVersion,
    ...(latestVersion !== undefined ? { latestVersion } : {}),
    ...(currencyDistance !== undefined ? { currencyDistance } : {}),
    state,
    reasons,
  };
}

function provenanceStateToPackageState(state: InstalledPackageProvenanceState): PackageProvenanceState {
  return state === "verified" ? "verified" : "violated";
}

function foldState(packages: readonly PackageProvenanceReport[]): ProvenanceCheckState {
  if (packages.length === 0) return "indeterminate";
  if (packages.some((pkg) => pkg.state === "indeterminate")) return "indeterminate";
  if (packages.some((pkg) => pkg.state === "violated")) return "violated";
  return "verified";
}

/**
 * Verifies provenance (and, where a policy declares one, currency) for every
 * supplied installed `@clossys` package, independently and concurrently --
 * one package's failure never skips another's check, matching
 * `probeReachability`'s own discipline. An empty `packages` list is
 * `indeterminate`, never a vacuous `verified` -- see this module's header.
 */
export async function checkInstalledPackagesProvenance(input: ProvenanceCheckInput): Promise<ProvenanceCheckResult> {
  const registryBaseUrl = input.registryBaseUrl ?? PUBLIC_REGISTRY;
  if (input.packages.length === 0) {
    return { state: "indeterminate", registryBaseUrl, packages: [] };
  }
  const packages = await Promise.all(
    input.packages.map((pkg) => checkOnePackage(pkg, registryBaseUrl, input.transport, input.currencyPolicy, input.signal)),
  );
  return { state: foldState(packages), registryBaseUrl, packages };
}
