#!/usr/bin/env node
// check:agents-definition: every agent is defined once, in docs/contracts/agents.json, and every
// other declaration of an agent agrees with it. Controller owns the file (each row's
// `definitionOwner`); docs/contracts/agents.schema.json is its schema, and this check reads it.
//
// One row per package under packages/. The other declarations, each joined to the rows:
//   D1  docs/contracts/role-loop-archetypes.json: a role charter for every row that is not
//       `tooling`, and none for a `tooling` row (executable tooling is not a role, as
//       check:package-evidence already holds);
//   D1' packages/controller/contracts/role-loop-archetypes.json: the copy Controller ships, byte
//       for byte the D1 file; `--write` regenerates it, nobody edits it by hand;
//   D2  docs/contracts/package-evidence.json: an entry per row, `executable-tooling` exactly for
//       the `tooling` rows, and no entry in the workspace scope without a row;
//   D3  docs/contracts/package-lifecycle.json: an entry per row, and none in scope without one;
//   D4  docs/contracts/first-wave-sequence.json: every row in exactly one wave, no other member;
//   D5  governance/release-qualification-policy.json: one entry per row, keyed by the published
//       spelling (D6), whose packageDir is the row's directory and whose adapter exists;
//   D6  scripts/lib/package-renames.mjs: every renamed directory is a row;
//   D7  packages/<id>/package.json: the row's id is the directory and its package the name;
//   D8  packages/<id>/skill/SKILL.md: the skill is named `<scope>-<id>`;
//   D9  the agent lists still written out in code (CODE_LISTS): a list of content agents names
//       exactly the `content` rows, and any other list names only rows.
//
// Usage: node scripts/check-agents-definition.mjs [--root DIR] [--json] [--write]
// Exit 0 when every source agrees, 1 on any finding, 2 on a usage error or an unreadable source.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PACKAGE_RENAMES, workspaceName } from "./lib/package-renames.mjs";

export const AGENTS_PATH = "docs/contracts/agents.json";
export const SCHEMA_PATH = "docs/contracts/agents.schema.json";
export const ROLE_CONTRACT_PATH = "docs/contracts/role-loop-archetypes.json";
export const CONTROLLER_COPY_PATH = "packages/controller/contracts/role-loop-archetypes.json";
const EVIDENCE_PATH = "docs/contracts/package-evidence.json";
const LIFECYCLE_PATH = "docs/contracts/package-lifecycle.json";
const WAVES_PATH = "docs/contracts/first-wave-sequence.json";
const POLICY_PATH = "governance/release-qualification-policy.json";

/** D9: the agent lists still written out in code. `content` lists must name exactly the content agents. */
export const CODE_LISTS = Object.freeze([
  { file: "packages/producer/src/agents.ts", symbol: "AGENT_PACKAGES", shape: "keys", rule: "content" },
  { file: "packages/producer/src/records/slot-model/types.ts", symbol: "SLOT_AGENTS", rule: "content" },
  { file: "packages/producer/src/records/request.ts", symbol: "CONTENT_AGENTS", rule: "content" },
  { file: "packages/producer/src/records/request.ts", symbol: "SLOT_TARGET", shape: "alternation", rule: "content" },
  { file: "packages/producer/src/queue/routing.ts", symbol: "ROUTED_AGENTS", rule: "content" },
  { file: "packages/producer/src/conform/model.ts", symbol: "CONFORM_AGENTS", rule: "content" },
  { file: "packages/producer/src/loop/agent-loops-ia.ts", symbol: "LOOP_AGENTS", rule: "content" },
  { file: "packages/controller/src/heartbeat/fs.ts", symbol: "AGENT_ROLES", rule: "content" },
  { file: "scripts/check-package-skills.mjs", symbol: "CONTENT_AGENT_LOOP", rule: "content" },
  { file: "scripts/check-package-framework.mjs", symbol: "NATIVE_CELL_ROLES", rule: "content" },
  { file: "packages/producer/src/loop/names.ts", symbol: "LIVE_AGENTS", rule: "agents" },
  { file: "packages/producer/src/check/e2e.ts", symbol: "E2E_COHORT", rule: "agents" },
  { file: "packages/producer/scripts/pack-five.mjs", symbol: "PACK_ROLES", rule: "agents" },
  { file: "packages/advisor/src/front-door/install.ts", symbol: "PACK_ROLES", rule: "agents" },
  { file: "packages/producer/src/constitution/checks/R01-catalog.ts", symbol: "FOUNDRY_AGENTS", rule: "agents" },
  { file: "scripts/check-contamination-classes.mjs", symbol: "SKILL_ID_PACKAGES", rule: "agents" },
].map(Object.freeze));

