// @vitest-environment node
import { readFileSync, existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const skillRoot = resolve(root, "skill");
interface Manifest { name: string; bin: Record<string, string>; exports: Record<string, unknown> }
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as Manifest;

/** Discover companions from the router, then follow their local Markdown links. */
function documents(): Map<string, string> {
  const pending = [resolve(skillRoot, "SKILL.md")];
  const found = new Map<string, string>();
  while (pending.length) {
    const path = pending.shift()!;
    if (found.has(path)) continue;
    expect(existsSync(path), `missing skill companion ${relative(root, path)}`).toBe(true);
    const text = readFileSync(path, "utf8");
    found.set(path, text);
    const links = [...text.matchAll(/\[[^\]]+\]\(([^)]+\.md)(?:#[^)]*)?\)/g)].map(match => resolve(dirname(path), match[1]!));
    // Launcher-managed SKILL.md retains these installed-package references.
    const installed = [...text.matchAll(/node_modules\/@clossys\/designer\/skill\/([a-z0-9-]+\.md)/g)].map(match => resolve(skillRoot, match[1]!));
    for (const target of [...links, ...installed]) {
      expect(relative(skillRoot, target).startsWith(".."), `companion escapes skill directory: ${target}`).toBe(false);
      pending.push(target);
    }
  }
  return found;
}

function commands(text: string): string[] {
  return [...new Set([...text.matchAll(/\bdesigner-[a-z][a-z0-9]*(?:-[a-z0-9]+)*\b/g)].map(match => match[0]))];
}
function subpaths(text: string): string[] {
  return [...new Set([...text.matchAll(/@clossys\/designer\/([a-z0-9][a-z0-9/.-]*)/g)].map(match => `./${match[1]!.replace(/[.,]+$/, "")}`))]
    .filter(path => !path.startsWith("./skill/"));
}

describe("installed Designer skill contract", () => {
  it("ships companions and runtime inventory without recursive script tests", () => {
    const docs = documents();
    expect(docs.size).toBeGreaterThan(1);
    expect(docs.has(resolve(skillRoot, "library-needs.md"))).toBe(true);
    const packed = spawnSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], {
      cwd: root, encoding: "utf8", timeout: 30_000,
    });
    expect(packed.status, packed.stderr).toBe(0);
    const result = JSON.parse(packed.stdout) as { files: { path: string }[] }[];
    const files = new Set(result[0]!.files.map(file => file.path));
    for (const path of docs.keys()) expect(files.has(relative(root, path)), `not packed: ${relative(root, path)}`).toBe(true);
    for (const [command, target] of Object.entries(manifest.bin)) {
      expect(files.has(target), `bin target missing for ${command}: ${target}`).toBe(true);
    }
    expect([...files].filter(path => path.startsWith("scripts/") && /\.test\.[^/]+$/.test(path))).toEqual([]);
    for (const path of [
      "scripts/check-ref-verbatim.mjs", "scripts/check-ref-verbatim.d.ts",
      "scripts/ref-verbatim/adaptations.mjs", "scripts/ref-verbatim/data-fit.mjs",
      "scripts/ref-verbatim/diff.mjs", "scripts/ref-verbatim/normalize.mjs", "scripts/ref-verbatim/typescript.mjs",
      "scripts/ref-verbatim/baseline.json", "scripts/ref-verbatim/owner-needs.json",
      "references/manifest.json", "scripts/check-section-tokens.mjs",
      "src/catalog/slots/sections.json", "src/catalog/slots/frames.json",
      "src/catalog/slot-contracts/sections.json", "src/catalog/slot-contracts/frames.json",
    ]) expect(files.has(path), `runtime inventory missing: ${path}`).toBe(true);
  }, 35_000);

  it("declares every designer command named by the skill and companions as a bin", () => {
    const named = commands([...documents().values()].join("\n"));
    expect(named.length).toBeGreaterThan(0);
    for (const command of named) expect(manifest.bin, `unshipped command ${command}`).toHaveProperty(command);
  });

  it("exports every public Designer subpath named by the skill and companions", () => {
    const named = subpaths([...documents().values()].join("\n"));
    expect(named.length).toBeGreaterThan(0);
    for (const subpath of named) expect(Object.hasOwn(manifest.exports, subpath), `unexported subpath ${subpath}`).toBe(true);
  });

});
