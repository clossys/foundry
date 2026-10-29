import type { AppLocalTarget } from "./emitter.js";
import type { SecurityTxtOptions } from "../content-map/security.js";

/** References must name source already included in the selected app-local closure.
 * Adapters own their Designer/Writer bindings; this command supplies no UI copy. */
export interface SiteSyncPort {
  readonly file: string;
  readonly export: string;
  readonly props?: Readonly<Record<string, unknown>>;
}
export interface SiteSyncHost {
  readonly locale: string;
  readonly frame: SiteSyncPort;
  readonly consent: SiteSyncPort;
  readonly notFound: SiteSyncPort;
  readonly security: SecurityTxtOptions;
  readonly formSubmit?: string;
}
export interface SiteSyncOptions {
  readonly root: string;
  readonly target: AppLocalTarget;
  readonly origin: string;
  readonly host: SiteSyncHost;
  readonly crawl: "allow" | "disallow";
  readonly check?: boolean;
}
export interface SiteSyncFinding {
  readonly kind: "missing" | "stale" | "hand-edit" | "extra" | "clossys-import";
  readonly path: string;
  readonly message: string;
}
export interface SiteSyncResult {
  readonly exitCode: 0 | 1 | 2;
  readonly findings: readonly SiteSyncFinding[];
  readonly files: readonly string[];
  readonly message?: string;
}
