#!/usr/bin/env node
// check-conversation-safety — extend the public-safety gate to GitHub's
// CONVERSATION surface: issue bodies, PR bodies, issue comments, and PR
// review comments/reviews. None of that is a file in the git tree, so
// check-public-safety.mjs (which only ever walks a directory) cannot see any
// of it, and nothing else in this repository ever has.
//
//   node scripts/check-conversation-safety.mjs --issue <n>  [options]
//   node scripts/check-conversation-safety.mjs --pr <n>     [options]
//   node scripts/check-conversation-safety.mjs --all        [options]
//   node scripts/check-conversation-safety.mjs --file <path>  (DRAFT mode)
//   <text> | node scripts/check-conversation-safety.mjs        (DRAFT mode, stdin)
//
//     --issue <n>           scan one issue's body + its comments
//     --pr <n>              scan one PR's body, issue-style comments, review
//                            comments, and review summaries
//     --all                 scan every issue and PR in the repository
//     --since <iso>         only fetch/consider items updated (--all) or
//                            comments posted (--issue/--pr) at or after this
//                            ISO 8601 timestamp
//     --file <path>         DRAFT mode: scan text that has NOT been posted yet
//     --repo <owner/repo>   override repository detection
//     --denylist <file>     explicit denylist path (forwarded)
//     --require-denylist    fail (exit 2) rather than degrade to PARTIAL mode
//     --json                machine-readable output
//
// Exit 0 = safe. Exit 1 = findings. Exit 2 = the gate could not run.
//
// WHY THIS EXISTS
// ----------------
// An audit of this repository's issue and PR conversation history found 214
// private-identity findings spread across 28 issues, pull requests, and
// comments — while the git tree itself, the one surface every other gate in
// this repository actually looks at, was clean. Nobody pasted a client name
// into a source file; people pasted it into a PR description, a code review
// comment, or an issue explaining what broke. That text is exactly as public
// and exactly as permanent as a committed file — arguably more permanent,
// since editing a GitHub comment leaves the original content readable via the
// API's edit history and any scraper that already indexed it — and until this
// script, nothing ever scanned it.
//
// DRAFT MODE IS THE POINT
// ------------------------
// Every other mode here (--issue, --pr, --all) is DETECTION: it finds
// disclosure that has already happened, after the text is already public,
// already indexed, already permanent. By the time any of those modes finds
// something, the damage this repository exists to prevent is already done —
// the best a human can do afterwards is edit the comment (which does not
// remove it from the API's edit history or a scraper's cache) or delete it
// (same problem, worse: deletion also destroys the surrounding conversation).
//
// --file (and its stdin form) is PREVENTION: it scans text BEFORE it is
// posted, while withholding it is still free and total. A `gh pr comment
// --body-file` invocation or a browser text box are equally trivial to pipe
// through this first. This is the single most valuable mode this script has,
// specifically because it is the only one that acts before the failure is
// irreversible rather than after.
//
// DELEGATION, NOT REIMPLEMENTATION
// ---------------------------------
// This script does not know what a private identity term looks like and
// deliberately never learns. It has exactly one job of its own: turn
// GitHub API objects (or a draft file) into plain text files in a scratch
// directory, and turn check-public-safety.mjs's findings back into GitHub
// object identities. The actual matching — the denylist, the secret
// patterns, FULL/PARTIAL mode, the zero-width-character stripping, all of
// it — is check-public-safety.mjs's, spawned as a subprocess exactly the way
// check-artifact-safety.mjs already spawns it for the tarball surface. A
// second, hand-rolled matcher here would drift from the first one release by
// release, and a drifted second matcher is precisely the failure mode this
// repository's own docs (see AGENTS.md, SECURITY.md) warn about: a confident
// pass that never actually checked what it claims to have checked.
//
// NEVER ECHO A MATCH
// -------------------
// This script's own output lands in PUBLIC CI logs — the exact surface it
// exists to protect. Like check-public-safety.mjs itself, every finding here
// is reported as a category label, a count, and a location (issue/PR number,
// comment id, github.com URL) — never the matched text. The location IS safe
// to print: an issue number or a comment URL discloses nothing that a public
// issue tracker doesn't already make trivially findable; the matched string
// is the one thing that must never appear here.
//
// WHAT THIS CANNOT DO
// --------------------
// This is advisory in the same one direction check-public-safety.mjs is: it
// can prove a comment dirty, never prove one clean, and a PARTIAL-mode pass
// (no denylist) skips identity checks entirely. It also cannot un-ring a bell
// — --issue/--pr/--all modes report disclosure that has already happened;
// only --file (or piping into stdin before posting) prevents it. And it only
// covers the surfaces GitHub's REST API exposes as fetchable objects: it does
// not scan repository wiki pages, GitHub Discussions, or Actions run logs.

