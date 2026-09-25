#!/usr/bin/env node
// validate-review-relay-event — accept or refuse the one small record that
// .github/workflows/conversation-safety-review-relay.yml uploads for a
// pull_request_review or pull_request_review_comment event.
//
//   node scripts/validate-review-relay-event.mjs <record.json> --repo <owner/repo>
//
// On success, prints GitHub Actions step outputs (key=value lines) naming the
// event, the pull request number, and the review id or comment id, and exits
// 0. Exit 1 = the record was read and refused. Exit 2 = usage error, or the
// record could not be read at all.
//
// WHY THE RECORD IS UNTRUSTED
// ---------------------------
// The relay runs on review events, and for those events GitHub loads the
// workflow file from the pull request's merge commit. A pull request can
// therefore change what the relay uploads. The relay is kept credential-free
// for exactly that reason, and conversation-safety.yml, which does hold the
// denylist and a write token, treats the record as data: this script accepts
// only an exact key set, integer identifiers, a known event name, and this
// repository. The review or comment TEXT is never carried in the record; the
// consuming workflow fetches it from the API by id, so a forged record can at
// most name a review or comment that really exists on the named pull request.
//
// Refusal messages never echo a value from the record. It is untrusted input
// and this script's output lands in a public Actions log.

import { readFileSync, statSync } from "node:fs";

export const RELAY_RECORD_MAX_BYTES = 1024;

export const RELAY_EVENTS = Object.freeze(["pull_request_review", "pull_request_review_comment"]);

const RECORD_KEYS = Object.freeze(["comment_id", "event", "pull_request", "repository", "review_id"]);

const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export class RelayRecordError extends Error {
  constructor(message) {
    super(message);
    this.name = "RelayRecordError";
  }
}

function isPositiveId(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Parse and validate one relay record.
 *
 * @param {string} raw - the record file's text
 * @param {string} expectedRepository - `owner/repo` of the repository this
 *   workflow runs in (GITHUB_REPOSITORY), never a value from the record
 * @returns {{ event: string, repository: string, pullRequest: number,
 *   reviewId: number | null, commentId: number | null }}
 * @throws {RelayRecordError} on any deviation from the expected shape
 */
export function parseReviewRelayRecord(raw, expectedRepository) {
  if (typeof expectedRepository !== "string" || !REPOSITORY_PATTERN.test(expectedRepository)) {
    throw new RelayRecordError("expected repository must be an owner/repo string");
  }
  if (typeof raw !== "string") throw new RelayRecordError("record must be text");
  if (Buffer.byteLength(raw, "utf8") > RELAY_RECORD_MAX_BYTES) {
    throw new RelayRecordError(`record exceeds ${RELAY_RECORD_MAX_BYTES} bytes`);
  }

  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    throw new RelayRecordError("record is not valid JSON");
  }
  if (record === null || typeof record !== "object" || Array.isArray(record) || Object.getPrototypeOf(record) !== Object.prototype) {
    throw new RelayRecordError("record must be a JSON object");
  }

  const keys = Object.keys(record).sort();
  if (keys.length !== RECORD_KEYS.length || keys.some((key, i) => key !== RECORD_KEYS[i])) {
    throw new RelayRecordError(`record must have exactly the keys ${RECORD_KEYS.join(", ")}`);
  }

  if (!RELAY_EVENTS.includes(record.event)) {
    throw new RelayRecordError(`event must be one of ${RELAY_EVENTS.join(", ")}`);
  }
  if (record.repository !== expectedRepository) {
    throw new RelayRecordError("repository does not match the repository this workflow runs in");
  }
  if (!isPositiveId(record.pull_request)) {
    throw new RelayRecordError("pull_request must be a positive integer");
  }

  if (record.event === "pull_request_review") {
    if (!isPositiveId(record.review_id)) throw new RelayRecordError("review_id must be a positive integer for pull_request_review");
    if (record.comment_id !== null) throw new RelayRecordError("comment_id must be null for pull_request_review");
  } else {
    if (!isPositiveId(record.comment_id)) {
      throw new RelayRecordError("comment_id must be a positive integer for pull_request_review_comment");
    }
    if (record.review_id !== null) throw new RelayRecordError("review_id must be null for pull_request_review_comment");
  }

  return Object.freeze({
    event: record.event,
    repository: record.repository,
    pullRequest: record.pull_request,
    reviewId: record.review_id,
    commentId: record.comment_id,
  });
}

/** Render a validated record as GitHub Actions step-output lines. */
export function formatStepOutputs(record) {
  return [
    `event=${record.event}`,
    `pull_request=${record.pullRequest}`,
    `review_id=${record.reviewId ?? ""}`,
    `comment_id=${record.commentId ?? ""}`,
    "",
  ].join("\n");
}

function main(argv) {
  const usage = "usage: node scripts/validate-review-relay-event.mjs <record.json> --repo <owner/repo>";
  const repoIndex = argv.indexOf("--repo");
  const repository = repoIndex >= 0 ? argv[repoIndex + 1] : undefined;
  const positional = argv.filter((arg, i) => !arg.startsWith("--") && i !== repoIndex + 1);
  if (argv.length !== 3 || repoIndex < 0 || repository === undefined || positional.length !== 1) {
    console.error(`validate-review-relay-event: ${usage}`);
    return 2;
  }

  const path = positional[0];
  let raw;
  try {
    // Size first, so an oversized upload is refused without being read.
    if (statSync(path).size > RELAY_RECORD_MAX_BYTES) {
      console.error(`validate-review-relay-event: refused: record exceeds ${RELAY_RECORD_MAX_BYTES} bytes`);
      return 1;
    }
    raw = readFileSync(path, "utf8");
  } catch (error) {
    console.error(`validate-review-relay-event: cannot read the relay record (${error.code ?? "error"})`);
    return 2;
  }

  try {
    process.stdout.write(formatStepOutputs(parseReviewRelayRecord(raw, repository)));
    return 0;
  } catch (error) {
    if (error instanceof RelayRecordError) {
      console.error(`validate-review-relay-event: refused: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = main(process.argv.slice(2));
}
