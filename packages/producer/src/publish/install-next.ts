/**
 * `clossys publish --install --site <publication> --next <app dir> --assembly <module>`: install a
 * whole pinned publication into a Next App Router app.
 *
 * Publisher plans one route file per content-map page and one dynamic `[slug]` route per leaf
 * template (`planNextRoutes`). Parameterized page records expand through the content map
 * (`expandPublication`): one tab page per IA group of the record's namespace, and one leaf template
 * per tab over that group's slots. Installed files carry Publisher's marker: a file without it is never
 * overwritten, and a marked file no page installs any more is removed. The install is recorded in
 * the install out root like every other `publish --install`, so `/api/publication` lists the
 * publication's pages as installed.
 *
 * With a `states` module the publication's shell installs too: the root `layout.tsx` (the
 * assembly's document and metadata) and the `loading`, `not-found`, `error` and `global-error`
 * states (the states module's state export). Every App Router file is then Publisher's.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { isBlocking, NEXT_ROUTE_MARKER, planNextRoutes, type InstallFinding, type NextShellState } from "@clossys/publisher/install";
import { readPinnedPublication } from "./pinned-publication.js";
import { expandPublication } from "./expand-tabs.js";
import { INSTALL_MARKER, installOutRoot } from "./install-out.js";

export const NEXT_INSTALL_REPORT = "install-report.json";
export const NEXT_INSTALL_KIND = "next";

export interface PublishNextOptions {
  readonly root: string;
  /** The pinned publication id (`studio`). */
  readonly publication: string;
  /** The Next app directory the routes install into. */
  readonly app: string;
  /** The consumer's assembly module, relative to the app directory. */
  readonly assembly: string;
  /** Resolve leaves at request time through the assembly's leaf export. */
  readonly live?: boolean;
  /** The consumer's states module (client, exports `PublishedState`), relative to the app directory: installs the publication's shell. */
  readonly states?: string;
  /** Report drift instead of writing. */
  readonly check?: boolean;
  /** The install record dir; defaults to `next-<publication>` in the install out root. */
  readonly out?: string;
}
export interface PublishNextFile { readonly file: string; readonly pageId: string; readonly kind: "page" | "leaf" | "shell"; readonly route: string; readonly state: "written" | "unchanged" | "removed" | "drift"; readonly shell?: NextShellState }
export interface PublishNextResult { readonly app: string; readonly out?: string; readonly files: readonly PublishNextFile[]; readonly findings: readonly InstallFinding[] }
/** The install record `/api/publication` reads: one row per installed page route. */
export interface NextInstallReport {
  readonly kind: typeof NEXT_INSTALL_KIND; readonly publication: string; readonly app: string;
  readonly pages: readonly { page: string; route: string; file: string }[];
  readonly leaves: readonly { page: string; route: string; file: string }[];
  /** The publication's shell files: its document and its states. Empty when no states module was named. */
  readonly shell: readonly { state: NextShellState; file: string }[];
  readonly findings: readonly InstallFinding[];
}

/** Every App Router file name that serves a route, a layout or a state. */
const ROUTE_FILE = /^(?:page|layout|template|route|default|loading|error|global-error|not-found)\.[cm]?[jt]sx?$/;
const marked = (content: string) => content.split("\n", 1)[0] === NEXT_ROUTE_MARKER;

/** Every route file under an app directory, relative and `/`-separated. */
async function routeFiles(app: string, dir = app): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return out; throw error; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await routeFiles(app, path));
    else if (entry.isFile() && ROUTE_FILE.test(entry.name)) out.push(relative(app, path).split(sep).join("/"));
  }
  return out;
}

/** Whether an app file is one Publisher installed (its first line is the route marker). */
export async function isInstalledRoute(path: string): Promise<boolean> {
  try { return marked(await readFile(path, "utf8")); } catch { return false; }
}

async function pruneEmpty(app: string, dir: string): Promise<void> {
  for (let cursor = dir; cursor !== app && cursor.startsWith(app + sep); cursor = dirname(cursor)) {
    if ((await readdir(cursor)).length) return;
    await rmdir(cursor);
  }
}

