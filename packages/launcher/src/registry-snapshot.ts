// The registry snapshot step (issue #1178): the one step of applying a plan
// that reads the network. It fetches each requested package's registry
// document anonymously, projects it into the shared registry snapshot
// contract (docs/contracts/registry-snapshot.json, in the public repository,
// not shipped in this package; its content is packed into src/generated/ at
// build time), validates the whole snapshot against that contract, and only
// then writes it, atomically.
//
// Credentials: every read goes through an injected `Transport` whose default
// is Node's own `fetch`. Nothing here runs the npm CLI, reads an `.npmrc`,
// reads an environment variable, or sets an `Authorization` header; the only
// headers sent are `accept` and `accept-encoding: identity`, which asks for
// the body uncompressed so its hash and the size cap apply to the bytes
// received. Redirects are refused (`redirect: "error"`, and a
// 3xx answer from any transport is refused too), each response is read as a
// stream and abandoned the moment it passes MAX_RESPONSE_BYTES (counted after
// any decoding, so a server that compresses anyway is still bounded), and each
// request, body included, is abandoned after a timeout.

import { createHash, randomBytes } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { ContractDocumentError, readContractDocument, validateAgainstContract } from "./generated/contract-schema.generated.js";
import type { ContractSchema, ContractViolation } from "./generated/contract-schema.generated.js";
import { PACKAGE_SCOPE } from "./generated/package-scope.generated.js";
import { PLAN_CONTRACTS } from "./generated/plan-contracts.generated.js";

/** Where the snapshot is written by default, relative to the hub root. */
export const REGISTRY_SNAPSHOT_REL = "clossys/.state/apply/registry-snapshot.json";

/** The most bytes read from any one registry response (10 MiB). */
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/** How long one request, its body included, may take. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * The port every registry read goes through: the shape of Node's `fetch`,
 * as Integrator's transport has. The request's URL and init are built here,
 * never by the transport's caller, so tests inspect exactly what would be sent.
 */
export type Transport = (input: URL, init: RequestInit) => Promise<Response>;

/** Node's own `fetch`. It reads no npm configuration and adds no credential. */
export const nodeFetchTransport: Transport = (input, init) => fetch(input, init);

/** One version of a package, projected from the registry's document. */
export interface RegistrySnapshotVersion {
  readonly version: string;
  readonly integrity: string | null;
  readonly tarball: string;
  readonly deprecated: boolean;
  readonly publishedAt: string | null;
  readonly hasAttestations: boolean;
}

/** One requested package. */
export interface RegistrySnapshotPackage {
  readonly name: string;
  readonly status: "found" | "not-found";
  readonly latest: string | null;
  readonly versions: readonly RegistrySnapshotVersion[];
  readonly responseSha256: string;
}

/** clossys/.state/apply/registry-snapshot.json (docs/contracts/registry-snapshot.json, in the public repository, not shipped in this package). */
export interface RegistrySnapshot {
  readonly schemaVersion: 1;
  readonly kind: "clossys.registry-snapshot";
  readonly registry: string;
  readonly fetchedAt: string;
  readonly fetchedBy: { readonly name: string; readonly version: string };
  readonly packages: readonly RegistrySnapshotPackage[];
}

/** One reason a snapshot is refused: `rule` is "schema" for the contract's keywords, else the code rule's id. */
export interface RegistrySnapshotViolation {
  readonly rule: "schema" | "N1" | "N2" | "N3";
  /** The field at fault, like `packages[1].versions[0].integrity`, or "" for the document itself. */
  readonly path: string;
  /** What is wrong, by position only, never quoting a value or an undeclared key. */
  readonly message: string;
}

/** Why the snapshot step stopped. The message names packages and positions only, never registry or request content. */
export class RegistrySnapshotError extends Error {}

function loadContract(name: string): ContractSchema {
  const contract = Object.hasOwn(PLAN_CONTRACTS, name) ? PLAN_CONTRACTS[name] : undefined;
  if (contract === undefined) throw new Error(`no packed contract named ${JSON.stringify(name)}`);
  return contract;
}

const UNDECLARED_FIELD = "is not a field the contract declares, and unknown fields are refused";

/**
 * A contract violation with no document text in it, as @clossys/advisor
 * reports one: the checker names an undeclared key in its path, and that key
 * is document text, so the violation is placed at the object holding it.
 */
