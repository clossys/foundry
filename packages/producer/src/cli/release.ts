/**
 * `clossys release <pub> --build|--manifest|--gates|--ready` (flows.md F8, publisher.md 9.4.3). Local only: it builds
 * into `clossys/.state/builds/`, writes the release candidate and the gate results, and checks the ready-pin. It never
 * deploys, publishes, pushes or bumps a version, and no flag skips a gate. The ready-pin itself is written by
 * `clossys pin publisher/release.<pub> <manifest> --by owner:queue.approve#<id>`, which refuses it unless
 * `release.ready` would pass.
 */
import { STATE_DIR, refuseLegacyState } from "../engine/state-dir.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { discoverRoot } from "./root.js";
import type { CliResult } from "./main.js";
import type { Finding } from "../loop/route.js";
import { sha256Hex } from "../records/hash.js";
import { cliActor, toIsoZ } from "../records/pin.js";
import { canonical } from "../records/slot-model/layout.js";
import { buildIssue, latestBuild, runBuild, type ReleaseBuilder } from "../release/build.js";
import { runGates } from "../release/gates.js";
import { releaseLocales, readReleaseSlot } from "../release/locales.js";
import { latestManifest, writeManifest } from "../release/manifest.js";
import { PUBLICATION_ID, releaseSlotId } from "../release/paths.js";
import { currentPins, pinDiff } from "../release/pins.js";
import { checkReleaseReady, RELEASE_READY } from "../release/ready.js";

export const RELEASE_USAGE = "Usage: clossys release <publication> --build|--manifest|--gates|--ready [--selection <module>[#export]] [--root <dir>] [--json]\n"
  + "  --build     build the publication from the pins as they resolve now into clossys/.state/builds/<id>/\n"
  + "  --selection (with --build) the consumer's component selection module every route mounts inside, as publish --install takes it\n"
  + "  --manifest  write the release candidate publisher/release.<pub>/candidates/<pub>-v<n>.json for the latest build\n"
  + "  --gates     run every release gate against the latest manifest; any failure exits 1 (no gate can be skipped)\n"
  + "  --ready     check the ready-pin (release.ready)\n"
  + "  Local only: nothing is deployed, published or pushed.";

type Action = "build" | "manifest" | "gates" | "ready";

export interface ReleaseCliOptions {
  readonly builder?: ReleaseBuilder;
  readonly now?: () => Date;
}

interface ReleaseOutput {
  readonly publication: string;
  readonly action: Action;
  readonly wrote: string[];
  readonly findings: Finding[];
  readonly [key: string]: unknown;
}

function usage(message: string): CliResult {
  return { exitCode: 2, message: `${message}\n${RELEASE_USAGE}` };
}

function done(root: string, output: ReleaseOutput, message: string, failed = output.findings.length > 0): CliResult {
  const lines = [message, ...output.findings.map(row => `  ${row.check ?? RELEASE_READY}  ${row.subject}  ${row.detail}`)];
  return { exitCode: failed ? 1 : 0, root, message: lines.join("\n"), output };
}

/**
 * Exit 0 ready or written, 1 a gate or the ready-pin fails, 2 usage or environment (system.md 6.2): a thrown error,
 * such as no workspace at --root, is never read as a red gate.
 */
export async function runReleaseCli(argv: readonly string[], cwd: string, options: ReleaseCliOptions = {}): Promise<CliResult> {
  try {
    return await releaseCli(argv, cwd, options);
  } catch (error) {
    return { exitCode: 2, message: `release: ${error instanceof Error ? error.message : String(error)}\n${RELEASE_USAGE}` };
  }
}

