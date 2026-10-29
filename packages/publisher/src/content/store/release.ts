import { publicationDigest, stampPublication, assertCompiledPublication } from "../release/publication.js";
import type { CompiledPublication } from "../release/publication.js";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { ContentFinding } from "../composition.js";
import { computeReleaseDigest, prepareContentRelease } from "../release/prepare.js";
import type { ReleaseInput, ReleaseManifest, ReleaseResult } from "../release/types.js";
import { isContentLocale, isRevisionId, SLOT_KINDS } from "../vocabulary.js";
import { readStoreJson, optionalStoreJson, writeStoreJson, storeEntries, storeRoot, storeSegment } from "./files.js";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export interface ContentReleasePointer {
  readonly targetId: string;
  readonly current: { readonly n: number; readonly digest: string };
  /** Only bundles explicitly selected through this local release operation. */
  readonly released: readonly { readonly n: number; readonly digest: string }[];
}
export type ContentReleasePointerResult = { readonly ok: true; readonly pointer: ContentReleasePointer } | { readonly ok: false; readonly findings: readonly ContentFinding[] };

async function changeReleasePointer(inputRoot: string, targetId: string, digest: string, rollback: boolean): Promise<ContentReleasePointerResult> {
  const refuse = (message: string): ContentReleasePointerResult => ({ ok:false,findings:[{path:"_release-pointers",rule:"release-pointer",message}] });
  let root: string;
  try { storeSegment(targetId); if (!hash(digest)) return refuse("An exact stored release digest is required"); root = await checkedRoot(inputRoot); await regularDirectory(join(root,"_releases")); }
  catch { return refuse("A regular existing release store and safe target are required"); }
  const lockPath = join(root,"_releases",".lock");
  let lock: OwnedPath;
  try { await fs.mkdir(lockPath); const stat = await fs.lstat(lockPath); lock = {path:lockPath,dev:stat.dev,ino:stat.ino}; }
  catch { return refuse("Release store is busy or invalid"); }
  try {
    const numbers = await releaseNumbers(root);
    const next = numbers[targetId];
    if (!next) return refuse("Unknown release target");
    const manifests: ReleaseManifest[] = [];
    for (let n=1;n<next;n++) manifests.push(await readStoreJson(root,`_releases/${targetId}/${n}.json`) as ReleaseManifest);
    const selected = manifests.find(manifest => manifest.digest === digest);
    if (!selected) return refuse("Digest does not identify a complete validated stored bundle");
    const previous = await optionalStoreJson(root,`_release-pointers/${targetId}.json`);
    const known = (value: unknown): value is ContentReleasePointer["current"] => object(value) && keys(value,["n","digest"]) && manifests.some(row => row.n === value.n && row.digest === value.digest);
    if (previous !== undefined && (!object(previous) || !keys(previous,["targetId","current","released"]) || previous.targetId !== targetId || !known(previous.current) || !Array.isArray(previous.released) || !previous.released.length || previous.released.some(value => !known(value)) || new Set(previous.released.map(value => (value as {n:number}).n)).size !== previous.released.length || !previous.released.some(value => publicationDigest(value) === publicationDigest(previous.current)))) return refuse("Stored release pointer is malformed or foreign");
    const old = previous as ContentReleasePointer | undefined;
    const current = {n:selected.n,digest:selected.digest};
    if (rollback) {
      if (!old || selected.n >= old.current.n || !old.released.some(row => row.digest === digest)) return refuse("Rollback requires a previously selected earlier release digest");
    } else if (selected.n !== next-1 || old && selected.n <= Math.max(...old.released.map(row => row.n))) return refuse("Release selection requires the newest newly prepared bundle");
    const pointer: ContentReleasePointer = {targetId,current,released:rollback ? old!.released : [...(old?.released ?? []),current]};
    await writeStoreJson(root,`_release-pointers/${targetId}.json`,pointer,false);
    return {ok:true,pointer:structuredClone(pointer)};
  } catch { return refuse("Stored release validation or atomic pointer update failed"); }
  finally { await unlinkOwned(lock,true); }
}

/** Select a prepared local release. This never asserts remote deployment/observation. */
export function selectContentRelease(root: string, targetId: string, digest: string): Promise<ContentReleasePointerResult> { return changeReleasePointer(root,targetId,digest,false); }
/** Repoint only to an earlier, already selected immutable release; no reapproval. */
export function rollbackContentRelease(root: string, targetId: string, digest: string): Promise<ContentReleasePointerResult> { return changeReleasePointer(root,targetId,digest,true); }
function keys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function text(value: unknown): value is string { return typeof value === "string" && !!value.trim(); }
function hash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function invalid(message: string): never { throw new TypeError(message); }
function failure(rule: string, message: string): ReleaseResult {
  const finding: ContentFinding = { path: "_releases", rule, message };
  return { ok: false, releases: [], findings: [finding] };
}