import { mkdtempSync, rmSync, writeFileSync, readFileSync, readSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));

function flagValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

// `tmpDir` is created partway through the run (once we know there is
// something to stage) but `die()` can be called both before and after that
// point — a `gh` failure while fetching happens after tmpDir exists just as
// often as a bad flag happens before it does. Declared here, ahead of `die`,
// so `die` always sees whichever value is current, and mirrors
// check-artifact-safety.mjs's own reasoning for doing the same: process.exit()
// terminates immediately and does not reliably unwind to a `finally` still
// pending higher up the stack, so every early-exit path has to clean up for
// itself rather than trust one at the end to catch it.
let tmpDir;

function die(msg, code = 2) {
  console.error(`check-conversation-safety: ${msg}`);
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  process.exit(code);
}

// --------------------------------------------------------------- mode select

const MODE_FLAGS = ["--issue", "--pr", "--all"];
const activeModeFlags = MODE_FLAGS.filter((f) => flags.has(f));
if (activeModeFlags.length > 1) {
  die(`--issue, --pr and --all are mutually exclusive (got: ${activeModeFlags.join(", ")})`);
}
if (flags.has("--file") && activeModeFlags.length) {
  die(`--file (draft mode) cannot be combined with ${activeModeFlags[0]} — a draft has no issue/PR identity yet`);
}

const isDraftMode = flags.has("--file") || activeModeFlags.length === 0;

function requirePositiveInt(flagName) {
  const raw = flagValue(flagName);
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n <= 0) {
    die(`${flagName} requires a positive integer, got ${JSON.stringify(raw ?? null)}`);
  }
  return n;
}

function parseSince() {
  const raw = flagValue("--since");
  if (!raw) return null;
  const ts = new Date(raw).getTime();
  if (Number.isNaN(ts)) die(`--since ${JSON.stringify(raw)} is not a valid ISO 8601 date/time`);
  return ts;
}

// ----------------------------------------------------------------- fetch: gh

// Repository identity is deliberately never taken from anything inside a
// fetched object (an issue body could, in principle, claim to be about a
// different repository) — it comes from context captured independently, the
// same reasoning check-name-collision.mjs applies to "is this our repo".
function detectRepo() {
  const envRepo = process.env.GITHUB_REPOSITORY;
  if (typeof envRepo === "string" && /^[^/]+\/[^/.]+$/.test(envRepo)) return envRepo;
  try {
    const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+?)(\.git)?$/);
    if (match) return `${match[1]}/${match[2]}`;
  } catch {
    // not a git checkout, or no origin remote — fall through to null
  }
  return null;
}

// `gh api --paginate` on an endpoint that returns a JSON array prints EACH
// PAGE as its own separate JSON array back to back, not one combined array —
// per `gh api --help`: "Each page is a separate JSON array or object." Naive
// `JSON.parse` of multi-page output silently throws (or worse, on some inputs
// parses only the first page and drops the rest without error). `--slurp`
// wraps all pages into one outer array; this then flattens that one level so
// callers see a single flat list regardless of how many pages GitHub sent.
function ghApiList(path) {
  try {
    const out = execFileSync("gh", ["api", path, "--paginate", "--slurp"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1 << 26,
    });
    const pages = JSON.parse(out);
    if (!Array.isArray(pages)) return { ok: false, error: "unexpected --slurp response shape (not an array of pages)" };
    return { ok: true, data: pages.flatMap((page) => (Array.isArray(page) ? page : [page])) };
  } catch (error) {
    return { ok: false, error: (error.stderr || error.message || "").toString().trim() };
  }
}

