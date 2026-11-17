/**
 * The Producer actions `publisher.check` and `publisher.release` (foundry-build-0028; 0020 review gap 2).
 *
 * The Publisher page checks (catalog, instance key, inline copy: packages/publisher/src/check) ran only over the
 * package defaults in Publisher's own tests. These actions run them over a consumer's page records in the agent chain:
 *
 *   clossys publisher check [--root <dir>] [--json]
 *   clossys publisher release <publication> [--build|--manifest|--gates|--ready]... [--root <dir>] [--json]
 *
 * The consumer root is discovered exactly as `clossys release` discovers it (cli/root.ts discoverRoot: the nearest
 * ancestor holding clossys/clossys.config.ts), so the check judges the same records the release ships.
 *
 * `check` reads every page candidate under `clossys/agents/publisher/page.<id>/candidates/` and judges it against the
 * installed Publisher's page and layout contracts and the live Designer catalog. `release` runs the same checks over
 * the publication's pinned pages and refuses (exit 1, no release step runs) on any finding; only a clean check hands on to
 * `clossys release` (default `--gates`). Exit 0 pass, 1 findings or refusal, 2 the check could not run.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CliResult } from "../cli/main.js";
import { discoverRoot } from "../cli/root.js";
import { installedPackageRoot } from "../package-path.js";
import { slotDir } from "../records/candidate.js";

export type Exit = 0 | 1 | 2;

/** The slice of the Publisher check API (`@clossys/publisher` dist/check/index.js) these actions call. */
export interface PublisherCheckApi {
  checkPageOption(pageId: string, content: Record<string, unknown>, page: unknown, layout: unknown, designer: unknown): readonly { check: string; message: string }[];
  checkLayoutUnits(layoutId: string, layout: unknown, designer: unknown): readonly string[];
  slotContract(id: string): { kind?: string; publication?: string } | undefined;
  loadDesignerCatalog(): { live: ReadonlySet<string>; retired: ReadonlySet<string> };
}

export interface PublisherFinding { readonly check: string; readonly subject: string; readonly detail: string }

export interface PublisherCheckResult {
  readonly exit: Exit;
  /** The discovered consumer root the records were read from (absent when none was found). */
  readonly root?: string;
  /** Every page record judged: `publisher/<page-id>/candidates/<file>`. */
  readonly checked: readonly string[];
  readonly findings: readonly PublisherFinding[];
  readonly message: string;
}

export type ReleaseRunner = (argv: readonly string[], cwd: string) => Promise<{ exitCode: Exit; message: string; output?: unknown }>;

export interface PublisherActionOptions {
  /** The Publisher check API; the installed package's built dist/check/index.js by default. */
  readonly api?: PublisherCheckApi;
}

const PAGE_SLOT = /^page\.[a-z0-9][a-z0-9-]*$/;
const PUBLISHER_DIR = (root: string) => join(root, "clossys", "agents", "publisher");
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Load the Publisher check API from the installed `@clossys/publisher` (its dist/check/index.js). */
export async function loadPublisherCheckApi(root: string | undefined = installedPackageRoot("publisher")): Promise<PublisherCheckApi> {
  if (root === undefined) throw new Error("@clossys/publisher is not installed");
  const entry = join(root, "dist", "check", "index.js");
  if (!existsSync(entry)) {
    throw new Error(`the installed @clossys/publisher (${root}) has no dist/check/index.js; install a @clossys/publisher tarball that ships dist/check (packed at or after foundry-build-0028)`);
  }
  const api = await import(pathToFileURL(entry).href) as Partial<PublisherCheckApi>;
  for (const name of ["checkPageOption", "checkLayoutUnits", "slotContract", "loadDesignerCatalog"] as const) {
    if (typeof api[name] !== "function") throw new Error(`@clossys/publisher check API has no ${name}`);
  }
  return api as PublisherCheckApi;
}

/** The consumer root around `start`, as `clossys release` finds it; a folder outside any consumer is an error. */
function consumerRoot(start: string): { root: string } | { error: string } {
  try { return { root: discoverRoot(start) }; } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
}

/** The consumer's page slots: `clossys/agents/publisher/page.<id>/` folders, sorted. */
function pageSlots(root: string): string[] {
  const dir = PUBLISHER_DIR(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory() && PAGE_SLOT.test(entry.name)).map(entry => entry.name).sort();
}

