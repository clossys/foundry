/**
 * Class check for the flat slot model: every deterministic agent verb runs against the
 * repository's own `clossys/` folder (brief and compile verbs exit 0; check verbs run in full and exit 0
 * or 1, their red gated by root `check:agents`), and no Producer source still names the
 * retired tree/cell layout or its HTTP route.
 *
 * `check` and `produce` are excluded: `check` is the repository-wide finding report (owner
 * decisions such as unpinned slots are findings by design), and `produce` is a long-running
 * server covered by server.test.ts. Test files and `__fixtures__` are excluded from the source
 * scan because they assert that the retired names are gone (for example a 404 on the old route).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { repoConsumer, runVerb } from "./__fixtures__/flat-consumer.js";

const root = dirname(repoConsumer);
const producer = join(root, "packages", "producer");
const VERBS: readonly (readonly string[])[] = [
  ["direct", "--check"], ["direct", "--brief"], ["direct"],
  ["design", "--check"], ["design", "--brief"], ["design"],
  ["write", "--check"], ["write", "--brief"], ["write"],
  ["publish"],
];

// Built from parts so this file does not match itself.
const RETIRED = [["tree", "json"].join("\\."), ["cells", "/"].join(""), ["/api", "cells"].join("/")];
const RETIRED_PATTERN = new RegExp(RETIRED.join("|"));
const CODE = /\.(?:ts|tsx|js|mjs|cjs)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "__fixtures__"]);

function codeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return SKIP_DIRS.has(name) ? [] : codeFiles(path);
    return CODE.test(name) && !/\.test\.[cm]?[jt]sx?$/.test(name) ? [path] : [];
  });
}

describe("flat slot model class check", () => {
  for (const args of VERBS) {
    // A check verb (`--check`, bare `publish`) carries its agent's share of the strict findings, so on the
    // repository it exits 1 until those are fixed; that red is gated by root `check:agents`. Here it must run in
    // full (never 2) and report what it found; brief and compile verbs must still exit 0.
    const checkVerb = args.includes("--check") || (args.length === 1 && args[0] === "publish");
    it(`clossys ${args.join(" ")} ${checkVerb ? "runs in full" : "exits 0"} on the repository clossys/`, () => {
      const result = runVerb([...args, "--root", root], root);
      const head = (result.value?.message ?? result.stdout ?? "").split("\n")[0];
      if (!checkVerb) { expect({ status: result.status, head, stderr: result.stderr.slice(0, 400) }).toMatchObject({ status: 0 }); return; }
      expect([0, 1], `${head}\n${result.stderr.slice(0, 400)}`).toContain(result.status);
      expect(result.value.exitCode).toBe(result.status);
    }, 180_000);
  }

  it("no Producer source names the retired tree or cell layout", () => {
    const hits = ["src", "studio"].flatMap(dir => codeFiles(join(producer, dir)))
      .flatMap(path => readFileSync(path, "utf8").split("\n")
        .flatMap((line, index) => RETIRED_PATTERN.test(line) ? [`${relative(producer, path)}:${index + 1}: ${line.trim().slice(0, 160)}`] : []));
    expect(hits).toEqual([]);
  }, 60_000);
});
