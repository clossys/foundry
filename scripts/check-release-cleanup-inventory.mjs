#!/usr/bin/env node
// Validate the closed, value-free inventory that gates the W1F clean-release
// unit.  The inventory describes immutable public metadata only; it never
// stores the client-local path values that caused the affected releases.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadTransitionPolicy } from "./lib/package-identity-transition.mjs";

const INVENTORY_PATH = "governance/release-cleanup/clossys-npmjs-affected.json";
const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA512 = /^[a-f0-9]{128}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const REQUIRED_FIELDS = ["repository", "bugs", "homepage", "_from", "_resolved"];
const REPLACEMENTS = new Map([
  ["@clossys/advisor", "0.1.6"],
  ["@clossys/starter", "0.1.5"],
  ["@clossys/controller", "0.8.24"],
  ["@clossys/strategist", "0.1.2"],
]);
const errors = [];
const fail = (message) => errors.push(message);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const digest = (algorithm, value) => createHash(algorithm).update(value).digest("hex");

let inventory;
try { inventory = JSON.parse(readFileSync(INVENTORY_PATH, "utf8")); }
catch (error) { console.error(`release cleanup inventory unavailable: ${error.message}`); process.exit(2); }

let transition;
try { transition = loadTransitionPolicy("governance/package-identity-transition.json"); }
catch (error) { console.error(`release cleanup transition unavailable: ${error.message}`); process.exit(2); }

const topKeys = ["$comment", "schemaVersion", "kind", "issue", "baseCommit", "repository", "historical", "observedAt", "status", "rows"];
if (!exactKeys(inventory, topKeys)) fail("inventory has unknown or missing top-level fields");
if (inventory.schemaVersion !== 1 || inventory.kind !== "clossys-npmjs-affected-version-inventory-v1") fail("inventory schema identity is invalid");
if (inventory.issue !== 651) fail("inventory must bind issue #651");
if (!SHA1.test(inventory.baseCommit ?? "")) fail("inventory baseCommit must be a SHA-1");
try { execFileSync("git", ["cat-file", "-e", `${inventory.baseCommit}^{commit}`], { stdio: "ignore" }); }
catch { fail("inventory baseCommit must resolve to a commit"); }
if (inventory.repository !== transition.candidate.repository) fail("inventory repository must bind the candidate repository");
if (!exactKeys(inventory.historical, ["repository", "repositoryId"]) || inventory.historical.repository !== transition.historicalRepositories?.[0] || inventory.historical.repositoryId !== transition.historicalRepositoryIds?.[0]) fail("inventory historical repository does not bind the closed transition policy");
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(inventory.observedAt ?? "")) fail("inventory observedAt must be a canonical UTC instant");
if (inventory.status !== "closed") fail("inventory must be closed before cleanup qualification proceeds");

const expected = (transition.historicalRepositoryVersions ?? []).map(({ name, version }) => `${name}\0${version}`).sort();
const rows = Array.isArray(inventory.rows) ? inventory.rows : [];
if (rows.length !== expected.length) fail(`inventory must contain exactly ${expected.length} rows`);
const seen = new Set();
for (const row of rows) {
  const keys = ["name", "version", "replacementVersion", "affectedFields", "historicalRepository", "metadataSha256", "tarball", "disposition"];
  if (!exactKeys(row, keys)) { fail("inventory row has unknown or missing fields"); continue; }
  const key = `${row.name}\0${row.version}`;
  if (seen.has(key)) fail(`duplicate inventory row ${row.name}@${row.version}`);
  seen.add(key);
  if (!expected.includes(key)) fail(`inventory row is not in the closed transition version set: ${row.name}@${row.version}`);
  if (row.historicalRepository !== inventory.historical.repository) fail(`historical repository mismatch for ${key}`);
  if (row.replacementVersion !== REPLACEMENTS.get(row.name) || !VERSION.test(row.replacementVersion ?? "")) fail(`replacement version mismatch for ${key}`);
  if (JSON.stringify(row.affectedFields) !== JSON.stringify(REQUIRED_FIELDS)) fail(`affected field classification mismatch for ${key}`);
  if (!SHA256.test(row.metadataSha256 ?? "")) fail(`metadata digest invalid for ${key}`);
  if (!exactKeys(row.tarball, ["sha1", "sha256", "sha512"]) || !SHA1.test(row.tarball.sha1 ?? "") || !SHA256.test(row.tarball.sha256 ?? "") || !SHA512.test(row.tarball.sha512 ?? "")) fail(`tarball digest tuple invalid for ${key}`);
  if (row.disposition !== "replace-then-retire") fail(`disposition mismatch for ${key}`);
}
if (JSON.stringify([...seen].sort()) !== JSON.stringify(expected)) fail("inventory rows do not exactly match the transition policy version set");

for (const [name, version] of REPLACEMENTS) {
  try {
    const manifest = JSON.parse(readFileSync(`packages/${name.slice(name.indexOf("/") + 1)}/package.json`, "utf8"));
    if (manifest.name !== name || manifest.version !== version) fail(`replacement manifest mismatch for ${name}`);
  } catch { fail(`replacement manifest unavailable for ${name}`); }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`[release-cleanup-inventory] ${error}`);
  process.exit(1);
}
console.log(`release cleanup inventory OK — ${rows.length} affected public versions, value-free and closed.`);
