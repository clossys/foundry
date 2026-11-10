import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { aliasesFrom, checkSourceLadder, componentModulesFrom, licenceAllowed, loadInputs } from "./check-source-ladder.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const designer = path.resolve(here, "..");
const script = path.join(here, "check-source-ladder.mjs");

const part = (id, stars, extra = {}) => ({ id, url: `https://github.com/example/${id}`, stars, weeklyDownloads: stars * 10, licence: "MIT", ...extra });
const L2 = () => ({ rung: "L2", chosen: part("partner-a", 900), rejected: [{ ...part("partner-b", 400), reason: "no React Aria base" }], reason: "most popular partner part with the whole widget" });
const L4 = () => ({ rung: "L4", rejected: [{ ...part("partner-c", 50), reason: "unmaintained since 2023" }], slotNeeded: "studio needs a zoomable canvas no stock or partner part ships", reason: "no partner covers the slot; composition of stock cannot express it" });

/** One non-stock row (components.widget, source `partner`), one stock row, one module per leaf. */
function input({ ladder, source = "partner", stockItems = [], stockFills = [], modules = [{ file: "Widget.tsx", names: ["Widget"] }, { file: "preview-runtime/components/button/button.tsx", names: ["Button"] }], aliases = new Map() } = {}) {
  const offer = { source, leaves: ["components.widget"], ...(ladder === undefined ? {} : { ladder }) };
  return {
    roster: {
      components: [
        { l2: "inputs-widget", leaves: ["components.widget"], offers: [offer] },
        { l2: "actions-buttons", leaves: ["components.button"], offers: [{ source: "shadcn@aria", leaves: ["components.button"] }] },
      ],
      assets: [], sections: [], frames: [],
    },
    stockItems: new Set(stockItems), stockFills: new Set(stockFills), componentModules: modules, aliases,
  };
}
const rules = findings => findings.map(finding => finding.rule).sort();

test("a stock offer needs no ladder record, and a complete L2 record passes", () => {
  assert.deepEqual(checkSourceLadder(input({ ladder: L2() })), []);
});

test("missing-ladder: passes with a record, fails without one", () => {
  assert.deepEqual(rules(checkSourceLadder(input({ ladder: L4() }))), []);
  const findings = checkSourceLadder(input());
  assert.deepEqual(rules(findings), ["missing-ladder"]);
  assert.equal(findings[0].subject, "components/inputs-widget/partner");
});

test("ladder-fields: each malformed or missing required field fails", () => {
  assert.deepEqual(rules(checkSourceLadder(input({ ladder: L2() }))), []);
  const cases = {
    "no reason": { ...L2(), reason: "" },
    "bad rung": { ...L2(), rung: "L1" },
    "no rung": { ...L2(), rung: undefined },
    "chosen without stars": { ...L2(), chosen: { ...part("partner-a", 900), stars: undefined } },
    "chosen without url": { ...L2(), chosen: { ...part("partner-a", 900), url: "" } },
    "chosen without weeklyDownloads": { ...L2(), chosen: { ...part("partner-a", 900), weeklyDownloads: -1 } },
    "rejected without numbers": { ...L2(), rejected: [{ id: "partner-b", reason: "older" }] },
    "three rejected": { ...L2(), rejected: [1, 2, 3].map(n => ({ ...part(`p${n}`, n), reason: "smaller" })) },
    "unknown category": { ...L2(), category: "misc" },
    "slotNeeded off L4": { ...L2(), slotNeeded: "why" },
    "bad checkedAt": { ...L2(), checkedAt: "last week" },
    "L3 without chosen": { rung: "L3", reason: "compose stock popover and button" },
  };
  for (const [name, ladder] of Object.entries(cases)) {
    const found = rules(checkSourceLadder(input({ ladder })));
    assert.ok(found.length > 0 && found.every(rule => rule === "ladder-fields"), `${name}: ${found.join(", ")}`);
  }
});

test("light categories need only category and reason; other categories still need a rung", () => {
  assert.deepEqual(checkSourceLadder(input({ ladder: { category: "studio-composition", reason: "Studio-only canvas chrome" } })), []);
  assert.deepEqual(checkSourceLadder(input({ ladder: { category: "brand-asset", reason: "consumer logo" } })), []);
  assert.deepEqual(rules(checkSourceLadder(input({ ladder: { category: "brand-asset" } }))), ["ladder-fields"]);
  assert.deepEqual(rules(checkSourceLadder(input({ ladder: { category: "icon-standard", reason: "most used icon set" } }))), ["ladder-fields"]);
  assert.deepEqual(checkSourceLadder(input({ ladder: { ...L2(), category: "icon-standard" } })), []);
});

test("l4-justification: L4 passes with slotNeeded and reason, fails without slotNeeded", () => {
  assert.deepEqual(checkSourceLadder(input({ ladder: L4() })), []);
  assert.deepEqual(rules(checkSourceLadder(input({ ladder: { ...L4(), slotNeeded: undefined } }))), ["l4-justification"]);
  assert.deepEqual(rules(checkSourceLadder(input({ ladder: { ...L4(), slotNeeded: " " } }))), ["l4-justification"]);
});

