import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const cli = fileURLToPath(new URL("./run-candidate-qualification.mjs", import.meta.url));

async function rejects(args) {
  await assert.rejects(() => execFile(process.execPath, [cli, ...args]), /Usage: --package/);
}

test("CLI rejects unknown, duplicate, missing, and path-traversal package flags before filesystem access", async () => {
  await rejects(["--unknown", "x", "--package", "controller", "--tarball", "candidate.tgz", "--output", "out.json"]);
  await rejects(["--package", "controller", "--package", "again", "--tarball", "candidate.tgz", "--output", "out.json"]);
  await rejects(["--package", "../controller", "--tarball", "candidate.tgz", "--output", "out.json"]);
  await rejects(["--package", "controller", "--tarball", "candidate.tgz"]);
});
test("CLI rejects a credential-bearing parent before it can inspect a candidate", async () => {
  await assert.rejects(() => execFile(process.execPath, [cli, "--package", "controller", "--tarball", "candidate.tgz", "--output", "out.json"], { env: { PATH: process.env.PATH, NODE_AUTH_TOKEN: "secret" } }), /credential-bearing/);
});
