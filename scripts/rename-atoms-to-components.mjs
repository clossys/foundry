#!/usr/bin/env node
/** Repository-only migration. Dry-run by default; no Git index or branch changes.
 * Usage: node scripts/rename-atoms-to-components.mjs [--root DIR] [--write|--check] [--json]
 * Run the renamed documentation generator and the CSS generator after --write.
 * --check rejects residual layer names, including stale generated output.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const rules = JSON.parse(readFileSync(join(here, "rename-atoms-to-components.allowlist.json"), "utf8"));
const ignored = new Set([".git", "node_modules", "dist", "build", ".next", "coverage", ".cache"]);
const textExtension = /\.(?:[cm]?[jt]sx?|json|md|css|ya?ml|html|txt|snap)$/;
// Word and camel-case segments only: anatomy, atomic and atomically never match.
const legacy = /ATOM_[A-Z_]*|\bATOMS?\b|\bAtoms?(?=[A-Z]|\b)|(?<=[a-z])Atoms?(?=[A-Z]|\b)|\batoms?(?=[A-Z]|\b)/g;
function glob(pattern, path) {
  const expression = pattern.split("**").map(part => part.split("*").map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*");
  return new RegExp(`^${expression}$`).test(path);
}
export const exception = path => rules.files.find(rule => glob(rule.pattern, path));
const generated = path => rules.generated.includes(path);
export function renameText(source) {
  return source.split("\n").map(line => {
    if (rules.lines.some(rule => line.includes(rule.contains))) return line;
    const next = line.replace(legacy, word =>
    word.startsWith("ATOM") ? word.replace("ATOM", "COMPONENT") :
      word[0] === "A" ? word.replace("Atom", "Component") : word.replace("atom", "component"))
    // After the entrypoint flip, this example must still name an unrecognized path.
    .replace(/(It does not catch a second library imported any other way.*)a `\/components` path/, "$1a `/controls` path");
    // Other packages retain their own spelling; widening the scan must preserve it.
    if (line.includes("const FOREIGN_PRIMITIVE_RE =")) return next.replace("(?:components|tokens|theme)", "(?:atoms|components|tokens|theme)") + " // rename-negative: retain foreign entrypoint vocabulary";
    return next;
  }).join("\n");
}
function files(root, dir = "") {
  if (dir === "" && existsSync(join(root, ".git"))) {
    return [...new Set(execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean))]
      .filter(path => !path.split("/").some(part => ignored.has(part)) && textExtension.test(path) && existsSync(join(root, path)) && lstatSync(join(root, path)).isFile()).sort();
  }
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => {
    if (ignored.has(entry.name) || entry.name.startsWith(".env") || entry.isSymbolicLink()) return [];
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    return entry.isDirectory() ? files(root, path) : textExtension.test(entry.name) ? [path] : [];
  }).sort();
}
// The longest directory moves happen before file basenames, then content edits.
const directoryMoves = [
  ["packages/designer/src/atoms", "packages/designer/src/components"],
  ["packages/designer/examples/atoms", "packages/designer/examples/components"],
];
function renamedPath(path) {
  for (const [from, to] of directoryMoves) if (path.startsWith(`${from}/`)) path = to + path.slice(from.length);
  const base = path.slice(path.lastIndexOf("/") + 1);
  return path.slice(0, path.length - base.length) + renameText(base);
}
export function planRename(root) {
  root = resolve(root);
  const moves = [], edits = [], retained = [], generatedFiles = [], residual = [];
  let hits = 0;
  for (const path of files(root)) {
    const source = readFileSync(join(root, path), "utf8");
    if (source.includes("\0")) continue;
    const count = [...source.matchAll(legacy)].length;
    const protection = exception(path);
    if (protection) {
      if (count) retained.push({ path, hits: count, reason: protection.reason });
      continue;
    }
    const next = renamedPath(path);
    if (next !== path) moves.push({ from: path, to: next });
    const replacement = renameText(source);
    if (generated(path)) {
      if (replacement !== source) generatedFiles.push({ path: next, hits: count });
    } else if (replacement !== source) {
      const changedHits = [...source.split("\n").filter(line => !rules.lines.some(rule => line.includes(rule.contains))).join("\n").matchAll(legacy)].length;
      hits += changedHits;
      edits.push({ path: next, hits: changedHits, content: replacement });
    }
    for (const [index, line] of source.split("\n").entries()) {
      if (rules.lines.some(rule => line.includes(rule.contains))) continue;
      if ([...line.matchAll(legacy)].length) residual.push({ path, line: index + 1 });
    }
  }
  // Refuse all collisions before the first mutation, including coexistence of old/new dirs.
  const targets = new Set();
  for (const move of moves) {
    if (targets.has(move.to) || existsSync(join(root, move.to))) throw new Error(`Rename conflict: ${move.from} -> ${move.to}`);
    targets.add(move.to);
  }
  for (const [from, to] of directoryMoves) if (existsSync(join(root, from)) && existsSync(join(root, to))) throw new Error(`Rename conflict: ${from} -> ${to}`);
  return { root, moves, edits, retained, generatedFiles, residual, summary: {
    movedFiles: moves.length, editedFiles: edits.length, replacements: hits,
    generatedFiles: generatedFiles.length, retainedFiles: retained.length,
    retainedHits: retained.reduce((sum, entry) => sum + entry.hits, 0), residualLines: residual.length,
  } };
}
export function applyRename(plan) {
  const { root } = plan;
  for (const [from, to] of directoryMoves) if (existsSync(join(root, from))) renameSync(join(root, from), join(root, to));
  for (const { from, to } of plan.moves) {
    let actual = from;
    for (const [old, next] of directoryMoves) if (actual.startsWith(`${old}/`)) actual = next + actual.slice(old.length);
    if (actual === to) continue;
    mkdirSync(dirname(join(root, to)), { recursive: true });
    renameSync(join(root, actual), join(root, to));
  }
  for (const edit of plan.edits) writeFileSync(join(root, edit.path), edit.content);
}
export function main(args) {
  let root = resolve(here, ".."), write = false, check = false, json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root" && args[i + 1]) root = resolve(args[++i]);
    else if (args[i] === "--write") write = true;
    else if (args[i] === "--check") check = true;
    else if (args[i] === "--json") json = true;
    else if (args[i] !== "--dry-run") throw new Error(`Unknown option: ${args[i]}`);
  }
  if (write && check) throw new Error("Choose --write or --check.");
  const plan = planRename(root);
  if (write) applyRename(plan);
  const { edits, ...report } = plan;
  const output = { ...report, root: relative(process.cwd(), root) || ".", mode: write ? "write" : check ? "check" : "dry-run", edits: edits.map(({ content, ...edit }) => edit) };
  console.log(json ? JSON.stringify(output, null, 2) : JSON.stringify(output.summary));
  if (check && (plan.moves.length || plan.residual.length)) return 1;
  return 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
