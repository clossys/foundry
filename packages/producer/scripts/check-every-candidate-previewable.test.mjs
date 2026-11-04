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
 * Publisher page and publication candidates have no candidate renderer yet: they are counted and
 * listed as uncovered kinds, not findings, so the gap stays visible.
 *
 * A slot whose pinned candidate is already invalid (an unplaced slot, a candidate with issues)
 * renders nothing by design; its candidates are not counted as previewable.
 *
 * Usage: node --test packages/producer/scripts/check-every-candidate-previewable.test.mjs
 * CLOSSYS_CHECK_REPO=DIR checks another checkout (built) instead of this one. node --test exits 0
 * with no finding and 1 on any finding.
 */
import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(process.env.CLOSSYS_CHECK_REPO ?? join(here, "../../.."));
const AGENTS = ["director", "designer", "writer", "publisher"];
const RENDERED = { designer: "specimen", director: "record", writer: "record" };

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
    cpSync(join(repo, "clossys", "agents"), join(consumer, "agents"), { recursive: true });
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
  if (typeof slotDetail !== "function" || typeof listSlots !== "function") throw new Error("packages/producer is not built (dist/server/slot-detail.js, dist/records/slots.js)");
  const consumer = join(repo, "clossys");
  const { inputs, inputsError, dropped } = specimenInputs(repo, slotInstallInputs);
  const findings = [], uncovered = new Map(), counts = { candidates: 0, rendered: 0, previews: 0 };
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
        const kind = RENDERED[agent];
        if (!kind || (agent === "designer" && !candidate.name.endsWith(".json"))) {
          uncovered.set(`${agent}:${detail.kind}`, (uncovered.get(`${agent}:${detail.kind}`) ?? 0) + 1);
          continue;
        }
        if (!candidate[kind]) { findings.push(`${where}: a valid candidate has no ${kind}`); continue; }
        counts.rendered++;
        if (agent !== "designer") continue;
        const [, element, version] = /^(.+)-v(\d+)\.json$/.exec(candidate.name);
        if (!inputs) { findings.push(`${where}: the specimen inputs did not load: ${inputsError ?? "no slotInstallInputs"}`); continue; }
        const accepted = validPin
          ? inputs.pins[entry.id]?.element === element && inputs.pins[entry.id]?.version === Number(version)
          : (inputs.options.get(entry.id) ?? []).some(row => typeof row === "object" && optionKey(row.element, row.version) === optionKey(element, Number(version)));
        if (!accepted) findings.push(`${where}: the specimen route does not accept this (slot, candidate)`);
      }
    }
  }
  return { counts, findings, uncovered: Object.fromEntries(uncovered), dropped, ...(inputsError ? { inputsError } : {}) };
}

// A node:test file: it writes only its own disposable temporary copy, never the checked model.
test("check:every-candidate-previewable", async t => {
  const outcome = await checkEveryCandidatePreviewable(REPO);
  for (const [kind, count] of Object.entries(outcome.uncovered)) t.diagnostic(`uncovered kind (no candidate renderer yet, not a finding): ${kind} ${count} candidate(s)`);
  for (const slot of outcome.dropped) t.diagnostic(`pre-existing invalid pin, the pinned build refuses it (pin dropped in a temporary copy to check the rest): ${slot}`);
  if (outcome.inputsError) t.diagnostic(`the pinned specimen inputs refuse: ${outcome.inputsError}`);
  const { candidates, rendered, previews } = outcome.counts;
  t.diagnostic(`${rendered} valid candidates render, ${previews} marked preview, of ${candidates}`);
  assert.deepEqual(outcome.findings, []);
});
