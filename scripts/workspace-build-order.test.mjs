import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");

// Exercise the shipped shell commands without installing or compiling a
// workspace. Designer's clean-build prerequisite is represented by a marker
// that only Strategist's build can create; a later build cannot repair it.
function runCommands(t, commands) {
  const cwd = mkdtempSync(join(tmpdir(), "workspace-build-order-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const bin = join(cwd, "bin");
  mkdirSync(bin);
  for (const name of ["controller", "designer", "writer", "locksmith", "strategist"]) {
    mkdirSync(join(cwd, "packages", name), { recursive: true });
  }
  const npm = join(bin, "npm");
  writeFileSync(npm, `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
function build(name) {
  fs.appendFileSync("commands.log", name + "\\n");
  if (name === "designer" && !fs.existsSync("strategist-built")) {
    console.error("Designer cannot resolve Strategist's shipped declarations before Strategist builds");
    process.exit(17);
  }
  fs.writeFileSync(name + "-built", "built");
}
if (args[0] === "ci") process.exit(0);
if (args[0] === "run" && args[1] === "check:contrast") {
  process.exit(fs.existsSync("designer-built") ? 0 : 18);
}
if (args[0] !== "run" || args[1] !== "build") process.exit(19);
const workspace = args.find(arg => arg.startsWith("--workspace="));
if (workspace) build(workspace.slice("--workspace=packages/".length));
else if (args.includes("--workspaces")) {
  for (const name of fs.readdirSync("packages").sort()) build(name);
} else process.exit(20);
`);
  chmodSync(npm, 0o755);
  const result = spawnSync("/bin/sh", ["-c", commands.join(" && ")], {
    cwd,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    encoding: "utf8",
  });
  return {
    ...result,
    builds: readFileSync(join(cwd, "commands.log"), "utf8").trim().split("\n"),
  };
}

function jobCommands(id) {
  const lines = workflow.split("\n");
  const start = lines.indexOf(`  ${id}:`);
  assert.ok(start >= 0, `the ${id} job exists`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(line => /^  [a-z][a-z0-9-]*:/.test(line));
  const job = rest.slice(0, end < 0 ? undefined : end).join("\n");
  const commands = [...job.matchAll(/^      - run: (.+)$/gm)].map(match => match[1]);
  assert.ok(commands.length > 0, `the ${id} job has executable commands`);
  return commands;
}

test("the root build prepares Strategist declarations before Designer", t => {
  const result = runCommands(t, [manifest.scripts.build]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.builds.indexOf("strategist") < result.builds.indexOf("designer"));
});

for (const id of ["contrast", "designer-contrast"]) {
  test(`${id} builds Strategist before Designer and runs contrast`, t => {
    const commands = jobCommands(id);
    assert.equal(commands.at(-1), "npm run check:contrast");
    const result = runCommands(t, commands);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.builds, ["strategist", "designer"]);
  });
}

test("a Designer-first mutation fails before the remaining workspace builds", t => {
  const result = runCommands(t, [
    "npm run build --workspace=packages/designer && npm run build --workspace=packages/strategist && npm run build --workspaces --if-present",
  ]);
  assert.equal(result.status, 17);
  assert.match(result.stderr, /cannot resolve Strategist's shipped declarations/);
  assert.deepEqual(result.builds, ["designer"]);
});
