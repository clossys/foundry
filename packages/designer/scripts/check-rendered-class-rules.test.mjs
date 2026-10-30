import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import { cssClassRules, htmlClasses, sourceClasses, checkClasses, main } from "./check-rendered-class-rules.mjs";
import { upstreamMarkers, upstreamStyleRules } from "./proc3-upstream-markers.mjs";
import postcss from "postcss";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = resolve(root, "coverage/tmp/proc3-upstream-markers");
mkdirSync(scratch, { recursive: true });
// Leave mutation evidence under ignored tmp. Tests never clean other work.
const fixture = () => mkdtempSync(resolve(scratch, "case-"));
const script = fileURLToPath(new URL("./check-rendered-class-rules.mjs", import.meta.url));
const run = args => {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(result.error, undefined);
  return result;
};

// Test fixtures collect their own bytes; they are not native Studio evidence.
function renderedArgs(html, css) {
  const manifest = resolve(dirname(html), "render-manifest.json");
  const sourceHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  writeFileSync(manifest, JSON.stringify({ version: 1, sourceHead, files: [html, css].map(file => ({ path: relative(dirname(manifest), file), sha256: createHash("sha256").update(readFileSync(file)).digest("hex") })) }));
  return ["--html", html, "--css", css, "--render-manifest", manifest];
}

test("escaped Tailwind selectors, nested conditions, compounds, and structural markers retain exact names", () => {
  const rules = cssClassRules(String.raw`
    @media (width >= 48rem) {
      .md\:flex { display: flex }
      .hover\:bg-primary\/90:hover { background: red }
      .group\/card:has([data-state=open]) .group-data-\[state\=open\]\/card\:flex { display:flex }
      .\[\&_svg\:not\(\[class\*\=\'size-\'\]\)\]\:size-4 { & svg:not([class*='size-']) { width:1rem; height:1rem } }
      .w-\[calc\(100\%-1rem\)\] { width:calc(100% - 1rem) }
      .\32 xl\:grid:is(.dark *) { display:grid }
      .one.two { color:red }
      [class~="attribute-class"] { color:blue }
    }
  `);
  for (const name of ["md:flex", "hover:bg-primary/90", "group/card", "group-data-[state=open]/card:flex", "[&_svg:not([class*='size-'])]:size-4", "w-[calc(100%-1rem)]", "2xl:grid", "dark", "one", "two", "attribute-class"]) assert(rules.has(name), name);
});

test("empty rules, comments, negative selectors, supports queries, and keyframe names provide no coverage", () => {
  const rules = cssClassRules(`
    /* .comment { color:red } */
    .empty {}
    .outer-empty { .inner-empty {} }
    .real:not(.negative) { color:red }
    @supports selector(.query-only) { .supported { display:block } }
    @keyframes animation { from { opacity:0 } to { opacity:1 } }
  `);
  for (const name of ["empty", "outer-empty", "inner-empty", "negative", "query-only", "comment", "animation"]) assert(!rules.has(name), name);
  assert(rules.has("real"));
  assert(rules.has("supported"));
  assert.deepEqual(checkClasses(new Map([["empty", []], ["real", []]]), rules).map(row => row.class), ["empty"]);
  assert.throws(() => cssClassRules('@import "missing.css"; .real {display:block}'), /unresolved CSS @import/);
});

test("valid support queries and bare nesting preserve evidence; malformed or ineffective declarations fail closed", () => {
  const rules = cssClassRules(`
    @supports (display: grid) and selector(:is(.query)) {
      .parent { .child { display:grid } }
      .positive:is(.choice):not(:is(.negative))::part(part-only) { color:red }
    }
  `);
  for (const token of ["parent", "child", "positive", "choice"]) assert(rules.has(token), token);
  for (const token of ["query", "negative", "part-only"]) assert(!rules.has(token), token);
  for (const invalid of [".x{display:}", ".x{display:bogus-value}", ".x{nonsense:foo}", ".x{color red;}", ".x{.child{color red;}}", ".x{display:block; broken}", ".x{display:block", ".x{content:\"unclosed}", "/* unclosed", "@example {.x{display:block}}"] ) {
    assert.throws(() => cssClassRules(invalid), undefined, invalid);
  }
  assert(!rules.has("group/absent"), "structural classification does not invent candidate CSS rules");
});

