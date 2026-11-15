/**
 * The Director package tree (ia-target director.md 2, 9.1-9.2): 3 L0, 9 L1, 27 L2, 55 L3 slots, the retired ids and
 * the starter templates. `loadDirectorTree` reads the shipped files and returns fresh mutable data;
 * `checkDirectorTree` reports every finding instead of throwing, so a mutated tree can be checked in tests.
 *
 * Sources (all under src/catalog, shipped in the npm package):
 * - `ia/strategy.json`: L0 layers, L1 nodes, L2 children, slot labels and marks, the default forbid list.
 * - `cells/strategy.json`: each slot's question and mustContain keys, and the slots it reads (`links`).
 * - `retired.json`: ids that never return as live slots.
 * - `defaults/<slot-id>/template-v1.md`: one template per starter slot, the keys with no answers.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { DirectorContract, DirectorL0, DirectorRetired, DirectorSlot, DirectorSlotMark } from "../../types.js";

export interface DirectorL2 { id: string; label: string; slots: string[] }
export interface DirectorL1 { id: string; label: string; question: string; l2: DirectorL2[] }
export interface DirectorL0Node { id: DirectorL0; label: string; owns: string; doesNotOwn: string; l1: DirectorL1[] }
export interface DirectorTemplate { slot: string; file: string; text: string }
export interface DirectorTree {
  packageVersion: string;
  l0: DirectorL0Node[];
  slots: DirectorSlot[];
  retired: DirectorRetired[];
  templates: DirectorTemplate[];
}
export type DirectorTreeRule =
  | "tree.shape" | "tree.placement" | "brief.missing" | "uses.dangling" | "retired.reused"
  | "template.missing" | "template.extra" | "template.check";
export interface DirectorTreeIssue { rule: DirectorTreeRule; path: string; message: string }

export const TEMPLATE_FILE = "template-v1.md";
const L0_IDS: readonly DirectorL0[] = ["strategy", "roadmap", "execution"];
const ISO = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$/;

/** src/catalog/ia/ (source) and dist/catalog/ia/ (compiled) both sit three levels below the package root. */
const pkg = (path: string): URL => new URL(`../../../${path}`, import.meta.url);
const readJson = (path: string): unknown => JSON.parse(readFileSync(pkg(path), "utf8"));

interface IaFile {
  layers: { id: DirectorL0; label: string; nodes: string[] }[];
  ownership: Record<string, { owns: string; doesNotOwn: string }>;
  forbid: string[];
  nodes: { id: string; name: string; question: string; children: { id: string; name: string; leaves: string[] }[] }[];
  slots: Record<string, { label: string; mark: DirectorSlotMark; forbid?: string[] }>;
}
interface CellFile { id: string; question: string; mustContain: { key: string; hint: string }[]; links: { cites: string }[] }

/** Reads the shipped tree; every call returns new objects. */
export function loadDirectorTree(): DirectorTree {
  const ia = readJson("src/catalog/ia/strategy.json") as IaFile;
  const cells = new Map((readJson("src/catalog/cells/strategy.json") as CellFile[]).map(cell => [cell.id, cell]));
  const retired = readJson("src/catalog/retired.json") as DirectorRetired[];
  const packageVersion = (readJson("package.json") as { version: string }).version;
  const nodes = new Map(ia.nodes.map(node => [node.id, node]));
  const l0: DirectorL0Node[] = ia.layers.map(layer => ({
    id: layer.id, label: layer.label,
    owns: ia.ownership?.[layer.id]?.owns ?? "", doesNotOwn: ia.ownership?.[layer.id]?.doesNotOwn ?? "",
    l1: layer.nodes.map(id => {
      const node = nodes.get(id);
      return { id, label: node?.name ?? "", question: node?.question ?? "", l2: (node?.children ?? []).map(child => ({ id: child.id, label: child.name, slots: [...child.leaves] })) };
    }),
  }));
  const slots: DirectorSlot[] = [];
  for (const layer of l0) for (const l1 of layer.l1) for (const l2 of l1.l2) for (const id of l2.slots) {
    const meta = ia.slots?.[id];
    const cell = cells.get(id);
    const brief: DirectorContract | undefined = cell ? { question: cell.question, mustContain: cell.mustContain.map(item => ({ ...item })), forbid: [...(meta?.forbid ?? ia.forbid ?? [])] } : undefined;
    slots.push({ id, l0: layer.id, l1: l1.id, l2: l2.id, label: meta?.label ?? "", mark: meta?.mark ?? "other-live", ...(brief ? { brief } : {}), uses: (cell?.links ?? []).map(link => link.cites) });
  }
  const defaults = pkg("src/catalog/defaults/");
  const templates: DirectorTemplate[] = existsSync(defaults)
    ? readdirSync(defaults, { withFileTypes: true }).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry =>
      readdirSync(new URL(`${entry.name}/`, defaults)).sort().map(file => ({ slot: entry.name, file, text: readFileSync(new URL(`${entry.name}/${file}`, defaults), "utf8") })))
    : [];
  return { packageVersion, l0, slots, retired, templates };
}