/** Every candidate file of a page slot, or only the pinned one (`pinned`); an unpinned slot ships the package default. */
function pageRecords(root: string, slotId: string, pinned: boolean): { file: string; error?: string }[] {
  const dir = slotDir(root, "publisher", slotId);
  if (pinned) {
    const pinPath = join(dir, "pin.json");
    if (!existsSync(pinPath)) return [];
    let candidate: unknown;
    try { candidate = (JSON.parse(readFileSync(pinPath, "utf8")) as { candidate?: unknown }).candidate; } catch (error) {
      return [{ file: "pin.json", error: `pin.json is not JSON (${error instanceof Error ? error.message : String(error)})` }];
    }
    if (typeof candidate !== "string" || !candidate) return [{ file: "pin.json", error: "pin.json names no candidate" }];
    return [{ file: `candidates/${candidate}` }];
  }
  const candidates = join(dir, "candidates");
  if (!existsSync(candidates)) return [];
  return readdirSync(candidates).filter(name => name.endsWith(".json")).sort().map(name => ({ file: `candidates/${name}` }));
}

/**
 * Run the Publisher page checks over a consumer's page records. `pinned` judges only what each page slot pins (the
 * release set); otherwise every candidate is judged, so a page option fails before anyone can pin it.
 */
export async function checkPublisherPages(start: string, options: PublisherActionOptions & { pinned?: boolean; publication?: string } = {}): Promise<PublisherCheckResult> {
  const found = consumerRoot(start);
  if ("error" in found) return { exit: 2, checked: [], findings: [], message: `publisher.check: ${found.error}` };
  const { root } = found;
  let api: PublisherCheckApi;
  try { api = options.api ?? await loadPublisherCheckApi(); } catch (error) {
    return { exit: 2, root, checked: [], findings: [], message: `publisher.check: ${error instanceof Error ? error.message : String(error)}` };
  }
  let designer: ReturnType<PublisherCheckApi["loadDesignerCatalog"]>;
  try { designer = api.loadDesignerCatalog(); } catch (error) {
    return { exit: 2, root, checked: [], findings: [], message: `publisher.check: could not load the Designer catalog: ${error instanceof Error ? error.message : String(error)}` };
  }
  const findings: PublisherFinding[] = [];
  const checked: string[] = [];
  const layoutsSeen = new Set<string>();
  for (const slotId of pageSlots(root)) {
    const page = api.slotContract(slotId);
    // A release judges its own publication's pages; a page id Publisher does not have is always judged (and fails).
    if (options.publication !== undefined && page?.kind === "page" && page.publication !== options.publication) continue;
    for (const record of pageRecords(root, slotId, options.pinned === true)) {
      const subject = `publisher/${slotId}/${record.file}`;
      checked.push(subject);
      if (record.error) { findings.push({ check: "page.record", subject, detail: record.error }); continue; }
      if (!page || page.kind !== "page") { findings.push({ check: "page.slot-known", subject, detail: `${slotId} is not a Publisher page slot` }); continue; }
      let content: unknown;
      try { content = (JSON.parse(readFileSync(join(slotDir(root, "publisher", slotId), record.file), "utf8")) as { content?: unknown }).content; } catch (error) {
        findings.push({ check: "page.record", subject, detail: existsSync(join(slotDir(root, "publisher", slotId), record.file)) ? `not JSON (${error instanceof Error ? error.message : String(error)})` : "the pinned candidate does not exist" });
        continue;
      }
      if (!isRecord(content)) { findings.push({ check: "page.record", subject, detail: "a page candidate holds its option under content" }); continue; }
      const layoutId = typeof content.layout === "string" ? content.layout.replace(/^publisher\//, "") : "";
      const layout = layoutId ? api.slotContract(layoutId) : undefined;
      for (const finding of api.checkPageOption(slotId, content, page, layout?.kind === "layout" ? layout : undefined, designer)) {
        findings.push({ check: finding.check, subject, detail: finding.message });
      }
      if (layout?.kind === "layout" && !layoutsSeen.has(layoutId)) {
        layoutsSeen.add(layoutId);
        for (const detail of api.checkLayoutUnits(layoutId, layout, designer)) findings.push({ check: "layout.units-resolve", subject: `publisher/${layoutId}`, detail });
      }
    }
  }
  const exit: Exit = findings.length ? 1 : 0;
  const head = `publisher.check: ${checked.length} page record${checked.length === 1 ? "" : "s"}, ${findings.length} finding${findings.length === 1 ? "" : "s"}`;
  return { exit, root, checked, findings, message: [head, ...findings.map(finding => `  ${finding.check}  ${finding.subject}: ${finding.detail}`)].join("\n") };
}

export interface PublisherReleaseResult extends PublisherCheckResult { readonly released: boolean; readonly release?: { exitCode: Exit; message: string } }

/**
 * `publisher.release`: the pinned pages must pass `publisher.check` first; any finding (or a check that cannot run)
 * refuses the release and no release step runs. A clean check hands `<publication> <flags>` to `clossys release`.
 */
export async function releasePublisher(
  start: string,
  publication: string,
  flags: readonly string[],
  options: PublisherActionOptions & { release?: ReleaseRunner } = {},
): Promise<PublisherReleaseResult> {
  const check = await checkPublisherPages(start, { ...options, pinned: true, publication });
  if (check.exit !== 0 || check.root === undefined) {
    return { ...check, released: false, message: `publisher.release: refused; ${publication} is not released while publisher.check fails\n${check.message}` };
  }
  // The release runs on the root the check judged, never on the caller's start folder.
  const root = check.root;
  const release = options.release ?? defaultRelease;
  const result = await release([publication, ...(flags.length ? flags : ["--gates"]), "--root", root], root);
  return { ...check, exit: result.exitCode, released: result.exitCode === 0, release: { exitCode: result.exitCode, message: result.message }, message: `${check.message}\n${result.message}` };
}

const defaultRelease: ReleaseRunner = async (argv, cwd) => (await import("../cli/release.js")).runReleaseCli(argv, cwd);

const USAGE = "Usage: clossys publisher check [--root <dir>] [--json]\n"
  + "       clossys publisher release <publication> [--build|--manifest|--gates|--ready]... [--root <dir>] [--json]";

/** The verb's run: parse argv, run the action, return its exit, printed text and --json output. */
export async function runPublisherAction(argv: readonly string[], cwd: string, options: PublisherActionOptions & { release?: ReleaseRunner } = {}): Promise<{ exit: Exit; text: string; output?: unknown }> {
  const [mode, ...rest] = argv;
  // --help (on its own or after check|release) prints the usage and runs nothing.
  if (argv.includes("--help") || argv.includes("-h")) return { exit: 0, text: USAGE };
  if (mode !== "check" && mode !== "release") return { exit: 2, text: USAGE };
  let rootFlag: string | undefined;
  let publication: string | undefined;
  const flags: string[] = [];
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index]!;
    if (arg === "--json") continue;
    if (arg === "--root") {
      rootFlag = rest[++index];
      if (rootFlag === undefined || rootFlag.startsWith("--")) return { exit: 2, text: `--root requires a value\n${USAGE}` };
    } else if (mode === "release" && (arg === "--build" || arg === "--manifest" || arg === "--gates" || arg === "--ready")) flags.push(arg);
    else if (mode === "release" && !arg.startsWith("--") && publication === undefined) publication = arg;
    else return { exit: 2, text: `Unknown argument: ${arg}\n${USAGE}` };
  }
  const start = resolve(cwd, rootFlag ?? ".");
  if (mode === "check") {
    const result = await checkPublisherPages(start, options);
    return { exit: result.exit, text: result.message, output: { exitCode: result.exit, message: result.message, root: result.root, checked: result.checked, findings: result.findings } };
  }
  if (!publication) return { exit: 2, text: `release requires <publication>\n${USAGE}` };
  const result = await releasePublisher(start, publication, flags, options);
  return { exit: result.exit, text: result.message, output: { exitCode: result.exit, message: result.message, root: result.root, released: result.released, checked: result.checked, findings: result.findings } };
}

/** `clossys publisher check|release ...`: the handler entry the publisher.check and publisher.release actions bind. */
export async function runPublisherCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const { exit, text, output } = await runPublisherAction(argv, cwd);
  return { exitCode: exit, message: text, ...(output !== undefined ? { output } : {}) };
}