const ID = /["']([a-z][a-z0-9-]*)["']/g;

/** The members of one written-out list in `source`, or null when the list is not found. */
export function extractList(source, { symbol, shape = "array" }) {
  const head = new RegExp(`\\b(?:const|let|var)\\s+${symbol}\\b[^=]*=\\s*`).exec(source);
  if (!head) return null;
  const rest = source.slice(head.index + head[0].length);
  let members;
  if (shape === "keys") members = /^\{([^}]*)\}/.exec(rest)?.[1].match(/^\s*([a-z][a-z0-9-]*)\s*:/gm)?.map((key) => key.replace(/[\s:]/g, ""));
  else if (shape === "alternation") members = /^\/\^\(([a-z|-]+)\)/.exec(rest)?.[1].split("|");
  else members = [.../^(?:Object\.freeze\(|new Set\()?\[([^\]]*)\]/.exec(rest)?.[1].matchAll(ID) ?? []].map((match) => match[1]);
  return members?.length ? members : null;
}

function skillName(root, dir) {
  const path = join(root, "packages", dir, "skill/SKILL.md");
  if (!existsSync(path)) return null;
  const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(path, "utf8"))?.[1] ?? "";
  return /^name:[ \t]*(\S+)[ \t]*$/m.exec(front)?.[1] ?? null;
}

/** Read every source the rows are joined to. Throws when one cannot be read. */
export function readSources(root) {
  const text = (path) => readFileSync(join(root, path), "utf8");
  const json = (path) => JSON.parse(text(path));
  const dirs = readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, "packages", entry.name, "package.json")))
    .map((entry) => entry.name)
    .sort();
  const policy = json(POLICY_PATH).packages ?? {};
  return {
    scope: json("package-scope.json").scope,
    agents: json(AGENTS_PATH),
    schema: json(SCHEMA_PATH),
    packages: dirs.map((dir) => ({ dir, name: json(`packages/${dir}/package.json`).name, skill: skillName(root, dir) })),
    roleContract: json(ROLE_CONTRACT_PATH),
    roleContractText: text(ROLE_CONTRACT_PATH),
    controllerCopyText: text(CONTROLLER_COPY_PATH),
    evidence: json(EVIDENCE_PATH).packages ?? [],
    lifecycle: json(LIFECYCLE_PATH).packages ?? [],
    waves: json(WAVES_PATH).waves ?? [],
    policy,
    adapters: Object.fromEntries(Object.entries(policy).map(([key, entry]) => [key, typeof entry?.adapterPath === "string" && existsSync(join(root, entry.adapterPath))])),
    renames: PACKAGE_RENAMES.map((row) => ({ ...row })),
    codeLists: CODE_LISTS.map((list) => ({ ...list, members: existsSync(join(root, list.file)) ? extractList(text(list.file), list) : null })),
  };
}

const kind = (value) => (value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value);

