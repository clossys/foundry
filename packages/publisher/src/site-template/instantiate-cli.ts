#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDirectInvocation } from "../verified-publication-rate-cli.js";
import { SiteInstantiateRefusal, SiteInstantiateUnavailable, instantiateSite } from "./instantiate.js";

const USAGE = `Usage: publisher-site-instantiate --root <repo> --pins <file.json> [--site-dir apps/site]

Copies the site template into <repo>/<site-dir> with exact @clossys/* pins and makes the
root package.json workspaces cover it. <file.json> is a JSON object
{ "@clossys/<pkg>": "<exact semver>" } taken from the approved plan; this command never reads a plan.
Exit codes: 0 = done, 1 = refused (nothing written), 2 = could not run.`;

class UsageError extends Error {}

interface Parsed {
  root: string;
  pins: string;
  siteDir: string | undefined;
}

function parseArgs(argv: readonly string[]): Parsed {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index] as string;
    const value = argv[index + 1];
    if (flag !== "--root" && flag !== "--pins" && flag !== "--site-dir") throw new UsageError("unknown-argument");
    if (value === undefined || value.startsWith("--")) throw new UsageError("missing-value");
    if (values.has(flag)) throw new UsageError("repeated-argument");
    values.set(flag, value);
  }
  const root = values.get("--root");
  const pins = values.get("--pins");
  if (root === undefined || pins === undefined) throw new UsageError("missing-required-argument");
  return { root, pins, siteDir: values.get("--site-dir") };
}

function fail(prefix: string, rule: string): void {
  console.error(`publisher-site-instantiate: ${prefix}: ${rule}`);
}

/** Testable dispatcher. Returns the exit code: 0 done, 1 refused, 2 could not run. */
export function main(argv: readonly string[], env: { templateDir?: string } = {}): number {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log(USAGE);
    return 0;
  }
  let parsed: Parsed;
  try {
    parsed = parseArgs(argv);
  } catch (cause) {
    if (!(cause instanceof UsageError)) throw cause;
    fail("could not run", cause.message);
    console.error(USAGE);
    return 2;
  }
  let pins: unknown;
  try {
    pins = JSON.parse(readFileSync(resolve(parsed.pins), "utf8"));
  } catch {
    fail("could not run", "pins-file-unreadable");
    return 2;
  }
  try {
    const result = instantiateSite({
      root: parsed.root,
      pins,
      ...(parsed.siteDir === undefined ? {} : { siteDir: parsed.siteDir }),
      ...(env.templateDir === undefined ? {} : { templateDir: env.templateDir }),
    });
    console.log(`publisher-site-instantiate: done: ${result.siteDir}${result.workspacesAdded ? " (root workspaces updated)" : ""}`);
    return 0;
  } catch (cause) {
    if (cause instanceof SiteInstantiateRefusal) {
      fail("refused", cause.message);
      return 1;
    }
    if (cause instanceof SiteInstantiateUnavailable) {
      fail("could not run", cause.rule);
      return 2;
    }
    // Node's own messages carry absolute paths; report the code only.
    const code = (cause as NodeJS.ErrnoException | undefined)?.code;
    fail("could not run", typeof code === "string" ? code : "unexpected-error");
    return 2;
  }
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
