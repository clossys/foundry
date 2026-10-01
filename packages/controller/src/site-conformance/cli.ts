/**
 * CLI for the report-mode site conformance scan (slice 1 of #1515). Prints
 * one JSON report -- rule, file and line only, never matched source text --
 * and exits 0 whenever the scan ran, findings or not. Exits 2 when it could
 * not run, including for `--enforce`, which this slice does not offer.
 */
import { DEFAULT_SITE, SiteConformanceError, WAIVERS_PATH, scanSiteConformance } from "./scan.js";

const USAGE = `Usage: site-conformance-check <repoRoot> [--site <dir>]

Report-mode scan of a site's Next.js app directory (<dir>/app, default
${DEFAULT_SITE}; .ts and .tsx files, skipping node_modules and .next).
Rules:
  site/route-not-publisher-view   page.tsx, not-found.tsx and error.tsx must
                                  import @clossys/publisher/web, directly or
                                  through one relative import
  site/template-route-duplicate   a page.tsx route named like a template
                                  route (privacy, terms, legal, about,
                                  contact) outside <dir>/web-route-manifest.json
  site/raw-style-literal          a hex colour or rgb(, hsl(, oklch( on a
                                  line; a same-line token-gate:ignore skips it
  site/symlink-unscanned          a symlink under <dir>/app that points at a
                                  .ts/.tsx file, a directory or nothing; it
                                  is not followed, so what it names was not
                                  scanned (never waivable)

Waivers: ${WAIVERS_PATH}
  { "version": 1, "waivers": [{ "rule", "path", "reason" }] }
A matched waiver moves its finding to "waived"; an unmatched one is the
finding site/waiver-unused.

Prints { mode, site, filesScanned, findings, waived }. Exit codes: 0 = the
scan ran (findings or not), 2 = it could not run (missing repository or
site directory, a symlinked site or app directory, no files, an unreadable
file or directory, bad waiver file or manifest, unknown flag).`;

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  let site: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--site") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) {
        console.error(USAGE);
        return 2;
      }
      site = value;
      i += 1;
    } else if (arg.startsWith("-")) {
      console.error(USAGE);
      return 2;
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1) {
    console.error(USAGE);
    return 2;
  }
  try {
    console.log(JSON.stringify(scanSiteConformance(positional[0] as string, site === undefined ? {} : { site }), null, 2));
    return 0;
  } catch (error) {
    // Any failure means the scan did not complete, which is "could not run"
    // (2), never a crash code that a caller could read as findings. Only a
    // SiteConformanceError message is shown: it never carries source text.
    console.error(`site-conformance-check: ${error instanceof SiteConformanceError ? error.message : "the scan failed unexpectedly"}`);
    return 2;
  }
}
