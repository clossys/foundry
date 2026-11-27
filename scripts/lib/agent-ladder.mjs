// The readiness ladder (docs/contracts/agents.json `ladder`, owned by Controller): one check per rung, and an
// agent's rung computed from them, never declared. computeLadder runs each rung's check for every agent in ladder
// order and stops at the first that fails: the agent's rung is the last rung whose check, and every check below it,
// passed (null when declared fails), and `next` / `missing` name the rung it lacks and what that check found.
// `clossys agents check` (packages/producer/src/cli/agents.ts) writes the result to RUNGS_PATH and its Producer
// copy; scripts/check-agent-rung.mjs re-runs one rung's check for every agent that file places at or above it.
//
// The rung checks:
//   declared    check:agents-definition finds nothing about the agent (a finding about no one row fails every agent);
//   conforming  check-package-conformance.mjs --enforce reports no gap and no finding for the agent's package;
//   qualified   a retained release-qualification record exists for the package's current version (published name);
//   packed      package.json `files` ships skill/SKILL.md and every bin target, and check:bin-reachability and
//               check:install-docs pass for the package (install-docs documents it: a skipped package is not passed);
//   looped      every check:agents entry of the agent exits 0, and clossys init adopts its loops: it is in the
//               content list init-loops reads and ships loops/.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, readSources } from "../check-agents-definition.mjs";
import { AGENT_CHECKS } from "../check-agents.mjs";
import { scanBinReachability } from "../check-bin-reachability.mjs";
import { scanInstallDocs } from "../check-install-docs.mjs";
import { qualificationRecordRetainedForVersion } from "../check-qualification-record-present.mjs";
import { publishedName } from "./package-renames.mjs";

