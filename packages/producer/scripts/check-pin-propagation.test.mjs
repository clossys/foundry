#!/usr/bin/env node
/**
 * check:pin-propagation: a pin is the one wire from a slot to everything that renders it.
 *
 * In a temporary copy of the repository's slot model (clossys/agents), through the built
 * Producer and Publisher modules of the checked repository:
 *
 *   1. Drift. One byte appended to a pinned Designer candidate (one the home page resolves) and
 *      to the pinned Publisher page candidate:
 *        - Studio detail flags it: studio.check-pin-matches fails with studio.check-pin-hash-mismatch,
 *          and the drifted candidate renders no specimen or record;
 *        - the page build refuses it: designerPins (the first step of publish --install) throws
 *          "native pin hash drift", pageRecordFromCell and readPinnedPublication throw hash drift.
 *   2. Repin. The same Designer slot and page.home are repinned to another valid candidate through
 *      the one writer (records/slot-write.ts writePin):
 *        - Studio detail changes: the new candidate is pinned, shown, not a preview, and its
 *          specimen (slot, element, version) is the one the pinned build renders;
 *        - the specimen inputs change: slotInstallInputs().pins and its fingerprint;
 *        - Publisher output changes: the home page's resolved item (resolvePage itemHash) for the
 *          Designer slot, and the projected Studio publication for page.home.
 *
 * A pinned slot whose pinned candidate is already invalid in the source model would stop the
 * pinned build before the probe; its pin is dropped in the copy and named in the output.
 *
 * Usage: node --test packages/producer/scripts/check-pin-propagation.test.mjs
 * CLOSSYS_CHECK_REPO=DIR checks another checkout (built) instead of this one; one subtest per
 * assertion, so node --test exits 0 when every assertion holds and 1 otherwise.
 */
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import assert from "node:assert/strict";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(process.env.CLOSSYS_CHECK_REPO ?? join(here, "../../.."));
const DESIGNER_PROBE_PAGE = "page.home";
const STUDIO_PUBLICATION = "studio";
// A planner repin: G15 requires the basis, and a planner decider records basis planner.
const PROBE = { decidedBy: "planner:check-pin-propagation", basis: "planner", at: "2026-01-01T00:00:00.000Z" };

async function modules(repo) {
  const load = async (rel, names) => {
    const file = join(repo, rel);
    let mod = {};
    // A module that is absent or does not link is an unbuilt entry point, reported as missing.
    try { if (existsSync(file)) mod = await import(pathToFileURL(file).href); } catch { mod = {}; }
    return Object.fromEntries(names.map(name => [name, mod[name]]));
  };
  return {
    ...await load("packages/producer/dist/server/slot-detail.js", ["slotDetail"]),
    ...await load("packages/producer/dist/specimen/slot-install-inputs.js", ["slotInstallInputs"]),
    ...await load("packages/producer/dist/specimen/library-source.js", ["libraryRecordSource"]),
    ...await load("packages/producer/dist/publish/install.js", ["designerPins", "pageRecordFromCell", "writerCopy"]),
    ...await load("packages/producer/dist/publish/pinned-publication.js", ["readPinnedPublication"]),
    ...await load("packages/producer/dist/records/slot-write.js", ["writePin"]),
    ...await load("packages/producer/dist/records/slots.js", ["listSlots", "readCandidate"]),
    ...await load("packages/publisher/dist/install/index.js", ["resolvePage"]),
  };
}