function ghApiOne(path) {
  try {
    const out = execFileSync("gh", ["api", path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1 << 26,
    });
    return { ok: true, data: JSON.parse(out) };
  } catch (error) {
    return { ok: false, error: (error.stderr || error.message || "").toString().trim() };
  }
}

function bodyItem(kind, number, id, url, body) {
  return { kind, number, id, url, body: typeof body === "string" ? body : "" };
}

// Comments/reviews carry `created_at`; a body object (issue/PR/review) is
// always included regardless of --since — the object was explicitly asked
// for by number, so its own body is always in scope even if it predates the
// cutoff. --since only thins out which COMMENTS ride along with it.
function afterSince(obj, sinceTs) {
  if (!sinceTs) return true;
  const t = new Date(obj.created_at ?? obj.submitted_at ?? 0).getTime();
  return !Number.isNaN(t) && t >= sinceTs;
}

function fetchIssueComments(repo, n, sinceTs) {
  const r = ghApiList(`repos/${repo}/issues/${n}/comments`);
  if (!r.ok) die(`could not fetch comments for #${n} from ${repo}: ${r.error}\n  Needs an authenticated \`gh\` with access to this repository. Refusing to report a pass from a check that did not run.`);
  return r.data.filter((c) => afterSince(c, sinceTs));
}

function fetchIssue(repo, n, sinceTs) {
  const r = ghApiOne(`repos/${repo}/issues/${n}`);
  if (!r.ok) die(`could not fetch issue #${n} from ${repo}: ${r.error}\n  Needs an authenticated \`gh\` with access to this repository. Refusing to report a pass from a check that did not run.`);
  if (r.data.pull_request) {
    console.error(`check-conversation-safety: note — #${n} is a pull request, not an issue; re-run with --pr ${n} to also scan its review comments.`);
  }
  const items = [bodyItem("issue-body", n, n, r.data.html_url, r.data.body)];
  for (const c of fetchIssueComments(repo, n, sinceTs)) {
    items.push(bodyItem("issue-comment", n, c.id, c.html_url, c.body));
  }
  return items;
}

function fetchPr(repo, n, sinceTs) {
  const r = ghApiOne(`repos/${repo}/pulls/${n}`);
  if (!r.ok) die(`could not fetch PR #${n} from ${repo}: ${r.error}\n  Needs an authenticated \`gh\` with access to this repository. Refusing to report a pass from a check that did not run.`);
  const items = [bodyItem("pr-body", n, n, r.data.html_url, r.data.body)];
  for (const c of fetchIssueComments(repo, n, sinceTs)) {
    items.push(bodyItem("pr-comment", n, c.id, c.html_url, c.body));
  }
  const rc = ghApiList(`repos/${repo}/pulls/${n}/comments`);
  if (!rc.ok) die(`could not fetch review comments for PR #${n} from ${repo}: ${rc.error}`);
  for (const c of rc.data.filter((c) => afterSince(c, sinceTs))) {
    items.push(bodyItem("pr-review-comment", n, c.id, c.html_url, c.body));
  }
  const rv = ghApiList(`repos/${repo}/pulls/${n}/reviews`);
  if (!rv.ok) die(`could not fetch reviews for PR #${n} from ${repo}: ${rv.error}`);
  for (const rvw of rv.data.filter((rvw) => afterSince(rvw, sinceTs))) {
    items.push(bodyItem("pr-review", n, rvw.id, rvw.html_url, rvw.body));
  }
  return items;
}