export const RUNGS_PATH = "docs/contracts/agents.rungs.json";
export const RUNGS_COPY_PATH = "packages/producer/src/agent-rungs.generated.ts";
const SCRIPTS = fileURLToPath(new URL("..", import.meta.url));
const json = (root, path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const message = (error) => (error instanceof Error ? error.message : String(error));

/** Every rung's check: (context, row) => the missing items, [] when the rung holds. */
export const RUNG_CHECKS = Object.freeze({
  declared(context, row) {
    const findings = context.once("definition", () => evaluate(readSources(context.root)));
    const ids = new Set(context.rows.flatMap((item) => [item.id, item.package]));
    const owns = (subject) => subject === row.id || subject === row.package || subject.startsWith(`packages/${row.id}/`);
    const about = (subject) => [...ids].some((id) => subject === id || subject.startsWith(`packages/${id}/`));
    return findings.filter((item) => owns(String(item.subject ?? "")) || !about(String(item.subject ?? ""))).map((item) => `${item.rule} ${item.subject}: ${item.message}`);
  },
  conforming(context, row) {
    const report = context.once("conformance", () => {
      const run = spawnSync(process.execPath, [join(SCRIPTS, "check-package-conformance.mjs"), "--enforce", "--json", context.root], { encoding: "utf8", maxBuffer: 64 << 20 });
      const parsed = JSON.parse(run.stdout);
      if (parsed.error) throw new Error(parsed.error);
      return parsed;
    });
    const line = (report.table ?? []).find((item) => item.role === row.package);
    if (!line) return [`check-package-conformance has no row for ${row.package}`];
    const gaps = Object.entries(line).filter(([key, value]) => ["absent", "partial", "drifted", "sample-only", "not-removed"].includes(value) && key !== "classification").map(([key, value]) => `${key} ${value}`);
    const named = new Set(gaps.map((gap) => `conformance-gap-${gap.split(" ")[0]}`));
    const rules = [...new Set((report.findings ?? []).filter((item) => item.role === row.package && !named.has(item.rule)).map((item) => item.rule))];
    return [...gaps, ...rules];
  },
  qualified(context, row) {
    const { version } = json(context.root, `packages/${row.id}/package.json`);
    const candidate = { name: publishedName(row.package), version };
    const record = qualificationRecordRetainedForVersion({ root: context.root, candidate });
    if (record.state === "present") return [];
    return [`no retained release-qualification record for ${candidate.name}@${version} (${record.path ?? record.reason})`];
  },
  packed(context, row) {
    const manifest = json(context.root, `packages/${row.id}/package.json`);
    const missing = [];
    if (manifest.private === true) missing.push("package.json is private, so the package never installs");
    if (!existsSync(join(context.root, "packages", row.id, "skill/SKILL.md"))) missing.push("skill/SKILL.md is absent");
    else if (!ships(manifest.files, "skill/SKILL.md")) missing.push("package.json files does not ship skill/SKILL.md");
    const bins = typeof manifest.bin === "string" ? { [row.id]: manifest.bin } : manifest.bin ?? {};
    for (const [name, target] of Object.entries(bins)) if (!ships(manifest.files, target)) missing.push(`package.json files does not ship bin ${name} (${target})`);
    const reach = context.once("bins", () => scanBinReachability(context.root));
    for (const item of [...reach.findings, ...reach.cannotAnswer]) if (item.packageName === row.package) missing.push(`check:bin-reachability ${item.rule}${item.binName ? ` ${item.binName}` : ""}`);
    const docs = context.once("docs", () => scanInstallDocs(context.root));
    for (const item of docs.findings) if (item.packageName === row.package) missing.push(`check:install-docs ${item.rule}`);
    if (!docs.documented.some((item) => item.packageName === row.package)) missing.push("check:install-docs does not find the public registry and auth-free install in its README");
    return missing;
  },
  looped(context, row) {
    const missing = [];
    const entries = AGENT_CHECKS.filter((entry) => entry.agent === row.id);
    if (entries.length === 0) missing.push("no check:agents entry");
    for (const entry of entries) {
      const run = spawnSync(process.execPath, [join(SCRIPTS, "check-agents.mjs"), "--only", entry.id], { cwd: context.root, encoding: "utf8", maxBuffer: 64 << 20 });
      if (run.status !== 0) missing.push(`check:agents ${entry.id} exits ${run.status}`);
    }
    if (!(context.lists.content?.members ?? []).includes(row.id)) missing.push("clossys init does not adopt its loops: not in the content list");
    if (!existsSync(join(context.root, "packages", row.id, "loops"))) missing.push("ships no loops/");
    return missing;
  },
});

/** Whether npm's `files` (absent = everything) ships `path`: a listed file, a listed folder above it, or a glob. */
export function ships(files, path) {
  if (!Array.isArray(files)) return true;
  const want = path.replace(/^\.\//, "");
  const covers = (entry) => {
    const clean = entry.replace(/^\.\//, "").replace(/\/+$/, "");
    if (!/[*?]/.test(clean)) return want === clean || want.startsWith(`${clean}/`);
    const pattern = clean.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*");
    return new RegExp(`^${pattern}(?:/.*)?$`).test(want);
  };
  let shipped = false;
  for (const entry of files) {
    if (typeof entry !== "string") continue;
    if (entry.startsWith("!")) { if (covers(entry.slice(1))) shipped = false; }
    else if (covers(entry)) shipped = true;
  }
  return shipped;
}

/** What every rung check reads: the root, agents.json, its rows and lists, and a per-run cache (`once`). */
export function ladderContext(root) {
  const agents = json(root, "docs/contracts/agents.json");
  const cache = new Map();
  const once = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
  return { root, agents, rows: agents.agents ?? [], lists: agents.lists ?? {}, once };
}

/**
 * The ladder computed over the agents.json at `root`: { ladder, needs, lists, agents: [{ id, package (published name),
 * rung, next, missing }] }.
 * `checks` replaces RUNG_CHECKS (tests). A check that throws is a missing item, never a pass.
 */
export function computeLadder(root, { checks = RUNG_CHECKS } = {}) {
  const context = ladderContext(root);
  const { agents, rows } = context;
  const ladder = (agents.ladder?.rungs ?? []).map((rung) => rung.id);
  const computed = rows.map((row) => {
    let rung = null;
    for (const id of ladder) {
      let missing;
      try { missing = checks[id] ? checks[id](context, row) : [`no check for rung ${id}`]; } catch (error) { missing = [`${id} check could not run: ${message(error)}`]; }
      if (missing.length > 0) return { id: row.id, package: publishedName(row.package), rung, next: id, missing };
      rung = id;
    }
    return { id: row.id, package: publishedName(row.package), rung, next: null, missing: [] };
  });
  return { ladder, needs: agents.ladder?.needs ?? [], lists: agents.lists ?? {}, agents: computed };
}

/** The rung's place on the ladder: -1 for null (below declared). */
export const rungIndex = (ladder, rung) => (rung === null ? -1 : ladder.indexOf(rung));

/** The agents at `rung` or higher, in row order. */
export const atOrAbove = (result, rung) => result.agents.filter((agent) => rungIndex(result.ladder, agent.rung) >= rungIndex(result.ladder, rung)).map((agent) => agent.id);

/** Every need the ladder states, per member below it: [{ id, list, need, rung, next, missing }]. */
export function shortfalls(result) {
  const byId = new Map(result.agents.map((agent) => [agent.id, agent]));
  return result.needs.flatMap((need) => (result.lists[need.list]?.members ?? []).flatMap((id) => {
    const agent = byId.get(id);
    if (agent && rungIndex(result.ladder, agent.rung) >= rungIndex(result.ladder, need.rung)) return [];
    return [{ id, list: need.list, need: need.rung, rung: agent?.rung ?? null, next: agent?.next ?? null, missing: agent?.missing ?? ["no agents.json row"] }];
  }));
}

/** The generated agents.rungs.json text. */
export function renderRungs(result) {
  const sets = Object.fromEntries(result.needs.map((need) => [need.list, { need: need.rung, listed: result.lists[need.list]?.members?.length ?? 0, atOrAbove: atOrAbove(result, need.rung).length }]));
  return `${JSON.stringify({
    $comment: "Generated by `clossys agents check` from the rung checks of docs/contracts/agents.json `ladder`. Do not edit: check:agent-ladder fails when the Producer copy differs, and check:agent-rung:<rung> re-runs each rung's check for every agent this file places at or above it.",
    schemaVersion: 1,
    ladder: result.ladder,
    needs: sets,
    agents: result.agents.map((agent) => ({ id: agent.id, package: agent.package, rung: agent.rung, next: agent.next, missing: agent.missing })),
  }, null, 2)}\n`;
}

/** The Producer copy (`clossys status` and `clossys init` read it): the ladder and each agent's rung. */
export function renderRungsCopy(rungs) {
  const entries = rungs.agents.map((agent) => `  ${JSON.stringify(agent.id)}: ${JSON.stringify(agent.rung)},`);
  const byPackage = rungs.agents.map((agent) => `  ${JSON.stringify(agent.package)}: ${JSON.stringify(agent.rung)},`);
  return [
    `// Generated from ${RUNGS_PATH} by \`clossys agents check\`. Do not edit: check:agent-ladder fails when this file`,
    "// differs from that render by one byte.",
    "",
    "/** The readiness ladder, lowest rung first. */",
    `export const AGENT_LADDER = Object.freeze(${JSON.stringify(rungs.ladder)} as const);`,
    "",
    "/** The rung each named list needs (agents.json ladder.needs). */",
    `export const AGENT_RUNG_NEEDS: Readonly<Record<string, string>> = Object.freeze(${JSON.stringify(Object.fromEntries(Object.entries(rungs.needs).map(([list, set]) => [list, set.need])))});`,
    "",
    "/** Each agent's computed rung; null is below declared. */",
    `export const AGENT_RUNGS: Readonly<Record<string, string | null>> = Object.freeze({\n${entries.join("\n")}\n});`,
    "",
    "/** The same rungs by published package name, as a consumer's node_modules/@clossys/ holds them. */",
    `export const AGENT_RUNGS_BY_PACKAGE: Readonly<Record<string, string | null>> = Object.freeze({\n${byPackage.join("\n")}\n});`,
    "",
  ].join("\n");
}

/** The agents.rungs.json at `root`, parsed, or null when there is none. */
export function readRungs(root) {
  const path = join(root, RUNGS_PATH);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

/** Writes agents.rungs.json and its Producer copy; returns the paths written. */
export function writeRungs(root, result) {
  const text = renderRungs(result);
  const written = [[RUNGS_PATH, text], [RUNGS_COPY_PATH, renderRungsCopy(JSON.parse(text))]];
  for (const [path, body] of written) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return written.map(([path]) => path);
}
