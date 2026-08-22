import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertRegistryCanApplyDeprecation,
  assertReplacementIsShipped,
  deprecationPlanFrom,
  deprecationTarget,
  parseMode,
  shippedPackageNames,
} from "./deprecate-legacy-packages.mjs";

// The plan used to be a frozen five-entry array pointing at `governance`
// subpaths. Decision 9's recut renamed eight more names, retired those five,
// and left every hard-coded entry pointing at a package that no longer exists.
// These tests cover the derived form, and in particular the two ways it must
// refuse rather than publish a wrong permanent notice.

const lifecycle = (packages) => ({ schemaVersion: 1, packages });

test("the plan is derived from the lifecycle document's deprecated entries", () => {
  const plan = deprecationPlanFrom(
    lifecycle([
      { name: "@fixture/kept", status: "published" },
      { name: "@fixture/old", status: "deprecated", replacement: { name: "@fixture/new", range: "^0.1.0" } },
      { name: "@fixture/gone", status: "retired" },
      { name: "@fixture/early", status: "incubating" },
    ]),
    "@fixture",
  );
  assert.deepEqual(plan, [
    { directory: "old", packageName: "@fixture/old", replacement: "@fixture/new", message: "Deprecated: use @fixture/new instead." },
  ]);
});

test("a deprecated entry with no replacement is a hard error, never a skipped row", () => {
  // A deprecation notice with no migration target tells a consumer their
  // package is dead and nothing about what to do next. Skipping the row would
  // be worse still: the notice silently never gets written at all.
  assert.throws(
    () => deprecationPlanFrom(lifecycle([{ name: "@fixture/orphan", status: "deprecated" }]), "@fixture"),
    /no replacement\.name/,
  );
});

test("a readable contract with real entries and none deprecated is a finished migration, not an error", () => {
  // This asserted the opposite until the last five donors retired and zero
  // deprecated became reachable -- at which point this script failed
  // `npm run check` for every contributor precisely BECAUSE the repository
  // had reached the state it was working toward.
  assert.deepEqual(deprecationPlanFrom(lifecycle([{ name: "@fixture/a", status: "published" }]), "@fixture"), []);
});

test("a contract declaring NO packages at all is still an error, not an empty plan", () => {
  // The separating case. Deleting the old guard outright would satisfy the
  // test above and lose this: a document that declares nothing was not the
  // contract this script means to read, and reading it as "nothing to
  // deprecate" is how a misconfigured apply reports success having done
  // nothing. Zero-deprecated-among-real-entries and zero-entries are
  // different facts and only one of them is a finished migration.
  assert.throws(() => deprecationPlanFrom(lifecycle([]), "@fixture"), /declares no packages at all/);
});

test("a malformed lifecycle document is an error, not an empty plan", () => {
  assert.throws(() => deprecationPlanFrom({ schemaVersion: 1 }, "@fixture"), /expected \{ packages/);
  assert.throws(() => deprecationPlanFrom(null, "@fixture"), /expected \{ packages/);
});

test("an out-of-scope deprecated entry is refused rather than deprecated under the wrong owner", () => {
  assert.throws(
    () => deprecationPlanFrom(lifecycle([{ name: "@other/thing", status: "deprecated", replacement: { name: "@fixture/new" } }]), "@fixture"),
    /not in scope/,
  );
});

test("the scope must be a real npm scope", () => {
  assert.throws(() => deprecationPlanFrom(lifecycle([]), "not-a-scope"), /must contain an npm scope/);
});

test("a replacement that this workspace does not ship is refused", () => {
  // The predecessor check asserted the OLD package's directory still existed.
  // That is the wrong end once a rename deletes it: what a consumer needs is
  // for the name the permanent notice points AT to be installable.
  const entry = { directory: "old", packageName: "@fixture/old", replacement: "@fixture/never-shipped", message: "..." };
  assert.throws(() => assertReplacementIsShipped(entry, new Set(["@fixture/something-else"])), /is not a package in this workspace/);
  assert.doesNotThrow(() => assertReplacementIsShipped(entry, new Set(["@fixture/never-shipped"])));
});

test("only dry-run and apply are accepted", () => {
  assert.equal(parseMode(["--mode=dry-run"]), "dry-run");
  assert.equal(parseMode(["--mode=apply"]), "apply");
  assert.throws(() => parseMode(["--mode=apply", "--package=anything"]));
  assert.throws(() => parseMode(["--mode=delete"]));
});

test("registry notices are applied per discovered version, never through a wildcard", () => {
  assert.equal(deprecationTarget("@vespeneventures/catalog", "0.1.1"), "@vespeneventures/catalog@0.1.1");
  assert.throws(() => deprecationTarget("@vespeneventures/catalog", "*"));
  assert.throws(() => deprecationTarget("@vespeneventures/catalog", "0.1.1 --tag=latest"));
});

test("apply preflight reads a persistent identity for every exact discovered version", () => {
  const calls = [];
  const state = [{
    packageName: "@fixture/old",
    versions: [{ version: "0.1.0" }, { version: "0.1.1" }],
  }];
  assert.doesNotThrow(() => assertRegistryCanApplyDeprecation(state, (packageName, version) => {
    calls.push(`${packageName}@${version}`);
    return `${packageName}@${version}`;
  }));
  assert.deepEqual(calls, ["@fixture/old@0.1.0", "@fixture/old@0.1.1"]);
});

test("apply preflight refuses GitHub Packages' empty version identity before any mutation", () => {
  const state = [{ packageName: "@fixture/old", versions: [{ version: "0.1.0" }] }];
  assert.throws(
    () => assertRegistryCanApplyDeprecation(state, () => ""),
    /version\.ID cannot be empty.*Refusing before mutation.*no registry metadata changed/,
  );
});

test("integration: this repository's own real plan resolves, and every replacement it names ships here", () => {
  // The whole point of deriving the plan is that it cannot drift from
  // reality. This asserts that against the real documents, not a fixture —
  // if a rename lands without a lifecycle record, this fails here rather
  // than at the moment someone runs an irreversible --mode=apply.
  const plan = deprecationPlanFrom(JSON.parse(readFileSync("docs/contracts/package-lifecycle.json", "utf8")), "@vespeneventures");
  const shipped = shippedPackageNames();
  // Deliberately NOT `plan.length > 0`. This repository currently declares
  // nothing deprecated, and asserting otherwise would make a finished
  // migration look like a broken document. What must hold is that whatever
  // the plan does name is real -- which is the claim that actually protects
  // an irreversible --mode=apply.
  assert.ok(Array.isArray(plan));
  for (const entry of plan) assert.doesNotThrow(() => assertReplacementIsShipped(entry, shipped), `${entry.packageName} -> ${entry.replacement}`);
});
