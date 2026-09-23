#!/usr/bin/env node
// check-release-calendar — is it currently a day an ordinary pull request
// may merge, per governance/release-calendar.json's weekly cadence (Mon-Fri
// merge window, Saturday release, Sunday consumer adoption -- docs/
// RELEASING.md, owner decision 2026-09-23)?
//
//   node scripts/check-release-calendar.mjs [--json] --changed-files <json>
//     [--base <ref>] [--head <ref>] [--root <path>] [--files-unreadable]
//     [--labels <a,b,c>] [--now <ISO instant>]
//
// Exit 0 = the merge window is open, OR it is release/adoption day but this
// pull request is either the release PR itself -- proven by BOTH carrying
// the "release:weekly" label (governance/release-calendar.json's
// releasePrPolicy.label) AND a STRUCTURALLY VERIFIED release-PR-shaped diff
// (content-level, not just paths -- see below) -- or carries the
// "release:out-of-band" label. Exit 1 = release or adoption day, and
// neither -- the next merge window is reported either way. Exit 2 = this
// script itself could not run the check (bad arguments, no calendar file).
//
// A BRANCH NAME, OR A BARE FILE PATH LIST, IS NOT SUFFICIENT ON ITS OWN
// -------------------------------------------------------------------------
// Earlier versions of this gate trusted first the pull request's head
// branch name, then only each changed file's PATH and git STATUS. Neither
// is a property an agent (or anyone else who can open a pull request) is
// prevented from producing on their own -- see scripts/lib/release-
// calendar.mjs's own header for the full reasoning, what the current
// two-part proof establishes, and the residual risk it does not eliminate.
//
// THIS SCRIPT NOW DOES THE STRUCTURAL VERIFICATION ITSELF -- NO npm
// -----------------------------------------------------------------
// On a day the footprint actually matters (release/adoption day, and the
// pull request is not already out-of-band labelled -- see "COST" below),
// this script fetches every changed file's CONTENT at `--base`/`--head`
// via local `git show` (the checkout must have enough history for both
// refs to resolve -- see .github/workflows/release-calendar.yml's
// fetch-depth) and hands it to scripts/lib/release-pr-footprint.mjs's
// evaluateReleasePrFootprint(), which is fully pure -- no npm invocation,
// no network, no filesystem beyond what this script already fetched (an
// earlier draft regenerated package-lock.json via a real `npm install`
// and compared byte-for-byte, which drifts from what is actually
// committed even on an UNCHANGED tree and could never pass -- see that
// module's own header for the fix). ANY failure along this path (a file
// that doesn't classify, an unreadable ref) makes `footprintVerified`
// false, which is a normal, expected FAIL outcome here -- never a silent
// pass.
//
// --changed-files IS A PAGINATED REST RESULT -- FAIL CLOSED IF IT ISN'T
// COMPLETE
// -------------------------------------------------------------------------
// The calling workflow resolves this via GitHub's paginated "list pull
// request files" REST endpoint (up to 100 entries per page; a release PR
// with more files than that is not release-PR shaped anyway, but the
// PAGINATION itself must still be read to completion, not silently
// truncated at page one). If that workflow could not read every page --
// a rate limit, a network error, anything -- it passes `--files-unreadable`
// instead of a (possibly incomplete) `--changed-files` list, and this
// script refuses the exemption outright rather than judging a partial file
// list. "The file list can't be fully read" and "the file list was fully
// read and something in it fails" reach the identical FAIL outcome.
//
// COST: this is skipped entirely on an ordinary merge-window weekday (no
// git work happens) and whenever the pull request already carries the
// out-of-band label (which does not depend on the footprint at all) -- the
// git-fetching path only runs on the days, and for the pull requests,
// where the answer actually matters.
//
// --changed-files is a JSON array of `{ "path": string, "status": one of
// "added"/"removed"/"modified"/"renamed"/"copied"/"changed"/"unchanged" }`
// (the GitHub REST "list pull request files" shape) and --labels is
// supplied by the calling workflow (.github/workflows/release-calendar.yml),
// resolved differently per trigger:
//   - pull_request: github.event.pull_request.labels is on the payload
//     directly.
//   - merge_group: there is no pull_request payload -- the workflow
//     extracts the PR number from github.event.merge_group.head_ref
//     (shaped like refs/heads/gh-readonly-queue/<base>/pr-<number>-<sha>)
//     and resolves labels via `gh pr view` against that PR number. See
//     that workflow's own comments for exactly how, and its own note on
//     why the pull_request path is what actually gets exercised before the
//     merge queue (#1263) exists.
//
// --now overrides "the current instant" for testing; defaults to real time.
// This script is intentionally NOT wired into the required-checks ruleset
// itself -- see governance policy in docs/RELEASING.md and this repository
// AGENTS.md's autonomous-review rules: making a check required is an owner
// action on the branch protection ruleset, not something a workflow file
// can do on its own. docs/RELEASING.md's rollout section also names the
// EXACT check context string to select there once that day comes.
//
// Pure decision logic lives in scripts/lib/release-calendar.mjs's
// evaluateReleaseCalendarGate() and scripts/lib/release-pr-footprint.mjs's
// evaluateReleasePrFootprint() -- this file is argv parsing, the local git
// content-fetching those pure functions deliberately do not have (neither
// touches npm, network, or the filesystem at all), and process exit-code
// plumbing, the same split every other check-* script in this repository
// uses.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEFAULT_OUT_OF_BAND_LABEL, dayTypeFor, evaluateReleaseCalendarGate, loadReleaseCalendar } from "./lib/release-calendar.mjs";
import { evaluateReleasePrFootprint } from "./lib/release-pr-footprint.mjs";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// The full text of `path` at `ref`, or null if it does not exist there
// (either genuinely absent, or the ref/path could not be resolved --
// this function does not distinguish the two, both read as "cannot
// verify this file", which is exactly the fail-closed behavior wanted).
function contentAt(root, ref, path) {
  try {
    return git(["show", `${ref}:${path}`], root);
  } catch {
    return null;
  }
}