function fetchAll(repo, sinceTs, sinceRaw) {
  let path = `repos/${repo}/issues?state=all&per_page=100`;
  if (sinceRaw) path += `&since=${encodeURIComponent(sinceRaw)}`;
  const listing = ghApiList(path);
  if (!listing.ok) die(`could not list issues/PRs for ${repo}: ${listing.error}`);
  const items = [];
  for (const entry of listing.data) {
    const n = entry.number;
    const isPr = Boolean(entry.pull_request);
    items.push(bodyItem(isPr ? "pr-body" : "issue-body", n, n, entry.html_url, entry.body));
    for (const c of fetchIssueComments(repo, n, sinceTs)) {
      items.push(bodyItem(isPr ? "pr-comment" : "issue-comment", n, c.id, c.html_url, c.body));
    }
    if (isPr) {
      const rc = ghApiList(`repos/${repo}/pulls/${n}/comments`);
      if (!rc.ok) die(`could not fetch review comments for PR #${n} from ${repo}: ${rc.error}`);
      for (const c of rc.data.filter((c) => afterSince(c, sinceTs))) {
        items.push(bodyItem("pr-review-comment", n, c.id, c.html_url, c.body));
      }
      const rv = ghApiList(`repos/${repo}/pulls/${n}/reviews`);
      if (!rv.ok) die(`could not fetch reviews for PR #${n} from ${repo}: ${rv.error}`);
      for (const rvw of rv.data.filter((rvw) => afterSince(rvw, sinceTs))) {
        items.push(bodyItem("pr-review", n, rvw.id, rvw.html_url, rvw.body));
      }
    }
  }
  return items;
}

// -------------------------------------------------------------- fetch: draft

