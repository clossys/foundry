#!/usr/bin/env node
/**
 * check:every-candidate-previewable: every placed, valid candidate renders from its own bytes,
 * and only the valid pin is used by pages.
 *
 * Over the repository's slot model (clossys/agents), read through the built Producer:
 *   - Designer element candidates (registry-item JSON) carry a specimen, and the specimen route
 *     accepts the (slot, candidate): the pin is the pinned build's (element, version), every other
 *     valid candidate is one of slotInstallInputs().options, which the route builds on request;
 *   - Director brief and Writer strings candidates carry record rows;
 *   - every candidate except the valid pin is marked `preview`, and the valid pin is not.
 * Designer element candidates are also certified (planner decision D1, src/specimen/library-source.ts
 * certifyCandidate): a candidate whose specimen mounts a component mounts with the slot contract
 * fixture (slot.json `contract.fixture`) and needs no props it does not supply; there is no borrow
 * from a sibling's preview, so a candidate with no preview of its own and no contract fixture has
 * no specimen and is uncertified. An uncertified candidate is a finding unless it is listed in the
 * shrink-only baseline (the consumer's clossys/evidence/check-every-candidate-previewable.baseline.json,
 * the wave-2 data workload); a baseline row that passes, or is no longer checked, is a finding too.
 * Publisher page candidates assemble only: their frame and sections name Designer slots the pinned
 * build holds (or the page is in the baseline's `unassembled` rows). Publication candidates are counted once their format validates (no candidate issues).
 * Producer seat candidates (clossys/agents/producer/<step>/candidates) each parse and validate
 * against the seat schema (pipeline/schemas/seat.schema.json).
 *
 * A slot whose pinned candidate is already invalid (an unplaced slot, a candidate with issues)
 * renders nothing by design; its candidates are not counted as previewable.
 *
 * Usage: node --test packages/producer/scripts/check-every-candidate-previewable.test.mjs
 * CLOSSYS_CHECK_REPO=DIR checks another checkout (built) instead of this one. node --test exits 0
 * with no finding and 1 on any finding.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import { consumerPath } from "./consumer-root.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(process.env.CLOSSYS_CHECK_REPO ?? join(here, "../../.."));
const AGENTS = ["director", "designer", "writer", "publisher"];
const RENDERED = { designer: "specimen", director: "record", writer: "record" };
/** The shrink-only lists, read from the checked checkout: `uncertified` Designer candidates and `unassembled` Publisher pages, each `{ "<slot>": ["<candidate>"] }`. */
export const BASELINE = "clossys/evidence/check-every-candidate-previewable.baseline.json";

function readBaseline(repo) {
  const file = join(repo, BASELINE);
  if (!existsSync(file)) return new Set();
  const doc = JSON.parse(readFileSync(file, "utf8"));
  const rows = section => Object.entries(doc[section] ?? {}).flatMap(([slot, names]) => names.map(name => `${slot}/${name}`));
  return new Set([...rows("uncertified").map(key => `uncertified ${key}`), ...rows("unassembled").map(key => `unassembled ${key}`)]);
}

async function load(repo, rel) {
  const file = join(repo, rel);
  try { return existsSync(file) ? await import(pathToFileURL(file).href) : {}; } catch { return {}; }
}

/**
 * The specimen route's accepted (slot, candidate) set. A pinned slot whose pinned candidate is
 * already invalid stops the whole pinned build; in a temporary copy its pin is dropped (and named)
 * so every other slot can still be checked.
 */
