/**
 * `clossys run` from an installed Producer reaches only what the packages ship. Every chain command a
 * default run executes is either a clossys verb (in-package code) or a traced command whose files sit
 * inside the step's own package and are listed in its package.json `files`: never a repository
 * script, a Studio file or a sibling package's source. Foundry's own Studio build steps run only on
 * demand (`clossys run --studio`), from a Foundry checkout.
 */
import { readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { describe, expect, it } from "vitest";
import { chainCommand, packageDir } from "./chain.js";
import { PACKAGE_ROOT } from "./options.js";
import { STEPS } from "./steps/index.js";

interface Manifest { readonly files?: readonly string[]; readonly scripts?: Readonly<Record<string, string>> }
const manifest = (dir: string): Manifest => JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Manifest;

/** Whether `npm pack` ships `file` under this `files` list (plain entries and `!` exclusions; no globs in the paths checked here). */
function shipped(files: readonly string[], file: string): boolean {
  const covers = (entry: string) => file === entry || file.startsWith(`${entry.replace(/\/$/, "")}/`);
  const excluded = files.filter(entry => entry.startsWith("!")).some(entry => {
    const pattern = entry.slice(1).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "(?:.*/)?").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*");
    return new RegExp(`^${pattern}$`).test(file);
  });
  return !excluded && files.filter(entry => !entry.startsWith("!")).some(covers);
}

/** The files one shell command names, following `npm run <script>` through the package's scripts. */
function filesOf(command: string, dir: string, seen = new Set<string>()): string[] {
  const out: string[] = [];
  for (const part of command.split(/&&|\|\||;/).map(text => text.trim()).filter(Boolean)) {
    const words = part.split(/\s+/);
    if (words[0] === "npm" && words[1] === "run") {
      const name = words.find((word, index) => index > 1 && !word.startsWith("-"))!;
      const script = manifest(dir).scripts?.[name];
      if (script === undefined) { out.push(`<missing npm script ${name}>`); continue; }
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(...filesOf(script, dir, seen));
    } else if (words[0] === "node") out.push(words.slice(1).find(word => !word.startsWith("-"))!);
    else if (words[0] === "clossys") continue;
    else out.push(`<unshipped command ${words[0]}>`);
  }
  return out;
}

describe("clossys run from tarballs", () => {
  const root = "/consumer";
  const rows = STEPS.flatMap(step => {
    const command = chainCommand(step, root, PACKAGE_ROOT);
    if ("skip" in command) return [];
    const text = typeof step.chain === "string" ? step.chain : step.run ?? "";
    // chainCommand drops the first word: a verb row is in-package code only when that word is clossys.
    if (command.argv[0] !== "pipeline" || command.argv[1] !== "trace") return [{ step: step.id, files: [] as string[], problems: text.startsWith("clossys ") ? [] : [`not a clossys verb: ${text}`] }];
    const dir = packageDir(step, PACKAGE_ROOT);
    const traced = command.argv.slice(command.argv.indexOf("--") + 1).join(" ");
    const files = filesOf(traced, dir);
    const list = manifest(dir).files ?? [];
    const problems = files.filter(file => file.startsWith("<") || normalize(file).startsWith("..") || file.startsWith("/") || !shipped(list, normalize(file).split("\\").join("/")));
    return [{ step: step.id, files, problems }];
  });

  it("runs some traced command, so the check below bites", () => {
    expect(rows.some(row => row.files.length > 0)).toBe(true);
  });

  it("runs only files its own package ships", () => {
    expect(rows.filter(row => row.problems.length)).toEqual([]);
  });

  it("names a repository script as unshipped (the check is not vacuous)", () => {
    const studio = STEPS.find(step => step.id === "studio.map")!;
    const command = chainCommand(studio, root, PACKAGE_ROOT, ["--studio"]);
    expect("argv" in command).toBe(true);
    const dir = packageDir(studio, PACKAGE_ROOT);
    const traced = "argv" in command ? command.argv.slice(command.argv.indexOf("--") + 1).join(" ") : "";
    const files = filesOf(traced, dir);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some(file => !shipped(manifest(dir).files ?? [], normalize(file)))).toBe(true);
  });

  it("skips Foundry's own Studio build steps unless --studio asks for them", () => {
    for (const id of ["studio.map", "specimen.evidence", "studio.compose", "build.receipt", "studio.checks"]) {
      const step = STEPS.find(candidate => candidate.id === id)!;
      expect(chainCommand(step, root, PACKAGE_ROOT), id).toMatchObject({ onDemand: "--studio" });
      expect("argv" in chainCommand(step, root, PACKAGE_ROOT, ["--studio"]), id).toBe(true);
    }
  });
});