function positionOnly(violation: ContractViolation): { path: string; message: string } {
  if (violation.message !== UNDECLARED_FIELD) return { path: violation.path, message: violation.message };
  const { path } = violation;
  const cut = path.endsWith('"]') ? path.lastIndexOf('["') : path.lastIndexOf(".");
  return { path: cut === -1 ? "" : path.slice(0, cut), message: "has a field the contract does not declare, and unknown fields are refused" };
}

function eachRepeat<T>(items: readonly T[], key: (item: T) => string, onRepeat: (index: number, firstIndex: number) => void): void {
  const first = new Map<string, number>();
  items.forEach((item, index) => {
    const value = key(item);
    const earlier = first.get(value);
    if (earlier === undefined) first.set(value, index);
    else onRepeat(index, earlier);
  });
}

/**
 * Every violation of the registry snapshot contract: its schema, then, only
 * for a snapshot whose shape is known good, its code rules N1-N3 (no package
 * named twice, no version recorded twice for one package, no `latest` or
 * versions for a package that was not found). Implemented separately from
 * @clossys/advisor's reader; both are tested against the one corpus,
 * docs/contracts/registry-snapshot.fixture.json (in the public repository,
 * not shipped in this package). Never throws.
 */
export function registrySnapshotViolations(value: unknown): RegistrySnapshotViolation[] {
  const schema = validateAgainstContract(loadContract("registry-snapshot.json"), value, loadContract);
  if (schema.length > 0) return schema.map((violation) => ({ rule: "schema", ...positionOnly(violation) }));
  const snapshot = value as RegistrySnapshot;
  const violations: RegistrySnapshotViolation[] = [];
  eachRepeat(snapshot.packages, (entry) => entry.name, (index, first) =>
    violations.push({ rule: "N1", path: `packages[${index}].name`, message: `repeats packages[${first}].name` }),
  );
  snapshot.packages.forEach((entry, index) => {
    eachRepeat(entry.versions, (version) => version.version, (position, first) =>
      violations.push({ rule: "N2", path: `packages[${index}].versions[${position}].version`, message: `repeats packages[${index}].versions[${first}].version` }),
    );
    if (entry.status === "not-found") {
      if (entry.latest !== null) violations.push({ rule: "N3", path: `packages[${index}].latest`, message: "must be null when the package was not found" });
      if (entry.versions.length > 0) violations.push({ rule: "N3", path: `packages[${index}].versions`, message: "must be empty when the package was not found" });
    }
  });
  return violations;
}

/** Compares strings as sequences of UTF-16 code units, the order the snapshot contract sorts by. */
function byCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The snapshot in the contract's canonical order: packages sorted by name, each package's versions sorted by version. */
export function canonicalRegistrySnapshot(snapshot: RegistrySnapshot): RegistrySnapshot {
  return {
    ...snapshot,
    packages: [...snapshot.packages]
      .sort((left, right) => byCodeUnits(left.name, right.name))
      .map((entry) => ({ ...entry, versions: [...entry.versions].sort((left, right) => byCodeUnits(left.version, right.version)) })),
  };
}

/**
 * A package name's registry path segment. Copied, unchanged, from
 * `registryEncodedName` in @clossys/integrator's provenance-check.ts, which
 * this package must not depend on at runtime; a test compares the two
 * function bodies so they cannot drift apart. The leading `@` stays literal
 * and only the slash is percent-encoded (`@scope%2Fname`), the convention
 * npm-compatible registries share; `encodeURIComponent` on the whole name
 * would also encode the `@`, which none of them expect.
 */
export function registryEncodedName(name: string): string {
  const slash = name.indexOf("/");
  if (slash === -1) return encodeURIComponent(name);
  return `@${encodeURIComponent(name.slice(1, slash))}%2F${encodeURIComponent(name.slice(slash + 1))}`;
}

/** The full registry document's URL for `name`: `{registry}/{encoded name}`. */
export function packumentUrl(registry: string, name: string): URL {
  return new URL(registryEncodedName(name), registry.endsWith("/") ? registry : `${registry}/`);
}

const PACKAGE_NAME = new RegExp(
  ((loadContract("registry-snapshot.json").definitions as Record<string, { pattern: string }>).packageName as { pattern: string }).pattern,
);

/**
 * The package names in a snapshot request: the report `advisor-package-request`
 * prints, `{ state: "satisfied", names, findings: [] }`, or just `{ names }`.
 * Every name must be a scoped package name in the packed publishing scope,
 * named once. A refusal names positions only, never the request's text.
 */
