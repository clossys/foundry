import type { DeploymentBuildRequirement, DeploymentBuildRequirementDefinition, DeploymentEnvironment, DeploymentFinding } from "../types.js";

/**
 * Standard DNS resource record types this contract can declare and check
 * live. Deliberately the small, universal subset every DNS provider
 * supports -- see this module's README section for why a provider-specific
 * record kind (Cloudflare's own page rules, for example) has no place in a
 * PROVIDER-NEUTRAL schema.
 */
export const DNS_RECORD_TYPES = ["A", "AAAA", "CNAME", "TXT", "MX", "NS"] as const;
export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number];

/**
 * One declared DNS record. `proxied` is not a Cloudflare-only escape hatch
 * bolted onto an otherwise-neutral shape -- it names a real, provider-
 * observable fact ("this DNS provider terminates and re-originates traffic
 * at its own edge, so the record's LIVE value is the provider's edge
 * address, never `value`") that changes what live resolution can prove for
 * this one record. A DNS provider that has no such behavior always declares
 * `proxied: false` (the default) and this field is inert. See
 * `dns-check.ts`'s own header for exactly how it changes verification.
 */
export type DnsRecordDefinition = {
  readonly type: DnsRecordType;
  /** Relative to `domain`, or `"@"` for the apex. */
  readonly name: string;
  readonly value: string;
  /** MX only. Every other record type must omit it. */
  readonly priority?: number;
  readonly proxied?: boolean;
};

export type DnsRecord = {
  readonly type: DnsRecordType;
  readonly name: string;
  readonly value: string;
  readonly priority?: number;
  readonly proxied: boolean;
};

/** One environment this web surface serves, and which branch feeds it -- see `../branch-binding.ts`'s identical plain-string seam. */
export type WebSurfaceEnvironmentDefinition = {
  readonly environment: DeploymentEnvironment;
  /** The fully-qualified hostname serving this environment, e.g. `"example.com"` or `"preview.example.com"`. */
  readonly hostname: string;
  readonly branch: string;
};

export type WebSurfaceEnvironment = WebSurfaceEnvironmentDefinition;

/** The application's build settings, plus the repository subdirectory the hosting provider must root the project at (issue #1215's `apps/*` layout). */
export type WebSurfaceBuildSettingsDefinition = DeploymentBuildRequirementDefinition & {
  readonly applicationRoot: string;
};

export type WebSurfaceBuildSettings = DeploymentBuildRequirement & {
  readonly applicationRoot: string;
};

/**
 * The declared web deployment surface: one domain, its DNS records, one
 * hosting project, and the environment-to-branch mapping that feeds it.
 * Provider-neutral -- `dnsProvider` and `hostingProvider` are plain,
 * lowercase-identifier strings, exactly like `DeploymentSurfaceDefinition
 * .provider` in `../types.ts`, never a closed enum of "every provider this
 * package has heard of." Cloudflare (DNS) and Vercel (hosting) are this
 * contract's first worked example, not the only providers it can name --
 * see `vercel-hosting.ts` for how a Vercel-specific live observation folds
 * into the provider-neutral verification report without this module or
 * `verify.ts` importing anything Vercel-specific.
 */
export type WebSurfaceDeclarationDefinition = {
  readonly schemaVersion: "1";
  /** The registrable apex domain, e.g. `"example.com"`. Never a real product domain in this repository's own examples or fixtures. */
  readonly domain: string;
  readonly dnsProvider: string;
  readonly records: readonly DnsRecordDefinition[];
  readonly hostingProvider: string;
  readonly hostingProject: string;
  readonly build: WebSurfaceBuildSettingsDefinition;
  readonly environments: readonly WebSurfaceEnvironmentDefinition[];
  /**
   * Key routes beyond the root to verify are actually served, each an
   * internal path starting with `/`. The root (`"/"`) is always checked by
   * `checkRoutes` whether or not it is repeated here.
   */
  readonly routes?: readonly string[];
};

export type WebSurfaceDeclaration = {
  readonly schemaVersion: "1";
  readonly domain: string;
  readonly dnsProvider: string;
  readonly records: readonly DnsRecord[];
  readonly hostingProvider: string;
  readonly hostingProject: string;
  readonly build: WebSurfaceBuildSettings;
  readonly environments: readonly WebSurfaceEnvironment[];
  readonly routes: readonly string[];
};

/** Reuses the deployment contract's own finding shape -- one vocabulary for "what's wrong," not a second one per subpath. */
export type WebSurfaceFinding = DeploymentFinding;
