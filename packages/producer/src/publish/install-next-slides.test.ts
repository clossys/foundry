/**
 * `clossys publish --install --site <deck publication> --next app --bind`: a `deck.16x9` publication installs as one
 * Next App Router React page per slide at `/<deck route>/<n>` (CP1-SLIDES). The fixture consumer's publication is
 * turned into a deck of one page (`/about`) placing two slides before the store is migrated, the bound install runs
 * as it does for a site, and each slide route is bundled and server-rendered: the pinned frame and section with
 * Writer text, at the 16:9 stage, linked to its neighbours. The unmodified fixture still installs byte for byte as it
 * did before the deck path existed.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";
import { NEXT_ROUTE_MARKER } from "@clossys/publisher/install";
import { applySlotsMigration, planSlotsMigration } from "../migrate/slots.js";
import { withDesignerSlots } from "../specimen/__fixtures__/canonical-library.js";
import { publishNext, type PublishNextResult } from "./install-next.js";
import { localItemRunner, NEXT_BIND_PROJECTION } from "./install-next-bind.js";

const fixture = join(import.meta.dirname, "__fixtures__", "install-consumer");
const template = join(import.meta.dirname, "..", "..", "..", "publisher", "templates", "site");
const temps: string[] = [];
const MIGRATED_AT = "2026-11-03T00:00:00Z";
afterAll(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });

/**
 * The site install's output before CP1-SLIDES (base claude/r2f-int2 a2b4c3d01): every file the bound install leaves
 * in the site app and its install record (root paths written as `<root>`), as one digest over its sorted `path sha256` lines.
 */
const SITE_INSTALL_DIGEST = "0958b535d9c6e2fe89975e738c5c0acae085b3473893776bc86cdc3531dd8687";

const records = (root: string, agent: string) => join(root, "clossys", "agents", agent);
/** Rewrite a pinned candidate and re-pin its hash, as `clossys pin` would record the edited file. */
function repin(root: string, agent: string, slot: string, candidate: string, edit: (record: Record<string, unknown>) => void) {
  const dir = join(records(root, agent), slot);
  const file = join(dir, "candidates", candidate);
  const record = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  edit(record);
  const text = `${JSON.stringify(record, null, 2)}\n`;
  writeFileSync(file, text);
  const pin = JSON.parse(readFileSync(join(dir, "pin.json"), "utf8")) as Record<string, unknown>;
  writeFileSync(join(dir, "pin.json"), `${JSON.stringify({ ...pin, sha256: createHash("sha256").update(text).digest("hex") }, null, 2)}\n`);
}
/**
 * The deck: the publication records `deck.16x9` over its one page, `/about`, which places two slides. A page places
 * each section slot once, so the second slide is a second pinned section (the fixture hero, pinned to
 * `sections.page-header`).
 */
function asDeck(root: string) {
  const designer = records(root, "designer");
  cpSync(join(designer, "sections.hero"), join(designer, "sections.page-header"), { recursive: true });
  const heroPin = JSON.parse(readFileSync(join(designer, "sections.hero", "pin.json"), "utf8")) as { candidate: string };
  repin(root, "designer", "sections.page-header", heroPin.candidate, record => {
    const meta = record.meta as { slot: string; element: { slot: string } };
    meta.slot = "sections.page-header";
    meta.element.slot = "sections.page-header";
  });
  repin(root, "publisher", "publication.example-site", "publication-v2.json", record => {
    record.format = "deck.16x9";
    record.entryOrder = ["about"];
    const tree = (record.meta as { tree: { children: { cells: string[] }[] } }).tree;
    tree.children[0]!.cells = ["page.about"];
  });
  repin(root, "publisher", "page.about", "page-v1.json", record => { record.sections = ["sections.hero", "sections.page-header"]; });
}

/** A temp consumer holding the fixture records (as a deck when asked) and the site template as `apps/site`. */
async function consumer(deck: boolean): Promise<{ root: string; site: string; app: string }> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "producer-next-slides-")));
  temps.push(root);
  cpSync(fixture, root, { recursive: true });
  if (deck) asDeck(root);
  await withDesignerSlots(join(root, "clossys"));
  const plan = planSlotsMigration(root, { at: MIGRATED_AT, version: "0.0.0-test" });
  if (plan.findings.length) throw new Error(`fixture store does not migrate: ${JSON.stringify(plan.findings)}`);
  applySlotsMigration(root, plan, { at: MIGRATED_AT, version: "0.0.0-test" });
  const site = join(root, "apps", "site");
  cpSync(template, site, { recursive: true, filter: source => !/[\\/](?:node_modules|\.next)(?:[\\/]|$)/.test(source.slice(template.length)) });
  return { root, site, app: join(site, "app") };
}
const install = (root: string, app: string): Promise<PublishNextResult> => publishNext({
  root, publication: "example-site", app, check: false, out: join(root, ".out"),
  bind: { selection: { module: join(root, "component-selection.ts") }, runner: localItemRunner },
});
const blocking = (result: PublishNextResult) => result.findings.filter(finding => finding.severity !== "info");

