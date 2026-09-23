import { DEPLOYMENT_ENVIRONMENTS } from "../types.js";
import type { DeploymentEnvironment } from "../types.js";
import { DNS_RECORD_TYPES } from "./types.js";
import type { DnsRecordType, WebSurfaceDeclarationDefinition, WebSurfaceFinding } from "./types.js";

const ID = /^[a-z][a-z0-9-]{0,63}$/;
const DECLARATION_KEYS = new Set(["schemaVersion", "domain", "dnsProvider", "records", "hostingProvider", "hostingProject", "build", "environments", "routes"]);
const RECORD_KEYS = new Set(["type", "name", "value", "priority", "proxied"]);
const BUILD_KEYS = new Set(["command", "outputDirectory", "applicationRoot"]);
const ENVIRONMENT_KEYS = new Set(["environment", "hostname", "branch"]);

const DOMAIN_LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const APEX_DOMAIN = new RegExp(`^${DOMAIN_LABEL}(?:\\.${DOMAIN_LABEL})+$`);
const HOSTNAME = new RegExp(`^(?:\\*\\.)?${DOMAIN_LABEL}(?:\\.${DOMAIN_LABEL})*$`);
const RECORD_NAME = new RegExp(`^(?:@|(?:\\*\\.)?${DOMAIN_LABEL}(?:\\.${DOMAIN_LABEL})*)$`);
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const TXT_VALUE = /^[\x20-\x7e]{1,255}$/;
const RECORD_TYPES_ALLOWING_PROXY: ReadonlySet<DnsRecordType> = new Set(["A", "AAAA", "CNAME"]);

function record(findings: WebSurfaceFinding[], rule: string, message: string, path?: string): void {
  findings.push({ rule, severity: "error", message, ...(path === undefined ? {} : { path }) });
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, path: string, findings: WebSurfaceFinding[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) record(findings, "web-surface-unknown-property", "Unsupported property.", `${path}.${key}`);
  }
}

/** A rough but sound IPv6 shape check: hex groups and at most one "::" compression, nothing else. */
function isIpv6(value: string): boolean {
  if (value.length === 0 || value.length > 45 || value !== value.trim()) return false;
  if (!/^[0-9a-f:]+$/i.test(value)) return false;
  const compressions = value.split("::").length - 1;
  if (compressions > 1) return false;
  const groups = value.split("::").flatMap((half) => (half.length === 0 ? [] : half.split(":")));
  if (compressions === 0 && groups.length !== 8) return false;
  if (compressions === 1 && groups.length >= 8) return false;
  return groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group));
}

function isBuildCommand(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 1_000 && !/[\r\n\0]/.test(value);
}

function isRelativePath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 256
    && value === value.trim()
    && !value.startsWith("/")
    && !value.includes("\\")
    && value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function isRoutePath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 512
    && value === value.trim()
    && value.startsWith("/")
    && !value.startsWith("//")
    && !/[\r\n\t?#]/.test(value);
}

/** Mirrors `../branch-binding.ts`'s `isBranchName` shape check exactly -- see that file's header for why this stays a plain-string seam rather than a cross-import. */
function isBranchName(value: string): boolean {
  if (value.length === 0 || value.length > 255 || value !== value.trim()) return false;
  if (value === "HEAD" || value.startsWith("-") || value.startsWith("/") || value.endsWith("/")) return false;
  if (value.endsWith(".") || value.endsWith(".lock") || value.includes("..") || value.includes("@{") || value.includes("//")) return false;
  const forbidden = new Set(["~", "^", ":", "?", "*", "[", "\\"]);
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x20 || codePoint === 0x7f || forbidden.has(character)) return false;
  }
  return !value.split("/").some((segment) => segment.length === 0 || segment.startsWith(".") || segment.endsWith(".lock"));
}

function normalizedDomain(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const domain = value.trim().toLowerCase().replace(/\.$/, "");
  return domain.length > 0 && domain.length <= 253 ? domain : undefined;
}