async function releaseCli(argv: readonly string[], cwd: string, options: ReleaseCliOptions): Promise<CliResult> {
  const actions: Action[] = [];
  let publication: string | undefined;
  let rootFlag: string | undefined;
  let selectionArg: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") return { exitCode: 0, message: RELEASE_USAGE };
    if (arg === "--json") continue;
    if (arg === "--build" || arg === "--manifest" || arg === "--gates" || arg === "--ready") actions.push(arg.slice(2) as Action);
    else if (arg === "--root") {
      rootFlag = argv[++index];
      if (rootFlag === undefined || rootFlag.startsWith("--")) return usage("--root requires a value");
    } else if (arg === "--selection") {
      selectionArg = argv[++index];
      if (selectionArg === undefined || selectionArg.startsWith("--")) return usage("--selection requires <module>[#export]");
    } else if (arg.startsWith("--")) return usage(`Unknown argument: ${arg}`);
    else if (publication === undefined) publication = arg;
    else return usage(`release takes one publication (got ${publication} and ${arg})`);
  }
  if (!publication) return usage("release requires <publication>");
  if (!PUBLICATION_ID.test(publication)) return usage(`${publication} is not a publication id ([a-z0-9-])`);
  if (actions.length !== 1) return usage(actions.length ? `release takes one of --build, --manifest, --gates, --ready (got ${actions.map(a => `--${a}`).join(", ")})` : "release requires --build, --manifest, --gates or --ready");
  const action = actions[0]!;
  if (selectionArg !== undefined && action !== "build") return usage("--selection is taken only with --build");
  const hash = selectionArg?.lastIndexOf("#") ?? -1;
  const selection = selectionArg === undefined ? undefined
    : hash > 0 ? { module: selectionArg.slice(0, hash), export: selectionArg.slice(hash + 1) } : { module: selectionArg };
  const root = discoverRoot(resolve(cwd, rootFlag ?? "."));
  const slotRef = `publisher/${releaseSlotId(root, publication)}`;
  const now = options.now ?? (() => new Date());
  if (!readReleaseSlot(root, publication)) {
    const findings = [{ check: RELEASE_READY, subject: slotRef, detail: `${slotRef} has no readable slot.json: no release slot for ${publication}` }];
    return done(root, { publication, action, wrote: [], findings }, `release ${publication} --${action}: refused`);
  }

  if (action === "build") {
    const { locales } = releaseLocales(root, publication);
    try {
      const stamp = await runBuild(root, publication, { locales, now, cwd, ...(selection ? { selection } : {}), ...(options.builder ? { builder: options.builder } : {}) });
      return done(root, { publication, action, wrote: [stamp.path], findings: [], build: stamp }, `release ${publication}: built ${stamp.id.slice(0, 12)} into ${stamp.path} (${stamp.routes} routes, ${stamp.locales.join(", ") || "no locales"})`);
    } catch (error) {
      return { exitCode: 1, root, message: `release ${publication} --build failed: ${(error as Error).message}`, output: { publication, action, wrote: [], findings: [{ check: "release.build", subject: slotRef, detail: (error as Error).message }] } };
    }
  }

  if (action === "manifest") {
    try {
      const written = writeManifest(root, publication, { now });
      const failed = Object.entries(written.content.checks).filter(([, status]) => status !== "pass").map(([gate]) => gate);
      return done(root, { publication, action, wrote: [written.rel], findings: [], manifest: { name: written.name, sha256: written.sha256, reused: written.reused, checks: written.content.checks, diff: written.content.diff } },
        `release ${publication}: ${written.reused ? "the latest manifest already lists this build" : "wrote"} ${written.rel} (${written.sha256.slice(0, 12)})${failed.length ? `; gates failing: ${failed.join(", ")}` : ""}`, false);
    } catch (error) {
      return { exitCode: 1, root, message: `release ${publication} --manifest refused: ${(error as Error).message}`, output: { publication, action, wrote: [], findings: [{ check: "release.manifest", subject: slotRef, detail: (error as Error).message }] } };
    }
  }

  if (action === "gates") {
    const manifest = latestManifest(root, publication);
    const build = latestBuild(root, publication);
    const gates = runGates(root, publication, build);
    const findings: Finding[] = [...gates.findings];
    if (!manifest) findings.push({ check: "release.manifest", subject: slotRef, detail: `${publication} has no manifest: run clossys release ${publication} --manifest` });
    else {
      for (const issue of manifest.issues) findings.push({ check: "release.manifest", subject: `${slotRef}/${manifest.name}`, detail: issue });
      const content = manifest.content;
      if (content) {
        for (const row of pinDiff(content.pins, currentPins(root))) findings.push({ check: "release.manifest", subject: row.ref, detail: `${manifest.name} lists ${row.from ?? "nothing"}, it resolves to ${row.to ?? "nothing"} now: build and write the manifest again` });
        const issue = buildIssue(root, content.build.id);
        if (issue) findings.push({ check: "release.manifest", subject: `${slotRef}/${manifest.name}`, detail: issue });
        if (build && build.id !== content.build.id) findings.push({ check: "release.manifest", subject: `${slotRef}/${manifest.name}`, detail: `${manifest.name} names build ${content.build.id.slice(0, 12)}, the latest build is ${build.id.slice(0, 12)}` });
      }
    }
    const wrote: string[] = [];
    if (manifest?.sha256) {
      const slot = readReleaseSlot(root, publication);
      const rel = join(STATE_DIR, "checks", "publisher", releaseSlotId(root, publication), `${manifest.name}.json`);
      const doc = {
        schema: "clossys.check-result/1",
        subject: `${slotRef}/${manifest.name}`,
        subjectSha256: manifest.sha256,
        briefSha256: sha256Hex(JSON.stringify(canonical(slot?.brief ?? null))),
        standard: typeof (slot as { standard?: unknown } | undefined)?.standard === "string" ? (slot as { standard: string }).standard : "release",
        ranAt: toIsoZ(now().toISOString())!,
        by: cliActor(`clossys release ${publication} --gates`),
        status: findings.length ? "fail" : "pass",
        results: [
          ...Object.entries(gates.checks).map(([check, status]) => ({ check, status })),
          ...findings.map(row => ({ check: row.check ?? "release.gates", status: "fail" as const, detail: `${row.subject}: ${row.detail}` })),
        ],
      };
      refuseLegacyState(root);
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), `${JSON.stringify(doc, null, 2)}\n`);
      wrote.push(rel.split(/[\\/]/).join("/"));
    }
    const failing = Object.entries(gates.checks).filter(([, status]) => status !== "pass").map(([gate]) => gate);
    return done(root, { publication, action, wrote, findings, checks: gates.checks },
      findings.length ? `release ${publication}: gates fail (${failing.join(", ") || "manifest"})` : `release ${publication}: every gate passes (${Object.keys(gates.checks).join(", ")})`);
  }

  const ready = checkReleaseReady(root, publication);
  return done(root, { publication, action, wrote: [], findings: ready.findings }, ready.status === "pass" ? `release ${publication}: the ready-pin holds` : `release ${publication}: not ready`);
}