export function requestedPackageNames(request: unknown, scope: string = PACKAGE_SCOPE.scope): string[] {
  if (typeof request !== "object" || request === null || Array.isArray(request)) throw new RegistrySnapshotError("the request must be a JSON object with a names array");
  const record = request as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "state" && key !== "names" && key !== "findings")) {
    throw new RegistrySnapshotError("the request has a field other than state, names and findings");
  }
  if (Object.hasOwn(record, "state") && record.state !== "satisfied") {
    throw new RegistrySnapshotError("the request's state is not satisfied: fix the plan and run advisor-package-request again");
  }
  if (Object.hasOwn(record, "findings") && !(Array.isArray(record.findings) && record.findings.length === 0)) {
    throw new RegistrySnapshotError("the request's findings must be an empty array");
  }
  const names = Object.hasOwn(record, "names") ? record.names : undefined;
  if (!Array.isArray(names) || names.length === 0) throw new RegistrySnapshotError("the request's names must be a non-empty array");
  const seen = new Map<string, number>();
  for (let index = 0; index < names.length; index += 1) {
    if (!Object.hasOwn(names, index)) throw new RegistrySnapshotError(`names[${index}] is missing`);
    const name: unknown = names[index];
    if (typeof name !== "string" || !PACKAGE_NAME.test(name) || !name.startsWith(`${scope}/`)) {
      throw new RegistrySnapshotError(`names[${index}] is not a package name in the ${scope} scope`);
    }
    const earlier = seen.get(name);
    if (earlier !== undefined) throw new RegistrySnapshotError(`names[${index}] repeats names[${earlier}]`);
    seen.set(name, index);
  }
  return names as string[];
}

/** A registry document that cannot be projected. `what` is fixed text, never the document's. */
class PackumentShapeError extends Error {}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An own member only: a registry document's inherited members are never read. */
function own(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** An own member that must be a plain object when present; absent or null reads as undefined. */
function optionalObject(record: Record<string, unknown>, key: string, what: string): Record<string, unknown> | undefined {
  const value = own(record, key);
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) throw new PackumentShapeError(what);
  return value;
}

function optionalString(record: Record<string, unknown>, key: string, what: string): string | null {
  const value = own(record, key);
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new PackumentShapeError(what);
  return value;
}

/**
 * Projects a registry document into one snapshot entry's `latest` and
 * `versions`, reading only what the contract records: the version the
 * `latest` dist-tag names, and that one version's integrity, tarball,
 * deprecation, publish time and attestation presence. Every other version,
 * dist-tag and field is ignored. When `latest` names a version the document
 * does not list, `versions` is empty, so a resolver refuses it by name.
 */
export function projectPackument(name: string, document: unknown): { latest: string | null; versions: RegistrySnapshotVersion[] } {
  if (!isPlainObject(document)) throw new PackumentShapeError("is not a JSON object");
  if (own(document, "name") !== name) throw new PackumentShapeError("does not name the package that was requested");
  const distTags = optionalObject(document, "dist-tags", "has dist-tags that are not an object");
  const latest = distTags === undefined ? null : optionalString(distTags, "latest", "has a latest dist-tag that is not a string");
  if (latest === null) return { latest: null, versions: [] };
  const versions = optionalObject(document, "versions", "has versions that are not an object");
  const entry = versions === undefined ? undefined : own(versions, latest);
  if (entry === undefined) return { latest, versions: [] };
  if (!isPlainObject(entry)) throw new PackumentShapeError("lists the latest version as something that is not an object");
  if (own(entry, "version") !== latest) throw new PackumentShapeError("lists the latest version under a different version number");
  const dist = optionalObject(entry, "dist", "has a latest version whose dist is not an object") ?? {};
  const tarball = own(dist, "tarball");
  if (typeof tarball !== "string") throw new PackumentShapeError("has a latest version with no tarball URL");
  const deprecation = own(entry, "deprecated");
  let deprecated: boolean;
  if (deprecation === undefined || deprecation === null) deprecated = false;
  else if (typeof deprecation === "boolean") deprecated = deprecation;
  // npm treats an empty deprecation message as no deprecation, and any other message as one.
  else if (typeof deprecation === "string") deprecated = deprecation !== "";
  else throw new PackumentShapeError("marks the latest version deprecated with something that is neither text nor a boolean");
  const attestations = own(dist, "attestations");
  if (attestations !== undefined && attestations !== null && !isPlainObject(attestations)) {
    throw new PackumentShapeError("has latest-version attestations that are not an object");
  }
  const time = optionalObject(document, "time", "has a time field that is not an object");
  return {
    latest,
    versions: [
      {
        version: latest,
        integrity: optionalString(dist, "integrity", "has a latest-version integrity that is not a string"),
        tarball,
        deprecated,
        publishedAt: time === undefined ? null : optionalString(time, latest, "has a latest-version publish time that is not a string"),
        hasAttestations: isPlainObject(attestations),
      },
    ],
  };
}