/** Every finding in the tree; an empty list means the tree is sound. */
export function checkDirectorTree(tree: DirectorTree): DirectorTreeIssue[] {
  const issues: DirectorTreeIssue[] = [];
  const add = (rule: DirectorTreeRule, path: string, message: string) => { issues.push({ rule, path, message }); };
  if (tree.l0.map(node => node.id).join() !== L0_IDS.join()) add("tree.shape", "l0", `Expected the L0s ${L0_IDS.join(", ")}`);
  const slotIds = new Set(tree.slots.map(slot => slot.id));
  const placed = new Map<string, number>();
  const groupIds = new Set<string>();
  for (const [i, l0] of tree.l0.entries()) {
    if (!l0.owns || !l0.doesNotOwn) add("tree.shape", `l0[${i}]`, "An L0 states what it owns and does not own");
    for (const [j, l1] of l0.l1.entries()) {
      const path = `l0[${i}].l1[${j}]`;
      if (!l1.label || !l1.question) add("tree.shape", path, "An L1 has a label and a question");
      if (groupIds.has(l1.id)) add("tree.placement", path, `Duplicate group id ${l1.id}`);
      groupIds.add(l1.id);
      if (l1.l2.length < 2) add("tree.placement", path, "An L1 holds at least two L2s");
      for (const [k, l2] of l1.l2.entries()) {
        if (groupIds.has(l2.id)) add("tree.placement", `${path}.l2[${k}]`, `Duplicate group id ${l2.id}`);
        groupIds.add(l2.id);
        if (!l2.id.startsWith(`${l1.id}.`)) add("tree.placement", `${path}.l2[${k}]`, `L2 ${l2.id} is not under its L1 ${l1.id}`);
        if (l2.slots.length < 2) add("tree.placement", `${path}.l2[${k}]`, "An L2 holds at least two slots");
        for (const id of l2.slots) placed.set(id, (placed.get(id) ?? 0) + 1);
      }
    }
  }
  for (const [id, count] of placed) if (count !== 1) add("tree.placement", "l0", `Slot ${id} is placed ${count} times`);
  const seen = new Set<string>();
  for (const [i, slot] of tree.slots.entries()) {
    const path = `slots[${i}]`;
    if (seen.has(slot.id)) add("tree.placement", path, `Duplicate slot ${slot.id}`);
    seen.add(slot.id);
    if (!placed.has(slot.id)) add("tree.placement", path, `Slot ${slot.id} is not placed in the tree`);
    if (!slot.label) add("tree.shape", path, `Slot ${slot.id} has no label`);
    const brief = slot.brief;
    const keys = brief?.mustContain.map(item => item.key) ?? [];
    if (!brief || !brief.question.trim() || keys.length < 2 || new Set(keys).size !== keys.length || brief.mustContain.some(item => !item.key.trim() || !item.hint.trim()) || brief.forbid.length === 0)
      add("brief.missing", path, `Slot ${slot.id} has no complete brief (question, 2+ unique keys with hints, forbid list)`);
    for (const [j, id] of slot.uses.entries()) if (!slotIds.has(id)) add("uses.dangling", `${path}.uses[${j}]`, `Slot ${slot.id} uses ${id}, which is not a live slot`);
  }
  const retiredIds = new Set<string>();
  for (const [i, entry] of tree.retired.entries()) {
    const path = `retired[${i}]`;
    if (retiredIds.has(entry.id)) add("retired.reused", path, `Retired id ${entry.id} is listed twice`);
    retiredIds.add(entry.id);
    if (slotIds.has(entry.id) || placed.has(entry.id)) add("retired.reused", path, `Retired id ${entry.id} is a live slot again`);
    if (entry.fate === "merged" && (!entry.target || !slotIds.has(entry.target))) add("retired.reused", path, `Retired id ${entry.id} merges into ${entry.target ?? "nothing"}, which is not a live slot`);
  }
  for (const [i, slot] of tree.slots.entries()) for (const id of slot.uses) if (retiredIds.has(id)) add("retired.reused", `slots[${i}].uses`, `Slot ${slot.id} uses the retired id ${id}`);
  const bySlot = new Map(tree.slots.map(slot => [slot.id, slot]));
  const withTemplate = new Set<string>();
  for (const [i, template] of tree.templates.entries()) {
    const path = `templates[${i}]`;
    const slot = bySlot.get(template.slot);
    withTemplate.add(template.slot);
    if (!slot || slot.mark !== "starter") { add("template.extra", path, `Template for ${template.slot}, which is not a starter slot`); continue; }
    if (template.file !== TEMPLATE_FILE) { add("template.extra", path, `Starter ${slot.id} ships ${template.file}; expected only ${TEMPLATE_FILE}`); continue; }
    for (const message of checkTemplate(slot, template.text, tree.packageVersion)) add("template.check", path, `${slot.id}: ${message}`);
  }
  for (const slot of tree.slots) if (slot.mark === "starter" && !withTemplate.has(slot.id)) add("template.missing", "templates", `Starter ${slot.id} ships no ${TEMPLATE_FILE}`);
  return issues;
}

