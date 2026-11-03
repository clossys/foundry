import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classTokens, loadCatalog, sectionShellFindings, tokenFindings } from "./check-section-tokens.mjs";
import { pageFindings } from "./check-page-overflow.mjs";

const catalog = loadCatalog();
const bandTokens = String(catalog.contracts.get("sections.band").limits["emits.theme"]).split(",");

function consumer({ heroClass = "py-section", heroDeps = ["@acme/section-shell", "@acme/section-header"], emits = bandTokens, heroMeta } = {}) {
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
  add("sections.hero", "hero", { registryDependencies: heroDeps, ...(heroMeta ? { meta: heroMeta } : {}) }, { "hero.tsx": `export const Hero = () => <div className="${heroClass}" />` });
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

test("a verbatim stock pick keeps its reference classes and need not compose the band", () => {
  const stock = "py-24 max-w-5xl text-5xl";
  const pick = { source: { kind: "registry", ref: ["shadcn-aria/separator-example@4.23.0"] }, refVerbatim: { files: { "hero.tsx": "registry/aria-nova/examples/separator-example.tsx" } } };
  assert.deepEqual(sectionShellFindings(consumer({ heroClass: stock, heroDeps: ["separator"], heroMeta: pick }), catalog), []);
  // Mutation: the same code as an adopt (derived), or with the file unmapped, is linted again.
  const derived = sectionShellFindings(consumer({ heroClass: stock, heroDeps: ["separator"], heroMeta: { ...pick, source: { ...pick.source, kind: "derived" } } }), catalog);
  assert.equal(derived.filter(row => row.startsWith("shell:")).length, 2);
  assert.equal(derived.filter(row => /^(spacing|type):/.test(row)).length, 3);
  const unmapped = sectionShellFindings(consumer({ heroClass: stock, heroDeps: ["separator"], heroMeta: { ...pick, refVerbatim: { files: {} } } }), catalog);
  assert.equal(unmapped.length, 5);
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