function isRecordValue(type: DnsRecordType, value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  switch (type) {
    case "A":
      return IPV4.test(value);
    case "AAAA":
      return isIpv6(value);
    case "TXT":
      return TXT_VALUE.test(value);
    case "CNAME":
    case "MX":
    case "NS": {
      const hostname = normalizedDomain(value);
      return hostname !== undefined && HOSTNAME.test(hostname) && !hostname.startsWith("*.");
    }
    default:
      return false;
  }
}

function validateRecord(value: unknown, path: string, findings: WebSurfaceFinding[]): void {
  if (!object(value)) {
    record(findings, "dns-record-object", "A DNS record must be an object.", path);
    return;
  }
  rejectUnknownKeys(value, RECORD_KEYS, path, findings);

  const type = typeof value.type === "string" && (DNS_RECORD_TYPES as readonly string[]).includes(value.type) ? (value.type as DnsRecordType) : undefined;
  if (type === undefined) record(findings, "dns-record-type", `type must be one of ${DNS_RECORD_TYPES.join(", ")}.`, `${path}.type`);

  if (typeof value.name !== "string" || !RECORD_NAME.test(value.name.toLowerCase())) {
    record(findings, "dns-record-name", 'name must be "@" or a hostname label relative to the declared domain.', `${path}.name`);
  }

  if (type !== undefined && !isRecordValue(type, value.value)) {
    record(findings, "dns-record-value", `value is not a valid ${type} record value.`, `${path}.value`);
  } else if (type === undefined && typeof value.value !== "string") {
    record(findings, "dns-record-value", "value must be a string.", `${path}.value`);
  }

  if (value.priority !== undefined) {
    if (type !== "MX") record(findings, "dns-record-priority-unsupported", "priority is supported only for MX records.", `${path}.priority`);
    else if (typeof value.priority !== "number" || !Number.isInteger(value.priority) || value.priority < 0 || value.priority > 65_535) {
      record(findings, "dns-record-priority", "priority must be an integer from 0 through 65535.", `${path}.priority`);
    }
  } else if (type === "MX") {
    record(findings, "dns-record-priority-required", "MX records require priority.", `${path}.priority`);
  }

  if (value.proxied !== undefined) {
    if (typeof value.proxied !== "boolean") record(findings, "dns-record-proxied", "proxied must be a boolean when supplied.", `${path}.proxied`);
    else if (type !== undefined && !RECORD_TYPES_ALLOWING_PROXY.has(type)) {
      record(findings, "dns-record-proxied-unsupported", "proxied is supported only for A, AAAA, and CNAME records.", `${path}.proxied`);
    }
  }
}

function validateBuild(value: unknown, path: string, findings: WebSurfaceFinding[]): void {
  if (!object(value)) {
    record(findings, "web-surface-build-object", "build must be an object.", path);
    return;
  }
  rejectUnknownKeys(value, BUILD_KEYS, path, findings);
  if (!isBuildCommand(value.command)) record(findings, "web-surface-build-command", "build.command must be a non-empty single-line command.", `${path}.command`);
  if (!isRelativePath(value.outputDirectory)) record(findings, "web-surface-output-directory", "build.outputDirectory must be a non-empty relative path without dot segments.", `${path}.outputDirectory`);
  if (!isRelativePath(value.applicationRoot)) record(findings, "web-surface-application-root", "build.applicationRoot must be a non-empty relative path without dot segments (e.g. \"apps/site\").", `${path}.applicationRoot`);
}

