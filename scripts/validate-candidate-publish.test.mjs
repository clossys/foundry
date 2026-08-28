import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { argsFrom, freezeTarball } from "./validate-candidate-publish.mjs";

test("publish validator has a closed CLI and rejects traversal or bootstrap authorization flags", () => {
  const argv = ["node", "script", "--package", "controller", "--tarball", "candidate.tgz", "--transcript", "result.json", "--mode", "prepublish"];
  assert.deepEqual(argsFrom(argv), { package: "controller", tarball: "candidate.tgz", transcript: "result.json", mode: "prepublish" });
  for (const mutation of [["--unknown", "x"], ["--package", "../controller"], ["--mode", "other"], ["--package", "again"]]) assert.throws(() => argsFrom([...argv, ...mutation]), /Usage:/);
});
test("validator freezes the supplied tarball before a source path replacement", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "publish-validator-test-")); t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "candidate.tgz"); await writeFile(source, "first bytes");
  const frozen = freezeTarball(source); await writeFile(source, "replacement bytes");
  try { assert.equal((await readFile(frozen.tarball, "utf8")), "first bytes"); } finally { frozen.cleanup(); }
});