const TIMED_OUT = Symbol("timed out");

/** Settles with `promise`, or rejects with TIMED_OUT as soon as `signal` aborts, whether or not the transport honours the signal. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(TIMED_OUT);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(TIMED_OUT);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * The body's bytes, read chunk by chunk. The read stops, and the stream is
 * cancelled, the moment the running total passes `cap`, so an oversize body
 * is never buffered past it.
 */
async function readCapped(body: ReadableStream<Uint8Array> | null, cap: number, signal: AbortSignal): Promise<Uint8Array | "too-large"> {
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await untilAborted(reader.read(), signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new TypeError("a response chunk is not bytes");
      total += value.byteLength;
      if (total > cap) return "too-large";
      chunks.push(value);
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * The request every registry read sends: `accept`, and `accept-encoding:
 * identity` so the body arrives uncompressed and `responseSha256` and the
 * size cap apply to the exact bytes received; no credential, no redirect.
 */
function requestInit(signal: AbortSignal): RequestInit {
  return { method: "GET", headers: { accept: "application/json", "accept-encoding": "identity" }, redirect: "error", credentials: "omit", signal };
}

export interface FetchSnapshotOptions {
  readonly transport?: Transport;
  readonly timeoutMs?: number;
  /** An ISO 8601 date-time, taken once every fetch has finished. */
  readonly now?: () => string;
  /** The package taking the snapshot; read from this package's own package.json unless given. */
  readonly fetchedBy?: { readonly name: string; readonly version: string };
}

type Fetched = { readonly status: 200 | 404; readonly bytes: Uint8Array };

async function fetchOne(transport: Transport, url: URL, where: string, timeoutMs: number): Promise<Fetched> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const seconds = `${timeoutMs / 1000} s`;
  try {
    let response: Response;
    try {
      response = await untilAborted(transport(url, requestInit(controller.signal)), controller.signal);
    } catch {
      if (controller.signal.aborted) throw new RegistrySnapshotError(`${where}: the registry did not answer within ${seconds}`);
      throw new RegistrySnapshotError(`${where}: the registry could not be reached, or answered with a redirect, which is refused`);
    }
    const { status } = response;
    const discard = (): void => {
      response.body?.cancel().catch(() => undefined);
    };
    if (response.redirected || (status >= 300 && status < 400)) {
      discard();
      throw new RegistrySnapshotError(`${where}: the registry answered with a redirect${response.redirected ? "" : ` (HTTP ${status})`}, which is refused and never followed`);
    }
    if (status !== 200 && status !== 404) {
      discard();
      throw new RegistrySnapshotError(`${where}: the registry answered HTTP ${status}; only 200 and 404 are recorded`);
    }
    const tooLarge = `${where}: the registry's response is larger than ${MAX_RESPONSE_BYTES / (1024 * 1024)} MiB and was not read past that`;
    const declared = response.headers.get("content-length");
    if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared.trim()) > MAX_RESPONSE_BYTES) {
      discard();
      throw new RegistrySnapshotError(tooLarge);
    }
    let bytes: Uint8Array | "too-large";
    try {
      bytes = await readCapped(response.body, MAX_RESPONSE_BYTES, controller.signal);
    } catch {
      if (controller.signal.aborted) throw new RegistrySnapshotError(`${where}: the registry did not finish its response within ${seconds}`);
      throw new RegistrySnapshotError(`${where}: the registry's response could not be read`);
    }
    if (bytes === "too-large") throw new RegistrySnapshotError(tooLarge);
    return { status, bytes };
  } finally {
    clearTimeout(timer);
  }
}

function strictJsonReason(cause: unknown): string {
  if (!(cause instanceof ContractDocumentError)) return "is not strict JSON";
  const where = cause.position === undefined ? "" : ` at position ${cause.position}`;
  const why = cause.reason === "encoding" ? "is not valid UTF-8" : cause.reason === "repeated-key" ? "repeats a key in one object" : "is not valid JSON";
  return `${why}${where}`;
}

let ownIdentity: { name: string; version: string } | undefined;