function validateEnvironments(value: unknown, domain: string | undefined, path: string, findings: WebSurfaceFinding[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    record(findings, "web-surface-environments", "environments must be a non-empty array.", path);
    return;
  }
  const seen = new Set<string>();
  for (const [index, environment] of value.entries()) {
    const entryPath = `${path}[${index}]`;
    if (!object(environment)) {
      record(findings, "web-surface-environment-object", "An environment entry must be an object.", entryPath);
      continue;
    }
    rejectUnknownKeys(environment, ENVIRONMENT_KEYS, entryPath, findings);
    if (!DEPLOYMENT_ENVIRONMENTS.includes(environment.environment as DeploymentEnvironment)) {
      record(findings, "web-surface-environment", "environment is not supported.", `${entryPath}.environment`);
    } else if (seen.has(environment.environment as string)) {
      record(findings, "duplicate-web-surface-environment", "Each environment may appear at most once.", `${entryPath}.environment`);
    } else {
      seen.add(environment.environment as string);
    }
    const hostname = normalizedDomain(environment.hostname);
    if (hostname === undefined || !HOSTNAME.test(hostname) || hostname.startsWith("*.")) {
      record(findings, "web-surface-environment-hostname", "hostname must be a valid hostname.", `${entryPath}.hostname`);
    } else if (domain !== undefined && hostname !== domain && !hostname.endsWith(`.${domain}`)) {
      record(findings, "web-surface-environment-hostname-scope", "hostname must equal the declared domain or be one of its subdomains.", `${entryPath}.hostname`);
    }
    if (typeof environment.branch !== "string" || !isBranchName(environment.branch)) {
      record(findings, "web-surface-environment-branch", "branch must be a valid Git branch name.", `${entryPath}.branch`);
    }
  }
  if (!seen.has("production")) record(findings, "web-surface-production-environment-required", "A production environment is required.", path);
}

function validateRoutes(value: unknown, path: string, findings: WebSurfaceFinding[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    record(findings, "web-surface-routes", "routes must be an array when supplied.", path);
    return;
  }
  const seen = new Set<string>();
  for (const [index, route] of value.entries()) {
    const routePath = `${path}[${index}]`;
    if (!isRoutePath(route)) record(findings, "web-surface-route", "Each route must be an internal path without a query or fragment.", routePath);
    else if (seen.has(route)) record(findings, "duplicate-web-surface-route", "routes must be unique.", routePath);
    else seen.add(route);
  }
}

function validate(value: unknown, findings: WebSurfaceFinding[]): void {
  if (!object(value)) {
    record(findings, "web-surface-object", "A web surface declaration must be an object.");
    return;
  }
  rejectUnknownKeys(value, DECLARATION_KEYS, "declaration", findings);

  if (value.schemaVersion !== "1") record(findings, "web-surface-schema-version", 'schemaVersion must be "1".', "declaration.schemaVersion");

  const domain = normalizedDomain(value.domain);
  if (domain === undefined || !APEX_DOMAIN.test(domain)) record(findings, "web-surface-domain", "domain must be a registrable domain name.", "declaration.domain");

  if (typeof value.dnsProvider !== "string" || !ID.test(value.dnsProvider)) record(findings, "web-surface-dns-provider", "dnsProvider must be a lowercase stable identifier.", "declaration.dnsProvider");
  if (typeof value.hostingProvider !== "string" || !ID.test(value.hostingProvider)) record(findings, "web-surface-hosting-provider", "hostingProvider must be a lowercase stable identifier.", "declaration.hostingProvider");
  if (typeof value.hostingProject !== "string" || value.hostingProject.trim().length === 0 || value.hostingProject.length > 256) {
    record(findings, "web-surface-hosting-project", "hostingProject must be a non-empty identifier.", "declaration.hostingProject");
  }

  if (!Array.isArray(value.records) || value.records.length === 0) {
    record(findings, "web-surface-records", "records must be a non-empty array.", "declaration.records");
  } else {
    for (const [index, entry] of value.records.entries()) validateRecord(entry, `declaration.records[${index}]`, findings);
  }

  validateBuild(value.build, "declaration.build", findings);
  validateEnvironments(value.environments, domain, "declaration.environments", findings);
  validateRoutes(value.routes, "declaration.routes", findings);
}

/**
 * Reports every supported structural violation without exposing source
 * values. Authoring input can arrive from untyped configuration, including
 * objects with throwing accessors; those are treated as unreadable input
 * rather than allowed to fail validation itself -- the same discipline
 * `../validate.ts` already documents for `validateDeploymentManifest`.
 */
export function validateWebSurfaceDeclaration(value: unknown): readonly WebSurfaceFinding[] {
  const findings: WebSurfaceFinding[] = [];
  try {
    validate(value, findings);
  } catch {
    record(findings, "web-surface-unreadable", "Web surface declaration could not be read safely.");
  }
  return findings;
}

export function isValidWebSurfaceDeclaration(value: unknown): value is WebSurfaceDeclarationDefinition {
  return !validateWebSurfaceDeclaration(value).some((finding) => finding.severity === "error");
}