test("pinned classification distinguishes structural markers from @apply styling and common global rules", () => {
  const classification = upstreamMarkers(sourceClasses);
  for (const token of ["cn-card-action", "cn-breadcrumb"]) assert.equal(classification.classify(token)?.kind, "upstream-hook");
  for (const token of ["group", "group/badge", "group/new-valid-name", "group/_slot", "group/--slot"]) assert.equal(classification.classify(token)?.kind, "structural-group");
  for (const token of ["cn-badge", "cn-badge-variant-default", "cn-font-heading", "cn-unknown-typo", "group-typo", "group-hover/card:flex", "group/card:flex", "group/4bad", "group/", "group/-"]) assert.equal(classification.classify(token), undefined, token);
  assert(classification.styling.get("cn-badge").some(row => row.kind === "apply"));
  assert(classification.styling.get("cn-font-heading").some(row => row.file === "apps/v4/app/globals.css"));
  const rules = upstreamStyleRules('.outer { .styled { @apply flex; } .empty {} .positive:not(.negative) { color:red } } /* .comment { @apply flex; } */', "reference.css");
  for (const token of ["outer", "styled", "positive"]) assert(rules.has(token), token);
  for (const token of ["empty", "negative", "comment"]) assert(!rules.has(token), token);
  assert.throws(() => upstreamStyleRules(".broken { @apply flex;", "broken.css"));
});

test("locked framework group variants use structural ancestors and generate no standalone group rule", async () => {
  const { compile } = createRequire(import.meta.url)("tailwindcss");
  const compiler = await compile("@tailwind utilities;");
  assert.equal(cssClassRules(compiler.build(["group", "group/new-valid-name"])).size, 0);
  const rules = cssClassRules(compiler.build(["group-hover/new-valid-name:flex"]));
  assert(rules.has("group-hover/new-valid-name:flex"));
  assert(rules.get("group/new-valid-name").some(row => row.selector.includes(":where(.group\\/new-valid-name)")));
});

test("pinned reference byte drift fails closed with CLI exit 2", () => {
  const dir = fixture(), source = resolve(dir, "source.tsx"), css = resolve(dir, "classes.css"), changed = resolve(dir, "tampered-reference.css");
  const reference = resolve(root, "packages/designer/scripts/__fixtures__/proc3-upstream/globals.css");
  writeFileSync(source, 'export const X = () => <div className="flex" />;');
  writeFileSync(css, ".flex{display:flex}");
  writeFileSync(changed, readFileSync(reference, "utf8") + "\n.cn-card-action { color:red }\n");
  const read = file => readFileSync(file === reference ? changed : file);
  assert.throws(() => upstreamMarkers(sourceClasses, read), /reference hash mismatch/);
  const log = console.log, error = console.error, output = [];
  let status;
  try {
    console.log = value => output.push(value); console.error = () => {};
    status = main(["--source", source, "--css", css], read);
  } finally { console.log = log; console.error = error; }
  assert.equal(status, 2);
  const report = JSON.parse(output.at(-1));
  assert.equal(report.ok, false); assert.equal(report.status, "invalid-input");
  assert.match(report.violations[0].reason, /reference hash mismatch/);
  writeFileSync(resolve(dir, "reference-tamper-report.json"), output.at(-1));
});

