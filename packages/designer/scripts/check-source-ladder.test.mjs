import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { aliasesFrom, backdropsFrom, checkBackdropComponents, COPY_IMPORT_REWRITES, partnerCopyBody, checkConsumerLeafFreeze, checkConsumerPins, checkSourceLadder, componentModulesFrom, consumerFrom, leafFreezeFrom, licenceAllowed, loadInputs } from "./check-source-ladder.mjs";

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
  assert.deepEqual(rules(checkSourceLadder(input({ ladder: { category: "brand-asset", reason: "logo", rejected: [part("partner-x", 10)] } }))), ["popularity"]);
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

// Consumer pins (foundry-audit-0006): the consumer's pinned choices are held to the ladder, themes included.
const pin = (slot, refs, reason = "") => ({ slot, candidate: `${slot.split(".").at(-1)}-v1.json`, refs, reason });
const ariaItems = () => new Set(["alert", "login-03", "font-inter", "form"]);

test("pin-stock-available: a radix shadcn/<item> pin with an aria twin needs a reason naming the twin", () => {
  const clean = [
    pin("components.banner", ["shadcn-aria/alert@4.23.0"]),
    pin("themes.font-sans", ["shadcn/font-inter@4.23.0"], "Kept radix: shadcn-aria/font-inter ships the same files; director:brand.voice"),
    pin("themes.radius", ["shadcn/neutral@4.23.0"]), // no aria neutral: nothing to pass over
  ];
  assert.deepEqual(checkConsumerPins({ consumerPins: clean, pinStockItems: ariaItems() }), []);
  const broken = [
    pin("components.banner", ["shadcn/alert@4.23.0"], "Stock alert with a dismiss slot."),
    pin("sections.sign-in-form", ["shadcn/login-03@4.23.0"]),
    pin("themes.font-sans", ["shadcn/font-inter@4.23.0"]),
  ];
  const findings = checkConsumerPins({ consumerPins: broken, pinStockItems: ariaItems() });
  assert.deepEqual(findings.map(finding => `${finding.rule} ${finding.subject}`), [
    "pin-stock-available consumer/components.banner",
    "pin-stock-available consumer/sections.sign-in-form",
    "pin-stock-available consumer/themes.font-sans",
  ]);
  assert.match(findings[0].detail, /shadcn-aria ships alert/);
});

test("pin-stock-skipped: a non-theme leaf with aria stock, sourced elsewhere, needs a reason naming the stock", () => {
  assert.deepEqual(checkConsumerPins({ consumerPins: [
    pin("components.form", ["shadcn-aria/field@4.23.0"]),
    pin("sections.form", ["tailark-oss/mist-contact-1@8139698"], "shadcn-aria/form has no contact layout; tailark is the most popular partner block."),
    pin("themes.card", ["shadcn/neutral@4.23.0"]), // a theme token group named like a component is not a component
  ], pinStockItems: ariaItems() }), []);
  const findings = checkConsumerPins({ consumerPins: [pin("sections.form", ["tailark-oss/mist-contact-1@8139698"], "Contact form.")], pinStockItems: ariaItems() });
  assert.deepEqual(findings.map(finding => finding.rule), ["pin-stock-skipped"]);
  assert.match(findings[0].detail, /stock shadcn-aria\/form/);
});

test("consumer-leaf-freeze: every consumer themes/assets/components id must be owner-signed; pending is not signed", () => {
  const leafFreeze = { signed: { themes: new Set(["themes.primary"]), assets: new Set(["assets.logo"]), components: new Set(["components.button"]) }, pending: new Map([["components.sheet", "src/catalog/ia/components.leaf-amendments.json"]]) };
  assert.deepEqual(checkConsumerLeafFreeze({ consumerSlots: ["themes.primary", "assets.logo", "components.button", "sections.hero", "frames.page"], leafFreeze }), []);
  const findings = checkConsumerLeafFreeze({ consumerSlots: ["themes.primary", "themes.success", "components.sheet", "sections.hero"], leafFreeze });
  assert.deepEqual(findings.map(finding => `${finding.rule} ${finding.subject}`), ["consumer-leaf-freeze consumer/components.sheet", "consumer-leaf-freeze consumer/themes.success"]);
  assert.match(findings[0].detail, /listed only in src\/catalog\/ia\/components\.leaf-amendments\.json, pending owner ratification/);
  assert.doesNotMatch(findings[1].detail, /pending/);
});