// The only git integration the footprint check needs: fetch every changed
// file's base/head content locally, then hand it straight to the fully
// pure evaluateReleasePrFootprint() -- no npm, no scratch directories, no
// network. Returns the same `{ ok, reason }` shape that function does.
function computeFootprint({ root, base, head, changedFiles }) {
  const files = changedFiles.map(({ path, status }) => ({
    path,
    status,
    baseContent: status === "added" ? null : contentAt(root, base, path),
    headContent: status === "removed" ? null : contentAt(root, head, path),
  }));
  return evaluateReleasePrFootprint({ files });
}

function parseArgs(argv) {
  const json = argv.includes("--json");
  const filesUnreadable = argv.includes("--files-unreadable");
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const changedFilesRaw = get("--changed-files") ?? "[]";
  let changedFiles;
  try {
    changedFiles = JSON.parse(changedFilesRaw);
    if (!Array.isArray(changedFiles)) throw new Error("not an array");
  } catch (error) {
    console.error(`check-release-calendar: --changed-files is not a valid JSON array: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  const labelsRaw = get("--labels") ?? "";
  const labels = labelsRaw
    .split(",")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const nowRaw = get("--now");
  const now = nowRaw ? new Date(nowRaw) : new Date();
  if (Number.isNaN(now.getTime())) {
    console.error(`check-release-calendar: --now "${nowRaw}" is not a parseable date`);
    process.exit(2);
  }
  return { json, changedFiles, filesUnreadable, labels, now, base: get("--base"), head: get("--head"), root: get("--root") ?? process.cwd() };
}

function main() {
  const { json, changedFiles, filesUnreadable, labels, now, base, head, root } = parseArgs(process.argv.slice(2));

  let calendar;
  try {
    calendar = loadReleaseCalendar(root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) console.log(JSON.stringify({ error: message }, null, 2));
    else console.error(`check-release-calendar: ${message}`);
    process.exit(2);
    return;
  }

  const dayType = dayTypeFor(now, calendar.timezone, calendar);
  const outOfBandLabel = calendar.outOfBandPolicy?.changesetFlag ?? DEFAULT_OUT_OF_BAND_LABEL;
  // The footprint is only ever relevant on a day it could change the
  // verdict: merge-window days pass regardless, and an out-of-band-
  // labelled PR passes regardless of its footprint (see docs/RELEASING.md's
  // out-of-band section). Skipping git work outside that narrow case
  // is a cost optimization only -- it changes nothing about correctness,
  // since evaluateReleaseCalendarGate() would reach the identical verdict
  // either way for those two cases.
  const footprintMatters = dayType !== "merge-window" && !labels.includes(outOfBandLabel);

  let footprintVerified = false;
  let footprintReason = "not evaluated -- merge window is open or this pull request is already out-of-band labelled";
  if (footprintMatters) {
    if (filesUnreadable) {
      footprintReason = "the changed-file list could not be fully read (pagination) -- failing closed";
    } else if (!base || !head) {
      footprintReason = "--base/--head not provided -- cannot verify the diff's content";
    } else {
      const footprint = computeFootprint({ root, base, head, changedFiles });
      footprintVerified = footprint.ok;
      footprintReason = footprint.reason;
    }
  }

  const result = evaluateReleaseCalendarGate({ calendar, now, labels, footprintVerified });

  if (json) {
    console.log(JSON.stringify({ ...result, labels, changedFileCount: changedFiles.length, footprintVerified, footprintReason, now: now.toISOString(), timezone: calendar.timezone }, null, 2));
  } else if (result.status === "pass") {
    console.log(`check-release-calendar: OK -- ${result.reason}`);
  } else {
    console.error(`check-release-calendar: FAIL -- ${result.reason}`);
    if (footprintMatters) console.error(`check-release-calendar: footprint detail -- ${footprintReason}`);
  }

  process.exit(result.status === "pass" ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
