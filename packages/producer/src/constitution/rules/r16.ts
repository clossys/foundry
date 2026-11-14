/**
 * R16 Judge independence (slot-constitution.md section 2): the maker never grades itself. Status
 * `building`: reported, never failing a non-strict run (section 4).
 *
 * R16.1 and R16.4 scan source under the workspace root (`ctx.root`), R16.2 reads critique records
 * through the slot reader, R16.3 reads the standard ledgers and the git log of the standards and
 * recipes folders. A check with nothing to judge (no critiques, no standards, no git) reports nothing.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { loadSchema, validateValue } from "../../pipeline/schema.js";
import { listModelDir, readModelText } from "../../records/slots.js";
import { STANDARD_AUTHORS } from "../../records/standards.js";
import { CERTIFY_KEY_FIELDS } from "../criteria/core/verdict.js";
import { isObject, liveSlotRecords } from "../checks/shared.js";
import type { Check, Row, RuleModule, SlotRecord } from "../types.js";
import { standardsWorld } from "./r15.js";

const posix = (path: string) => path.split(sep).join("/");
const codeRow = (check: string, path: string, reason: string): Row => ({ rule: "R16", check, agent: "*", slot: "*", reason, path });
const slotRow = (check: string, slot: SlotRecord, path: string, reason: string, candidate?: string): Row =>
  ({ rule: "R16", check, agent: slot.agent, slot: slot.id, ...(candidate ? { candidate } : {}), reason, path });

/**
 * The judge's source (R16.1): the constitution (criteria, certifiers, check modules), the critic
 * tooling of every agent (`packages/<agent>/actions/critic/`) and the write guards. Workspace-relative.
 */
export const JUDGE_ROOTS = Object.freeze(["packages/producer/src/constitution", "packages/producer/src/records/slot-write.ts", "packages/producer/src/records/standards.ts"]);
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SKIP = new Set(["node_modules", "dist", "__fixtures__", "__tests__"]);

/** The judge source files under `root`, workspace-relative, sorted. */
export function judgeFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    if (!existsSync(abs)) return;
    const stat = statSync(abs);
    if (stat.isFile()) { if (CODE.test(abs) && !TEST.test(abs)) out.push(posix(relative(root, abs))); return; }
    for (const name of readdirSync(abs).sort()) if (!SKIP.has(name)) walk(join(abs, name));
  };
  for (const entry of JUDGE_ROOTS) walk(join(root, entry));
  const packages = join(root, "packages");
  if (existsSync(packages)) for (const name of readdirSync(packages).sort()) walk(join(packages, name, "actions", "critic"));
  return [...new Set(out)].sort();
}