/** Every file under `dir` (but dependencies, build output and render bundles), relative and sorted. */
function files(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap(name => {
    if (["node_modules", ".next", ".render"].includes(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, base) : [relative(base, path)];
  }).sort();
}
function siteDigest(root: string, site: string): string {
  const lines = [site, join(root, ".out")].flatMap(dir => files(dir).map(file => `${relative(root, join(dir, file))} ${createHash("sha256").update(readFileSync(join(dir, file), "utf8").split(root).join("<root>")).digest("hex")}`));
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

/** Bundle the installed root layout around one installed route and render it to HTML, as Next would on the server. */
async function render(site: string, route: string): Promise<string> {
  const here = createRequire(import.meta.url);
  const entry = `import { createElement } from "react"; import Layout from "./app/layout"; import Page from "./app/${route}"; export default function Root() { return createElement(Layout, null, createElement(Page)); }`;
  const result = await build({
    stdin: { contents: entry, resolveDir: site, loader: "tsx" }, bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic", logLevel: "silent",
    banner: { js: `import { createRequire as __createRequire } from "node:module"; const require = __createRequire(${JSON.stringify(import.meta.filename)});` },
    loader: { ".css": "empty" },
    nodePaths: [join(import.meta.dirname, "..", "..", "node_modules"), join(import.meta.dirname, "..", "..", "..", "..", "node_modules")],
    plugins: [{ name: "host-react", setup(builder) { builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, args => ({ path: here.resolve(args.path), external: true })); } }],
  });
  const out = join(site, ".render", `${route.replace(/\W/g, "-")}-${Date.now()}.mjs`);
  mkdirSync(join(site, ".render"), { recursive: true });
  writeFileSync(out, result.outputFiles[0]!.text);
  const module = await import(pathToFileURL(out).href) as { default: ComponentType };
  return renderToStaticMarkup(createElement(module.default));
}

describe("clossys publish --install --next --bind: slide decks", () => {
  it("a deck.16x9 publication installs one React page per slide", async () => {
    const { root, site, app } = await consumer(true);
    const result = await install(root, app);
    expect(blocking(result)).toEqual([]);
    for (const n of [1, 2]) expect(readFileSync(join(app, "about", String(n), "page.tsx"), "utf8").split("\n")[0]).toBe(NEXT_ROUTE_MARKER);
    expect(existsSync(join(app, "about", "page.tsx"))).toBe(false);
    expect(existsSync(join(app, "about", "3", "page.tsx"))).toBe(false);
    const first = await render(site, "about/1/page");
    expect(first).toContain('data-frame="plain"');
    expect(first).toContain('data-deck-stage="16:9"');
    expect(first).toContain('data-slide="1"');
    expect(first).toContain('href="/about/2"');
    expect(first).not.toContain('rel="prev"');
    expect(first).toContain("1 / 2");
    const second = await render(site, "about/2/page");
    expect(second).toContain('href="/about/1"');
    expect(second).not.toContain('rel="next"');
    expect(second).toContain("2 / 2");
    // The slide's section carries the deck page's Writer text, as the site page did.
    const heading = /<h1[^>]*>([^<]+)<\/h1>/.exec(first)?.[1];
    expect(heading).toBeTruthy();
    expect(second).toContain(heading!);
  }, 120_000);

  it("bind records list the slide routes", async () => {
    const { root, site, app } = await consumer(true);
    const result = await install(root, app);
    expect(blocking(result)).toEqual([]);
    const projection = JSON.parse(readFileSync(join(site, NEXT_BIND_PROJECTION), "utf8")) as { pages: { id: string; route: string; sections: string[] }[] };
    expect(projection.pages.map(page => page.route)).toEqual(["/about/1", "/about/2"]);
    expect(projection.pages.map(page => page.sections)).toEqual([["sections.hero"], ["sections.page-header"]]);
    const report = JSON.parse(readFileSync(join(root, ".out", "install-report.json"), "utf8")) as { pages: { route: string }[] };
    expect(report.pages.map(page => page.route).sort()).toEqual(["/about/1", "/about/2"]);
  }, 120_000);

  it("a site publication installs unchanged", async () => {
    const { root, site, app } = await consumer(false);
    const result = await install(root, app);
    expect(blocking(result)).toEqual([]);
    const digest = siteDigest(root, site);
    expect(digest).toBe(SITE_INSTALL_DIGEST);
  }, 120_000);
});