/** The subset of JSON Schema agents.schema.json uses: type, const, enum, pattern, required, properties, additionalProperties, items. */
export function validateSchema(schema, value, path, findings) {
  const fail = (message) => findings.push({ rule: "agents-schema", subject: path, message });
  if (schema.type && kind(value) !== schema.type) return fail(`must be ${schema.type}`);
  if ("const" in schema && value !== schema.const) return fail(`must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) return fail(`must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}`);
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) return fail(`must match ${schema.pattern}`);
  if (kind(value) === "object") {
    for (const key of schema.required ?? []) if (!(key in value)) fail(`is missing ${key}`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) validateSchema(schema.properties[key], item, `${path}.${key}`, findings);
      else if (schema.additionalProperties === false) fail(`has unknown key ${key}`);
    }
  }
  if (kind(value) === "array" && schema.items) value.forEach((item, index) => validateSchema(schema.items, item, `${path}[${index}]`, findings));
}

/** Join every source to the rows; returns [{ rule, subject, message }]. Pure. */
export function evaluate(sources) {
  const findings = [];
  const find = (rule, subject, message) => findings.push({ rule, subject, message });
  validateSchema(sources.schema, sources.agents, "agents.json", findings);
  const rows = Array.isArray(sources.agents?.agents) ? sources.agents.agents.filter((row) => kind(row) === "object") : [];
  const byId = new Map();
  for (const row of rows) {
    if (byId.has(row.id)) find("duplicate-agent", row.id, "has more than one row");
    byId.set(row.id, row);
  }
  const byPackage = new Map(rows.map((row) => [row.package, row]));
  const inScope = (name) => typeof name === "string" && name.startsWith(`${sources.scope}/`);

  // D7 and D8: one row per package, named as the package and its skill are.
  const dirs = new Set(sources.packages.map((item) => item.dir));
  for (const item of sources.packages) {
    const row = byId.get(item.dir);
    if (!row) { find("package-without-row", item.dir, `packages/${item.dir} has no row in ${AGENTS_PATH}`); continue; }
    if (row.package !== item.name) find("package-name-mismatch", item.dir, `row names ${row.package}, packages/${item.dir}/package.json names ${item.name}`);
    const skill = `${sources.scope.replace(/^@/, "")}-${item.dir}`;
    if (item.skill !== skill) find("skill-name-mismatch", item.dir, `packages/${item.dir}/skill/SKILL.md must be named ${skill}, found ${item.skill ?? "no skill"}`);
  }
  for (const row of rows) if (!dirs.has(row.id)) find("row-without-package", row.id, `has a row but no packages/${row.id}/package.json`);

  // D1 and D1': a charter for every row that is not tooling, none for tooling; Controller ships the same bytes.
  const roles = new Set(Object.keys(sources.roleContract?.roles ?? {}));
  for (const role of roles) {
    const row = byPackage.get(role);
    if (!row) find("role-without-agent", role, `${ROLE_CONTRACT_PATH} charters a role with no row`);
    else if (row.class === "tooling") find("tooling-agent-has-role", role, "is tooling and must not carry a role charter");
  }
  for (const row of rows) if (row.class !== "tooling" && !roles.has(row.package)) find("agent-without-role", row.package, `is ${row.class} and has no charter in ${ROLE_CONTRACT_PATH}`);
  if (sources.controllerCopyText !== sources.roleContractText) find("controller-role-contract-drift", CONTROLLER_COPY_PATH, `differs from ${ROLE_CONTRACT_PATH}; regenerate it with \`node scripts/check-agents-definition.mjs --write\``);

  // D2 and D3: evidence and lifecycle entries, one per row; executable tooling exactly for the tooling rows.
  for (const [path, entries, label] of [[EVIDENCE_PATH, sources.evidence, "evidence"], [LIFECYCLE_PATH, sources.lifecycle, "lifecycle"]]) {
    const names = new Set(entries.map((entry) => entry?.name));
    for (const entry of entries) {
      if (!inScope(entry?.name)) continue;
      const row = byPackage.get(entry.name);
      if (!row) find(`${label}-unknown-agent`, entry.name, `${path} has an entry with no row`);
      else if (label === "evidence" && (entry.category === "executable-tooling") !== (row.class === "tooling")) find("evidence-class-mismatch", entry.name, `is ${row.class} but ${path} ${entry.category === "executable-tooling" ? "classes it executable-tooling" : "does not class it executable-tooling"}`);
    }
    for (const row of rows) if (!names.has(row.package)) find(`${label}-missing`, row.package, `has no entry in ${path}`);
  }

  // D4: every row in exactly one wave.
  const waveCount = new Map();
  for (const wave of sources.waves) for (const id of wave?.packages ?? []) waveCount.set(id, (waveCount.get(id) ?? 0) + 1);
  for (const id of waveCount.keys()) if (!byId.has(id)) find("wave-unknown-agent", id, `${WAVES_PATH} names a wave member with no row`);
  for (const row of rows) if (waveCount.get(row.id) !== 1) find("wave-membership", row.id, `is in ${waveCount.get(row.id) ?? 0} waves of ${WAVES_PATH}, not exactly one`);

  // D5 and D6: qualification entries are keyed by the published spelling, joined through the rename table.
  const qualified = new Map();
  for (const [key, entry] of Object.entries(sources.policy)) {
    const row = byPackage.get(workspaceName(key));
    if (!row) { find("qualification-unknown-agent", key, `${POLICY_PATH} qualifies a package with no row`); continue; }
    qualified.set(row.id, (qualified.get(row.id) ?? 0) + 1);
    if (entry?.packageDir !== `packages/${row.id}`) find("qualification-package-dir", key, `packageDir must be packages/${row.id}, found ${entry?.packageDir}`);
    if (sources.adapters[key] !== true) find("qualification-adapter-missing", key, `adapter ${entry?.adapterPath} does not exist`);
  }
  for (const row of rows) if (qualified.get(row.id) !== 1) find("qualification-missing", row.package, `has ${qualified.get(row.id) ?? 0} entries in ${POLICY_PATH}, not exactly one`);
  for (const rename of sources.renames) if (!byId.has(rename.directory)) find("rename-unknown-agent", rename.directory, "scripts/lib/package-renames.mjs renames a directory with no row");

  // D9: the lists still written out in code.
  const content = rows.filter((row) => row.class === "content").map((row) => row.id).sort();
  for (const list of sources.codeLists) {
    const subject = `${list.file}#${list.symbol}`;
    if (!list.members) { find("code-list-unreadable", subject, "the list was not found"); continue; }
    for (const id of list.members) if (!byId.has(id)) find("code-list-unknown-agent", subject, `names ${id}, which has no row`);
    if (list.rule === "content" && JSON.stringify([...new Set(list.members)].sort()) !== JSON.stringify(content)) find("code-list-content-drift", subject, `names ${list.members.join(", ")}; the content agents are ${content.join(", ")}`);
  }
  return findings;
}

function parseArgs(argv) {
  const args = { root: resolve(fileURLToPath(new URL("..", import.meta.url))), json: false, write: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--json") args.json = true;
    else if (argv[index] === "--write") args.write = true;
    else if (argv[index] === "--root" && argv[index + 1]) args.root = resolve(argv[(index += 1)]);
    else throw new Error(`unknown argument ${argv[index]}`);
  }
  return args;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let args;
  let sources;
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.write) writeFileSync(join(args.root, CONTROLLER_COPY_PATH), readFileSync(join(args.root, ROLE_CONTRACT_PATH)));
    sources = readSources(args.root);
  } catch (error) {
    console.error(`check-agents-definition: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  const findings = evaluate(sources);
  if (args.json) console.log(JSON.stringify({ ok: findings.length === 0, findings }, null, 2));
  else {
    for (const item of findings) console.log(`${item.rule} ${item.subject}: ${item.message}`);
    console.log(`check-agents-definition: ${sources.packages.length} packages, ${findings.length} finding(s)`);
  }
  process.exit(findings.length === 0 ? 0 : 1);
}
