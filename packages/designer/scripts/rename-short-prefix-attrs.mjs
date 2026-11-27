#!/usr/bin/env node
/**
 * Codemod: data attributes whose first segment was a short (2 to 4 character) word now open with
 * a full word of 5 or more characters, taken from the namespace their own module already uses
 * (`data-asset-*`, `data-candidate-*`, `data-library-*`, `data-specimen-*`, `data-studio-*`,
 * `data-backdrop-*` and so on). This rewrites every literal use in the designer, publisher,
 * producer and writer sources, selectors, tests, checks and docs, plus the matching
 * `dataset.<camel>` reads.
 *
 *   node packages/designer/scripts/rename-short-prefix-attrs.mjs          rewrite in place
 *   node packages/designer/scripts/rename-short-prefix-attrs.mjs --check  exit 1 on any old name left
 *
 * Never rewritten: vendored upstream copies (`references/`), the compiled utilities stylesheet
 * (its own generator re-emits it from the sources) and the route-slug paths under
 * route-slug folder `producer/studio/app/writer/patterns/` (its `and-lists` slug). The check still reads the generated
 * stylesheet, so a stale one fails it. Tiptap's own node-view content-hole attribute is
 * that library's contract (read by `@tiptap/react`), not a name this repository owns, so it is not listed.
 */
import { AGENT_LISTS } from "./agent-lists.generated.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PACKAGES = AGENT_LISTS["provenance-stamped"];
const TEXT = /\.(?:[cm]?[jt]sx?|css|json|md|html)$/;
const SKIPPED = /(?:^|\/)(?:node_modules|dist|references)\/|^packages\/producer\/studio\/app\/writer\/patterns\/data[-]and[-]lists\//;
const GENERATED = [/^packages\/designer\/styles\/utilities\.css$/];
const SELF = "packages/designer/scripts/rename-short-prefix-attrs.mjs";

/**
 * Old attribute -> new attribute, each without its `data-` lead (added below, so this file never
 * spells an old name whole). Longest first, so a name that prefixes another never swallows it.
 */
const RENAMES = [
  ["hero-backdrop-kind", "backdrop-kind"],
  ["hero-live-backdrop", "backdrop-live"],
  ["hero-live-scrim", "backdrop-live-scrim"],
  ["hero-backdrop", "backdrop-still"],
  ["hero-gradient", "backdrop-gradient"],
  ["hero-scrim", "backdrop-scrim"],
  ["app-icon", "asset-app-icon"],
  ["safe-zone", "asset-safe-zone"],
  ["card-config", "record-cards-config"],
  ["cell-status", "candidate-cell-status"],
  ["cell-actions", "candidate-cell-actions"],
  ["cell-id", "provenance-cell-id"],
  ["chat-empty", "studio-chat-empty"],
  ["copy-role", "specimen-copy-role"],
  ["copy-context", "specimen-copy-context"],
  ["copy-value", "member-copy-value"],
  ["copy-key", "specimen-copy-key"],
  ["copy-target", "writer-copy-target"],
  ["copy-status", "writer-copy-status"],
  ["copy-ref", "publisher-copy-ref"],
  ["faq-columns", "question-columns"],
  ["font-variable", "specimen-font-variable"],
  ["ramp-step", "specimen-ramp-step"],
  ["home-agent", "studio-home-agent"],
  ["leaf-id", "library-leaf-id"],
  ["leaf-label", "library-leaf-label"],
  ["main-state", "publication-main-state"],
  ["max-lines", "specimen-max-lines"],
  ["max-chars", "specimen-max-chars"],
  ["page-command", "studio-page-command"],
  ["rich-text-callout", "document-callout"],
  ["rich-text-badge", "document-badge"],
  ["seat-active", "studio-seat-active"],
  ["slot-card", "studio-slot-card"],
  ["tree-label", "studio-tree-label"],
  ["type-sample", "specimen-type-sample"],
  ["zoom-reset", "studio-zoom-reset"],
];

const camel = name => name.slice("data-".length).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Each rename as an attribute rule (a whole name: no name character on either side) plus its `dataset` read. */
const RULES = RENAMES.map(([from, to]) => [`data-${from}`, `data-${to}`]).flatMap(([from, to]) => [
  [new RegExp(`(?<![A-Za-z0-9_-])${escape(from)}(?![A-Za-z0-9_-])`, "g"), to],
  [new RegExp(`\\bdataset\\.${camel(from)}\\b`, "g"), `dataset.${camel(to)}`],
]);

const check = process.argv.includes("--check");
const unknown = process.argv.slice(2).filter(arg => arg !== "--check");
if (unknown.length) {
  console.error(`rename-short-prefix-attrs: unknown argument ${unknown.join(" ")}`);
  process.exit(2);
}

const files = execFileSync("git", ["ls-files", "-z", "--", ...PACKAGES.map(name => `packages/${name}`)], { cwd: repository, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\0").filter(path => path && path !== SELF && TEXT.test(path) && !SKIPPED.test(path));

const left = [];
let rewritten = 0;
for (const path of files) {
  const absolute = resolve(repository, path);
  let text;
  try { text = readFileSync(absolute, "utf8"); } catch { continue; }
  let next = text;
  for (const [pattern, replacement] of RULES) next = next.replace(pattern, replacement);
  if (next === text) continue;
  if (check || GENERATED.some(pattern => pattern.test(path))) {
    text.split("\n").forEach((line, index) => {
      if (RULES.some(([pattern]) => { pattern.lastIndex = 0; return pattern.test(line); })) left.push(`${path}:${index + 1}: ${line.trim().slice(0, 160)}`);
    });
    continue;
  }
  writeFileSync(absolute, next);
  rewritten++;
}

if (!check) console.log(`rename-short-prefix-attrs: rewrote ${rewritten} file(s)`);
if (left.length) {
  console.error(`rename-short-prefix-attrs: ${left.length} old short-prefix attribute name(s) left${check ? "" : " in generated files; re-run their generators"}:`);
  for (const line of left) console.error(`  ${line}`);
  process.exit(1);
}
if (check) console.log(`rename-short-prefix-attrs: no old short-prefix attribute names in ${files.length} file(s)`);
