/**
 * `advisor install --from <pack-dir>` and `advisor update --from <pack-dir>`: install Producer and the
 * agent packages from tarballs packed at one foundry commit (Producer's pack-five script in the foundry
 * repository; it does not ship in this package).
 * Only a complete pack of a clean commit (artifacts.json) is accepted; every tarball's SHA-256 is checked
 * before npm sees it. The record is clossys/advisor/install.json. Update never deletes a vendored file.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { isSecretPath } from "./guard.js";
import { ok, refused, tail, type Host, type VerbResult } from "./host.js";

export const MVP_ROLES = ["producer", "director", "designer", "writer", "publisher"] as const;
export const INSTALL_RECORD = "clossys/advisor/install.json";
export const VENDOR_DIR = "vendor/clossys";
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const TARBALL = /^[a-z0-9][a-z0-9._-]*\.tgz$/;

export interface PackedArtifact { readonly role: string; readonly name: string; readonly version: string; readonly filename: string; readonly sha256: string }
export interface PackManifest { readonly head: string; readonly tree: string; readonly artifacts: readonly PackedArtifact[] }
export interface InstallRecord {
  readonly schema: "clossys.advisor-install/1";
  readonly foundry: { readonly head: string; readonly tree: string };
  readonly packages: readonly { readonly role: string; readonly name: string; readonly version: string; readonly file: string; readonly sha256: string }[];
  readonly at: string;
  readonly previous?: { readonly head: string; readonly tree: string; readonly at: string };
}

/** Reads and checks <from>/artifacts.json and every tarball it names. Returns refusal lines, or the manifest. */
export function readPack(from: string): { manifest?: PackManifest; issues: string[] } {
  const file = join(from, "artifacts.json");
  if (!existsSync(file)) return { issues: [`${file} not found; pack a clean foundry commit with Producer's pack-five script (a dirty or incomplete pack writes no artifacts.json)`] };
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, "utf8")); } catch { return { issues: ["artifacts.json is not valid JSON"] }; }
  const doc = raw as Record<string, unknown>;
  const issues: string[] = [];
  if (doc.schemaVersion !== 1) issues.push("artifacts.json schemaVersion must be 1");
  if (doc.complete !== true) issues.push("artifacts.json is not a complete pack");
  const source = doc.source as Record<string, unknown> | undefined;
  if (source && source.dirty !== false) issues.push("artifacts.json was packed from a dirty checkout");
  const head = typeof doc.head === "string" ? doc.head : "";
  const tree = typeof doc.tree === "string" ? doc.tree : "";
  if (!HEX40.test(head) || !HEX40.test(tree)) issues.push("artifacts.json must name a 40-character head and tree");
  const list = Array.isArray(doc.artifacts) ? doc.artifacts as Record<string, unknown>[] : [];
  if (!list.length) issues.push("artifacts.json lists no artifacts");
  const artifacts: PackedArtifact[] = [];
  for (const [index, entry] of list.entries()) {
    const fields = ["role", "name", "version", "filename", "sha256"] as const;
    if (fields.some(field => typeof entry[field] !== "string")) { issues.push(`artifacts[${index}] needs role, name, version, filename and sha256`); continue; }
    const artifact = Object.fromEntries(fields.map(field => [field, entry[field] as string])) as unknown as PackedArtifact;
    if (!TARBALL.test(artifact.filename) || basename(artifact.filename) !== artifact.filename || isSecretPath(artifact.filename)) { issues.push(`artifacts[${index}].filename must be a plain .tgz name`); continue; }
    if (!HEX64.test(artifact.sha256)) { issues.push(`artifacts[${index}].sha256 must be 64 hex digits`); continue; }
    const tarball = join(from, artifact.filename);
    if (!existsSync(tarball)) { issues.push(`${artifact.filename} is missing from the pack`); continue; }
    const actual = createHash("sha256").update(readFileSync(tarball)).digest("hex");
    if (actual !== artifact.sha256) { issues.push(`${artifact.filename} SHA-256 does not match artifacts.json`); continue; }
    artifacts.push(artifact);
  }
  for (const role of MVP_ROLES) {
    const count = list.filter(entry => entry.role === role).length;
    if (count !== 1) issues.push(`the pack must hold ${role} exactly once (found ${count})`);
  }
  return issues.length ? { issues } : { manifest: { head, tree, artifacts }, issues };
}

