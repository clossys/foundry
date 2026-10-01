#!/usr/bin/env node
/**
 * `publisher-head-lint` — lints the head metadata and titles of a directory of
 * rendered HTML pages. Presentation and I/O only: parse argv, read the `.html`
 * files, run the pure `lintRenderedHead`, print. All real logic lives in
 * `head-lint.ts`.
 *
 *   publisher-head-lint <html-dir> --site-name <name>
 *
 * Every `.html` file under the directory is a page: `index.html` maps to its
 * directory's route (`index.html` is `/`, `about/index.html` is `/about`) and
 * `a.html` to `/a`. Symbolic links are skipped. Nothing is written.
 *
 * Exit codes:
 *
 *   0 — clean: every page passed.
 *   1 — refused: one `<rule> <path>` line per finding.
 *   2 — could not run: bad arguments, a missing, empty or unreadable
 *       directory, or an unreadable page. Kept distinct from 1: "could not
 *       check" is never "refused".
 *
 * Output never repeats a value from a page: findings print a rule and a route
 * or tag only.
 */

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lintRenderedHead, type RenderedHeadPage } from "./head-lint.js";

const USAGE = `Usage: publisher-head-lint <html-dir> --site-name <name>

  html-dir   A directory of rendered HTML pages. Every .html file under it is read.
             index.html maps to its directory's route (/ or /about); a.html maps to /a.
             Symbolic links are skipped. Nothing is written.

Options:
  --site-name <name>   The site name every page title carries. Required.
  --help               Print this message and exit 0.

Exit codes: 0 = clean, 1 = findings (one "<rule> <path>" line each), 2 = could not run.
`;

/** Anything wrong with the arguments or the files: always exit 2, never 1. */
export class CliInputError extends Error {}

interface ParsedArgs {
  positionals: string[];
  siteName?: string;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { positionals: [], help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--site-name") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new CliInputError("--site-name needs a value");
      if (args.siteName !== undefined) throw new CliInputError("--site-name was given more than once");
      index += 1;
      args.siteName = value;
    } else if (arg.startsWith("-")) {
      throw new CliInputError(`unknown flag "${arg}"`);
    } else {
      args.positionals.push(arg);
    }
  }
  return args;
}

/** The route a file serves: `index.html` is its directory, `a.html` is `/a`. */
function routeOf(relativePath: string): string {
  const withoutExtension = relativePath.replace(/\.html$/i, "");
  const route = withoutExtension === "index" ? "" : withoutExtension.replace(/\/index$/, "");
  return `/${route}`;
}

function collectPages(root: string, relativeDir: string, pages: RenderedHeadPage[]): void {
  const entries = readdirSync(join(root, relativeDir), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const relativePath = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      collectPages(root, relativePath, pages);
    } else if (entry.isFile() && /\.html$/i.test(entry.name)) {
      pages.push({ path: routeOf(relativePath), html: readFileSync(join(root, relativePath), "utf8") });
    }
  }
}

function readPages(dir: string): RenderedHeadPage[] {
  let isDirectory: boolean;
  try {
    isDirectory = statSync(dir).isDirectory();
  } catch {
    throw new CliInputError(`html-dir "${dir}" does not exist or cannot be read`);
  }
  if (!isDirectory) throw new CliInputError(`html-dir "${dir}" is not a directory`);
  const pages: RenderedHeadPage[] = [];
  try {
    collectPages(dir, "", pages);
  } catch {
    throw new CliInputError(`cannot read the pages under "${dir}"`);
  }
  if (pages.length === 0) throw new CliInputError(`html-dir "${dir}" has no .html pages`);
  return pages;
}

/** Exported so the whole argv-to-exit-code contract can be exercised without spawning a process. Never throws: anything that stops a run maps to 2. */
export function main(argv: string[]): number {
  try {
    return execute(argv);
  } catch (error) {
    console.error(error instanceof CliInputError ? `publisher-head-lint: ${error.message}` : "publisher-head-lint: unexpected error");
    return 2;
  }
}

function execute(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (args.positionals.length !== 1) throw new CliInputError("expected exactly one <html-dir>");
  if (args.siteName === undefined || args.siteName.trim() === "") throw new CliInputError("--site-name is required");

  const pages = readPages(resolve(args.positionals[0] as string));
  const findings = lintRenderedHead({ siteName: args.siteName, pages });
  if (findings.length > 0) {
    for (const finding of findings) console.log(`${finding.rule} ${finding.path}`);
    return 1;
  }
  console.log(`ok: ${pages.length} page(s) clean`);
  return 0;
}

/** Same real-path guard `seal-cli.ts` uses: an installed bin is a symlink, so both sides are resolved. */
function detectMainModule(): boolean {
  const argvPath = process.argv[1];
  if (argvPath === undefined) return false;
  try {
    return realpathSync(resolve(argvPath)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (detectMainModule()) {
  process.exitCode = main(process.argv.slice(2));
}
