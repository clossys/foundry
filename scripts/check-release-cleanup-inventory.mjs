#!/usr/bin/env node
// Validate the closed, value-free W1F inventory that gates the clean-release
// unit. The observed tuples and source basis are sealed here so a same-shape
// digest substitution or a merely resolvable commit cannot pass.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { loadTransitionPolicy } from "./lib/package-identity-transition.mjs";

export const INVENTORY_PATH = "governance/release-cleanup/clossys-npmjs-affected.json";
export const OBSERVED_BASE_COMMIT = "811bd25d9449037728a11504c7fcf3d90723d01a";
export const OBSERVED_AT = "2026-08-31T04:31:34Z";
export const METADATA_CANONICALIZATION = Object.freeze({
  source: "credentialless-public-npm-exact-version-document-v1",
  projection: "complete-response-json",
  algorithm: "recursive-key-sorted-json-v1",
  encoding: "utf8",
  trailingNewline: false,
  arrays: "preserve-order",
});

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

// These are the seven observed public tuples. Keeping the complete tuple in
// code makes each retained digest independently reviewable and prevents a
// same-length replacement from becoming a new accepted observation.
const SEALED_TUPLES = new Map([
  ["@clossys/advisor\u00000.1.3", { replacementVersion: "0.1.6", metadataSha256: "f71262d2b2328eb7421db13f953b0d27b84df18790e907681053f3af7ca04917", tarball: { sha1: "963eb83f920f6d67dec62e9215b499d611484e4b", sha256: "09fafeda20800f284ec9570026bb72479c89ba40241004d932cc73e7dc1792b6", sha512: "655a1dd201bd168f5e93a26cc25cb89d15029a7dfdc84b73eaa556e8accd64921119ba2866dc0da142d282e2e18b09d2aa1493c2ae10983bcdfa6727b2fffefb" } }],
  ["@clossys/advisor\u00000.1.5", { replacementVersion: "0.1.6", metadataSha256: "5d7ea5589159023c8057ae344bbc884e76689e4c823511752fd84776f67161c4", tarball: { sha1: "b26d15ace747a3a4b3232a8a21532a467855f314", sha256: "a29adc6037561fcee821672ab63ba765d45922832d83491edf9783cbb8bd050c", sha512: "618f2d4ed720aee256daf95089b70bd4ac766f2624a44f06780ce436f59985e75ec9e8d0858a16798f09745f3f7d044a4c79e067894a40cc0f0f759f433ca950" } }],
  ["@clossys/controller\u00000.8.21", { replacementVersion: "0.8.24", metadataSha256: "48444863b8eee5020a65514299be63146ff8fedde0cfccd94d410ca850ae5588", tarball: { sha1: "5bbe54d2a621cbeae9f7774e9d26eea0607edd36", sha256: "d3989fc27481519523c8663e4dc914cb896c9f182d25fb1b675ecdb5d3d5bc39", sha512: "4f37786d5453457eb449ce469a852196b3c3780e0f21dde69b624112ca3ec956b478bd7d4229c94d537b8bf8292ef8313bcee814efa5c04f05ef297922bc5c0a" } }],
  ["@clossys/controller\u00000.8.23", { replacementVersion: "0.8.24", metadataSha256: "0691ebaaaff6486044d13fa781d0de6499f176e7a19b4af32abdac23111ac0cf", tarball: { sha1: "9d61d760701204712d84a3e710677c4b36900c9a", sha256: "d3d7176dc043faeabb96336f1c29ce230a1d63f4f03721ddd3e4cfce26d988f5", sha512: "ffc76c870fcf4a7d95ba17adee5dc264ee508efc9e2f7dcbfb7265e6501c66a39f8cbe57fc584b5f5c4c10da0fc37664cbcb9a15bb1886a8316bc81c3309fbff" } }],
  ["@clossys/starter\u00000.1.2", { replacementVersion: "0.1.5", metadataSha256: "43473b7b674e3188393fd9409bbdf7a962a209754dc251b916c1f5447e2fa06f", tarball: { sha1: "7222feb7c91f021e8479e720a0b8ebcce912f91b", sha256: "7690826525ff4f3fc336ba4a0bf9ffaedf265a217f5eabf369d7074fdcca6835", sha512: "fe11440f85ef69d2f66cc5a9d95673e0d5cff318392f47dd97b8c297ad0b8f7cde4622918203af2772099d67eae6889be87a15d4f0ae7ba347ce55e003acd05c" } }],
  ["@clossys/starter\u00000.1.4", { replacementVersion: "0.1.5", metadataSha256: "ac16ca9de2ed46a1c48f88656a1baa9f72d8fbd155a9b3ecb306047ea64d14c0", tarball: { sha1: "86b2d453a0107c5a62e7e0437c9cc3982584ae1f", sha256: "10fd0d0d406f94d080c78e6e842c4a878872f1bb9d8d620e39477f2c86491568", sha512: "5b0ef9862fe9a5126e2367c8f10f786c6a6d97bf89f158fcc58237a1ea9ed582c25e65790cde3964a5de3bf3441c0036f8629fccabd805844c7d3d948da17d5a" } }],
  ["@clossys/strategist\u00000.1.1", { replacementVersion: "0.1.2", metadataSha256: "2294db813aab514c8d5e35b8761edadd80739f973a34715ba9e54758f3ef150c", tarball: { sha1: "06d7618e03ea58651feb4ba872e6c351de5c0f79", sha256: "b3db2c551bd2aa0e98ce5da4e3bd82655da135c6b0b666521a3143bdded24205", sha512: "a972d02967e33dd253d892157a70a4cbf9eb46366648d90126c75fe06382d110e82886f1a6113391d332c42b6c5b85438b9440c0bc2058a63c4388465af7bdee" } }],
]);

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const digest = (algorithm, value) => createHash(algorithm).update(value).digest("hex");