/** Every module specifier a source file imports: static imports and re-exports, dynamic import(), require(). */
export function importSpecifiers(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/(?:^|[\s;])(?:import|export)\s[^'"`;]*?\bfrom\s*["']([^"']+)["']|(?:^|[\s;])import\s*["']([^"']+)["']|\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)|\brequire\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) {
    found.push(match[1] ?? match[2] ?? match[3] ?? match[4]!);
  }
  return found;
}

const RECIPES = /(?:^|\/)packages\/[^/]+\/recipes(?:\/|$)/;
/** Whether a specifier imported from `file` (workspace-relative) lands under packages/(*)/recipes/. */
export function importsRecipe(file: string, specifier: string): boolean {
  if (specifier.startsWith(".")) return RECIPES.test(posix(join(dirname(file), specifier)));
  return /(?:^|\/)recipes(?:\/|$)/.test(specifier.replace(/^@clossys\/[^/]+\//, "")) && /^@clossys\//.test(specifier);
}

/** R16.1: certifiers, critic tooling, check modules and guards import nothing under packages/(*)/recipes/. */
export const r16_1: Check = ctx => {
  const rows: Row[] = [];
  for (const file of judgeFiles(ctx.root)) {
    const source = readFileSync(join(ctx.root, file), "utf8");
    for (const specifier of importSpecifiers(source)) if (importsRecipe(file, specifier)) rows.push(codeRow("R16.1", file, `imports ${specifier}, a recipe: the judge never reads the maker`));
  }
  return rows;
};

/** The roles a critique packet may list and what each ref may be (R16.2). */
/** Maker files a packet never lists: a recipe, its craft notes or generator, a ledger, direction notes, briefs or prompts. */
const MAKER = /(?:^|\/)(?:recipes\/|craft\.md$|generate\.mjs$|ledger\.json$|directions?(?:\/|\.|$)|notes?(?:\/|\.|$)|prompts?(?:\/|\.|$)|brief\.md$)/i;
/** The issues of one critique record's manifest for a slot of `agent` judged by `standard`. */
export function manifestIssues(doc: { standard: string; packet: { manifest: readonly { role: string; ref: string }[] } }, agent: string, slotDir: string): string[] {
  const issues: string[] = [];
  const base = `packages/${agent}/standards/${doc.standard}/`;
  const roles = new Set(doc.packet.manifest.map(item => item.role));
  for (const role of ["taste", "render"]) if (!roles.has(role)) issues.push(`packet manifest lists no ${role}`);
  for (const item of doc.packet.manifest) {
    const ref = item.ref;
    if (MAKER.test(ref)) { issues.push(`packet manifest lists ${ref}: never a recipe file, direction notes or the maker`); continue; }
    if (item.role === "taste" && ref !== `${base}taste.md`) issues.push(`taste ref ${ref} is not ${base}taste.md`);
    if (item.role === "exemplar" && !ref.startsWith(`${base}exemplars/`) && !/^https?:\/\//.test(ref)) issues.push(`exemplar ref ${ref} is not under ${base}exemplars/ or a link`);
    if (item.role === "contract" && ref !== `${slotDir}/slot.json` && ref !== `${slotDir}/slot.json#contract`) issues.push(`contract ref ${ref} is not ${slotDir}/slot.json#contract`);
  }
  return issues;
}

/** R16.2: every critique record is valid and its packet manifest lists only the standard, the contract and the render. */
export const r16_2: Check = ctx => {
  const rows: Row[] = [];
  const schema = loadSchema("critique");
  for (const slot of liveSlotRecords(ctx)) {
    if (!slot.entries.includes("critiques")) continue;
    const dir = join(ctx.root, slot.dir, "critiques");
    for (const name of listModelDir(dir).sort()) {
      const path = `${slot.dir}/critiques/${name}`;
      let value: unknown;
      try { value = JSON.parse(readModelText(join(dir, name))); }
      catch (error) { rows.push(slotRow("R16.2", slot, path, `critique record unreadable: ${(error as Error).message}`)); continue; }
      const issues = validateValue(value, schema);
      if (issues.length) { for (const issue of issues) rows.push(slotRow("R16.2", slot, path, `critique ${issue.path} ${issue.message}`)); continue; }
      const doc = value as { slot: string; candidate: string; standard: string; packet: { manifest: { role: string; ref: string }[] } };
      if (doc.slot !== slot.id) rows.push(slotRow("R16.2", slot, path, `critique names slot ${doc.slot}, not ${slot.id}`, doc.candidate));
      if (name !== `${doc.candidate.replace(/\.[^.]+$/, "")}.json`) rows.push(slotRow("R16.2", slot, path, `critique file ${name} is not named for candidate ${doc.candidate}`, doc.candidate));
      for (const issue of manifestIssues(doc, slot.agent, slot.dir)) rows.push(slotRow("R16.2", slot, path, issue, doc.candidate));
    }
  }
  return rows;
};

/** Commits (non-merge) touching paths under both packages/(*)/standards/ and packages/(*)/recipes/, plus a dirty tree touching both. */
export function mixedChanges(root: string, git: (args: string[]) => string = args => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 })): { commit: string; standards: string[]; recipes: string[] }[] {
  let log: string, status: string;
  try {
    log = git(["log", "--no-merges", "--format=@@%H", "--name-only", "--", ":(glob)packages/*/standards/**", ":(glob)packages/*/recipes/**"]);
    status = git(["status", "--porcelain=v1", "--untracked-files=all", "--", ":(glob)packages/*/standards/**", ":(glob)packages/*/recipes/**"]);
  } catch { return []; }
  const out: { commit: string; standards: string[]; recipes: string[] }[] = [];
  const judge = (commit: string, paths: string[]) => {
    const standards = paths.filter(path => /^packages\/[^/]+\/standards\//.test(path));
    const recipes = paths.filter(path => /^packages\/[^/]+\/recipes\//.test(path));
    if (standards.length && recipes.length) out.push({ commit, standards, recipes });
  };
  for (const block of log.split("@@").filter(Boolean)) {
    const [commit, ...paths] = block.split("\n").map(line => line.trim()).filter(Boolean);
    judge(commit!, paths);
  }
  judge("working tree", status.split("\n").filter(Boolean).map(line => line.slice(3).replace(/^.* -> /, "")));
  return out;
}

/**
 * R16.3: a standard changes only through `clossys standard` by owner or planner (its ledger's last
 * event records the current files), and no unit diff changes both a standard and a recipe.
 */
export const r16_3: Check = ctx => {
  const world = standardsWorld(ctx);
  const rows: Row[] = [];
  for (const standard of world.standards) {
    const path = `${standard.dir}/ledger.json`;
    const row = (reason: string): Row => ({ rule: "R16", check: "R16.3", agent: standard.agent, slot: `standards/${standard.id}`, reason, path });
    if (!standard.ledger.length) { rows.push(row("no ledger event: the standard did not change through clossys standard")); continue; }
    for (const event of standard.ledger) {
      if (event.verb !== "standard") rows.push(row(`ledger event verb ${String(event.verb)} is not standard`));
      if (!(STANDARD_AUTHORS as readonly unknown[]).includes(event.by)) rows.push(row(`ledger event by ${String(event.by)}: standards change by owner or planner only`));
    }
    const last = standard.ledger[standard.ledger.length - 1]!;
    const recorded = isObject(last.files) ? last.files : {};
    const same = Object.keys(recorded).length === Object.keys(standard.files).length && Object.entries(standard.files).every(([name, sha]) => recorded[name] === sha);
    if (!same) rows.push(row("the files differ from the last clossys standard event: changed outside the verb"));
  }
  for (const change of mixedChanges(ctx.root)) {
    rows.push(codeRow("R16.3", change.standards[0]!, `${change.commit} changes standards (${change.standards.length} files) and recipes (${change.recipes.length} files) together`));
  }
  return rows;
};

/** Words that would let a recipe into a verdict (R16.4): a recipe loader or a recipe path. */
const RECIPE_TOKEN = /records\/recipes|\bloadRecipes\b|\breadRecipe\b|\brecipesFor\b|packages\/[^"'`/]+\/recipes\//;
/** R16.4: the certify cache key has no recipe field, and no criterion or certifier source names a recipe. */
export const r16_4: Check = ctx => {
  const rows: Row[] = [];
  const keyFile = "packages/producer/src/constitution/criteria/core/verdict.ts";
  for (const field of CERTIFY_KEY_FIELDS) if (/recipe/i.test(field)) rows.push(codeRow("R16.4", keyFile, `certify cache key field ${field} names a recipe`));
  if (CERTIFY_KEY_FIELDS.join(",") !== "candidate,standard,contract,pinSet") rows.push(codeRow("R16.4", keyFile, `certify cache key is (${CERTIFY_KEY_FIELDS.join(", ")}), not (candidate, standard, contract, pinSet)`));
  for (const file of judgeFiles(ctx.root).filter(path => /\/constitution\/(?:criteria|certify)\//.test(path))) {
    const source = readFileSync(join(ctx.root, file), "utf8");
    const hit = RECIPE_TOKEN.exec(source);
    if (hit) rows.push(codeRow("R16.4", file, `names ${hit[0]}: a verdict reads no recipe`));
  }
  return rows;
};

export const R16_CHECKS = { "R16.1": r16_1, "R16.2": r16_2, "R16.3": r16_3, "R16.4": r16_4 } as const;
export const R16: RuleModule = { rule: "R16", checks: R16_CHECKS };