/** Historical bundles stand alone: current mutable registry state is not their authority. */
function validateBundle(manifest: unknown, build: unknown, handover: unknown, targetId: string, n: number): void {
  if (!object(manifest) || !keys(manifest, ["targetId", "n", "at", "entries", "approvedBy", "digest"], ["publications"]) ||
    manifest.targetId !== targetId || manifest.n !== n || !text(manifest.at) || !Number.isFinite(Date.parse(manifest.at)) ||
    !text(manifest.approvedBy) || !hash(manifest.digest) || !Array.isArray(manifest.entries) || !manifest.entries.length) {
    invalid("Stored release manifest is malformed");
  }
  const slots = new Set<string>();
  const candidates = new Set<string>();
  for (const entry of manifest.entries) {
    if (!object(entry) || !keys(entry, ["slotId", "candidateId", "revision", "digest"], ["route"]) ||
      !text(entry.slotId) || !text(entry.candidateId) || !isRevisionId(entry.revision) || !hash(entry.digest) ||
      (Object.hasOwn(entry, "route") && (!text(entry.route) || !entry.route.startsWith("/") || entry.route.startsWith("//"))) ||
      slots.has(entry.slotId) || candidates.has(entry.candidateId)) invalid("Stored release entries are malformed or duplicated");
    slots.add(entry.slotId);
    candidates.add(entry.candidateId);
  }
  const { digest, ...payload } = manifest;
  if (computeReleaseDigest(payload as unknown as Omit<ReleaseManifest, "digest">) !== digest) invalid("Stored release manifest digest does not match its content");
  if (!object(build) || !keys(build, ["targetId", "releaseN", "routes"], ["publications"]) || build.targetId !== targetId || build.releaseN !== n ||
    !Array.isArray(build.routes) || build.routes.length !== manifest.entries.length) invalid("Stored build manifest does not match its release");
  if (Object.hasOwn(manifest, "publications") !== Object.hasOwn(build, "publications")) invalid("Publication products are missing from the bundle");
  if (manifest.publications !== undefined) {
    if (!Array.isArray(manifest.publications) || !manifest.publications.length || !Array.isArray(build.publications)) invalid("Malformed publication bundle");
    const identities = new Set<string>();
    for (const publication of manifest.publications) {
      assertCompiledPublication(publication);
      if (identities.has(publication.publicationId)) invalid("Duplicate historical publication");
      identities.add(publication.publicationId);
      const owned = manifest.entries.map(entry => (entry as Record<string,unknown>).route).filter(value => value !== undefined).sort();
      if (publicationDigest(owned) !== publicationDigest(publication.products.routes.routes.map(route => route.path).sort())) invalid("Historical publication target route closure differs");
    }
    const expected = (manifest.publications as CompiledPublication[]).map(value => stampPublication(value, manifest.digest as string));
    if (publicationDigest(expected) !== publicationDigest(build.publications)) invalid("Publication products differ from the release digest");
  }
  const routes = new Set<string>();
  for (const route of build.routes) {
    if (!object(route) || !keys(route, ["slotId", "kind", "locales", "revision", "digest"], ["path"]) ||
      !text(route.slotId) || !SLOT_KINDS.includes(route.kind as typeof SLOT_KINDS[number]) ||
      !Array.isArray(route.locales) || !route.locales.length || route.locales.some(locale => !isContentLocale(locale)) ||
      new Set(route.locales).size !== route.locales.length || routes.has(route.slotId)) invalid("Stored build route is malformed or duplicated");
    const entry = manifest.entries.find(value => value.slotId === route.slotId);
    if (!entry || route.revision !== entry.revision || route.digest !== entry.digest || route.path !== entry.route ||
      Object.hasOwn(route, "path") !== Object.hasOwn(entry, "route")) invalid("Stored build route differs from its release entry");
    routes.add(route.slotId);
  }
  if (!object(handover) || !keys(handover, ["targetId", "releaseN", "receiver", "matches", "status", "observedAt"]) ||
    handover.targetId !== targetId || handover.releaseN !== n || !["builder", "messenger", "influencer"].includes(handover.receiver as string) ||
    handover.matches !== false || handover.status !== "pending" || handover.observedAt !== null) invalid("Stored handover must be a matching pending local receipt");
}