test("checkSourceLadder runs the consumer rules alongside the roster rules", () => {
  const leafFreeze = { signed: { themes: new Set(), assets: new Set(), components: new Set(["components.banner"]) }, pending: new Map() };
  const clean = { ...input({ ladder: L2() }), consumerPins: [pin("components.banner", ["shadcn-aria/alert@4.23.0"])], consumerSlots: ["components.banner"], pinStockItems: ariaItems(), leafFreeze };
  assert.deepEqual(checkSourceLadder(clean), []);
  const broken = { ...clean, consumerPins: [pin("components.banner", ["shadcn/alert@4.23.0"])], consumerSlots: ["components.banner", "components.gadget"] };
  assert.deepEqual(rules(checkSourceLadder(broken)), ["consumer-leaf-freeze", "pin-stock-available"]);
});

test("leaf freeze and consumer loaders read signed amendments as signed and pending ones as pending", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ladder-freeze-"));
  const write = (file, value) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), JSON.stringify(value)); };
  for (const layer of ["themes", "assets", "components"]) write(`ia/${layer}.leaf-freeze.json`, { layer, signedHead: "abc", leafIds: [`${layer}.base`] });
  write("ia/assets.leaf-amendments.json", { layer: "assets", status: "owner-signed", baseSignedHead: "abc", addedLeafIds: ["assets.signed"] });
  write("ia/assets.draft-leaf-amendments.json", { layer: "assets", status: "pending-owner-ratification", baseSignedHead: "abc", addedLeafIds: ["assets.draft"] });
  write("ia/components.leaf-amendments.json", { layer: "components", status: "owner-signed", baseSignedHead: "stale", addedLeafIds: ["components.stale"] });
  const freeze = leafFreezeFrom(path.join(dir, "ia"));
  assert.deepEqual([...freeze.signed.assets].sort(), ["assets.base", "assets.signed"]);
  assert.deepEqual([...freeze.pending.keys()].sort(), ["assets.draft", "components.stale"]);
  write("consumer/agents/designer/themes.base/slot.json", {});
  write("consumer/agents/designer/themes.base/pin.json", { candidate: "base-v1.json" });
  write("consumer/agents/designer/themes.base/candidates/base-v1.json", { meta: { source: { ref: ["shadcn/font-inter@4.23.0"] }, element: { reason: "r" } } });
  write("consumer/agents/designer/assets.draft/slot.json", {});
  const consumer = consumerFrom(path.join(dir, "consumer"));
  assert.deepEqual(consumer.consumerSlots, ["assets.draft", "themes.base"]);
  assert.deepEqual(consumer.consumerPins, [{ slot: "themes.base", candidate: "base-v1.json", refs: ["shadcn/font-inter@4.23.0"], reason: "r" }]);
  assert.throws(() => consumerFrom(path.join(dir, "nowhere")), /no consumer Designer slots/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the real consumer: pins and slot ids load, themes included", () => {
  const loaded = loadInputs(designer);
  assert.ok(loaded.consumerSlots.some(slot => slot.startsWith("themes.")) && loaded.consumerPins.some(entry => entry.slot.startsWith("themes.")));
  assert.ok(loaded.pinStockItems.has("font-inter") && !loaded.stockItems.has("font-inter"));
  assert.ok(loaded.leafFreeze.signed.components.has("components.specimen-frame") || loaded.leafFreeze.signed.components.size > 50);
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

// Adopted interactive backdrops (foundry-build-0048 U23): records carry the ladder, sources are checked.
const UPSTREAM = '"use client"\n\nimport { cn } from "@/lib/utils"\n\nexport const Thing = () => null\n';
const COPY = `// Magic UI Thing (MIT), copied byte-for-byte.\n// @ts-nocheck\n${UPSTREAM.replace('"@/lib/utils"', `"${COPY_IMPORT_REWRITES[0][1]}"`)}`;
const registryRecord = (extra = {}) => ({
  id: "thing",
  source: { registry: "magicui", item: "thing", version: "abc1234", file: "registry/magicui/thing.tsx", copy: "src/components/partners/magicui/thing.tsx", export: "Thing" },
  ladder: { rung: "L2", chosen: { ...part("@magicui/thing", 900), licence: "MIT" }, reason: "most popular motion registry", checkedAt: "2026-11-18" },
  ...extra,
});
const foundryRecord = (extra = {}) => ({ id: "mesh", source: { foundry: "src/blocks/backdrop/Mesh.tsx", export: "Mesh" }, ladder: { rung: "L4", slotNeeded: "a colour field", reason: "no registry part paints one" }, ...extra });
const manifestRow = (extra = {}) => ({ registry: "magicui", name: "thing", version: "abc1234", dir: "magicui/thing@abc1234", license: "MIT", files: [{ path: "registry/magicui/thing.tsx" }], ...extra });
const backdrops = ({ records = [registryRecord(), foundryRecord()], sources = { thing: { manifest: manifestRow(), vendored: UPSTREAM, copy: COPY }, mesh: { foundry: true } } } = {}) => ({ registry: { components: records }, sources });

test("backdrops: a vendored L2 record and a Foundry L4 record with their sources pass", () => {
  assert.equal(partnerCopyBody(COPY), UPSTREAM);
  assert.deepEqual(checkBackdropComponents(backdrops()), []);
  assert.deepEqual(rules(checkBackdropComponents({ registry: { components: [] }, sources: {} })), ["backdrop-source"]);
});

test("backdrop-copy-drift: one changed byte in the partner copy fails", () => {
  const drifted = backdrops({ sources: { thing: { manifest: manifestRow(), vendored: UPSTREAM, copy: COPY.replace("=> null", "=> undefined") }, mesh: { foundry: true } } });
  assert.deepEqual(rules(checkBackdropComponents(drifted)), ["backdrop-copy-drift"]);
  const otherImport = backdrops({ sources: { thing: { manifest: manifestRow(), vendored: UPSTREAM, copy: COPY.replace(COPY_IMPORT_REWRITES[0][1], "../utils.js") }, mesh: { foundry: true } } });
  assert.deepEqual(rules(checkBackdropComponents(otherImport)), ["backdrop-copy-drift"]);
});

test("backdrop-source: missing manifest row, disallowed or mismatched licence, unlisted file, missing files", () => {
  const withSource = thing => backdrops({ sources: { thing, mesh: { foundry: true } } });
  assert.deepEqual(rules(checkBackdropComponents(withSource({ vendored: UPSTREAM, copy: COPY }))), ["backdrop-source"]);
  assert.deepEqual(rules(checkBackdropComponents(withSource({ manifest: manifestRow({ license: "GPL-3.0" }), vendored: UPSTREAM, copy: COPY }))), ["backdrop-source"]);
  assert.deepEqual(rules(checkBackdropComponents(withSource({ manifest: manifestRow({ license: "ISC" }), vendored: UPSTREAM, copy: COPY }))), ["backdrop-source"]);
  assert.deepEqual(rules(checkBackdropComponents(withSource({ manifest: manifestRow({ files: [] }), vendored: UPSTREAM, copy: COPY }))), ["backdrop-source"]);
  assert.deepEqual(rules(checkBackdropComponents(withSource({ manifest: manifestRow(), copy: COPY }))), ["backdrop-source"]);
  assert.deepEqual(rules(checkBackdropComponents(withSource({ manifest: manifestRow(), vendored: UPSTREAM }))), ["backdrop-source"]);
  assert.deepEqual(rules(checkBackdropComponents(backdrops({ sources: { thing: { manifest: manifestRow(), vendored: UPSTREAM, copy: COPY }, mesh: { foundry: false } } }))), ["backdrop-source"]);
});

test("backdrop-rung and the ladder rules: L2 must choose the vendored item, a Foundry part must record L4", () => {
  const l4Registry = registryRecord({ ladder: { rung: "L4", slotNeeded: "x", reason: "y" } });
  assert.deepEqual(rules(checkBackdropComponents(backdrops({ records: [l4Registry, foundryRecord()] }))), ["backdrop-rung"]);
  const otherChosen = registryRecord({ ladder: { ...registryRecord().ladder, chosen: part("@magicui/other", 900) } });
  assert.deepEqual(rules(checkBackdropComponents(backdrops({ records: [otherChosen, foundryRecord()] }))), ["backdrop-rung"]);
  const l2Foundry = foundryRecord({ ladder: registryRecord().ladder });
  assert.deepEqual(rules(checkBackdropComponents(backdrops({ records: [registryRecord(), l2Foundry] }))), ["backdrop-rung"]);
  const noBasis = foundryRecord({ ladder: { rung: "L4", reason: "no registry part paints one" } });
  assert.deepEqual(rules(checkBackdropComponents(backdrops({ records: [registryRecord(), noBasis] }))), ["l4-justification"]);
  const noLadder = registryRecord({ ladder: undefined });
  assert.deepEqual(rules(checkBackdropComponents(backdrops({ records: [noLadder, foundryRecord()] }))), ["backdrop-rung", "missing-ladder"]);
});

test("the real adopted backdrops: every record loads, Magic UI copies match their vendored bytes", () => {
  const real = backdropsFrom(designer);
  assert.ok(real.registry.components.length >= 4);
  assert.deepEqual(checkBackdropComponents(real), []);
  assert.ok(real.registry.components.some(record => typeof record.source.foundry === "string" && record.ladder.rung === "L4"));
  for (const record of real.registry.components.filter(entry => entry.source.registry)) assert.equal(partnerCopyBody(real.sources[record.id].copy), real.sources[record.id].vendored, record.id);
});