function specimenInputs(repo, slotInstallInputs) {
  if (typeof slotInstallInputs !== "function") return { inputsError: "no slotInstallInputs", dropped: [] };
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "check-every-candidate-previewable-")));
  const consumer = join(temp, "clossys"), dropped = [];
  try {
    cpSync(consumerPath("agents"), join(consumer, "agents"), { recursive: true });
    for (let attempt = 0; attempt <= 50; attempt++) {
      try { return { inputs: slotInstallInputs(consumer), dropped }; }
      catch (error) {
        const slot = /^Specimen slot ([^:]+): (?!native pin hash drift)/.exec(error.message)?.[1];
        const pin = slot && join(consumer, "agents", "designer", slot, "pin.json");
        if (!pin || !existsSync(pin)) return { inputsError: error.message, dropped };
        dropped.push(`designer:${slot} (${error.message})`);
        unlinkSync(pin);
      }
    }
    return { inputsError: "too many invalid pins", dropped };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

export async function checkEveryCandidatePreviewable(repo) {
  const { slotDetail } = await load(repo, "packages/producer/dist/server/slot-detail.js");
  const { listSlots } = await load(repo, "packages/producer/dist/records/slots.js");
  const { slotInstallInputs } = await load(repo, "packages/producer/dist/specimen/slot-install-inputs.js");
  const { certifyCandidate } = await load(repo, "packages/producer/dist/specimen/library-source.js");
  const { pinnedWriterCopy } = await load(repo, "packages/producer/dist/specimen/specimen-tree.js");
  let writer;
  const writerSource = typeof pinnedWriterCopy === "function" ? () => writer ??= pinnedWriterCopy(consumer) : undefined;
  const { readCandidate, listSeats } = await load(repo, "packages/producer/dist/records/slots.js");
  if (typeof slotDetail !== "function" || typeof listSlots !== "function") throw new Error("packages/producer is not built (dist/server/slot-detail.js, dist/records/slots.js)");
  const consumer = consumerPath();
  const { inputs, inputsError, dropped } = specimenInputs(repo, slotInstallInputs);
  const findings = [], uncovered = new Map();
  const counts = { candidates: 0, rendered: 0, previews: 0, certified: 0, baselined: 0, assembled: 0, unassembled: 0, publications: 0, seats: 0 };
  const baseline = readBaseline(repo), checkedBaseline = new Set();
  let certifyMissing = false;
  const certify = (entry, detail, candidate, where) => {
    if (typeof certifyCandidate !== "function" || typeof readCandidate !== "function") {
      if (!certifyMissing) findings.push("designer: candidate certification did not load (dist/specimen/library-source.js certifyCandidate, dist/records/slots.js readCandidate)");
      certifyMissing = true;
      return "missing";
    }
    const key = `uncertified ${entry.id}/${candidate.name}`;
    let result;
    try {
      const { bytes } = readCandidate(consumer, "designer", entry.id, candidate.name);
      result = certifyCandidate({ root: consumer, slot: entry.id, name: candidate.name, bytes, contract: detail.contract, layer: entry.position?.l0, ...(writerSource ? { writerSource } : {}) });
    } catch (error) { result = { certified: false, reasons: [error instanceof Error ? error.message : String(error)] }; }
    if (result.certified) { counts.certified++; return "certified"; }
    if (baseline.has(key)) { counts.baselined++; checkedBaseline.add(key); return "baselined"; }
    findings.push(`${where}: uncertified: ${result.reasons.join("; ")}`);
    return "uncertified";
  };
  const assembles = (entry, candidate, where) => {
    if (typeof readCandidate !== "function") { findings.push(`${where}: the Publisher page did not load (dist/records/slots.js readCandidate)`); return; }
    if (!inputs) { findings.push(`${where}: the specimen inputs did not load: ${inputsError ?? "no slotInstallInputs"}`); return; }
    let page;
    try { page = JSON.parse(readCandidate(consumer, "publisher", entry.id, candidate.name).bytes); }
    catch (error) { findings.push(`${where}: the page does not parse: ${error instanceof Error ? error.message : String(error)}`); return; }
    const named = [page.frame, ...(Array.isArray(page.sections) ? page.sections : [undefined])];
    const loose = named.filter(slot => typeof slot !== "string" || !inputs.pins[slot]);
    if (loose.length) {
      const key = `unassembled ${entry.id}/${candidate.name}`;
      if (baseline.has(key)) { counts.unassembled++; checkedBaseline.add(key); return; }
      findings.push(`${where}: the page assembles slots the pinned Designer build does not hold: ${loose.map(String).join(", ")}`);
      return;
    }
    counts.assembled++;
  };
  const optionKey = (element, version) => `${element}@v${version}`;
  for (const agent of AGENTS) {
    for (const entry of listSlots(consumer, agent)) {
      const detail = slotDetail(repo, agent, entry.id);
      if (!detail) continue;
      const placed = !detail.checks.some(check => check.label?.copy === "studio.check-slot-placed" && !check.ok);
      for (const candidate of detail.candidates) {
        counts.candidates++;
        const where = `${agent}:${entry.id}/${candidate.name}`;
        const validPin = placed && !candidate.issues.length && entry.pin?.candidate === candidate.name && entry.pin.sha256 === candidate.sha256;
        if (candidate.preview !== !validPin) findings.push(`${where}: preview is ${candidate.preview}, expected ${!validPin}`);
        if (candidate.preview) counts.previews++;
        if (!placed || candidate.issues.length) continue;
        // A pinned candidate whose bytes drifted renders nothing; the pin check flags it.
        if (entry.pin?.candidate === candidate.name && !validPin) continue;
        if (agent === "publisher" && detail.kind === "page") { assembles(entry, candidate, where); continue; }
        if (agent === "publisher" && detail.kind === "publication") { counts.publications++; continue; }
        const kind = RENDERED[agent];
        if (!kind || (agent === "designer" && !candidate.name.endsWith(".json"))) {
          uncovered.set(`${agent}:${detail.kind}`, (uncovered.get(`${agent}:${detail.kind}`) ?? 0) + 1);
          continue;
        }
        if (!candidate[kind]) {
          // With no contract fixture to mount (and no preview of its own), a Designer candidate has no
          // specimen: that is the same uncertified row, never a borrowed sibling preview.
          if (agent === "designer" && candidate.name.endsWith(".json") && certify(entry, detail, candidate, where) !== "certified") continue;
          findings.push(`${where}: a valid candidate has no ${kind}`);
          continue;
        }
        counts.rendered++;
        if (agent !== "designer") continue;
        const [, element, version] = /^(.+)-v(\d+)\.json$/.exec(candidate.name);
        if (!inputs) { findings.push(`${where}: the specimen inputs did not load: ${inputsError ?? "no slotInstallInputs"}`); continue; }
        const accepted = validPin
          ? inputs.pins[entry.id]?.element === element && inputs.pins[entry.id]?.version === Number(version)
          : (inputs.options.get(entry.id) ?? []).some(row => typeof row === "object" && optionKey(row.element, row.version) === optionKey(element, Number(version)));
        if (!accepted) findings.push(`${where}: the specimen route does not accept this (slot, candidate)`);
        certify(entry, detail, candidate, where);
      }
    }
  }
  if (!certifyMissing) for (const key of [...baseline].filter(key => !checkedBaseline.has(key)).sort()) findings.push(`baseline ${key}: passes or is no longer checked; remove it from ${BASELINE}`);
  const notes = [];
  checkSeats(consumer, listSeats, await seatSchema(repo), counts, findings, notes);
  return { counts, findings, notes, uncovered: Object.fromEntries(uncovered), dropped, ...(inputsError ? { inputsError } : {}) };
}

/** Every Producer seat candidate parses and validates against the seat schema. */
async function seatSchema(repo) {
  const { loadSchema, validateValue } = await load(repo, "packages/producer/dist/pipeline/schema.js");
  if (typeof loadSchema !== "function" || typeof validateValue !== "function") return undefined;
  const packageRoot = join(repo, "packages/producer");
  return value => validateValue(value, loadSchema("seat", packageRoot), packageRoot);
}
function checkSeats(consumer, listSeats, seatValidator, counts, findings, notes) {
  const tree = join(consumer, "agents", "producer");
  if (!existsSync(tree)) return;
  if (!seatValidator) { findings.push("producer: the seat schema did not load (dist/pipeline/schema.js)"); return; }
  // The seat folders are read from disk: the Producer IA reader refusing the tree must not hide a seat.
  if (typeof listSeats === "function") { try { listSeats(consumer); } catch (error) { notes.push(`the Producer seat reader refuses the tree: ${error instanceof Error ? error.message : String(error)}`); } }
  for (const seat of readdirSync(tree, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()) {
    const dir = join(tree, seat, "candidates");
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter(name => name.endsWith(".json")).sort()) {
      const where = `producer:${seat}/${name}`;
      let value;
      try { value = JSON.parse(readFileSync(join(dir, name), "utf8")); }
      catch { findings.push(`${where}: the seat is not JSON`); continue; }
      const issues = seatValidator(value);
      if (issues.length) { findings.push(`${where}: not a seat: ${issues.map(issue => `${issue.path} ${issue.message}`).join("; ")}`); continue; }
      counts.seats++;
    }
  }
}

// A node:test file: it writes only its own disposable temporary copy, never the checked model.
test("check:every-candidate-previewable", async t => {
  const outcome = await checkEveryCandidatePreviewable(REPO);
  for (const [kind, count] of Object.entries(outcome.uncovered)) t.diagnostic(`uncovered kind (no candidate renderer yet, not a finding): ${kind} ${count} candidate(s)`);
  for (const slot of outcome.dropped) t.diagnostic(`pre-existing invalid pin, the pinned build refuses it (pin dropped in a temporary copy to check the rest): ${slot}`);
  for (const note of outcome.notes) t.diagnostic(`not a finding of this check: ${note}`);
  if (outcome.inputsError) t.diagnostic(`the pinned specimen inputs refuse: ${outcome.inputsError}`);
  const { candidates, rendered, previews } = outcome.counts;
  t.diagnostic(`${rendered} valid candidates render, ${previews} marked preview, of ${candidates}`);
  const { certified, baselined, assembled, unassembled, publications, seats } = outcome.counts;
  t.diagnostic(`designer: ${certified} certified, ${baselined} uncertified in the shrink-only baseline; publisher: ${assembled} pages assemble from pins, ${unassembled} in the shrink-only baseline, ${publications} publications; producer: ${seats} seat candidates valid`);
  assert.deepEqual(outcome.findings, []);
});