export async function checkPinPropagation(repo) {
  const results = [], notes = [];
  const assert = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), ...(detail ? { detail } : {}) }); return Boolean(ok); };
  const m = await modules(repo);
  const missing = Object.entries(m).filter(([, value]) => typeof value !== "function").map(([name]) => name);
  assert("the reader, writer, Studio detail, specimen inputs and Publisher entry points are built", !missing.length, missing.length ? `missing: ${missing.join(", ")}` : "");
  // The publication projection through the one reader is asserted below; without it those assertions fail.
  if (missing.some(name => name !== "readPinnedPublication")) return { results, notes };

  const temp = realpathSync(mkdtempSync(join(tmpdir(), "check-pin-propagation-")));
  try {
    const consumer = join(temp, "clossys");
    cpSync(join(repo, "clossys", "agents"), join(consumer, "agents"), { recursive: true });
    const slotPath = (agent, id) => join(consumer, "agents", agent, id);
    const publication = async () => m.readPinnedPublication ? m.readPinnedPublication(consumer, STUDIO_PUBLICATION) : Promise.reject(new Error("no readPinnedPublication through the one reader"));

    // A pinned build the source model already breaks would hide the probe; drop those pins in the copy.
    for (let attempt = 0; ; attempt++) {
      try { m.slotInstallInputs(consumer); break; }
      catch (error) {
        const slot = /^Specimen slot ([^:]+): (?!native pin hash drift)/.exec(error.message)?.[1];
        if (!slot || attempt > 50 || !existsSync(join(slotPath("designer", slot), "pin.json"))) throw error;
        notes.push(`pre-existing defect in the source model, pin dropped in the copy: designer:${slot} (${error.message})`);
        unlinkSync(join(slotPath("designer", slot), "pin.json"));
      }
    }

    const before = m.slotInstallInputs(consumer);
    const source = () => m.libraryRecordSource({ roots: [consumer] });
    // Publisher output for a Designer pin: the registry item Publisher's resolvePage installs for
    // the slot. The home page is probed first; when none of its resolved slots has another valid
    // candidate, a one-slot page record (the slot as its frame) is the probe.
    const homePage = await m.pageRecordFromCell(temp, DESIGNER_PROBE_PAGE, before.pins, await m.writerCopy(temp));
    const resolvedFor = async (page, pins) => (await m.resolvePage(page, pins, source())).slots;
    const hasOption = row => (before.options.get(row.slot) ?? []).length && before.pins[row.slot];
    let probePage = homePage, resolvedBefore = await resolvedFor(homePage, before.pins);
    let target = resolvedBefore.find(hasOption);
    if (!target) {
      for (const [slot, listedOptions] of before.options) {
        if (!before.pins[slot] || !listedOptions.length) continue;
        const page = { id: "pin-propagation", frame: slot, sections: [] };
        const rows = await resolvedFor(page, before.pins);
        const row = rows.find(row => row.slot === slot && row.itemHash);
        if (row) { probePage = page; resolvedBefore = rows; target = row; break; }
      }
      if (target) notes.push(`${DESIGNER_PROBE_PAGE} resolves no Designer slot with another valid candidate; Publisher probe page frames ${target.slot}`);
    }
    if (!assert("Publisher resolves a pinned Designer slot that has another valid candidate", target)) return { results, notes };
    const slot = target.slot, pinned = before.pins[slot];
    const pinnedName = `${pinned.element}-v${pinned.version}.json`;
    // An option is a recorded candidate by (element, version); a bare version names the pinned element.
    const optionOf = row => typeof row === "number" ? { element: pinned.element, version: row } : row;
    const option = optionOf(before.options.get(slot)[0]), optionName = `${option.element}-v${option.version}.json`;
    notes.push(`designer probe: ${slot} ${pinnedName} -> ${optionName}`);

    const pinCheck = detail => detail.checks.find(check => check.label?.copy === "studio.check-pin-matches");
    const candidateOf = (detail, name) => detail.candidates.find(candidate => candidate.name === name);
    const others = m.slotDetail(temp, "designer", slot).candidates.filter(candidate => !candidate.pinned && !candidate.issues.length).map(candidate => candidate.name).sort();
    const listed = before.options.get(slot).map(optionOf).map(row => `${row.element}-v${row.version}.json`).sort();
    assert("the specimen inputs list every other valid candidate of the slot as a preview option", isDeepStrictEqual(others, listed), `valid ${others.join(",")}; options ${listed.join(",")}`);

    // Baseline: the detail agrees with the pin, and the pinned candidate is the rendered one.
    const detail0 = m.slotDetail(temp, "designer", slot);
    assert("baseline: Studio detail pin check passes", pinCheck(detail0)?.ok === true);
    assert("baseline: the pinned candidate renders and is not a preview", candidateOf(detail0, pinnedName)?.specimen && candidateOf(detail0, pinnedName)?.preview === false);
    assert("baseline: the other candidate renders as a preview", candidateOf(detail0, optionName)?.specimen && candidateOf(detail0, optionName)?.preview === true);

    // 1. Drift a pinned Designer candidate byte.
    const designerFile = join(slotPath("designer", slot), "candidates", pinnedName), designerBytes = readFileSync(designerFile);
    appendFileSync(designerFile, " ");
    const drifted = m.slotDetail(temp, "designer", slot), driftCheck = pinCheck(drifted);
    assert("drift: Studio detail flags the pin hash mismatch", driftCheck?.ok === false && driftCheck.detail?.copy === "studio.check-pin-hash-mismatch", JSON.stringify(driftCheck));
    assert("drift: the drifted pinned candidate renders no specimen", candidateOf(drifted, pinnedName) && !candidateOf(drifted, pinnedName).specimen);
    let refusal = "";
    try { m.designerPins(temp); } catch (error) { refusal = error.message; }
    assert("drift: the page build refuses the drifted pin", /native pin hash drift/.test(refusal), refusal || "designerPins returned pins");
    let specimenRefusal = "";
    try { m.slotInstallInputs(consumer); } catch (error) { specimenRefusal = error.message; }
    assert("drift: the pinned specimen build refuses the drifted pin", /native pin hash drift/.test(specimenRefusal), specimenRefusal || "slotInstallInputs returned inputs");
    writeFileSync(designerFile, designerBytes);
    assert("drift restored: the source bytes are back", readFileSync(designerFile).equals(designerBytes));

    // 1b. Drift the pinned Publisher page candidate.
    const pageEntry = m.listSlots(consumer, "publisher").find(entry => entry.id === DESIGNER_PROBE_PAGE);
    const publicationBefore = await publication().catch(error => ({ error: error.message }));
    const pageFile = join(slotPath("publisher", DESIGNER_PROBE_PAGE), "candidates", pageEntry.pin.candidate), pageBytes = readFileSync(pageFile);
    appendFileSync(pageFile, " ");
    const pageDrift = pinCheck(m.slotDetail(temp, "publisher", DESIGNER_PROBE_PAGE));
    assert("page drift: Studio detail flags the pin hash mismatch", pageDrift?.ok === false && pageDrift.detail?.copy === "studio.check-pin-hash-mismatch", JSON.stringify(pageDrift));
    let pageRefusal = "", publicationRefusal = "";
    try { await m.pageRecordFromCell(temp, DESIGNER_PROBE_PAGE, before.pins); } catch (error) { pageRefusal = error.message; }
    try { await publication(); } catch (error) { publicationRefusal = error.message; }
    assert("page drift: the page build refuses the drifted page pin", /hash drift/.test(pageRefusal), pageRefusal || "pageRecordFromCell returned a page");
    assert("page drift: the publication refuses the drifted page pin", /hash drift/.test(publicationRefusal), publicationRefusal || "readPinnedPublication returned a publication");
    writeFileSync(pageFile, pageBytes);
    assert("page drift restored: the source bytes are back", readFileSync(pageFile).equals(pageBytes));

    // 2. Repin the Designer slot to the other candidate through the one writer.
    m.writePin(consumer, "designer", slot, optionName, PROBE);
    const detail1 = m.slotDetail(temp, "designer", slot), after = m.slotInstallInputs(consumer);
    assert("repin: Studio detail shows the new pin", detail1.shown === optionName && candidateOf(detail1, optionName)?.pinned && pinCheck(detail1)?.ok === true);
    assert("repin: the new pin renders and is no longer a preview; the old pin is a preview", candidateOf(detail1, optionName)?.preview === false && candidateOf(detail1, pinnedName)?.preview === true);
    const specimenOf = (detail, inputs) => ({ specimen: detail.candidates.find(candidate => candidate.pinned)?.specimen, pin: inputs.pins[slot] });
    assert("repin: the pinned specimen changes", !isDeepStrictEqual(specimenOf(detail0, before), specimenOf(detail1, after))
      && after.pins[slot]?.element === option.element && after.pins[slot]?.version === option.version, JSON.stringify(specimenOf(detail1, after)));
    assert("repin: the specimen build fingerprint changes", after.fingerprint !== before.fingerprint);
    const resolvedAfter = await resolvedFor(probePage, m.designerPins(temp));
    const itemOf = rows => rows.find(row => row.slot === slot)?.itemHash;
    assert("repin: Publisher's resolved page item changes", itemOf(resolvedAfter) && itemOf(resolvedAfter) !== itemOf(resolvedBefore), `${itemOf(resolvedBefore)} -> ${itemOf(resolvedAfter)}`);

    // 2b. Repin the Publisher page to another valid candidate.
    const pageDetail = m.slotDetail(temp, "publisher", DESIGNER_PROBE_PAGE);
    const otherPage = pageDetail.candidates.find(candidate => !candidate.pinned && !candidate.issues.length
      && m.readCandidate(consumer, "publisher", DESIGNER_PROBE_PAGE, candidate.name).bytes !== pageBytes.toString("utf8"));
    if (assert(`${DESIGNER_PROBE_PAGE} has another valid candidate with different bytes`, otherPage)) {
      notes.push(`publisher probe: ${DESIGNER_PROBE_PAGE} ${pageEntry.pin.candidate} -> ${otherPage.name}`);
      m.writePin(consumer, "publisher", DESIGNER_PROBE_PAGE, otherPage.name, PROBE);
      const pageAfter = m.slotDetail(temp, "publisher", DESIGNER_PROBE_PAGE);
      assert("page repin: Studio detail shows the new page pin", pageAfter.shown === otherPage.name && pinCheck(pageAfter)?.ok === true);
      const publicationAfter = await publication().catch(error => ({ error: error.message }));
      assert("page repin: the projected publication changes", !publicationBefore.error && !publicationAfter.error && !isDeepStrictEqual(publicationBefore, publicationAfter), publicationAfter.error ?? publicationBefore.error ?? "");
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  return { results, notes };
}

// A node:test file: it writes only its own disposable temporary copy, never the checked model.
test("check:pin-propagation", async t => {
  const outcome = await checkPinPropagation(REPO);
  for (const note of outcome.notes) t.diagnostic(note);
  for (const row of outcome.results) await t.test(row.name, () => assert.ok(row.ok, row.detail || row.name));
});