test("legitimate markers pass while removing a shipped cn styling rule and adding novel hooks fail", t => {
  const dir = fixture(), html = resolve(dir, "markers.html"), unknown = resolve(dir, "unknown.html"), removed = resolve(dir, "removed-cn-badge.css");
  const shipped = resolve(root, "packages/designer/styles/compiled.css"), before = readFileSync(shipped, "utf8");
  const tree = postcss.parse(before), selected = [];
  tree.walkRules(node => { if (node.selector === ".style-nova .cn-badge") selected.push(node); });
  assert(selected.length > 0, "mutation must remove actual shipped cn-badge styling");
  selected.forEach(node => node.remove());
  writeFileSync(removed, tree.toString());
  const tokens = "flex cn-badge group group/badge group/new-valid-name cn-card-action cn-breadcrumb";
  writeFileSync(html, `<div class="${tokens}"></div>`);
  writeFileSync(unknown, `<div class="${tokens} cn-unknown-typo group-typo group-hover/new:never-shipped"></div>`);
  const clean = run(renderedArgs(html, shipped)), missing = run(renderedArgs(html, removed)), novel = run(renderedArgs(unknown, shipped));
  assert.equal(clean.status, 0, clean.stderr); assert.equal(missing.status, 1, missing.stderr); assert.equal(novel.status, 1, novel.stderr);
  const cleanReport = JSON.parse(clean.stdout), missingReport = JSON.parse(missing.stdout), novelReport = JSON.parse(novel.stdout);
  assert.equal(cleanReport.markerCount, 5); assert.equal(cleanReport.counts.markers, 5);
  assert.deepEqual(missingReport.missing.map(row => row.class), ["cn-badge"]);
  for (const token of ["cn-unknown-typo", "group-typo", "group-hover/new:never-shipped"]) assert(novelReport.missing.some(row => row.class === token), token);
  const fontHtml = resolve(dir, "common-font.html"), fontCss = resolve(dir, "without-common-font.css");
  writeFileSync(fontHtml, '<div class="flex cn-font-heading"></div>'); writeFileSync(fontCss, ".flex{display:flex}");
  const font = run(renderedArgs(fontHtml, fontCss));
  assert.equal(font.status, 1, font.stderr); assert.deepEqual(JSON.parse(font.stdout).missing.map(row => row.class), ["cn-font-heading"]);
  assert.equal(readFileSync(shipped, "utf8"), before, "product CSS remains byte-identical");
  for (const [name, result] of [["markers", clean], ["removed-styling", missing], ["novel-hooks", novel]]) writeFileSync(resolve(dir, `${name}-report.json`), result.stdout);
  const receipt = { sourceHead: cleanReport.sourceHead, baselineExit: clean.status, removedStylingExit: missing.status, novelHookExit: novel.status, markerCount: cleanReport.markerCount, productCssUnchanged: true, shippedCssSha256: createHash("sha256").update(before).digest("hex"), evidenceDirectory: dir };
  writeFileSync(resolve(scratch, "latest-upstream-mutation-receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  t.diagnostic(JSON.stringify(receipt));
});

test("HTML parser measures real attributes, entities, SVG, and template content without reading prose", () => {
  const classes = htmlClasses(`<div class="flex [&amp;_svg]:size-4"><svg class='icon'/><template><b class="hidden"></b></template></div><p>class="prose-only"</p><!-- class="comment-only" -->`);
  assert.deepEqual([...classes.keys()].sort(), ["[&_svg]:size-4", "flex", "hidden", "icon"]);
});

test("source extraction follows class contexts, cva variants, imported helpers and tables; prose stays out", () => {
  const dir = fixture();
  writeFileSync(resolve(dir, "classes.ts"), `
    const variants = { first: 'bg-primary hover:bg-primary/90', second: 'bg-secondary' };
    export function look(value: 'first' | 'second') { return ['inline-flex', variants[value]].join(' ') }
  `);
  const source = resolve(dir, "component.tsx");
  writeFileSync(source, `
    import { look } from './classes.js';
    const prose = 'a Writer sentence with spaces';
    const kind = cva('rounded-md', { variants: { size: { sm: 'h-8', lg: 'h-10' } }, defaultVariants: { size: 'sm' }, compoundVariants: [{ size:'sm', className:'font-medium' }] });
    export function Example({ className, tone }: { className?:string, tone:'first'|'second' }) {
      return <button title="A Writer title" className={cn(kind({size:'sm'}), look(tone), { 'border-primary': true }, className)}>A Writer body</button>
    }
  `);
  const result = sourceClasses([source]);
  assert.deepEqual([...result.classes.keys()].sort(), ["bg-primary", "bg-secondary", "border-primary", "font-medium", "h-10", "h-8", "hover:bg-primary/90", "inline-flex", "rounded-md"]);
  assert.deepEqual(result.unsupported, []);
  assert(result.externalInputs.length > 0);
});

test("finite interpolated classes are enumerated; unknown generated classes fail explicitly", () => {
  const dir = fixture(), source = resolve(dir, "generated.tsx");
  writeFileSync(source, "export function X({value}:{value:string}) { const size = true ? '4' : '6'; return <div className={cn(`size-${size}`, `bg-${value}`)} /> }");
  const result = sourceClasses([source]);
  assert.deepEqual([...result.classes.keys()].sort(), ["size-4", "size-6"]);
  assert.equal(result.unsupported.length, 1);
  assert.match(result.unsupported[0].reason, /not a finite literal union/);
  const css = resolve(dir, "classes.css");
  writeFileSync(css, ".size-4{width:1rem}.size-6{width:1.5rem}");
  const failed = run(["--source", source, "--css", css]);
  assert.equal(failed.status, 1, failed.stderr);
  assert.equal(JSON.parse(failed.stdout).unsupported.length, 1);
});

test("local class properties resolve, caller inputs fail, and imported source is included in hashes", () => {
  const dir = fixture(), source = resolve(dir, "local.tsx"), helper = resolve(dir, "helper.ts"), css = resolve(dir, "local.css");
  writeFileSync(helper, `export const table = {className:'flex'}; export const other = 'grid';`);
  writeFileSync(source, `import {table, other} from './helper.js'; export function X({className='hidden'}:{className?:string}) {return <div className={cn(table.className, other, className)} />}`);
  writeFileSync(css, ".flex{display:flex}.grid{display:grid}.hidden{display:none}");
  const result = sourceClasses([source]);
  assert.deepEqual([...result.classes.keys()].sort(), ["flex", "grid", "hidden"]);
  assert.equal(result.externalInputs.length, 1);
  assert.deepEqual(result.unsupported, []);
  const measured = run(["--source", source, "--css", css]);
  assert.equal(measured.status, 1, measured.stderr);
  const report = JSON.parse(measured.stdout);
  assert.equal(report.counts.unverified, 1);
  assert(report.inputHashes.some(row => row.file === helper && /^[0-9a-f]{64}$/.test(row.sha256)));
  assert.match(report.sourceHead, /^[0-9a-f]{40}$/);
});

test("imported helper syntax errors, invalid cva data, and mismatched source heads are rejected", () => {
  const dir = fixture(), source = resolve(dir, "component.tsx"), helper = resolve(dir, "helper.ts"), css = resolve(dir, "classes.css");
  writeFileSync(css, ".flex{display:flex}");
  writeFileSync(helper, "export const look = ;");
  writeFileSync(source, "import {look} from './helper.js'; export const X = () => <div className={look} />;");
  assert.throws(() => sourceClasses([source]), /syntax error/);
  writeFileSync(source, "const styles=cva('flex',{variants:getUnknown()}); export const X = () => <div className={styles()} />;");
  const unresolved = run(["--source", source, "--css", css]);
  assert.equal(unresolved.status, 1, unresolved.stderr);
  assert(JSON.parse(unresolved.stdout).counts.unsupported > 0);
  const head = run(["--source", source, "--css", css, "--source-head", "0".repeat(40)]);
  assert.equal(head.status, 2);
  assert.match(head.stderr, /Source head mismatch/);
});

test("CLI rejects invalid, empty, and unresolved inputs instead of passing", () => {
  const dir = fixture(), html = resolve(dir, "empty.html"), css = resolve(dir, "empty.css");
  writeFileSync(html, "<p>No classes</p>");
  writeFileSync(css, ".flex{display:flex}");
  assert.equal(run(renderedArgs(html, css)).status, 2);
  assert.equal(run(["--invalid"]).status, 2);
  writeFileSync(html, '<div class="flex"></div>');
  writeFileSync(css, ".flex{}");
  assert.equal(run(renderedArgs(html, css)).status, 2);
});

test("real shipped CSS passes; removing its flex rule and injecting a class each exit 1", t => {
  const dir = fixture(), html = resolve(dir, "rendered.html"), changedHtml = resolve(dir, "injected.html"), changedCss = resolve(dir, "removed-rule.css");
  const shipped = resolve(root, "packages/designer/styles/compiled.css");
  const before = readFileSync(shipped, "utf8");
  const digest = text => createHash("sha256").update(text).digest("hex");
  writeFileSync(html, '<div class="flex"></div>');
  writeFileSync(changedHtml, '<div class="flex class-rule-mutation-unshipped"></div>');
  const mutation = before.replace(/\n  \.flex \{\s*display: flex;\s*\}/, "");
  assert.notEqual(mutation, before, "the shipped flex rule must actually be removed");
  writeFileSync(changedCss, mutation);
  const clean = run(renderedArgs(html, shipped));
  assert.equal(clean.status, 0, clean.stderr);
  const removed = run(renderedArgs(html, changedCss));
  assert.equal(removed.status, 1, removed.stderr);
  assert.deepEqual(JSON.parse(removed.stdout).missing.map(row => row.class), ["flex"]);
  const injected = run(renderedArgs(changedHtml, shipped));
  assert.equal(injected.status, 1, injected.stderr);
  assert.deepEqual(JSON.parse(injected.stdout).missing.map(row => row.class), ["class-rule-mutation-unshipped"]);
  assert.equal(digest(readFileSync(shipped, "utf8")), digest(before), "product CSS remains byte-identical");
  const cleanReport = JSON.parse(clean.stdout), removedReport = JSON.parse(removed.stdout), injectedReport = JSON.parse(injected.stdout);
  writeFileSync(resolve(dir, "baseline-report.json"), clean.stdout);
  writeFileSync(resolve(dir, "removed-rule-report.json"), removed.stdout);
  writeFileSync(resolve(dir, "injected-class-report.json"), injected.stdout);
  const receipt = { gate:"rendered-class-rules", sourceHead:cleanReport.sourceHead, evidenceDirectory:dir, baselineExit: clean.status, removedRuleExit: removed.status, injectedClassExit: injected.status, baselineCounts:cleanReport.counts, removedRuleCounts:removedReport.counts, injectedClassCounts:injectedReport.counts, shippedCssSha256: digest(before), productCssUnchanged: true };
  writeFileSync(resolve(dir, "mutation-receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  writeFileSync(resolve(scratch, "latest-mutation-receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  t.diagnostic(JSON.stringify(receipt));
});

test("standalone HTML refuses missing, stale, incomplete and hash-mismatched render manifests", () => {
  const dir = fixture(), html = resolve(dir, "rendered.html"), css = resolve(dir, "rendered.css");
  writeFileSync(html, '<div class="flex"></div>');
  writeFileSync(css, '.flex{display:flex}');
  const missing = run(["--html", html, "--css", css]);
  assert.equal(missing.status, 2); assert.match(missing.stderr, /requires --render-manifest/);
  const args = renderedArgs(html, css), manifest = args.at(-1), fresh = JSON.parse(readFileSync(manifest, "utf8"));
  assert.equal(run(args).status, 0);
  writeFileSync(manifest, JSON.stringify({ ...fresh, sourceHead: "0".repeat(40) }));
  const stale = run(args);
  assert.equal(stale.status, 2); assert.match(stale.stderr, /sourceHead/);
  writeFileSync(manifest, JSON.stringify({ ...fresh, files: fresh.files.slice(0, 1) }));
  const incomplete = run(args);
  assert.equal(incomplete.status, 2); assert.match(incomplete.stderr, /absent from manifest/);
  writeFileSync(manifest, JSON.stringify({ ...fresh, files: fresh.files.slice(1) }));
  const empty = run(args);
  assert.equal(empty.status, 2); assert.match(empty.stderr, /HTML inventory/);
  writeFileSync(manifest, JSON.stringify(fresh));
  writeFileSync(html, '<div class="flex changed"></div>');
  const changed = run(args);
  assert.equal(changed.status, 2); assert.match(changed.stderr, /hash mismatch/);
});
