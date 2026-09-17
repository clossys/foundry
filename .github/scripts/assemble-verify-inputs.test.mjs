// What this proves, and why it is built the way it is.
//
// The assembler's job is to say what it observed, including WHERE it looked.
// The failure this guards against is not a crash and not a refusal: it is a
// lookup quietly aimed at this repository for a reference that named another
// one, coming back "resolved", and being reported as a satisfied task record
// over an object the author never referenced. A pass and a failure are then
// both coincidences of what this repository's object of that number happens
// to be.
//
// So every case below is built the one way that can tell a real resolution
// from a retargeted one: the reference names somewhere else, and the number it
// names ALSO exists here. A test that merely feeds a cross-repository
// reference and asserts "it was handled" is satisfied by exactly the defect —
// prefix-stripping handles it, and returns an answer.
//
// The assembled document is fed to the real CLI, not just inspected, because
// the two halves can disagree: a collector that reports the right thing and a
// decision that ignores it is still a false pass. Both run here.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = join(here, "..", "..");
const assembler = join(here, "assemble-verify-inputs.mjs");
const cli = join(repositoryRoot, "packages/inspector/dist/bin.js");

const THIS_REPOSITORY = "clossys/foundry";
const THIS_HOST = "https://github.com";

function assemble(description, { serverUrl = THIS_HOST } = {}) {
  const result = spawnSync(process.execPath, [assembler], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_REPOSITORY: THIS_REPOSITORY,
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_SERVER_URL: serverUrl,
      PR_BODY: description,
      PR_AUTHOR: "a-person",
      PR_HEAD_REF: "topic/thing",
      PR_LABELS_JSON: "[]",
      // No credential: no lookup is attempted, which is exactly the state the
      // substitution below then fills in by hand.
      GH_TOKEN: "",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

// Stand in for the collision: this repository's own object of that number
// exists and reads perfectly well. If the reference is being retargeted here,
// this is what the run would find, and the verdict would be satisfied.
function withLocalObjectResolved(document) {
  const observation = document.taskRecord.observation;
  observation.item = { ...(observation.item ?? {}), outcome: "resolved", title: "an unrelated local object" };
  const path = join(mkdtempSync(join(tmpdir(), "verify-inputs-")), "inputs.json");
  writeFileSync(path, JSON.stringify(document));
  return path;
}

function decide(path) {
  const result = spawnSync(process.execPath, [cli, "--inputs", path, "--checks", "task-record"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  return { exitCode: result.status, output: `${result.stdout}${result.stderr}` };
}

test("a URL reference on another tracker is not answered by this repository's object of that number", () => {
  // The sharpest form of the defect: owner and name are this repository's own,
  // exactly, and only the host differs. A scope comparison that drops the host
  // reads this as local, looks up 73 here, and passes.
  const document = assemble(`Closes: https://other-tracker.invalid/${THIS_REPOSITORY}/issues/73`);
  const item = document.taskRecord.observation.item;
  assert.equal(item.outcome, "not-attempted");
  assert.match(item.detail, /other-tracker\.invalid/);
  assert.equal(document.taskRecord.observation.trackerHost, "github.com");

  const { exitCode, output } = decide(withLocalObjectResolved(document));
  assert.equal(exitCode, 2, output);
  assert.match(output, /indeterminate/);
});

test("a run that states no tracker host reports a host-bearing reference as unverifiable", () => {
  // Silence about the host is not agreement about the host, and inventing a
  // default here is the retargeting wearing a different hat.
  const document = assemble(`Closes: https://other-tracker.invalid/${THIS_REPOSITORY}/issues/73`, { serverUrl: "" });
  assert.equal(document.taskRecord.observation.trackerHost, undefined);
  const { exitCode, output } = decide(withLocalObjectResolved(document));
  assert.equal(exitCode, 2, output);
  assert.match(output, /item-tracker-host-unstated/);
});

test("a qualified cross-repository reference is not answered by this repository either", () => {
  const document = assemble("Closes: synthetic-owner/synthetic-repo#73");
  assert.equal(document.taskRecord.observation.item.outcome, "not-attempted");
  assert.match(document.taskRecord.observation.item.detail, /synthetic-owner\/synthetic-repo/);
  const { exitCode, output } = decide(withLocalObjectResolved(document));
  assert.equal(exitCode, 2, output);
  assert.match(output, /item-outside-tracker-scope/);
});

test("an ordinary reference to this repository still resolves, by number and by URL", () => {
  // The other direction of the proof. A change that only ever refuses is not a
  // gate, it is an outage, and it would be routed around rather than fixed.
  for (const description of [`Closes: #73`, `Closes: ${THIS_HOST}/${THIS_REPOSITORY}/issues/73`]) {
    const document = assemble(description);
    const { exitCode, output } = decide(withLocalObjectResolved(document));
    assert.equal(exitCode, 0, `${description}: ${output}`);
    assert.match(output, /satisfied/);
  }
});

test("a lookup this job actually makes says which repository it examined", () => {
  // Not asserted through the network: the no-credential path deliberately
  // claims no target, because nothing was examined. Stating one there would be
  // the same lie in the opposite direction.
  const document = assemble("Closes: #73");
  const item = document.taskRecord.observation.item;
  assert.equal(item.outcome, "not-attempted");
  assert.equal(item.lookupScope, undefined);
  assert.equal(item.lookupHost, undefined);
});
