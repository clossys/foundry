import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { ContentFinding } from "../composition.js";
import { computeReleaseDigest, prepareContentRelease } from "../release/prepare.js";
import type { ReleaseInput, ReleaseManifest, ReleaseResult } from "../release/types.js";
import { isContentLocale, isRevisionId, SLOT_KINDS } from "../vocabulary.js";
import { readStoreJson, storeEntries, storeRoot, storeSegment } from "./files.js";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
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
  if (!object(manifest) || !keys(manifest, ["targetId", "n", "at", "entries", "approvedBy", "digest"]) ||
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
  if (!object(build) || !keys(build, ["targetId", "releaseN", "routes"]) || build.targetId !== targetId || build.releaseN !== n ||
    !Array.isArray(build.routes) || build.routes.length !== manifest.entries.length) invalid("Stored build manifest does not match its release");
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
  // Snapshot before the first await so caller mutation cannot change an approved write.
  const snapshot = structuredClone(input);
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
    const prepared = prepareContentRelease(snapshot, numbers);
    if (!prepared.ok) return prepared;
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