test("stock-available: a vendored stock item or shadcn@aria fill needs a concrete rejection", () => {
  const rejection = { ...part("shadcn@aria/widget", 100000), reason: "stock widget has no async loading state the contract requires" };
  assert.deepEqual(checkSourceLadder(input({ ladder: { ...L4(), rejected: [rejection] }, stockItems: ["widget"] })), []);
  assert.deepEqual(checkSourceLadder(input({ ladder: L4(), stockItems: ["unrelated"] })), []);
  assert.deepEqual(rules(checkSourceLadder(input({ ladder: L4(), stockItems: ["widget"] }))), ["stock-available"]);
  assert.deepEqual(rules(checkSourceLadder(input({ ladder: L4(), stockItems: ["widgets"] }))), ["stock-available"]);
  assert.deepEqual(rules(checkSourceLadder(input({ ladder: L4(), stockFills: ["components.widget"] }))), ["stock-available"]);
  // A rejection with no reason is not concrete: stock-available still fires (popularity names the missing reason).
  assert.ok(rules(checkSourceLadder(input({ ladder: { ...L4(), rejected: [{ ...rejection, reason: "" }] }, stockItems: ["widget"] }))).includes("stock-available"));
  // Reported even when the ladder record is missing altogether.
  assert.deepEqual(rules(checkSourceLadder(input({ stockItems: ["widget"] }))), ["missing-ladder", "stock-available"]);
});

test("popularity: a more popular rejected candidate needs a reason", () => {
  const popular = { ...part("partner-z", 5000), reason: "GPL-3.0 licence" };
  assert.deepEqual(checkSourceLadder(input({ ladder: { ...L2(), rejected: [popular] } })), []);
  const findings = checkSourceLadder(input({ ladder: { ...L2(), rejected: [{ ...popular, reason: undefined }] } }));
  assert.deepEqual(rules(findings), ["popularity"]);
  assert.match(findings[0].detail, /more stars \(5000\)/);
});

test("licence: the chosen part must be MIT, Apache-2.0, BSD or ISC", () => {
  for (const licence of ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC", "ISC AND MIT"]) {
    assert.equal(licenceAllowed(licence), true, licence);
    assert.deepEqual(checkSourceLadder(input({ ladder: { ...L2(), chosen: part("partner-a", 900, { licence }) } })), [], licence);
  }
  for (const licence of ["GPL-3.0", "MIT AND GPL-3.0", "UNLICENSED", "Commercial"]) {
    assert.equal(licenceAllowed(licence), false, licence);
    assert.deepEqual(rules(checkSourceLadder(input({ ladder: { ...L2(), chosen: part("partner-a", 900, { licence }) } }))), ["licence"], licence);
  }
  // A rejected candidate may carry any licence; that is often the reason.
  assert.deepEqual(checkSourceLadder(input({ ladder: { ...L2(), rejected: [{ ...part("partner-g", 10, { licence: "GPL-3.0" }), reason: "GPL" }] } })), []);
});

test("unrostered-component: an exported component module must map to a roster leaf", () => {
  assert.deepEqual(checkSourceLadder(input({ ladder: L2() })), []);
  assert.deepEqual(checkSourceLadder(input({ ladder: L2(), modules: [{ file: "Logomark.tsx", names: ["Logomark"] }], aliases: new Map([["logomark", "components.widget"]]) })), []);
  const findings = checkSourceLadder(input({ ladder: L2(), modules: [{ file: "Gadget.tsx", names: ["Gadget"] }] }));
  assert.deepEqual(rules(findings), ["unrostered-component"]);
  assert.equal(findings[0].subject, "src/components/Gadget.tsx");
});

test("index and alias parsing: value re-exports with PascalCase names are component modules", () => {
  const modules = componentModulesFrom([
    "// export { Hidden } from \"./Hidden.js\";",
    "export { Button } from \"./preview-runtime/components/button/button.js\";",
    "export { DropdownMenu as Menu, InlineMenu } from \"./menu.js\";",
    "export type { ButtonProps } from \"./types.js\";",
    "export { BADGE_TONE, cx } from \"./tones.js\";",
    "export {\n  Field,\n  type FieldProps,\n} from \"./field.js\";",
  ].join("\n"));
  assert.deepEqual(modules, [
    { file: "preview-runtime/components/button/button.js", names: ["Button"] },
    { file: "menu.js", names: ["DropdownMenu", "Menu", "InlineMenu"] },
    { file: "field.js", names: ["Field"] },
  ]);
  assert.deepEqual([...aliasesFrom(`"act.icon-button": "components.button",\n  "depict.logomark": "components.logo",`)], [["icon-button", "components.button"], ["logomark", "components.logo"]]);
});

test("the real package inputs load offline and the check runs to a verdict", () => {
  const loaded = loadInputs(designer);
  assert.ok(loaded.stockItems.has("button") && !loaded.stockItems.has("button-example"));
  assert.ok(loaded.componentModules.length > 20);
  const findings = checkSourceLadder(loaded);
  assert.ok(findings.every(finding => typeof finding.rule === "string" && typeof finding.subject === "string"));
  const run = spawnSync(process.execPath, [script, "--json"], { cwd: designer, encoding: "utf8" });
  assert.equal(run.status, findings.length ? 1 : 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).findings, findings.length);
});

test("an unreadable root exits 2", () => {
  const run = spawnSync(process.execPath, [script, "--root", path.join(designer, "does-not-exist")], { encoding: "utf8" });
  assert.equal(run.status, 2);
});
