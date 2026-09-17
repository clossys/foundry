#!/usr/bin/env node

// Assembles the inputs document @example/verify-standards decides on.
//
// The split is the whole point: this script COLLECTS and the package DECIDES.
// Nothing here forms a verdict, and nothing in the package reaches for a
// tracker. Three properties fall out of that and each is load-bearing:
//
//   1. The package needs no credential. The only token in this process is this
//      repository's own, used for this repository's own tracker.
//   2. The verdict is auditable. What this writes is uploaded as a run
//      artifact and can be re-fed to the CLI offline to reproduce the answer.
//   3. "The lookup did not happen" survives. Every failure path below records
//      an explicit outcome rather than returning nothing. An absent record
//      would read as a clean one, which is the failure the whole package
//      exists to prevent.
//
// Every policy VALUE is read from .github/verify-standards-policy.json, never
// written here, so the values a reviewer argues about live in one small file
// of data instead of inside a script.

import { readFileSync } from "node:fs";

import {
  extractTaskReferenceText,
  parseTaskReference,
  TASK_ITEM_LOOKUP_OUTCOMES,
  VERIFY_STANDARDS_INPUTS_VERSION,
} from "@clossys/inspector";

// This import was "@example/verify-standards" until decision 9 folded
// that package and secret-scan into `inspector`. This file is byte-identical
// across several consuming repositories by design; that identity is
// deliberately broken here for the length of the migration window, because
// this repository is the producer and moves first. Each consumer repoints when
// it migrates, and the copies converge again on the new name.

const POLICY_PATH = ".github/verify-standards-policy.json";

function fail(message) {
  console.error(`assemble-verify-inputs: ${message}`);
  process.exit(1);
}