async function regularDirectory(path: string): Promise<void> {
  const stat = await fs.lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) invalid("Release store ancestors must be regular directories");
}
async function checkedRoot(input: string): Promise<string> {
  let current = resolve(input);
  for (;;) {
    await regularDirectory(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return storeRoot(input);
}
async function createDirectory(path: string): Promise<boolean> {
  try { await fs.mkdir(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  await regularDirectory(path);
  return false;
}

async function releaseNumbers(root: string): Promise<Record<string, number>> {
  const numbers: Record<string, number> = Object.create(null);
  for (const target of await storeEntries(root, "_releases", "directory")) {
    if (target === ".lock") continue;
    storeSegment(target);
    const files = await storeEntries(root, `_releases/${target}`, "file");
    const bundles = new Map<number, Set<string>>();
    for (const file of files) {
      const match = /^([1-9][0-9]*)(\.build|\.handover)?\.json$/.exec(file);
      if (!match) invalid("Release store contains an unexpected filename");
      const n = Number(match[1]);
      if (!Number.isSafeInteger(n)) invalid("Stored release number must be a safe positive integer");
      const suffixes = bundles.get(n) ?? new Set<string>();
      suffixes.add(match[2] ?? "");
      bundles.set(n, suffixes);
    }
    const ordered = [...bundles.keys()].sort((a, b) => a - b);
    for (const [index, n] of ordered.entries()) {
      if (n !== index + 1 || bundles.get(n)!.size !== 3) invalid("Release store has a gapped or partial bundle sequence");
      const prefix = `_releases/${target}/${n}`;
      const [manifest, build, handover] = await Promise.all([
        readStoreJson(root, `${prefix}.json`), readStoreJson(root, `${prefix}.build.json`), readStoreJson(root, `${prefix}.handover.json`),
      ]);
      validateBundle(manifest, build, handover, target, n);
    }
    numbers[target] = ordered.length + 1;
  }
  return numbers;
}

interface OwnedPath { readonly path: string; readonly dev: number; readonly ino: number }
async function unlinkOwned(value: OwnedPath, directory = false): Promise<void> {
  try {
    const stat = await fs.lstat(value.path);
    if (stat.dev !== value.dev || stat.ino !== value.ino) return;
    if (directory) await fs.rmdir(value.path);
    else await fs.unlink(value.path);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
async function writeOwned(path: string, value: unknown, owned: OwnedPath[]): Promise<void> {
  await regularDirectory(dirname(path));
  const file = await fs.open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    const stat = await file.stat();
    owned.push({ path, dev: stat.dev, ino: stat.ino });
    await file.writeFile(JSON.stringify(value, null, 2) + "\n", "utf8");
  } finally { await file.close(); }
}

/** Append complete immutable local bundles; publication and registry mutation are separate operations. */
export async function writeContentRelease(inputRoot: string, input: ReleaseInput): Promise<ReleaseResult> {
  const preflight = prepareContentRelease(input);
  if (!preflight.ok) return preflight;
  // Synchronously validated plain artifacts cross the first await. Producer
  // callbacks are not cloneable authority and are never invoked again here.
  const snapshot = structuredClone(preflight);
  let root: string;
  let releasesCreated = false;
  try {
    root = await checkedRoot(inputRoot);
    for (const bundle of preflight.releases) storeSegment(bundle.manifest.targetId);
    releasesCreated = await createDirectory(join(root, "_releases"));
  } catch { return failure("release-store-invalid", "Release root and target paths must be regular directories and safe identities"); }
  const lockPath = join(root, "_releases", ".lock");
  let lock: OwnedPath;
  try {
    await fs.mkdir(lockPath);
    const stat = await fs.lstat(lockPath);
    lock = { path: lockPath, dev: stat.dev, ino: stat.ino };
  } catch (error) {
    return failure((error as NodeJS.ErrnoException).code === "EEXIST" ? "release-store-busy" : "release-store-invalid", "Release store lock could not be acquired");
  }
  const owned: OwnedPath[] = [];
  const directories: OwnedPath[] = [];
  let completed = false;
  let writing = false;
  try {
    const numbers = await releaseNumbers(root);
    const prepared: ReleaseResult = { ...snapshot, releases: snapshot.releases.map(bundle => {
      const n = numbers[bundle.manifest.targetId] ?? 1;
      const { digest: _digest, ...previous } = bundle.manifest;
      const body = { ...previous,n };
      const digest = computeReleaseDigest(body);
      return { manifest: { ...body,digest }, build: { ...bundle.build,releaseN:n,...(body.publications ? { publications:body.publications.map(publication => stampPublication(publication,digest)) } : {}) }, handover:{...bundle.handover,releaseN:n} };
    }) };
    for (const bundle of prepared.releases) storeSegment(bundle.manifest.targetId);
    writing = true;
    for (const bundle of prepared.releases) {
      const target = join(root, "_releases", bundle.manifest.targetId);
      if (await createDirectory(target)) {
        const stat = await fs.lstat(target);
        directories.push({ path: target, dev: stat.dev, ino: stat.ino });
      }
      const prefix = join(target, String(bundle.manifest.n));
      await writeOwned(`${prefix}.json`, bundle.manifest, owned);
      await writeOwned(`${prefix}.build.json`, bundle.build, owned);
      await writeOwned(`${prefix}.handover.json`, bundle.handover, owned);
    }
    completed = true;
    return prepared;
  } catch {
    return failure(writing ? "release-store-write-failed" : "release-store-invalid", writing ? "Release bundle write failed; newly created files were rolled back" : "Existing release store contains a malformed, partial, or gapped bundle sequence");
  } finally {
    try {
      if (!completed) {
        for (const value of owned.reverse()) await unlinkOwned(value);
        for (const value of directories.reverse()) await unlinkOwned(value, true);
      }
    } finally {
      await unlinkOwned(lock, true);
      if (!completed && releasesCreated) await fs.rmdir(join(root, "_releases")).catch(error => {
        if (!["ENOENT", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      });
    }
  }
}
