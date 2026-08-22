import assert from "node:assert/strict";
import test from "node:test";

import { compareVocabulary, fold, loadVocabulary, EXIT_CODES, SHARED_VOCABULARIES } from "./check-shared-vocabularies.mjs";

const left = (members) => ({ label: "controller", members });
const right = (members) => ({ label: "observer", members });
const FIVE = ["declared-but-not-live", "live-but-not-declared", "live-differs-from-declared", "live-artifact-predates-its-declaration", "declared-but-not-verifiable"];

// The weaker check this gate has to beat. Named here rather than described,
// so the separating test below can actually run it.
const countComparison = (a, b) => a.length === b.length;

test("identical vocabularies are satisfied", () => {
  assert.equal(compareVocabulary("v", left(FIVE), right([...FIVE])).verdict, "satisfied");
});

test("order is not divergence — these are sets, not lists", () => {
  assert.equal(compareVocabulary("v", left(FIVE), right([...FIVE].reverse())).verdict, "satisfied");
});

test("SEPARATING FIXTURE: a renamed member keeps both counts equal, so a count comparison passes and this gate fails", () => {
  const renamed = [...FIVE.slice(0, 4), "declared-but-unverifiable"]; // was `declared-but-not-verifiable`
  assert.equal(renamed.length, FIVE.length, "fixture is only separating if the counts stay equal");

  // The weaker tool sees agreement.
  assert.equal(countComparison(FIVE, renamed), true, "the count comparison must PASS here, or it separates nothing");

  // This gate does not.
  const result = compareVocabulary("v", left(FIVE), right(renamed));
  assert.equal(result.verdict, "violated");
  assert.ok(
    result.reasons.some((r) => r.includes("declared-but-not-verifiable") && r.includes("not in observer")),
    `expected the missing member named in its direction, got: ${result.reasons.join(" | ")}`,
  );
  assert.ok(
    result.reasons.some((r) => r.includes("declared-but-unverifiable") && r.includes("not in controller")),
    `expected the other direction reported too, got: ${result.reasons.join(" | ")}`,
  );
});

test("SANITY: the weaker tool is not simply broken — it agrees on the honest case and on a real length change", () => {
  // If the count comparison failed everything, the test above would prove nothing.
  assert.equal(countComparison(FIVE, [...FIVE]), true);
  assert.equal(countComparison(FIVE, FIVE.slice(1)), false);
});

test("a dropped member is violated in one direction only", () => {
  const result = compareVocabulary("v", left(FIVE), right(FIVE.slice(0, 4)));
  assert.equal(result.verdict, "violated");
  assert.equal(result.reasons.length, 1);
});

test("an unreadable vocabulary is indeterminate, never satisfied", async () => {
  const loaded = await loadVocabulary(
    { label: "x", dist: "packages/nope/dist/index.js", exportName: "whatever" },
    { importer: () => Promise.reject(new Error("ENOENT")) },
  );
  assert.equal(loaded.ok, false);
  assert.match(loaded.reason, /npm run build/);
});

test("an EMPTY vocabulary is indeterminate, not a trivial match", async () => {
  // Two empty sets compare equal. Reporting that as agreement is the exact
  // shape this repository keeps finding: nothing found, therefore nothing wrong.
  const loaded = await loadVocabulary(
    { label: "x", dist: "d.js", exportName: "kinds" },
    { importer: () => Promise.resolve({ kinds: [] }) },
  );
  assert.equal(loaded.ok, false);
  assert.match(loaded.reason, /empty/);
});

test("indeterminate outranks violated outranks satisfied", () => {
  assert.equal(fold([{ verdict: "satisfied" }, { verdict: "violated" }, { verdict: "indeterminate" }]), "indeterminate");
  assert.equal(fold([{ verdict: "satisfied" }, { verdict: "violated" }]), "violated");
  assert.equal(fold([{ verdict: "satisfied" }]), "satisfied");
  assert.deepEqual(EXIT_CODES, { satisfied: 0, violated: 1, indeterminate: 2 });
});

test("the real declared sources name real export paths", () => {
  assert.ok(SHARED_VOCABULARIES.length > 0);
  for (const v of SHARED_VOCABULARIES) {
    assert.ok(v.sources.length >= 2, `${v.name} needs at least two copies to be worth comparing`);
    for (const s of v.sources) assert.match(s.dist, /^packages\/[a-z-]+\/dist\//);
  }
});
