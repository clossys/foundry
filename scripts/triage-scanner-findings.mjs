#!/usr/bin/env node
// This tool accepts metadata reports, never secret scanner matches or values.
// Every ignore entry requires a proof at its exact commit, file and line.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { designSourceProvenance, loadApprovedDesignSources } from "./lib/approved-design-sources.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const safePath = path => typeof path === "string" && !path.startsWith("/") && !/[\\\0\n\r]/.test(path) && path.split("/").every(part => part && part !== "." && part !== "..");
const sha = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const sha256 = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const files = {
  foundation: "scripts/lib/designer-foundation.json",
  aliases: "packages/writer/src/catalog/records/admin-pages.r1.en.json",
  writer: "packages/writer/src/catalog/records/admin-studio.r1.en.json",
  publisher: "packages/publisher/test-fixtures/marketing-reference/evidence.json",
  derivation: "packages/designer/src/importers/tailwind-default.ts",
};

export function gitReader(root) {
  const cache = new Map();
  return (commit, file) => {
    if (!sha(commit) || !safePath(file)) return null;
    const key = `${commit}:${file}`;
    if (!cache.has(key)) {
      try { cache.set(key, execFileSync("git", ["show", key], { cwd: root, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 32 * 1024 * 1024 })); }
      catch { cache.set(key, null); }
    }
    return cache.get(key);
  };
}

function linePair(line) {
  try {
    const object = JSON.parse(`{${line.trim().replace(/,$/, "")}}`);
    const entries = Object.entries(object);
    return entries.length === 1 ? entries[0] : [];
  } catch { return []; }
}

/** Unknown files are not opened. A known filename alone grants no exception. */
export function proveFingerprint(row, readBlob) {
  const blocked = { status: "BLOCKED-SECRET", reason: "No structural proof; leave this fingerprint unignored." };
  if (!sha(row.commit) || !safePath(row.file) || !Number.isSafeInteger(row.line) || row.line < 1 || row.rule !== "generic-api-key" || row.endLine !== row.line ||
    row.fingerprint !== `${row.commit}:${row.file}:${row.rule}:${row.line}` || !Object.values(files).includes(row.file)) return blocked;
  const bytes = readBlob(row.commit, row.file);
  if (!bytes) return blocked;
  const contents = bytes.toString("utf8"), lines = contents.split("\n"), line = lines[row.line - 1];
  if (typeof line !== "string") return blocked;
  const [key, value] = linePair(line);
  const proven = reason => ({ status: "false-positive", reason });
  if (row.file === files.derivation) {
    // A finite explanatory rule in a typed map, subsequently assigned to
    // meta.derivation.rule. Neither the matched text nor a credential is emitted.
    const start = contents.indexOf("const rules: Record<string, string> = {");
    const end = contents.indexOf("\n    };", start);
    const offset = lines.slice(0, row.line - 1).reduce((sum, text) => sum + text.length + 1, 0);
    if (start >= 0 && end > start && offset > start && offset < end && key === "tokens.diverging-color" && typeof value === "string" &&
      /^positive=blue\.600; negative=red\.600; .+$/.test(value) &&
      contents.includes('meta.derivation = { from: "dtcg#alias", rule: rules[meta.slot]! }')) {
      return proven("Design-token derivation explanation in typed rules map, assigned to meta.derivation.rule; not an authentication token.");
    }
    return blocked;
  }
  let document;
  try { document = JSON.parse(contents); } catch { return blocked; }
  const hashesSource = (commit, path, expected) => {
    if (!sha256(expected)) return false;
    const source = readBlob(commit, path);
    return source !== null && digest(source) === expected;
  };
  if (row.file === files.foundation && document.schema === "designer-foundation/v1" && document.files?.[key] === value && safePath(key) &&
    hashesSource(document.sourceTree, `packages/designer/${key}`, value)) {
    return proven("SHA-256 source-blob digest in Designer foundation receipt; recomputed from its recorded immutable source tree.");
  }
  if (row.file === files.aliases && document.version === 1 && document.aliases?.[key] === value && /^strings\.admin\.[a-z0-9.-]+$/.test(key) &&
    typeof value === "string" && /^st\.[a-z0-9]{10}$/.test(value)) {
    if (Array.isArray(document.records) && document.records.some(record => record.id === value)) return proven("Writer alias maps a design-token label to an existing copy record ID; verified against the same envelope's records.");
    if (Array.isArray(document.externalRecords) && document.externalRecords.some(record => record.recordId === value)) return proven("Writer alias names an explicitly declared external copy record ID with the Writer ID grammar; not a credential.");
  }
  if (row.file === files.writer && sha256(value)) {
    const batches = [document, ...(Array.isArray(document.sourceBatches) ? document.sourceBatches : [])];
    if (batches.some(batch => batch.sourceFiles?.[key] === value && safePath(key) && hashesSource(batch.sourceCommit, key, value))) {
      return proven("SHA-256 digest in Writer sourceFiles; recomputed from that batch's immutable source commit.");
    }
  }
  if (row.file === files.publisher && key === "designerTokensSha256" && document.inputs?.[key] === value &&
    [document.fixtureSourceCommit, document.fixtureSourceTree, document.baseline?.commit].some(commit =>
      ["packages/designer/src/tokens/tokens.ts", "packages/designer/src/tokens/tokens.json", "packages/designer/styles/tokens.css"].some(path => hashesSource(commit, path, value)))) {
    return proven("SHA-256 design-token input digest in marketing fixture evidence; recomputed from its recorded immutable source.");
  }
  return blocked;
}

