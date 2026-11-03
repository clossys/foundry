import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classTokens, loadCatalog, sectionShellFindings, tokenFindings } from "./check-section-tokens.mjs";
import { checkElement } from "./check-ref-verbatim.mjs";
import { configFromComponents, normalizeReference } from "./ref-verbatim/normalize.mjs";
import { pageFindings } from "./check-page-overflow.mjs";

const catalog = loadCatalog();
const bandTokens = String(catalog.contracts.get("sections.band").limits["emits.theme"]).split(",");

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const components = readFileSync(join(pkg, "ui/components.json"), "utf8");
// Real stock: the vendored shadcn-aria `example` component as `shadcn add` writes it.
const STOCK = JSON.parse(readFileSync(join(pkg, "references/manifest.json"), "utf8")).items.find(row => row.registry === "shadcn-aria" && row.name === "example" && row.version === "4.23.0");
const STOCK_PATH = "registry/aria-nova/components/example.tsx";
const STOCK_CODE = normalizeReference(readFileSync(join(pkg, "references", STOCK.dir, STOCK_PATH), "utf8"), STOCK_PATH, configFromComponents(JSON.parse(components)));
const lineage = files => ({ mode: "verbatim", source: { registry: STOCK.registry, item: STOCK.name, version: STOCK.version, hash: STOCK.hash, files } });
// The self-declared claim the lint must never trust.
const CLAIM = { source: { kind: "registry", ref: ["shadcn-aria/example@4.23.0"] }, refVerbatim: { files: { "hero.tsx": STOCK_PATH, "extra.tsx": STOCK_PATH } } };