export async function publishNext(options: PublishNextOptions): Promise<PublishNextResult> {
  const root = resolve(options.root);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(options.publication)) throw new Error(`publish --install --next: ${options.publication} needs a publication id ([a-z0-9-])`);
  const app = resolve(options.app);
  const pinned = await readPinnedPublication(join(root, "clossys"), options.publication);
  if (!pinned.routePack) throw new Error(`publish --install --next: publication ${options.publication} has no route pack`);
  const { map, leafTemplates } = expandPublication(join(root, "clossys"), pinned.map, pinned.routePack.routes as readonly Record<string, unknown>[]);
  const plan = planNextRoutes({ map, leafTemplates, assembly: options.assembly, live: options.live === true, ...(options.states !== undefined ? { states: options.states } : {}) });
  const findings: InstallFinding[] = [...plan.findings];
  const files: PublishNextFile[] = [];
  if (findings.some(isBlocking)) return { app, files, findings };
  const planned = new Set(plan.files.map(row => row.file));
  for (const row of plan.files) {
    const path = join(app, ...row.file.split("/"));
    const stored = existsSync(path) ? await readFile(path, "utf8") : undefined;
    if (stored !== undefined && !marked(stored)) {
      findings.push({ code: "site-contract", slot: row.pageId, detail: `${row.file} exists and was not installed by Publisher` });
      continue;
    }
    const state = stored === row.content ? "unchanged" : options.check ? "drift" : "written";
    if (state === "written") { await mkdir(dirname(path), { recursive: true }); await writeFile(path, row.content); }
    files.push({ file: row.file, pageId: row.pageId, kind: row.kind, route: row.route, state, ...(row.state ? { shell: row.state } : {}) });
  }
  for (const file of await routeFiles(app)) {
    if (planned.has(file) || !await isInstalledRoute(join(app, file))) continue;
    if (!options.check) { await unlink(join(app, file)); await pruneEmpty(app, dirname(join(app, file))); }
    files.push({ file, pageId: "", kind: "page", route: "", state: options.check ? "drift" : "removed" });
  }
  if (options.check || findings.some(isBlocking)) return { app, files, findings };
  const out = resolve(options.out ?? join(installOutRoot(root), `next-${options.publication}`));
  if (existsSync(out) && !existsSync(join(out, INSTALL_MARKER))) throw new Error(`publish: ${out} exists and was not written by clossys publish --install`);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, INSTALL_MARKER), "clossys publish --install --next output\n");
  const row = (file: (typeof plan.files)[number]) => ({ page: file.pageId, route: file.route, file: file.file });
  const report: NextInstallReport = {
    kind: NEXT_INSTALL_KIND, publication: map.publicationId, app,
    pages: plan.files.filter(file => file.kind === "page").map(row), leaves: plan.files.filter(file => file.kind === "leaf").map(row),
    shell: plan.files.flatMap(file => file.kind === "shell" && file.state ? [{ state: file.state, file: file.file }] : []), findings,
  };
  await writeFile(join(out, NEXT_INSTALL_REPORT), `${JSON.stringify(report, null, 2)}\n`);
  return { app, out, files, findings };
}

export const nextFailed = (result: PublishNextResult) => result.findings.some(isBlocking) || result.files.some(file => file.state === "drift");
export function nextSummary(result: PublishNextResult): string {
  const count = (state: PublishNextFile["state"]) => result.files.filter(file => file.state === state).length;
  return [
    `publish --install --next: ${result.app}`,
    `Routes: ${result.files.filter(file => file.state !== "removed").length} (written ${count("written")}, unchanged ${count("unchanged")}, removed ${count("removed")}, drift ${count("drift")})`,
    ...result.files.filter(file => file.state === "drift").map(file => `  drift: ${file.file}`),
    `Findings: ${result.findings.length}`,
    ...result.findings.map(finding => `  ${finding.code}: ${finding.detail}`),
  ].join("\n");
}