/** This package's own name and version, from the package.json it ships with. */
function launcherIdentity(): { name: string; version: string } {
  if (ownIdentity === undefined) {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { name?: unknown; version?: unknown };
    if (typeof manifest.name !== "string" || typeof manifest.version !== "string") throw new RegistrySnapshotError("this package's own package.json has no name and version");
    ownIdentity = { name: manifest.name, version: manifest.version };
  }
  return ownIdentity;
}

/**
 * Fetches every named package's full registry document, one at a time, and
 * returns the snapshot in canonical order, validated against the contract.
 * Throws RegistrySnapshotError, having fetched no further, on the first
 * package whose read fails: a transport error, a timeout, a redirect, an
 * answer other than 200 or 404, a body over MAX_RESPONSE_BYTES, a 200 body
 * that is not strict JSON or not a registry document for that package, or a
 * projection the contract refuses. A 404 records `status: "not-found"`.
 * `names` must already have passed `requestedPackageNames()`.
 */
export async function takeRegistrySnapshot(names: readonly string[], options: FetchSnapshotOptions = {}): Promise<RegistrySnapshot> {
  const transport = options.transport ?? nodeFetchTransport;
  const { registry } = PACKAGE_SCOPE;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchedBy = options.fetchedBy ?? launcherIdentity();
  const ordered = names.map((name, index) => ({ name, index })).sort((left, right) => byCodeUnits(left.name, right.name));
  const packages: RegistrySnapshotPackage[] = [];
  for (const { name, index } of ordered) {
    const where = `names[${index}] ${name}`;
    const { status, bytes } = await fetchOne(transport, packumentUrl(registry, name), where, timeoutMs);
    const responseSha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (status === 404) {
      packages.push({ name, status: "not-found", latest: null, versions: [], responseSha256 });
      continue;
    }
    let document: unknown;
    try {
      document = readContractDocument(bytes);
    } catch (cause) {
      throw new RegistrySnapshotError(`${where}: the registry's response ${strictJsonReason(cause)}`);
    }
    try {
      packages.push({ name, status: "found", ...projectPackument(name, document), responseSha256 });
    } catch (cause) {
      if (cause instanceof PackumentShapeError) throw new RegistrySnapshotError(`${where}: the registry's document ${cause.message}`);
      throw cause;
    }
  }
  const snapshot = canonicalRegistrySnapshot({
    schemaVersion: 1,
    kind: "clossys.registry-snapshot",
    registry,
    fetchedAt: (options.now ?? (() => new Date().toISOString()))(),
    fetchedBy: { name: fetchedBy.name, version: fetchedBy.version },
    packages,
  });
  assertValidSnapshot(snapshot);
  return snapshot;
}

function assertValidSnapshot(value: unknown): void {
  const violations = registrySnapshotViolations(value);
  if (violations.length > 0) {
    const listed = violations.map((violation) => `snapshot${violation.path === "" ? "" : violation.path.startsWith("[") ? violation.path : `.${violation.path}`} ${violation.message} (rule ${violation.rule})`);
    throw new RegistrySnapshotError(`the snapshot does not validate against the registry snapshot contract, so none is written: ${listed.join("; ")}`);
  }
}

/** The snapshot's file text: two-space JSON with a final newline, in the order given. */
export function serializeRegistrySnapshot(snapshot: RegistrySnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

/**
 * Writes `text` to `path` so that a reader sees the old file or the whole
 * new one, never part of it: the bytes go to a new temporary file in the same
 * directory, are flushed to disk, and the temporary file is then renamed over
 * `path`. On any failure the temporary file is removed and `path` is left as
 * it was.
 */
export function writeFileAtomically(path: string, text: string): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const temporary = join(directory, `.${basename(path)}.${randomBytes(8).toString("hex")}.tmp`);
  const bytes = Buffer.from(text, "utf8");
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", 0o644);
    let written = 0;
    while (written < bytes.length) written += writeSync(descriptor, bytes, written, bytes.length - written);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
  } catch (cause) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Already failing; the original error is the one reported.
      }
    }
    rmSync(temporary, { force: true });
    throw cause;
  }
}

/**
 * Serializes a snapshot, re-reads that exact text strictly and validates it
 * against the contract, and only then writes it atomically to `path`. The
 * bytes on disk are therefore exactly the bytes that validated.
 */
export function writeRegistrySnapshot(path: string, snapshot: RegistrySnapshot): void {
  const text = serializeRegistrySnapshot(snapshot);
  assertValidSnapshot(readContractDocument(Buffer.from(text, "utf8")));
  writeFileAtomically(path, text);
}
