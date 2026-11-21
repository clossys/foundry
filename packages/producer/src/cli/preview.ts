/**
 * `clossys preview <publication> [--with <agent>/<slot>/<candidate>]... [--port <n>] [--locale <l>]...
 * [--selection <module>[#export]] [--once] [--json] [--root <dir>]` (system.md 12.5).
 *
 * Builds the publication from its resolved pins (each `--with` swaps one slot's pin in a staged
 * copy; `clossys/` is never written) into `clossys/.state/builds/preview-<id>/`, prints the
 * clossys.preview/1 view and serves it on 127.0.0.1 (default port 4600) until interrupted.
 * `--once` builds and prints without serving.
 */
import { resolve } from "node:path";
import { isBlocking, type PageHostSelection } from "@clossys/publisher/install";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";
import { buildPreview, preparePreview, previewPort, previewUrl, previewView, startPreviewServer, type PreviewBuildOptions } from "../preview/serve.js";

export const PREVIEW_USAGE = "Usage: clossys preview <publication> [--with <agent>/<slot>/<candidate>]... [--port <n>] [--locale <locale>]...\n"
  + "  [--selection <module>[#export]] [--once] [--json] [--root <dir>]\n"
  + "  builds the publication from its pins (each --with swaps one slot, never written to clossys/) into\n"
  + "  clossys/.state/builds/preview-<id>/ and serves it on 127.0.0.1 (default port 4600); --once builds and exits.";

export interface PreviewCliDeps extends Pick<PreviewBuildOptions, "runner" | "npm" | "vite"> {
  /** Resolves when serving should stop; defaults to SIGINT or SIGTERM. */
  readonly until?: () => Promise<void>;
  /** Receives the view as soon as the server listens (stdout by default). */
  readonly announce?: (text: string) => void;
}

const VALUED = new Set(["--with", "--port", "--locale", "--selection", "--root"]);

function interrupted(): Promise<void> {
  return new Promise(done => {
    const stop = () => { process.off("SIGINT", stop); process.off("SIGTERM", stop); done(); };
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
  });
}

export async function runPreviewCli(argv: readonly string[], cwd: string, deps: PreviewCliDeps = {}): Promise<CliResult> {
  const refs: string[] = [], locales: string[] = [];
  let publication: string | undefined, port: string | undefined, root: string | undefined, selectionArg: string | undefined;
  let once = false, json = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help") return { exitCode: 0, message: PREVIEW_USAGE };
    if (arg === "--once") { once = true; continue; }
    if (arg === "--json") { json = true; continue; }
    if (VALUED.has(arg)) {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliUsageError(`${arg} requires a value\n${PREVIEW_USAGE}`);
      if (arg === "--with") refs.push(value);
      else if (arg === "--locale") locales.push(value);
      else if (arg === "--port") port = value;
      else if (arg === "--selection") selectionArg = value;
      else root = value;
      continue;
    }
    if (arg.startsWith("--") || publication !== undefined) throw new CliUsageError(`Unknown argument: ${arg}\n${PREVIEW_USAGE}`);
    publication = arg;
  }
  if (publication === undefined) throw new CliUsageError(`preview needs a publication id\n${PREVIEW_USAGE}`);
  let asked: number;
  try { asked = previewPort(port); } catch (error) { throw new CliUsageError(`${(error as Error).message}\n${PREVIEW_USAGE}`); }
  const hash = selectionArg?.lastIndexOf("#") ?? -1;
  const selection: PageHostSelection | undefined = selectionArg === undefined ? undefined
    : hash > 0 ? { module: selectionArg.slice(0, hash), export: selectionArg.slice(hash + 1) } : { module: selectionArg };
  const workspace = discoverRoot(resolve(cwd, root ?? "."));

  const prepared = await preparePreview({ root: workspace, publication, with: refs, locales });
  const build = await buildPreview(prepared, { cwd, ...(selection ? { selection } : {}), ...(deps.runner ? { runner: deps.runner } : {}), ...(deps.npm ? { npm: deps.npm } : {}), ...(deps.vite ? { vite: deps.vite } : {}) });
  const blocking = build.findings.filter(isBlocking);
  const findingLines = build.findings.map(row => `  ${isBlocking(row) ? "" : "info "}${row.page} ${row.code}: ${row.detail}`);
  const summary = (url: string) => [
    `preview ${prepared.publication} ${prepared.buildId}: ${url}`,
    ...prepared.routes.map(route => `  ${route.path} -> ${route.page}${build.built.includes(route.page) ? "" : " (not built)"}`),
    ...(prepared.overrides.length ? [`overrides: ${prepared.overrides.map(row => row.ref).join(", ")}`] : []),
    ...(prepared.sample.length ? [`sample: ${prepared.sample.join(", ")}`] : []),
    `findings: ${blocking.length}${build.findings.length > blocking.length ? ` (+${build.findings.length - blocking.length} info)` : ""}`, ...findingLines,
    `build: ${prepared.dir}`,
  ].join("\n");
  const exitCode = blocking.length ? 1 : 0;
  if (once) {
    const view = previewView(prepared, previewUrl(asked));
    return { exitCode, root: workspace, output: view, message: summary(view.url) };
  }
  const served = await startPreviewServer(prepared, asked);
  const view = previewView(prepared, served.url);
  (deps.announce ?? (text => process.stdout.write(`${text}\n`)))(json ? JSON.stringify(view, null, 2) : summary(view.url));
  try { await (deps.until ?? interrupted)(); } finally { await served.close(); }
  return { exitCode, root: workspace, output: view, message: summary(view.url), printed: true };
}