function readRecord(root: string): InstallRecord | undefined {
  const file = join(root, INSTALL_RECORD);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as InstallRecord : undefined;
}

function vendorAndInstall(root: string, from: string, manifest: PackManifest, host: Host): { issues: string[]; packages: InstallRecord["packages"] } {
  mkdirSync(join(root, VENDOR_DIR), { recursive: true });
  const packages = manifest.artifacts.map(artifact => {
    const file = `${VENDOR_DIR}/${artifact.filename}`;
    copyFileSync(join(from, artifact.filename), join(root, file));
    return { role: artifact.role, name: artifact.name, version: artifact.version, file, sha256: artifact.sha256 };
  });
  const result = host.run("npm", ["install", "--save-exact", "--no-audit", "--no-fund", ...packages.map(entry => `./${entry.file}`)], { cwd: root });
  if (result.status !== 0) return { issues: [`npm install failed (${result.status === null ? "npm not found" : `exit ${result.status}`}): ${tail(result.stderr)}`], packages };
  return { issues: [], packages };
}

function writeRecord(root: string, record: InstallRecord): void {
  mkdirSync(join(root, "clossys", "advisor"), { recursive: true });
  writeFileSync(join(root, INSTALL_RECORD), `${JSON.stringify(record, null, 2)}\n`);
}

export function runInstall(root: string, from: string | undefined, host: Host): VerbResult {
  if (!from) return { exitCode: 2, lines: ["install needs --from <pack-dir>"] };
  if (readRecord(root)) return refused([`install: ${INSTALL_RECORD} exists; run advisor update --from <pack-dir>`]);
  const { manifest, issues } = readPack(resolve(from));
  if (!manifest) return refused(issues.map(issue => `install: refused: ${issue}`));
  const installed = vendorAndInstall(root, resolve(from), manifest, host);
  if (installed.issues.length) return refused(installed.issues.map(issue => `install: ${issue}`));
  const record: InstallRecord = { schema: "clossys.advisor-install/1", foundry: { head: manifest.head, tree: manifest.tree }, packages: installed.packages, at: host.now() };
  writeRecord(root, record);
  return ok([...installed.packages.map(entry => `installed ${entry.name}@${entry.version} (${entry.role})`), `install: wrote ${INSTALL_RECORD} at foundry ${manifest.head.slice(0, 12)}`, "next: advisor init"], record);
}

export function runUpdate(root: string, from: string | undefined, host: Host): VerbResult {
  if (!from) return { exitCode: 2, lines: ["update needs --from <pack-dir>"] };
  const current = readRecord(root);
  if (!current) return refused([`update: no ${INSTALL_RECORD}; run advisor install --from <pack-dir> first`]);
  const { manifest, issues } = readPack(resolve(from));
  if (!manifest) return refused(issues.map(issue => `update: refused: ${issue}`));
  if (manifest.head === current.foundry.head && manifest.tree === current.foundry.tree) return ok([`update: already at foundry ${manifest.head.slice(0, 12)}; nothing changed`], current);
  const installed = vendorAndInstall(root, resolve(from), manifest, host);
  if (installed.issues.length) return refused(installed.issues.map(issue => `update: ${issue}`));
  const record: InstallRecord = { schema: "clossys.advisor-install/1", foundry: { head: manifest.head, tree: manifest.tree }, packages: installed.packages, at: host.now(), previous: { head: current.foundry.head, tree: current.foundry.tree, at: current.at } };
  writeRecord(root, record);
  const keep = new Set(installed.packages.map(entry => basename(entry.file)));
  const stale = readdirSync(join(root, VENDOR_DIR)).filter(name => name.endsWith(".tgz") && !keep.has(name));
  return ok([
    ...installed.packages.map(entry => `installed ${entry.name}@${entry.version} (${entry.role})`),
    `update: foundry ${current.foundry.head.slice(0, 12)} -> ${manifest.head.slice(0, 12)}; wrote ${INSTALL_RECORD}`,
    ...stale.map(name => `stale (kept, not deleted): ${VENDOR_DIR}/${name}`),
  ], { ...record, stale });
}