/**
 * Canonicalize the complete JSON value returned by the credentialless public
 * npm exact-version endpoint. Object keys are recursive and lexicographic;
 * arrays retain registry order; the UTF-8 hash input has no trailing newline.
 */
export function canonicalMetadataJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalMetadataJson).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalMetadataJson(value[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("metadata contains a non-JSON value");
  return encoded;
}

export function canonicalMetadataSha256(value) {
  return digest("sha256", canonicalMetadataJson(value));
}

export function validateReleaseCleanupInventory({ root = process.cwd(), inventory, transition, head = "HEAD" } = {}) {
  const errors = [];
  const fail = (message) => errors.push(message);
  const topKeys = ["$comment", "schemaVersion", "kind", "issue", "baseCommit", "repository", "historical", "observedAt", "metadataCanonicalization", "status", "rows"];
  if (!exactKeys(inventory, topKeys)) fail("inventory has unknown or missing top-level fields");
  if (inventory.schemaVersion !== 2 || inventory.kind !== "clossys-npmjs-affected-version-inventory-v2") fail("inventory schema identity is invalid");
  if (inventory.issue !== 651) fail("inventory must bind issue #651");
  if (inventory.baseCommit !== OBSERVED_BASE_COMMIT) fail("inventory baseCommit must bind the sealed observation basis");
  try {
    execFileSync("git", ["-C", root, "cat-file", "-e", `${inventory.baseCommit}^{commit}`], { stdio: "ignore" });
    execFileSync("git", ["-C", root, "merge-base", "--is-ancestor", inventory.baseCommit, head], { stdio: "ignore" });
  } catch { fail("inventory baseCommit must be the sealed observed commit and an ancestor of the checked head"); }
  if (inventory.repository !== transition?.candidate?.repository) fail("inventory repository must bind the candidate repository");
  if (!exactKeys(inventory.historical, ["repository", "repositoryId"]) || inventory.historical.repository !== transition.historicalRepositories?.[0] || inventory.historical.repositoryId !== transition.historicalRepositoryIds?.[0]) fail("inventory historical repository does not bind the closed transition policy");
  if (inventory.observedAt !== OBSERVED_AT) fail("inventory observedAt must bind the sealed observation instant");
  if (
    !exactKeys(inventory.metadataCanonicalization, Object.keys(METADATA_CANONICALIZATION))
    || Object.entries(METADATA_CANONICALIZATION).some(([key, value]) => inventory.metadataCanonicalization[key] !== value)
  ) fail("inventory metadata canonicalization does not bind the declared reproducible algorithm");
  if (inventory.status !== "closed") fail("inventory must be closed before cleanup qualification proceeds");

  const expected = (transition?.historicalRepositoryVersions ?? []).map(({ name, version }) => `${name}\0${version}`).sort();
  const rows = Array.isArray(inventory.rows) ? inventory.rows : [];
  if (rows.length !== expected.length || rows.length !== SEALED_TUPLES.size) fail(`inventory must contain exactly ${SEALED_TUPLES.size} sealed rows`);
  const seen = new Set();
  for (const row of rows) {
    const keys = ["name", "version", "replacementVersion", "affectedFields", "historicalRepository", "metadataSha256", "tarball", "disposition"];
    if (!exactKeys(row, keys)) { fail("inventory row has unknown or missing fields"); continue; }
    const key = `${row.name}\0${row.version}`;
    if (seen.has(key)) fail(`duplicate inventory row ${row.name}@${row.version}`);
    seen.add(key);
    const sealed = SEALED_TUPLES.get(key);
    if (!sealed) fail(`inventory row is not one of the seven sealed observed tuples: ${row.name}@${row.version}`);
    if (!expected.includes(key)) fail(`inventory row is not in the closed transition version set: ${row.name}@${row.version}`);
    if (row.historicalRepository !== inventory.historical.repository) fail(`historical repository mismatch for ${key}`);
    if (row.replacementVersion !== REPLACEMENTS.get(row.name) || !VERSION.test(row.replacementVersion ?? "")) fail(`replacement version mismatch for ${key}`);
    if (JSON.stringify(row.affectedFields) !== JSON.stringify(REQUIRED_FIELDS)) fail(`affected field classification mismatch for ${key}`);
    if (!SHA256.test(row.metadataSha256 ?? "")) fail(`metadata digest invalid for ${key}`);
    if (!exactKeys(row.tarball, ["sha1", "sha256", "sha512"]) || !SHA1.test(row.tarball.sha1 ?? "") || !SHA256.test(row.tarball.sha256 ?? "") || !SHA512.test(row.tarball.sha512 ?? "")) fail(`tarball digest tuple invalid for ${key}`);
    if (sealed && (row.replacementVersion !== sealed.replacementVersion || row.metadataSha256 !== sealed.metadataSha256 || JSON.stringify(row.tarball) !== JSON.stringify(sealed.tarball))) fail(`sealed observed tuple mismatch for ${key}`);
    if (row.disposition !== "replace-then-retire") fail(`disposition mismatch for ${key}`);
  }
  if (JSON.stringify([...seen].sort()) !== JSON.stringify(expected) || seen.size !== SEALED_TUPLES.size) fail("inventory rows do not exactly match the transition policy version set");
  for (const [name, version] of REPLACEMENTS) {
    try {
      const manifest = JSON.parse(readFileSync(`${root}/packages/${name.slice(name.indexOf("/") + 1)}/package.json`, "utf8"));
      if (manifest.name !== name || manifest.version !== version) fail(`replacement manifest mismatch for ${name}`);
    } catch { fail(`replacement manifest unavailable for ${name}`); }
  }
  return errors;
}

if (process.argv[1] && process.argv[1].endsWith("check-release-cleanup-inventory.mjs")) {
  const root = process.cwd();
  try {
    const inventory = JSON.parse(readFileSync(`${root}/${INVENTORY_PATH}`, "utf8"));
    const transition = loadTransitionPolicy(`${root}/governance/package-identity-transition.json`);
    const errors = validateReleaseCleanupInventory({ root, inventory, transition });
    if (errors.length > 0) {
      for (const error of errors) console.error(`[release-cleanup-inventory] ${error}`);
      process.exit(1);
    }
    console.log(`release cleanup inventory OK — ${inventory.rows.length} sealed affected public versions, value-free and closed.`);
  } catch (error) {
    console.error(`release cleanup inventory unavailable: ${error.message}`);
    process.exit(2);
  }
}
