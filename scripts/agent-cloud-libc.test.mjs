import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const muslEntry = lock.packages["node_modules/lightningcss-linux-x64-musl"];
const glibcEntry = lock.packages["node_modules/@tailwindcss/node/node_modules/lightningcss-linux-x64-gnu"];

test("locked Lightning CSS metadata keeps musl packages out of a glibc install", () => {
  const root = mkdtempSync(join(tmpdir(), "foundry-libc-fixture-"));
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const run = (args, cwd = root) => execFileSync(npm, args, { cwd, encoding: "utf8", stdio: "pipe" });
  try {
    const optionalDependencies = {};
    for (const [name, entry] of [["libc-fixture-musl", muslEntry], ["libc-fixture-glibc", glibcEntry]]) {
      assert.ok(entry, `the lock must contain ${name}'s native package metadata`);
      const source = join(root, name);
      mkdirSync(source);
      // Use the real lock's platform constraints with synthetic, local package
      // bytes. This exercises npm's installer without registry or native code.
      writeFileSync(join(source, "package.json"), JSON.stringify({
        name,
        version: "1.0.0",
        os: entry.os,
        cpu: entry.cpu,
        libc: entry.libc,
      }));
      const [packed] = JSON.parse(run(["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", root], source));
      optionalDependencies[name] = `file:${join(root, packed.filename)}`;
    }
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "libc-fixture-root",
      version: "1.0.0",
      private: true,
      optionalDependencies,
    }));
    run(["install", "--package-lock-only", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"]);
    run(["ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--os=linux", "--cpu=x64", "--libc=glibc"]);
    assert.ok(existsSync(join(root, "node_modules/libc-fixture-glibc/package.json")), "the glibc package must be installed");
    assert.equal(existsSync(join(root, "node_modules/libc-fixture-musl/package.json")), false, "the musl package must be omitted on glibc");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