function fetchDraft() {
  const filePath = flagValue("--file");
  let text;
  // readFileSync(0) is the obvious way to slurp stdin and it is wrong for a
  // pipe. Once the pipe buffer drains faster than the writer refills it, the
  // underlying read(2) returns EAGAIN on a non-blocking fd and the sync call
  // throws rather than waiting — reproducible with a ~1.7 MB paste on macOS,
  // and silent for anything small enough to fit the buffer in one go, which
  // is why it survives casual testing. An uncaught throw here would also exit
  // with code 1: the code this tool reserves for "a real finding", making a
  // crash indistinguishable from a detected leak by any caller that reads
  // only the exit status. So: read in a loop, treat EAGAIN as "wait and
  // retry" rather than as failure, and route any genuine error through die()
  // so it becomes exit 2, "the gate could not run".
  function readStdinFully() {
    const chunks = [];
    const buf = Buffer.alloc(1 << 16);
    while (true) {
      let bytes;
      try {
        bytes = readSync(0, buf, 0, buf.length, null);
      } catch (error) {
        if (error.code === "EAGAIN") continue;
        if (error.code === "EOF") break;
        die(`could not read stdin: ${error.message}`);
      }
      if (!bytes) break;
      chunks.push(Buffer.from(buf.subarray(0, bytes)));
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  if (filePath) {
    if (!existsSync(filePath)) die(`--file ${filePath} does not exist`);
    text = readFileSync(filePath, "utf8");
  } else {
    if (process.stdin.isTTY) {
      die(
        "no --issue/--pr/--all/--file given, and stdin is a terminal — nothing to scan.\n" +
          "  usage: node scripts/check-conversation-safety.mjs --file <path>\n" +
          "     or: <text> | node scripts/check-conversation-safety.mjs",
      );
    }
    text = readStdinFully();
  }
  return [bodyItem("draft", null, null, null, text)];
}

// -------------------------------------------------------------------- gather

let items;
let sourceLabel;

if (isDraftMode) {
  items = fetchDraft();
  sourceLabel = flagValue("--file") ? `draft file ${flagValue("--file")}` : "draft (stdin)";
} else {
  const repo = flagValue("--repo") ?? detectRepo();
  if (!repo) {
    die("cannot determine the repository — pass --repo <owner/repo>, set GITHUB_REPOSITORY, or run inside a checkout with a github.com origin remote");
  }
  const sinceRaw = flagValue("--since") ?? null;
  const sinceTs = parseSince();
  if (flags.has("--issue")) {
    const n = requirePositiveInt("--issue");
    items = fetchIssue(repo, n, sinceTs);
    sourceLabel = `${repo} issue #${n}`;
  } else if (flags.has("--pr")) {
    const n = requirePositiveInt("--pr");
    items = fetchPr(repo, n, sinceTs);
    sourceLabel = `${repo} PR #${n}`;
  } else {
    items = fetchAll(repo, sinceTs, sinceRaw);
    sourceLabel = `${repo} (all issues/PRs${sinceRaw ? ` updated since ${sinceRaw}` : ""})`;
  }
}

// -------------------------------------------------------------- stage + scan

tmpDir = mkdtempSync(join(tmpdir(), "conversation-safety-"));
let exitCode = 0;

function describeItem(item) {
  switch (item.kind) {
    case "draft":
      return "draft (not yet posted)";
    case "issue-body":
      return `issue #${item.number} (body)`;
    case "issue-comment":
      return `issue #${item.number} comment ${item.id}`;
    case "pr-body":
      return `PR #${item.number} (body)`;
    case "pr-comment":
      return `PR #${item.number} comment ${item.id}`;
    case "pr-review-comment":
      return `PR #${item.number} review comment ${item.id}`;
    case "pr-review":
      return `PR #${item.number} review ${item.id}`;
    default:
      return item.kind;
  }
}

try {
  // Staged into a directory OUTSIDE the repository — never under this
  // checkout — so nothing here can accidentally get git-added, and so a
  // --no-gitignore scan of it can't be confused by this repo's own
  // .gitignore rules (there are none to find out here regardless, but the
  // flag is passed explicitly rather than relied on implicitly).
  const itemsByFile = new Map();
  let staged = 0;
  items.forEach((item, i) => {
    if (!item.body || !item.body.trim()) return; // nothing to scan
    const rel = `${String(i).padStart(6, "0")}.md`;
    writeFileSync(join(tmpDir, rel), item.body, "utf8");
    itemsByFile.set(rel, item);
    staged++;
  });

  const gateArgs = [join(scriptDir, "check-public-safety.mjs"), tmpDir, "--no-gitignore", "--allow-changelogs", "--json"];
  const denylistArg = flagValue("--denylist");
  if (denylistArg) gateArgs.push("--denylist", denylistArg);
  if (flags.has("--require-denylist")) gateArgs.push("--require-denylist");

  let gateOut = "";
  let gateCode = 0;
  try {
    // maxBuffer MUST be set here, and generously. check-public-safety.mjs's
    // --json report puts the RAW MATCHED LINE in each identity finding's
    // `text` field (see that file's identity-matching push, where it stores
    // rawLines[i].trim().slice(0, 100) — only SECRET-class findings are
    // "<redacted>"). So this pipe carries precisely the strings this script
    // exists to keep out of a public log. At Node's 1 MiB default a report
    // with a few thousand findings — well within range for a real denylist
    // over a whole conversation surface — overflows the buffer, execFileSync
    // throws, the JSON no longer parses, and the truncated-but-still-raw
    // payload lands in the error path below. That was a live defect, caught
    // in review by piping a synthetic 20k-match draft through it and watching
    // the planted term print 318 times.
    gateOut = execFileSync("node", gateArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 });
  } catch (error) {
    gateCode = error.status ?? 2;
    gateOut = (error.stdout ?? "") + (error.stderr ?? "");
  }

  let report;
  try {
    report = JSON.parse(gateOut);
  } catch {
    report = null;
  }

  if (!report) {
    // Two very different things land here, and only one of them is safe to
    // print.
    //
    // (a) check-public-safety.mjs never reached its --json branch at all —
    //     its --require-denylist fast-fail. That output is a human-written
    //     error message with no scanned content in it, so relaying it
    //     verbatim is both safe and the most useful thing to do.
    //
    // (b) It DID emit a report and we failed to parse it — which now means
    //     the output was truncated or corrupted, since maxBuffer is no longer
    //     the cause. That payload is partial JSON still containing raw `text`
    //     fields. Printing it would republish the matched strings into the
    //     public CI log: the exact disclosure this whole script exists to
    //     prevent, arriving through its own error handler.
    //
    // Distinguish by shape, and when in doubt treat it as (b). A report
    // always starts with '{'; the fast-fail message never does.
    const looksLikeReport = gateOut.trimStart().startsWith("{");
    if (looksLikeReport) {
      console.error(
        "check-conversation-safety: the underlying gate produced a report that could not be parsed " +
          `(${gateOut.length} bytes, exit ${gateCode}).\n` +
          "Its output is deliberately NOT shown: an unparseable report is a truncated one, and a truncated " +
          "report still contains raw matched text that must not reach a public log.\n" +
          "This is NOT a clean scan. Re-run locally to investigate.",
      );
    } else {
      console.error(gateOut.trim());
    }
    exitCode = gateCode || 2;
  } else {
    const findings = (report.failures ?? []).map((f) => {
      const item = itemsByFile.get(f.rel);
      return {
        kind: f.kind,
        detail: f.detail,
        severity: f.severity,
        location: item ? describeItem(item) : f.rel,
        url: item?.url ?? null,
        // Deliberately no `text` / matched-string field here — see the file
        // header ("NEVER ECHO A MATCH"). This script's own output lands in
        // public CI logs, the exact surface it exists to protect.
      };
    });

    if (flags.has("--json")) {
      console.log(JSON.stringify({ mode: report.mode, source: sourceLabel, scanned: staged, findings }, null, 2));
    } else {
      console.log(`check-conversation-safety: scanned ${staged} conversation item(s) from ${sourceLabel}`);
      console.log(`mode: ${report.mode}`);
      if (report.mode === "PARTIAL") {
        console.log(
          "\n!! PARTIAL SCAN — identity checks were SKIPPED (no denylist available).\n" +
            "!! Secrets and forbidden-content rules were still enforced.\n" +
            "!! A pass here does NOT clear this conversation surface of private identity.\n" +
            "!! Re-run with --require-denylist and a denylist for a real clearance.",
        );
      }
      console.log("");

      if (!findings.length) {
        console.log(
          report.mode === "FULL"
            ? "PASS — no private identity or credential-shaped string found in scanned conversation text."
            : "PASS (partial) — no credential-shaped string found; identity checks were skipped.",
        );
      } else {
        const RANK = { critical: 0, high: 1, medium: 2 };
        for (const kind of ["SECRET", "forbidden-file", "manifest", "identity"]) {
          const rows = findings.filter((f) => f.kind === kind);
          if (!rows.length) continue;
          console.log(`## ${kind} — ${rows.length} finding(s)`);
          const grouped = rows.reduce((a, r) => ((a[r.detail] ??= []).push(r), a), {});
          const order = Object.entries(grouped).sort((a, b) => (RANK[a[1][0].severity] ?? 3) - (RANK[b[1][0].severity] ?? 3));
          for (const [detail, rs] of order) {
            // Deduplicate by location, the same way check-public-safety.mjs
            // groups its own findings by file. Ten hits of one category in a
            // single issue body are ten rows here but ONE place to go fix, and
            // printing the identical location ten times buries that — worst of
            // all in draft mode, where every hit shares the one pseudo-location
            // and the reader sees a wall of the same line.
            const seen = new Map();
            for (const r of rs) if (!seen.has(r.location)) seen.set(r.location, r);
            const where = [...seen.values()];
            console.log(`  [${rs[0].severity}] ${detail}: ${rs.length} hit(s) across ${where.length} location(s)`);
            for (const r of where.slice(0, 10)) console.log(`      ${r.location}${r.url ? ` — ${r.url}` : ""}`);
            if (where.length > 10) console.log(`      ...and ${where.length - 10} more`);
          }
          console.log("");
        }
        console.log(`FAIL — ${findings.length} finding(s). This conversation surface is NOT safe.`);
        if (isDraftMode) {
          console.log("This draft must NOT be posted as written — remove the flagged text before submitting it.");
        }
      }
    }

    exitCode = gateCode;
  }
} finally {
  // Belt-and-braces with the explicit cleanup inside die(): this covers the
  // normal completion path (pass or fail), which never goes through die().
  rmSync(tmpDir, { recursive: true, force: true });
}

process.exit(exitCode);
