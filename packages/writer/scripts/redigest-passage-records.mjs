#!/usr/bin/env node
/**
 * Re-digest authored passage records against the current Writer catalog.
 *
 * Every record object carrying `schema` and `schemaDigest` under the records
 * root must hold writerPassageSchemaDigest(slot.contract) for its schema's
 * catalog slot. Default mode checks and exits 1 on any stale digest; --write
 * rewrites only the 64 hex characters of each stale digest in place, so the
 * rest of every file stays byte-identical. Requires a built package (dist).
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const DIGEST = /"schemaDigest"(\s*):(\s*)"([0-9a-f]*)"/g;

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

/** Record objects with a digest, in document order (JSON.parse keeps it for these keys). */
function digestHolders(value, out = []) {
  if (Array.isArray(value)) for (const item of value) digestHolders(item, out);
  else if (object(value)) {
    if (Object.hasOwn(value, "schemaDigest")) out.push(value);
    for (const child of Object.values(value)) digestHolders(child, out);
  }
  return out;
}

const withoutDigests = value => Array.isArray(value)
  ? value.map(withoutDigests)
  : object(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "schemaDigest").map(([key, child]) => [key, withoutDigests(child)])) : value;

/**
 * Pure: returns the redigested source text and the stale findings.
 * `expected(schema)` returns the current digest, or undefined when the schema has no single catalog slot.
 */
export function redigestSource(path, source, expected) {
  const value = JSON.parse(source);
  const holders = digestHolders(value);
  const matches = [...source.matchAll(DIGEST)];
  if (matches.length !== holders.length) throw new Error(`${path}: ${matches.length} schemaDigest literals but ${holders.length} parsed holders`);
  const findings = [];
  let output = "";
  let cursor = 0;
  holders.forEach((holder, index) => {
    const match = matches[index];
    const current = match[3];
    if (holder.schemaDigest !== current) throw new Error(`${path}: schemaDigest literal ${index} is out of document order`);
    if (typeof holder.schema !== "string") throw new Error(`${path}: schemaDigest ${index} has no string schema`);
    const digest = expected(holder.schema);
    if (digest === undefined) throw new Error(`${path}: ${holder.id ?? `#${index}`} schema ${holder.schema} resolves to no single passage slot`);
    if (digest === current) return;
    findings.push({ path, id: holder.id ?? null, schema: holder.schema, from: current, to: digest });
    const start = match.index + match[0].length - 1 - current.length;
    output += source.slice(cursor, start) + digest;
    cursor = start + current.length;
  });
  output += source.slice(cursor);
  if (!isDeepStrictEqual(withoutDigests(JSON.parse(output)), withoutDigests(value))) throw new Error(`${path}: redigest changed more than schemaDigest`);
  return { output, findings };
}

export async function run(argv = process.argv.slice(2)) {
  let write = false;
  let recordsRoot = resolve(packageRoot, "src/catalog/records");
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--write") write = true;
    else if (argv[index] === "--check") write = false;
    else if (argv[index] === "--records" && argv[index + 1]) recordsRoot = resolve(argv[++index]);
    else throw new Error("Usage: redigest-passage-records.mjs [--check|--write] [--records <directory>]");
  }
  const { loadWriterStore } = await import(pathToFileURL(resolve(packageRoot, "dist/catalog/ia/index.js")).href);
  const { writerPassageSchemaDigest } = await import(pathToFileURL(resolve(packageRoot, "dist/checks/closed-world.js")).href);
  const slots = new Map();
  for (const slot of loadWriterStore().slots) slots.set(slot.id, [...(slots.get(slot.id) ?? []), slot]);
  const expected = schema => {
    const matches = slots.get(schema) ?? [];
    return matches.length === 1 && matches[0].contract.kind === "passage" ? writerPassageSchemaDigest(matches[0].contract) : undefined;
  };
  const files = [];
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Record source symlinks are not supported");
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(path);
    }
  };
  visit(recordsRoot);
  const findings = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const name = relative(recordsRoot, file).split("\\").join("/");
    const result = redigestSource(name, source, expected);
    findings.push(...result.findings);
    if (write && result.findings.length) writeFileSync(file, result.output);
  }
  for (const finding of findings) console.error(`${write ? "redigested" : "stale"} ${finding.path} ${finding.id ?? ""} ${finding.schema}`);
  console.log(`Writer passage digests: ${files.length} files, ${findings.length} ${write ? "rewritten" : "stale"}.`);
  return write ? 0 : findings.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().then(code => { process.exitCode = code; }, error => {
    console.error(`Writer passage redigest refused: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