export function groupFindings(rows, ruleKey) {
  const groups = new Map();
  for (const row of rows) {
    if (!safePath(row.file) || typeof row[ruleKey] !== "string") throw new Error("Invalid metadata finding");
    const key = `${row[ruleKey]}\0${row.file}`;
    if (!groups.has(key)) groups.set(key, { rule: row[ruleKey], file: row.file, findings: [] });
    groups.get(key).findings.push(row);
  }
  return [...groups.values()].sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule));
}

export function nameForeignNeed(group) {
  const id = digest(JSON.stringify([group.rule, group.file])).slice(0, 16);
  return { id: `NEED-FOREIGN-${id}`, ...group, status: "NEED" };
}

export function generateIgnore(proofs) {
  const seen = new Set();
  const lines = ["# Exact historical fingerprints, each backed by structural evidence."];
  for (const row of [...proofs].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint))) {
    if (row.status !== "false-positive" || seen.has(row.fingerprint)) continue;
    if (!/^[a-f0-9]{40}:[^\n\r:*?\[\]{}]+:[a-z0-9-]+:[1-9][0-9]*$/.test(row.fingerprint) || /[\n\r]/.test(row.reason)) throw new Error("Invalid fingerprint proof");
    seen.add(row.fingerprint);
    lines.push(`# ${row.reason}`, row.fingerprint);
  }
  return `${lines.join("\n")}\n`;
}

export function triage(root, foreign, leaks) {
  const fields = { foreign: new Set(["file", "line", "kind", "reference"]), leaks: new Set(["file", "line", "endLine", "column", "endColumn", "commit", "fingerprint", "rule"]) };
  for (const [label, rows] of [["foreign", foreign], ["leaks", leaks]]) {
    if (!Array.isArray(rows) || rows.some(row => row === null || typeof row !== "object" || Object.keys(row).some(key => !fields[label].has(key)))) throw new Error("Only metadata report fields are accepted");
  }
  const sources = loadApprovedDesignSources(root), readBlob = gitReader(root);
  const foreignGroups = groupFindings(foreign, "kind").map(group => {
    const carried = designSourceProvenance(readFileSync(join(root, group.file), "utf8"), sources);
    const references = [...new Set(group.findings.map(row => row.reference))];
    const approvals = sources.filter(source => references.some(reference => group.rule === "forge-slug" ? reference.toLowerCase() === source.repository : reference.toLowerCase() === `@${source.scope}`));
    return nameForeignNeed({ rule: group.rule, file: group.file, count: group.findings.length,
      approvedSources: approvals.map(source => ({ registry: source.registry, provenanceFile: source.provenanceFile, carried: carried.has(source.registry) })),
      reason: approvals.length ? "Approved source references lack file-local provenance; other references in this group remain unapproved." : "No approved source owns these references; no admission granted." });
  });
  const proofs = leaks.map(row => ({ file: row.file, rule: row.rule, fingerprint: row.fingerprint, ...proveFingerprint(row, readBlob) }));
  const leakGroups = groupFindings(proofs, "rule").map(group => ({ file: group.file, rule: group.rule, count: group.findings.length,
    falsePositives: group.findings.filter(row => row.status === "false-positive").length,
    blocked: group.findings.filter(row => row.status === "BLOCKED-SECRET").length,
    reasons: [...new Set(group.findings.map(row => row.reason))] }));
  return { foreignGroups, leakGroups, proofs, ignore: generateIgnore(proofs) };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [foreignPath, leaksPath, output] = process.argv.slice(2);
    if (!foreignPath || !leaksPath || !output) throw new Error("Usage: triage-scanner-findings.mjs FOREIGN_METADATA LEAK_METADATA OUTPUT_DIRECTORY");
    const result = triage(process.cwd(), JSON.parse(readFileSync(foreignPath, "utf8")), JSON.parse(readFileSync(leaksPath, "utf8")));
    mkdirSync(output, { recursive: true });
    for (const key of ["foreignGroups", "leakGroups", "proofs"]) writeFileSync(join(output, `${key}.json`), `${JSON.stringify(result[key], null, 2)}\n`);
    writeFileSync(join(output, "gitleaksignore.proposed"), result.ignore);
    console.log(JSON.stringify({ foreignGroups: result.foreignGroups.length, leakGroups: result.leakGroups, falsePositives: result.proofs.filter(row => row.status === "false-positive").length, blocked: result.proofs.filter(row => row.status === "BLOCKED-SECRET").length }));
  } catch { console.error("Scanner triage could not validate its metadata or proof inputs; diagnostic contents withheld."); process.exitCode = 2; }
}