/**
 * A package template passes its own slot checks when its header is the package-default candidate/1 header of that
 * slot, and its body is one empty `## <Key>` section per mustContain key, in order: the keys with no answers.
 */
export function checkTemplate(slot: DirectorSlot, text: string, packageVersion: string): string[] {
  const problems: string[] = [];
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) return ["no front matter"];
  const [, front = "", body = ""] = match;
  const lines = front.split("\n");
  if (lines[0] !== "clossys:") return ["front matter must hold only the clossys header"];
  const header: Record<string, unknown> = {};
  for (const line of lines.slice(1)) {
    const field = /^ {2}([A-Za-z]+): (.+)$/.exec(line);
    if (!field) { problems.push(`unreadable header line ${JSON.stringify(line)}`); continue; }
    try { header[field[1]!] = JSON.parse(field[2]!); } catch { problems.push(`header ${field[1]} is not a JSON value`); }
  }
  const expect = (key: string, value: unknown) => { if (JSON.stringify(header[key]) !== JSON.stringify(value)) problems.push(`header ${key} must be ${JSON.stringify(value)}`); };
  expect("schema", "clossys.candidate/1");
  expect("id", `director/${slot.id}/package:${TEMPLATE_FILE}`);
  expect("agent", "director");
  expect("kind", "candidate");
  expect("status", "draft");
  expect("createdBy", { actor: "package", package: "@clossys/director", version: packageVersion });
  expect("refs", []);
  expect("slot", `director/${slot.id}`);
  expect("source", { kind: "package-default", ref: [] });
  expect("rationale", []);
  if (typeof header.createdAt !== "string" || !ISO.test(header.createdAt)) problems.push("header createdAt must be an ISO timestamp");
  const allowed = new Set(["schema", "id", "agent", "kind", "status", "createdBy", "createdAt", "refs", "slot", "source", "rationale"]);
  for (const key of Object.keys(header)) if (!allowed.has(key)) problems.push(`header ${key} is not a package-default field`);
  const sections = body.split(/^## /m);
  if (sections[0]!.trim() !== "") problems.push("text before the first key section");
  const keys = slot.brief?.mustContain.map(item => item.key) ?? [];
  const headings = sections.slice(1).map(section => section.split("\n")[0]!.trim());
  if (headings.join("|") !== keys.join("|")) problems.push(`sections [${headings.join(", ")}] must be the mustContain keys [${keys.join(", ")}] in order`);
  for (const section of sections.slice(1)) if (section.split("\n").slice(1).join("\n").trim() !== "") problems.push(`section ${section.split("\n")[0]!.trim()} must stay unanswered`);
  return problems;
}

/** Renders the package template for a starter slot (the inverse of checkTemplate). */
export function renderTemplate(slot: DirectorSlot, packageVersion: string, createdAt: string): string {
  const header: [string, unknown][] = [
    ["schema", "clossys.candidate/1"], ["id", `director/${slot.id}/package:${TEMPLATE_FILE}`], ["agent", "director"], ["kind", "candidate"],
    ["status", "draft"], ["createdBy", { actor: "package", package: "@clossys/director", version: packageVersion }], ["createdAt", createdAt],
    ["refs", []], ["slot", `director/${slot.id}`], ["source", { kind: "package-default", ref: [] }], ["rationale", []],
  ];
  const front = header.map(([key, value]) => `  ${key}: ${JSON.stringify(value).replace(/":/g, "\": ").replace(/,"/g, ", \"")}`).join("\n");
  const body = (slot.brief?.mustContain ?? []).map(item => `## ${item.key}\n`).join("\n");
  return `---\nclossys:\n${front}\n---\n\n${body}`;
}
