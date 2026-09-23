/**
 * CLI for issue #1221: the operating-cadence heartbeat. Computes the
 * "decisions waiting for you" digest over every `clossys/<role>/loop.json`
 * under a repository root and emits ONE `docs/contracts/
 * check-output-envelope.json` report (issue #1174) -- see `../envelope.js`,
 * the one constructor this check and #1224's schema-version check share.
 *
 * Report mode by default: the digest is computed but never written.
 * `--write` writes a `decisions-waiting-for-you.md` file under the
 * installing repository's own `clossys/.state/` directory (see
 * `./fs.js`'s `DIGEST_PATH`). Never calls a model; never makes a
 * live external change -- this CLI only reads `clossys/*\/loop.json` and,
 * with `--write`, writes that one file.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCheckOutputEnvelope, envelopeToExitCode } from "../envelope.js";
import type { CheckFinding } from "../envelope.js";
import { computeHeartbeatForRepo, writeHeartbeatDigest } from "./fs.js";

const PACKAGE_NAME = "@clossys/controller";

function packageVersion(): string {
  try {
    const url = new URL("../../package.json", import.meta.url);
    const manifest = JSON.parse(readFileSync(url, "utf8")) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const USAGE = `Usage: foundry-heartbeat [repoRoot] [--write]

Reads every clossys/<role>/loop.json under repoRoot, computes the
"decisions waiting for you" digest (stale capabilities, open blockers,
pending decisions, and review windows due -- issue #1221), and prints one
check-output-envelope JSON report (docs/contracts/check-output-envelope.json)
to stdout. Report mode by default: the digest is computed but nothing is
written. --write also renders it to
clossys/.state/decisions-waiting-for-you.md. repoRoot defaults to the
current directory.

Zero-token: never calls a model, never makes a live external change.

Exit codes: 0 = satisfied (the digest computed successfully -- a
populated digest is not itself a violation), 2 = indeterminate (at least
one clossys/<role>/loop.json could not be read or validated).`;

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  const write = argv.includes("--write");
  const positional = argv.filter((value) => value !== "--write");
  if (positional.length > 1) {
    console.error(USAGE);
    return 2;
  }
  const repoRoot = resolve(positional[0] ?? ".");
  const now = new Date();
  const { digest, unreadable } = computeHeartbeatForRepo(repoRoot, now);

  let writtenPath: string | undefined;
  if (write) writtenPath = writeHeartbeatDigest(repoRoot, digest, now);

  const findings: CheckFinding[] = unreadable.map((item) => ({ rule: "loop-state-unreadable", severity: "error", message: `${item.path}: ${item.reason}`, path: item.path }));
  const verdict = unreadable.length > 0 ? "indeterminate" : "satisfied";
  const envelope = buildCheckOutputEnvelope({
    package: PACKAGE_NAME,
    version: packageVersion(),
    verdict,
    summary:
      verdict === "indeterminate"
        ? `${unreadable.length} clossys/<role>/loop.json file(s) could not be read or validated.`
        : `${digest.entries.length} item(s) waiting across every role's loop.json${writtenPath !== undefined ? `; digest written to ${writtenPath}` : ""}.`,
    findings,
    nextAction: verdict === "indeterminate" ? "Fix or regenerate the named loop.json file(s)." : undefined,
  });

  console.log(JSON.stringify(envelope, null, 2));
  return envelopeToExitCode(envelope);
}