function readPolicy() {
  let raw;
  try {
    raw = readFileSync(POLICY_PATH, "utf8");
  } catch (error) {
    fail(`cannot read ${POLICY_PATH}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`${POLICY_PATH} is not valid JSON: ${error.message}`);
  }
}

// Labels arrive as the raw event array so that this script never has to agree
// with a shell about how to quote a label containing a space or a quote.
function readLabels() {
  const raw = process.env.PR_LABELS_JSON;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => (typeof entry === "string" ? entry : entry?.name))
      .filter((name) => typeof name === "string");
  } catch {
    // A label list this script cannot read is not a reason to claim there were
    // none: an empty list would silently disable every label exemption.
    return undefined;
  }
}

// Which tracker this job's credential actually reads, taken from the runner's
// own environment rather than assumed.
//
// GITHUB_SERVER_URL and GITHUB_API_URL are both set by the runner on every
// host, including a self-hosted one, so neither is guessed here. When they are
// absent -- running this by hand, outside a workflow -- NO host is stated, and
// the package then reports a reference that names a host as unverifiable
// rather than as local. That is the point: `owner/name` is unique only within
// one tracker, so a URL naming the same owner and name on a different host is
// a different repository, and answering it with this repository's object of
// that number validates something the author never referenced.
function trackerHost() {
  const serverUrl = process.env.GITHUB_SERVER_URL;
  if (!serverUrl) return undefined;
  try {
    return new URL(serverUrl).host || undefined;
  } catch {
    return undefined;
  }
}

function apiBase() {
  // Whatever host this runner's API is on -- the same host the lookup then
  // claims to have examined. A literal here would make that claim false on
  // any tracker but one.
  return (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/+$/, "");
}

// The one network call. Its result is reported as an outcome from the
// package's own declared vocabulary -- including the outcomes that mean "this
// did not establish anything", which is the distinction a bare try/catch
// throws away.
//
// It also reports WHERE it looked, not just how the lookup ended. The package
// checks that target against the reference before reading the outcome, so a
// lookup aimed anywhere other than the repository the reference names is
// reported as indeterminate instead of standing in for it. That is the
// difference between "this resolved" and "this resolved, over there".
async function lookupItem(scope, host, number, token) {
  const target = { lookupScope: scope, ...(host ? { lookupHost: host } : {}) };
  if (!token) {
    return { outcome: "not-attempted", detail: "no tracker credential in this job" };
  }

  let response;
  try {
    response = await fetch(`${apiBase()}/repos/${scope}/issues/${number}`, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "assemble-verify-inputs",
        "x-github-api-version": "2022-11-28",
      },
    });
  } catch (error) {
    return { ...target, outcome: "unavailable", detail: `tracker unreachable: ${error.message}` };
  }

  // 404 is deliberately NOT proof of absence. A repository-scoped token
  // answers 404 identically for an item that does not exist and one it may not
  // read, so this reports the outcome that says exactly that and lets the
  // package decide it is indeterminate rather than a finding.
  if (response.status === 404) {
    return {
      ...target,
      outcome: "not-visible",
      detail: "tracker answered 404 — absent, or not readable by this job's credential",
    };
  }
  if (!response.ok) {
    return { ...target, outcome: "unavailable", detail: `tracker answered HTTP ${response.status}` };
  }

  let item;
  try {
    item = await response.json();
  } catch (error) {
    return { ...target, outcome: "unavailable", detail: `unreadable tracker response: ${error.message}` };
  }

  // A pull request is served by the issues endpoint too. Resolving one is not
  // resolving a work item, and the package has a distinct outcome for it.
  if (item?.pull_request) {
    return {
      ...target,
      outcome: "resolved-wrong-kind",
      detail: "reference resolves to a pull request, not a work item",
      title: typeof item.title === "string" ? item.title : undefined,
    };
  }

  return {
    ...target,
    outcome: "resolved",
    title: typeof item?.title === "string" ? item.title : undefined,
  };
}

async function main() {
  const policy = readPolicy();
  const trackerScope = process.env.GITHUB_REPOSITORY;
  if (!trackerScope) fail("GITHUB_REPOSITORY is not set");

  const labels = readLabels();
  const description = process.env.PR_BODY ?? "";
  const host = trackerHost();

  const observation = {
    eventKind: process.env.GITHUB_EVENT_NAME ?? "unknown",
    description,
    authorId: process.env.PR_AUTHOR ?? "",
    headRef: process.env.PR_HEAD_REF ?? "",
    // An unreadable label list is passed through as-is rather than replaced
    // with []: the package's own shape guard turns it into a named
    // indeterminate reason, where an empty array would have silently disabled
    // every label exemption and still claimed to have evaluated the change.
    labels: labels ?? null,
    trackerScope,
    // Omitted rather than defaulted when the runner did not say. A host
    // invented here would be this script asserting, on no evidence, that an
    // unfamiliar tracker is the familiar one.
    ...(host ? { trackerHost: host } : {}),
  };

  // The package owns reference grammar, so extraction and parsing come from it
  // rather than from a regex re-invented here that could drift from what the
  // check itself will look for.
  const raw = extractTaskReferenceText(description, policy.recordLabels ?? []);
  const reference = raw ? parseTaskReference(raw, trackerScope) : undefined;

  if (reference) {
    // Both halves, never just the scope. A reference whose URL names another
    // tracker can carry this repository's exact owner and name, so comparing
    // the path alone reads it as local and sends the lookup here -- the
    // retargeting this whole split exists to prevent. A reference that names
    // no host names no tracker, and is read as naming this one.
    const sameScope = reference.scope.toLowerCase() === trackerScope.toLowerCase();
    const sameHost = reference.host === undefined || (host !== undefined && reference.host.toLowerCase() === host.toLowerCase());
    observation.item =
      sameScope && sameHost
        ? await lookupItem(reference.scope, host, reference.number, process.env.GH_TOKEN)
        : {
            outcome: "not-attempted",
            detail:
              `reference names ${reference.host ? `${reference.host}/` : ""}${reference.scope}, ` +
              `outside ${host ? `${host}/` : ""}${trackerScope}, which is what this job's credential reads`,
          };
  }

  if (observation.item && !TASK_ITEM_LOOKUP_OUTCOMES.includes(observation.item.outcome)) {
    fail(`produced an outcome outside the package's vocabulary: ${observation.item.outcome}`);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: VERIFY_STANDARDS_INPUTS_VERSION,
        taskRecord: { observation, policy },
      },
      null,
      2,
    )}\n`,
  );
}

await main();
