import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  RELAY_RECORD_MAX_BYTES,
  RelayRecordError,
  formatStepOutputs,
  parseReviewRelayRecord,
} from "./validate-review-relay-event.mjs";

const REPO = "example-owner/example-repo";
const script = fileURLToPath(new URL("./validate-review-relay-event.mjs", import.meta.url));

const review = { event: "pull_request_review", repository: REPO, pull_request: 42, review_id: 3000000001, comment_id: null };
const comment = { event: "pull_request_review_comment", repository: REPO, pull_request: 42, review_id: null, comment_id: 2000000002 };

function refuses(record, pattern) {
  const raw = typeof record === "string" ? record : JSON.stringify(record);
  assert.throws(() => parseReviewRelayRecord(raw, REPO), (error) => error instanceof RelayRecordError && pattern.test(error.message));
}

test("accepts a pull_request_review record", () => {
  assert.deepEqual({ ...parseReviewRelayRecord(JSON.stringify(review), REPO) }, {
    event: "pull_request_review",
    repository: REPO,
    pullRequest: 42,
    reviewId: 3000000001,
    commentId: null,
  });
});

test("accepts a pull_request_review_comment record", () => {
  const parsed = parseReviewRelayRecord(JSON.stringify(comment), REPO);
  assert.equal(parsed.commentId, 2000000002);
  assert.equal(parsed.reviewId, null);
});

test("formats validated records as step outputs with empty strings for null ids", () => {
  assert.equal(
    formatStepOutputs(parseReviewRelayRecord(JSON.stringify(review), REPO)),
    "event=pull_request_review\npull_request=42\nreview_id=3000000001\ncomment_id=\n",
  );
  assert.equal(
    formatStepOutputs(parseReviewRelayRecord(JSON.stringify(comment), REPO)),
    "event=pull_request_review_comment\npull_request=42\nreview_id=\ncomment_id=2000000002\n",
  );
});

test("refuses anything that is not a plain JSON object", () => {
  refuses("not json", /not valid JSON/);
  refuses("[]", /JSON object/);
  refuses("null", /JSON object/);
  refuses("42", /JSON object/);
});

test("refuses missing, extra, or text-carrying keys", () => {
  const { comment_id: _omitted, ...missing } = review;
  refuses(missing, /exactly the keys/);
  refuses({ ...review, body: "text" }, /exactly the keys/);
  refuses(`{"__proto__":{"x":1},${JSON.stringify(review).slice(1)}`, /exactly the keys/);
});

test("refuses unknown events and another repository", () => {
  refuses({ ...review, event: "issue_comment" }, /event must be one of/);
  refuses({ ...review, event: "pull_request_target" }, /event must be one of/);
  refuses({ ...review, repository: "other-owner/example-repo" }, /repository does not match/);
  refuses({ ...review, repository: "EXAMPLE-OWNER/example-repo" }, /repository does not match/);
});

test("refuses non-integer, non-positive, string, or unsafe ids", () => {
  for (const bad of [0, -1, 1.5, "42", Number.MAX_SAFE_INTEGER + 2, null, true, [42], { n: 42 }]) {
    refuses({ ...review, pull_request: bad }, /pull_request must be a positive integer/);
    refuses({ ...review, review_id: bad }, /review_id must be a positive integer/);
    refuses({ ...comment, comment_id: bad }, /comment_id must be a positive integer/);
  }
  refuses('{"event":"pull_request_review","repository":"' + REPO + '","pull_request":1e400,"review_id":1,"comment_id":null}', /pull_request/);
});

test("refuses an id for the other event kind", () => {
  refuses({ ...review, comment_id: 7 }, /comment_id must be null/);
  refuses({ ...comment, review_id: 7 }, /review_id must be null/);
});

test("refuses oversized records before parsing", () => {
  const padded = `{${" ".repeat(RELAY_RECORD_MAX_BYTES)}${JSON.stringify(review).slice(1)}`;
  refuses(padded, /exceeds/);
});

test("refuses an invalid expected repository argument", () => {
  assert.throws(() => parseReviewRelayRecord(JSON.stringify(review), "not a repo"), RelayRecordError);
  assert.throws(() => parseReviewRelayRecord(JSON.stringify(review), undefined), RelayRecordError);
});

test("CLI: exit 0 with outputs, exit 1 on refusal without echoing record values, exit 2 on usage or unreadable input", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-record-"));
  try {
    const good = join(dir, "good.json");
    writeFileSync(good, JSON.stringify(review));
    const ok = spawnSync(process.execPath, [script, good, "--repo", REPO], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout, "event=pull_request_review\npull_request=42\nreview_id=3000000001\ncomment_id=\n");

    const marker = "SHOULD-NOT-BE-ECHOED";
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ ...review, repository: `${marker}/x` }));
    const refused = spawnSync(process.execPath, [script, bad, "--repo", REPO], { encoding: "utf8" });
    assert.equal(refused.status, 1);
    assert.equal(refused.stdout, "");
    assert.doesNotMatch(refused.stderr, new RegExp(marker));

    const huge = join(dir, "huge.json");
    writeFileSync(huge, " ".repeat(RELAY_RECORD_MAX_BYTES + 1));
    assert.equal(spawnSync(process.execPath, [script, huge, "--repo", REPO], { encoding: "utf8" }).status, 1);

    assert.equal(spawnSync(process.execPath, [script, join(dir, "missing.json"), "--repo", REPO], { encoding: "utf8" }).status, 2);
    assert.equal(spawnSync(process.execPath, [script, good], { encoding: "utf8" }).status, 2);
    assert.equal(spawnSync(process.execPath, [script, good, "--repo", REPO, "extra"], { encoding: "utf8" }).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
