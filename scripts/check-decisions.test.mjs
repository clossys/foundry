import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkDecisions } from "./check-decisions.mjs";

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "check-decisions.mjs");
const CANDIDATE = '{\n  "name": "example"\n}\n';
const sha = (text) => createHash("sha256").update(text).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

// One consumer with a pinned slot, a not-needed slot and an open slot, all valid. Each test
// then breaks exactly one thing.
function withRepo(fn) {
  const repo = mkdtempSync(join(tmpdir(), "check-decisions-test-"));
  try {
    const agent = join(repo, "clossys", "agents", "designer");
    const slot = (id, doc = {}) => {
      mkdirSync(join(agent, id, "candidates"), { recursive: true });
      writeFileSync(join(agent, id, "slot.json"), json({ schema: "clossys.slot/1", id, ...doc }));
      return join(agent, id);
    };
    const pinned = slot("components.pinned");
    writeFileSync(join(pinned, "candidates", "example-v1.json"), CANDIDATE);
    writeFileSync(join(pinned, "pin.json"), json({ candidate: "example-v1.json", sha256: sha(CANDIDATE), decidedBy: "owner", at: "2026-11-03T00:00:00.000Z" }));
    const notNeeded = slot("components.unused", { notNeeded: { reason: "No toolbar.", since: "2026-11-03", decidedBy: "owner" } });
    slot("components.open");
    fn({ repo, consumer: join(repo, "clossys"), pinned, notNeeded });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}
const rules = (consumer) => checkDecisions(consumer).findings.map((row) => row.rule);
const editPin = (dir, change) => {
  const path = join(dir, "pin.json");
  writeFileSync(path, json(change(JSON.parse(readFileSync(path, "utf8")))));
};

test("valid decision records pass and are counted pinned, not-needed and open", () => {
  withRepo(({ repo, consumer }) => {
    assert.deepEqual(checkDecisions(consumer), { findings: [], counts: { pinned: 1, "not-needed": 1, open: 1 } });
    const run = spawnSync(process.execPath, [scriptPath, "--repo", repo], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stdout + run.stderr);
  });
});

test("a pin whose hash differs from the candidate file fails", () => {
  withRepo(({ repo, consumer, pinned }) => {
    writeFileSync(join(pinned, "candidates", "example-v1.json"), CANDIDATE.replace("example", "edited"));
    assert.deepEqual(rules(consumer), ["pin-hash"]);
    assert.equal(spawnSync(process.execPath, [scriptPath, "--repo", repo]).status, 1);
  });
});

test("a pin missing decidedBy or at fails, including the pre-CLI pinnedBy shape", () => {
  withRepo(({ consumer, pinned }) => {
    editPin(pinned, ({ decidedBy, ...rest }) => rest);
    assert.deepEqual(rules(consumer), ["pin-shape"]);
    editPin(pinned, ({ ...rest }) => ({ ...rest, pinnedBy: "owner:x" }));
    assert.deepEqual(rules(consumer), ["pin-shape", "pin-shape"]);
    editPin(pinned, ({ pinnedBy, at, ...rest }) => ({ ...rest, decidedBy: "owner" }));
    assert.deepEqual(rules(consumer), ["pin-shape"]);
  });
});

test("a pin naming a missing candidate fails", () => {
  withRepo(({ consumer, pinned }) => {
    editPin(pinned, (pin) => ({ ...pin, candidate: "example-v9.json" }));
    assert.deepEqual(rules(consumer), ["pin-candidate"]);
  });
});

test("a slot both pinned and not needed fails", () => {
  withRepo(({ consumer, pinned, notNeeded }) => {
    writeFileSync(join(notNeeded, "pin.json"), readFileSync(join(pinned, "pin.json")));
    writeFileSync(join(notNeeded, "candidates", "example-v1.json"), CANDIDATE);
    assert.deepEqual(rules(consumer), ["both"]);
  });
});

test("a not-needed marker without decidedBy fails", () => {
  withRepo(({ consumer, notNeeded }) => {
    writeFileSync(join(notNeeded, "slot.json"), json({ schema: "clossys.slot/1", notNeeded: { reason: "No toolbar.", since: "2026-11-03" } }));
    assert.deepEqual(rules(consumer), ["not-needed-shape"]);
  });
});
