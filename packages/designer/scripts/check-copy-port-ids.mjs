#!/usr/bin/env node
/**
 * Class check: every copy port a section or passage contract declares is a lowercase id.
 *
 * A copy key is a dot path whose segments are lowercase kebab-case words, each optionally
 * followed by `[]` array markers (`plans[].price-by-interval[].price-text`). Writer record
 * ids embed these keys (`<surface>.<key>`), and the Writer id rule rejects capitals, so a
 * camelCase port in any contract is a record no consumer can write.
 *
 * Covered sources (paths relative to the repository root):
 * - Designer section slots: `contract.copy.fields[].key`
 * - Designer generated slot contracts: `contract.copy.fields[].key`
 * - Writer passage contracts: `limits.fields` keys and reference exemplar `fields` keys
 * - Writer derived passage slots: `contract.copy.fields[].key`
 *
 * Usage: node scripts/check-copy-port-ids.mjs [--root <repository>]   exit 0 clean, 1 findings, 2 could not run.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const COPY_PORT_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\[\])*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\[\])*)*$/;

export const COPY_PORT_SOURCES = [
  { path: "packages/designer/src/catalog/slots/sections.json", read: doc => slotKeys(doc) },
  { path: "packages/designer/src/catalog/slot-contracts/sections.json", read: doc => slotKeys(doc) },
  { path: "packages/writer/src/slot-contracts/contracts/passages.json", read: doc => passageContractKeys(doc) },
  { path: "packages/writer/src/catalog/slots/passages.json", read: doc => slotKeys(doc) },
];

const list = doc => Array.isArray(doc) ? doc : Array.isArray(doc?.slots) ? doc.slots : [];

function slotKeys(doc) {
  return list(doc).flatMap(slot => (slot?.contract?.copy?.fields ?? []).map(field => ({ slot: slot.id, key: field?.key, where: "contract.copy.fields" })));
}

function passageContractKeys(doc) {
  return list(doc).flatMap(slot => [
    ...Object.keys(slot?.limits?.fields ?? {}).map(key => ({ slot: slot.id, key, where: "limits.fields" })),
    ...(slot?.references ?? []).flatMap(reference => (reference?.exemplars ?? []).flatMap(exemplar => Object.keys(exemplar?.fields ?? {}).map(key => ({ slot: slot.id, key, where: `references.${reference.id}.exemplars.fields` })))),
  ]);
}

/** Returns one finding per copy port that is not a lowercase id. Throws when a source is missing. */
export function checkCopyPortIds(root) {
  const findings = [];
  for (const source of COPY_PORT_SOURCES) {
    const file = join(root, source.path);
    if (!existsSync(file)) throw new Error(`missing copy-port source ${source.path}`);
    for (const port of source.read(JSON.parse(readFileSync(file, "utf8")))) {
      if (typeof port.key === "string" && COPY_PORT_ID_RE.test(port.key)) continue;
      findings.push({ file: source.path, slot: port.slot, key: port.key, message: `${source.path}: ${port.slot} ${port.where} declares copy port ${JSON.stringify(port.key)}, which is not a lowercase id` });
    }
  }
  return findings;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--root");
  const root = resolve(at >= 0 ? args[at + 1] ?? "" : join(dirname(fileURLToPath(import.meta.url)), "../../.."));
  let findings;
  try { findings = checkCopyPortIds(root); } catch (error) { console.error(`check-copy-port-ids: ${error.message}`); process.exit(2); }
  for (const finding of findings) console.error(finding.message);
  console.log(`check-copy-port-ids: ${findings.length} finding(s) across ${COPY_PORT_SOURCES.length} contract source(s)`);
  process.exit(findings.length ? 1 : 0);
}