function consumer({ heroClass = "py-section", heroDeps = ["@acme/section-shell", "@acme/section-header"], emits = bandTokens, heroMeta, heroFiles, heroRecord, componentsJson = components } = {}) {
  const root = mkdtempSync(join(tmpdir(), "section-tokens-"));
  const pins = {};
  const add = (slot, element, item, files = {}) => {
    const dir = join(root, "library", slot, element, "v1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "registry-item.json"), JSON.stringify({ name: element, ...item, files: Object.keys(files).map(path => ({ path, type: "registry:component", target: `components/${path}` })) }));
    for (const [path, text] of Object.entries(files)) writeFileSync(join(dir, path), text);
    pins[slot] = { element, version: 1, hash: "sha256:" + "0".repeat(64), event: "e1" };
  };
  add("sections.band", "section-shell", { cssVars: { theme: Object.fromEntries(emits.map(name => [name.slice(2), "1rem"])) } }, { "section-shell.tsx": `export const S = () => <section className="py-section mx-auto max-w-measure px-gutter" />` });
  add("sections.section-header", "section-header", { registryDependencies: ["@acme/section-shell"] }, { "section-header.tsx": `export const H = () => <h2 className="text-heading" />` });
  add("sections.hero", "hero", { registryDependencies: heroDeps, ...(heroMeta ? { meta: heroMeta } : {}) }, heroFiles ?? { "hero.tsx": `export const Hero = () => <div className="${heroClass}" />` });
  if (heroRecord) {
    const dir = join(root, "library", "sections.hero", "hero", "v1");
    writeFileSync(join(dir, "element.json"), JSON.stringify({ schema: "clossys.element/1", id: "hero", slot: "sections.hero", version: 1, hash: pins["sections.hero"].hash, reads: { copyKeys: [], themeVars: [] }, ...heroRecord }));
    writeFileSync(join(root, "components.json"), componentsJson);
  }
  writeFileSync(join(root, "selection.json"), JSON.stringify({ pins }));
  return root;
}

test("a section built on the shell and its tokens is clean", () => {
  assert.deepEqual(sectionShellFindings(consumer(), catalog), []);
});

test("hard-coded section spacing, container widths, ramp sizes, arbitrary lengths and bleed fail", () => {
  const findings = sectionShellFindings(consumer({ heroClass: "py-24 md:py-36 mx-auto max-w-5xl text-5xl md:text-6xl min-w-[36rem] w-[200vw] min-w-max -right-6 -mx-8 gap-2 p-6 text-lg -m-2.5" }), catalog);
  const kinds = findings.map(row => row.split(":")[0] + ":" + row.split(": ").at(-1).split(" ")[0]);
  assert.deepEqual(kinds.sort(), [
    "bleed:-mx-8", "bleed:-right-6",
    "size:min-w-[36rem]", "size:min-w-max", "size:w-[200vw]",
    "spacing:max-w-5xl", "spacing:py-24", "spacing:py-36",
    "type:text-5xl", "type:text-6xl",
  ]);
});

test("a section that skips the shell, or a band that does not emit its tokens, fails", () => {
  assert.deepEqual(sectionShellFindings(consumer({ heroDeps: ["button"] }), catalog), [
    "shell: hero (sections.hero) does not depend on the band section-shell",
    "shell: hero (sections.hero) does not depend on the section header section-header",
  ]);
  assert.deepEqual(sectionShellFindings(consumer({ emits: bandTokens.filter(name => name !== "--text-display") }), catalog), ["shell: section-shell does not emit --text-display in cssVars.theme"]);
});

test("byte-identical stock passes the strict ref-verbatim check and is exempt from the shell and token lint", () => {
  // The stock bytes fail the token lint on their own: the exemption is what lets them through.
  assert.ok(tokenFindings("hero", [["hero.tsx", STOCK_CODE]]).length > 0);
  const stock = consumer({ heroDeps: ["example"], heroFiles: { "hero.tsx": STOCK_CODE }, heroRecord: { lineage: lineage({ "hero.tsx": STOCK_PATH }), payload: ["hero.tsx"] } });
  assert.deepEqual(sectionShellFindings(stock, catalog), []);
});

const NOT_STOCK = "py-40 max-w-7xl text-9xl w-[200vw] -mx-24";
const notStock = `export const Extra = () => <div className="${NOT_STOCK}" />\n`;
const SHELL = ["shell: hero (sections.hero) does not depend on the band section-shell", "shell: hero (sections.hero) does not depend on the section header section-header"];
const refused = (name, options) => {
  const findings = sectionShellFindings(consumer({ heroDeps: ["example"], heroMeta: CLAIM, ...options }), catalog);
  for (const row of SHELL) assert.ok(findings.includes(row), `${name}: ${row}`);
  for (const token of NOT_STOCK.split(" ")) assert.ok(findings.some(row => row.includes(`: ${token} is`)), `${name}: ${token} is linted`);
  // All or nothing: a stock file beside unproven code is linted too.
  if (options.heroFiles["hero.tsx"] === STOCK_CODE) assert.ok(findings.some(row => row.includes(" hero.tsx: ")), `${name}: stock hero.tsx is linted`);
  return findings;
};

test("a self-claimed or unproven stock pick is linted in full", () => {
  // Self-declared meta alone, with no element.json record.
  refused("claim only", { heroFiles: { "hero.tsx": notStock } });
  // Valid lineage but an empty payload: the strict check has nothing to cover.
  refused("payload []", { heroFiles: { "hero.tsx": notStock }, heroRecord: { lineage: lineage({ "hero.tsx": STOCK_PATH }), payload: [] } });
  // A mapping to a file that is not in the vendored reference.
  refused("nonexistent target", { heroFiles: { "hero.tsx": notStock }, heroRecord: { lineage: lineage({ "hero.tsx": "does/not/exist.tsx" }), payload: ["hero.tsx"] } });
  // Correct mapping, modified contents.
  refused("modified", { heroFiles: { "hero.tsx": STOCK_CODE + notStock }, heroRecord: { lineage: lineage({ "hero.tsx": STOCK_PATH }), payload: ["hero.tsx"] } });
  // Partial mapping: stock hero.tsx is mapped, extra.tsx is not.
  refused("partial", { heroFiles: { "hero.tsx": STOCK_CODE, "extra.tsx": notStock }, heroRecord: { lineage: lineage({ "hero.tsx": STOCK_PATH }), payload: ["hero.tsx", "extra.tsx"] } });
  // An unlisted non-stock file: registry-item.json ships extra.tsx, the payload omits it.
  refused("unlisted", { heroFiles: { "hero.tsx": STOCK_CODE, "extra.tsx": notStock }, heroRecord: { lineage: lineage({ "hero.tsx": STOCK_PATH }), payload: ["hero.tsx"] } });
});

test("an adapted file passes ref-verbatim but is not stock bytes: it is linted and the shell rule holds", () => {
  const adapted = STOCK_CODE.replace('from "cn"', 'from "@/lib/utils"');
  const files = { "hero.tsx": STOCK_CODE, "extra.tsx": adapted };
  const options = adaptations => ({ heroDeps: ["example"], heroMeta: CLAIM, heroFiles: files, heroRecord: { lineage: { ...lineage({ "hero.tsx": STOCK_PATH, "extra.tsx": STOCK_PATH }), adaptations }, payload: Object.keys(files) } });
  const target = { slot: "sections.hero", element: "hero", version: 1 };
  const hashes = checkElement(consumer(options([])), target, { strict: true }).findings.map(row => /unrecorded adaptation (sha256:[a-f0-9]{64})/.exec(row.detail)?.[1]).filter(Boolean);
  assert.ok(hashes.length > 0);
  const root = consumer(options(hashes.map(hash => ({ kind: "import-paths", file: "extra.tsx", hash, reason: "consumer utils alias" }))));
  assert.equal(checkElement(root, target, { strict: true }).status, "pass");
  const findings = sectionShellFindings(root, catalog);
  for (const row of SHELL) assert.ok(findings.includes(row), row);
  // Only the stock file is exempt; the adapted one is linted in full.
  assert.deepEqual(findings.filter(row => !row.startsWith("shell:")), tokenFindings("hero", [["extra.tsx", adapted]]));
});

test("stock bytes still need a strict ref-verbatim pass", () => {
  // Byte-identical stock of a registry:ui primitive: every file row passes, but a
  // section citing a primitive fails the strict check (REF-PRIMITIVE-AS-REF).
  const ui = JSON.parse(readFileSync(join(pkg, "references/manifest.json"), "utf8")).items.find(row => row.registry === "shadcn-aria" && row.name === "separator" && row.version === "4.23.0");
  const path = "registry/aria-nova/ui/separator.tsx";
  const code = normalizeReference(readFileSync(join(pkg, "references", ui.dir, path), "utf8"), path, configFromComponents(JSON.parse(components)));
  const root = consumer({ heroDeps: ["separator"], heroMeta: CLAIM, heroFiles: { "hero.tsx": code }, heroRecord: { lineage: { mode: "verbatim", source: { registry: ui.registry, item: ui.name, version: ui.version, hash: ui.hash, files: { "hero.tsx": path } } }, payload: ["hero.tsx"] } });
  const strict = checkElement(root, { slot: "sections.hero", element: "hero", version: 1 }, { strict: true });
  assert.deepEqual([strict.status, strict.files.map(row => row.status), strict.findings.map(row => row.code)], ["fail", ["pass"], ["REF-PRIMITIVE-AS-REF"]]);
  const findings = sectionShellFindings(root, catalog);
  for (const row of SHELL) assert.ok(findings.includes(row), row);
  assert.deepEqual(findings.filter(row => !row.startsWith("shell:")), tokenFindings("hero", [["hero.tsx", code]]));
});

test("a components.json alias that is not a plain module specifier fails closed", () => {
  const ref = JSON.parse(readFileSync(join(pkg, "references/manifest.json"), "utf8")).items.find(row => row.registry === "shadcn-aria" && row.name === "dashboard-01" && row.version === "4.23.0");
  const path = "registry/aria-nova/blocks/dashboard-01/components/nav-main.tsx";
  const raw = readFileSync(join(pkg, "references", ref.dir, path), "utf8");
  const comps = JSON.parse(components);
  const evil = `export const Evil = () => <div className="${NOT_STOCK}" />`;
  const alias = `${comps.aliases.ui}"\n${evil}\nimport {} from "${comps.aliases.ui}`;
  const injected = { ...comps, aliases: { ...comps.aliases, ui: alias } };
  assert.throws(() => normalizeReference(raw, path, configFromComponents(injected)), /not a plain module specifier/);
  // The bytes the unchecked rewrite would have produced: stock plus smuggled code.
  const code = normalizeReference(raw, path, configFromComponents(comps)).replaceAll(`"${comps.aliases.ui}/`, `"${alias}/`);
  assert.ok(code.includes("export const Evil"));
  const findings = sectionShellFindings(consumer({ heroDeps: ["button"], heroMeta: CLAIM, componentsJson: JSON.stringify(injected), heroFiles: { "hero.tsx": code }, heroRecord: { lineage: { mode: "verbatim", source: { registry: ref.registry, item: ref.name, version: ref.version, hash: ref.hash, files: { "hero.tsx": path } } }, payload: ["hero.tsx"] } }), catalog);
  for (const row of SHELL) assert.ok(findings.includes(row), row);
  for (const token of NOT_STOCK.split(" ")) assert.ok(findings.some(row => row.includes(`: ${token} is`)), `${token} is linted`);
});

test("every ref-verbatim code extension is linted: stock hero.tsx beside a non-stock evil.mts", () => {
  const findings = sectionShellFindings(consumer({ heroDeps: ["example"], heroMeta: CLAIM, heroFiles: { "hero.tsx": STOCK_CODE, "evil.mts": `export const cls: string = "${NOT_STOCK}";\n` }, heroRecord: { lineage: lineage({ "hero.tsx": STOCK_PATH }), payload: ["hero.tsx"] } }), catalog);
  for (const row of SHELL) assert.ok(findings.includes(row), row);
  for (const token of NOT_STOCK.split(" ")) assert.ok(findings.some(row => row.includes(` evil.mts: ${token} is`)), `evil.mts ${token} is linted`);
});

test("class tokens drop variants, important marks and opacity modifiers", () => {
  assert.deepEqual([...classTokens(`cn("md:py-24 !text-5xl bg-primary/50", 'lg:[&_svg]:size-4')`)], ["py-24", "text-5xl", "bg-primary", "size-4"]);
  assert.deepEqual(tokenFindings("x", [["x.tsx", `"[--timeline-dot-size:1.75rem] gap-4 mt-8 max-w-2xl"`]]), []);
});

test("page findings report overflow, scroll regions, clipped bleed and empty boxes", () => {
  assert.deepEqual(pageFindings("home@375/light", { viewport: 375, scrollWidth: 375, beyond: [], scroll: [], clipped: [], empty: [] }), []);
  assert.deepEqual(pageFindings("home@375/light", { viewport: 375, scrollWidth: 420, beyond: ["table 0..420"], scroll: ["div +200px"], clipped: ["section +40px"], empty: ["div.card 300x200"] }), [
    "overflow: home@375/light scrollWidth 420 > 375 (table 0..420)",
    "scroll: home@375/light div +200px",
    "clipped: home@375/light section +40px",
    "decoration: home@375/light empty box div.card 300x200",
  ]);
});
