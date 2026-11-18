/**
 * foundry-build-0048 U18: `clossys init --publication` records a publication's outputs on a new
 * submitted candidate, and `clossys publish --install --next --bind` installs them from the pinned
 * records: a form endpoint, share images drawn from the Designer's pinned mark, llms.txt, a feed,
 * JSON-LD in the layout, and every page again per non-default locale, bound to that locale's
 * pinned Writer copy. A locale the Writer has not drafted blocks the install; nothing falls back.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";
import { NEXT_ROUTE_MARKER } from "@clossys/publisher/install";
import { initPublicationOutputs as initThroughSubmit, type InitOutputsOptions } from "../cli/init-outputs.js";
import { STEPS } from "../pipeline/steps/index.js";
import { readLedger } from "../records/slots.js";
import { writeVerdict } from "../records/slot-write.js";
import { runCli } from "../cli/main.js";
import { withDesignerSlots } from "../specimen/__fixtures__/canonical-library.js";
import { designerShareMark, writerLocaleCopy } from "./install-outputs.js";
import { publishNext, type PublishNextResult } from "./install-next.js";
import { localItemRunner, NEXT_BIND_ASSEMBLY } from "./install-next-bind.js";

const fixture = join(import.meta.dirname, "__fixtures__", "install-consumer");
const template = join(import.meta.dirname, "..", "..", "..", "publisher", "templates", "site");
const temps: string[] = [];
const MARK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-label="Example"><circle cx="12" cy="12" r="10"/></svg>';
afterAll(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });

async function consumer(): Promise<{ root: string; site: string; app: string }> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "producer-outputs-")));
  temps.push(root);
  cpSync(fixture, root, { recursive: true });
  await withDesignerSlots(join(root, "clossys"));
  // The Designer's pinned mark: a token file whose positive variant is the svg share images draw.
  const mark = slotDir(root, "designer", "assets.mark");
  mkdirSync(join(mark, "candidates"), { recursive: true });
  const tokens = { assets: { mark: { positive: { $type: "svg", $value: MARK } } } };
  const item = {
    name: "mark", type: "registry:item",
    files: [{ path: "clossys/assets.mark.json", type: "registry:file", content: JSON.stringify(tokens, null, 2) }],
    meta: { slot: "assets.mark", source: { kind: "original", ref: ["test fixture"], license: "MIT" }, element: {
      id: "mark", package: "designer", layer: "assets", slot: "assets.mark", kind: "registry:item", license: "MIT",
      creator: { agent: "designer", model: "fixture", by: "U18" }, reason: "A fixture mark for share images.", createdAt: "2026-11-18T00:00:00Z",
      checks: [{ check: "ref-verbatim", status: "exempt", note: "non-code asset payload" }], deps: { npm: {}, registry: [] }, reads: { copyKeys: [], themeVars: [] },
    } },
  };
  writeFileSync(join(mark, "candidates", "mark-v1.json"), `${JSON.stringify(item, null, 2)}\n`);
  pin(root, "designer", "assets.mark", "mark-v1.json");
  const site = join(root, "apps", "site");
  cpSync(template, site, { recursive: true, filter: source => !/[\\/](?:node_modules|\.next)(?:[\\/]|$)/.test(source.slice(template.length)) });
  return { root, site, app: join(site, "app") };
}
const install = (root: string, app: string, check = false): Promise<PublishNextResult> => publishNext({
  root, publication: "example-site", app, check, out: join(root, ".out"),
  bind: { selection: { module: join(root, "component-selection.ts") }, runner: localItemRunner },
});
const blocking = (result: PublishNextResult) => result.findings.filter(finding => finding.severity !== "info");
const slotDir = (root: string, agent: string, id: string) => join(root, "clossys", "agents", agent, id);
/** A test-side pin of a candidate already in the slot (the fixture's pins are written the same way). */
function pin(root: string, agent: string, id: string, candidate: string): void {
  const bytes = readFileSync(join(slotDir(root, agent, id), "candidates", candidate));
  writeFileSync(join(slotDir(root, agent, id), "pin.json"), `${JSON.stringify({ candidate, sha256: createHash("sha256").update(bytes).digest("hex"), decidedBy: "planner:U18", basis: "planner", at: "2026-11-18T00:00:00Z" }, null, 2)}\n`);
}
/** The Writer's strings again with a French section: every key the pages and outputs draw. */
function draftFrench(root: string, omit: readonly string[] = []): void {
  const dir = slotDir(root, "writer", "strings.site");
  const en = readFileSync(join(dir, "candidates", "site-v2.md"), "utf8");
  const [, head, body] = /^(---\n[\s\S]*?\n---\n)([\s\S]*)$/.exec(en)!;
  const blocks = body!.split(/\n(?=### )/).slice(1).filter(block => !omit.some(key => block.startsWith(`### ${key}\n`)));
  const fr = blocks.map(block => block.replace(/\n([^\n<][^\n]*)\s*$/, "\nFR $1")).join("\n\n");
  const name = "site-v3.md";
  writeFileSync(join(dir, "candidates", name), `${head!.replace('locales: ["en"]', 'locales: ["en","fr"]')}${body!.trimEnd()}\n\n## fr\n\n${fr.trimEnd()}\n`);
  pin(root, "writer", "strings.site", name);
}
/**
 * init through the candidates verb: the slot gets a P1 create verdict first (adapt is P2), and the
 * guard runs with no rules here (the verb's own mechanics; init-outputs-slot2.e2e.test.ts runs the real guard).
 */
function initPublicationOutputs(root: string, options: InitOutputsOptions) {
  const id = `publication.${options.publication}`;
  if (!readLedger(slotDir(root, "publisher", id))?.events.some(event => event.op === "verdict")) {
    writeVerdict(join(root, "clossys"), "publisher", id, { verdict: "create", reason: "fixture: outputs are recorded on a new candidate", gaps: [{ id: "findability" }] }, { by: "agent:publisher.verdict", at: "2026-11-18T00:00:00Z" }, { model: "fixture", tier: "mid" });
  }
  const skill = STEPS.find(step => step.id === "publisher.candidates")!.command.skill!;
  return initThroughSubmit(root, options, { model: "fixture", tier: "mid", basis: "agent", skill }, { rules: [] });
}
const OUTPUTS = { publication: "example-site", forms: ["contact"] as const, share: true, meta: ["json-ld", "llms", "rss"] as const, locales: ["en", "fr"], origin: "https://example.com", identity: { name: "site.name", summary: "home.hero.body" } };

/** A route rendered inside its own root layout, with the layout's metadata export (what Next sets as <title>). */
async function render(site: string, route: string, layout: string): Promise<{ html: string; title?: string }> {
  const here = createRequire(import.meta.url);
  const entry = `import { createElement } from "react"; import Layout, { metadata } from "./app/${layout}"; import Page from "./app/${route}"; export { metadata }; export default function Root() { return createElement(Layout, null, createElement(Page)); }`;
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
  const module = await import(pathToFileURL(out).href) as { default: ComponentType; metadata?: { title?: string } };
  return { html: renderToStaticMarkup(createElement(module.default)), ...(module.metadata?.title !== undefined ? { title: module.metadata.title } : {}) };
}

describe("publication outputs (U18)", () => {
  it("init records the outputs on a new submitted candidate, never pins it, and names each Writer draft a locale needs", { timeout: 60_000 }, async () => {
    const { root } = await consumer();
    const pinBefore = readFileSync(join(slotDir(root, "publisher", "publication.example-site"), "pin.json"), "utf8");
    const result = await initPublicationOutputs(root, OUTPUTS);
    expect(result.candidate).toBe("example-site-v3.json");
    expect(readFileSync(join(slotDir(root, "publisher", "publication.example-site"), "pin.json"), "utf8")).toBe(pinBefore);
    const written = JSON.parse(readFileSync(join(slotDir(root, "publisher", "publication.example-site"), "candidates", result.candidate), "utf8"));
    expect(written.entryOrder).toEqual(["home", "about"]);
    expect(written.outputs).toMatchObject({ origin: "https://example.com", share: true, jsonLd: true, llms: true, feed: "rss", locales: { default: "en", all: ["en", "fr"] } });
    expect(written.outputs.forms).toEqual([expect.objectContaining({ id: "contact", kind: "contact", targetEnv: "CONTACT_FORM_TARGET" })]);
    // The record names the variable; no value appears anywhere in it.
    expect(JSON.stringify(written.outputs)).not.toMatch(/https:\/\/(?!example\.com)/);
    expect(result.writerDrafts.filter(row => row.locale === "en")).toEqual([]);
    expect(result.writerDrafts).toEqual(expect.arrayContaining([{ locale: "fr", key: "site.name" }, { locale: "fr", key: "home.hero.body" }, { locale: "fr", key: "site.studio.name" }]));
    expect(result.needsMark).toBe(false);

    // A value where a variable name belongs, or a non-https origin, is refused and writes nothing.
    await expect(initPublicationOutputs(root, { ...OUTPUTS, origin: "http://example.com" })).rejects.toThrow(/outputs refused: outputs.origin/);
    expect(existsSync(join(slotDir(root, "publisher", "publication.example-site"), "candidates", "example-site-v4.json"))).toBe(false);
    const cli = await runCli(["init", "--publication", "example-site", "--forms", "contact,webhook", "--root", root]);
    expect(cli.exitCode).not.toBe(0);
    expect(cli.message).toMatch(/--forms: unknown form webhook/);
  });

  it("the share mark is the Designer's pinned assets.mark, and Writer copy is keyed per locale with no fallback", { timeout: 60_000 }, async () => {
    const { root } = await consumer();
    expect(designerShareMark(root)).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(Buffer.from(designerShareMark(root)!.split(",")[1]!, "base64").toString("utf8")).toMatch(/^<svg/);
    draftFrench(root, ["site.pages"]);
    const writer = await writerLocaleCopy(root);
    expect(writer.source).toBe("en");
    expect(writer.locales).toEqual(["en", "fr"]);
    expect(writer.copy("en")["site.name"]).toBe("Example Studio");
    expect(writer.copy("fr")["site.name"]).toBe("FR Example Studio");
    expect(Object.hasOwn(writer.copy("fr"), "site.pages")).toBe(false);
  });

  it("installs forms, share images, llms.txt, the feed, JSON-LD and the French routes from the pinned records", { timeout: 120_000 }, async () => {
    const { root, site, app } = await consumer();
    const { candidate } = await initPublicationOutputs(root, OUTPUTS);
    pin(root, "publisher", "publication.example-site", candidate);

    // Until the Writer drafts French, the French install is blocked and nothing is written.
    const undrafted = await install(root, app);
    expect(blocking(undrafted).map(finding => finding.code)).toContain("missing-copy-key");
    expect(blocking(undrafted).some(finding => /\bfr\b/.test(finding.detail))).toBe(true);
    expect(existsSync(join(app, "api", "forms", "contact", "route.ts"))).toBe(false);

    draftFrench(root);
    const result = await install(root, app);
    expect(blocking(result)).toEqual([]);
    for (const file of ["api/forms/contact/route.ts", "opengraph-image.tsx", "twitter-image.tsx", "fr/opengraph-image.tsx", "fr/twitter-image.tsx", "llms.txt/route.ts", "feed.xml/route.ts", "fr/feed.xml/route.ts", "(en)/layout.tsx", "(en)/page.tsx", "(en)/about/page.tsx", "fr/layout.tsx", "fr/page.tsx", "fr/about/page.tsx", "fr/not-found.tsx", "global-error.tsx"]) {
      expect(readFileSync(join(app, file), "utf8").split("\n", 1)[0], file).toBe(NEXT_ROUTE_MARKER);
    }
    const form = readFileSync(join(app, "api", "forms", "contact", "route.ts"), "utf8");
    expect(form).toContain("createFormEndpoint");
    expect(form).toContain('"targetEnv":"CONTACT_FORM_TARGET"');
    expect(readFileSync(join(app, "fr", "opengraph-image.tsx"), "utf8")).toContain('"headline":"FR Example Studio"');
    expect(readFileSync(join(app, "llms.txt", "route.ts"), "utf8")).toContain("https://example.com/about");
    expect(readFileSync(join(app, "fr", "feed.xml", "route.ts"), "utf8")).toContain("https://example.com/fr/about");
    // No app-root layout: each locale's document is its own root layout, with its own JSON-LD.
    expect(existsSync(join(app, "layout.tsx"))).toBe(false);
    expect(readFileSync(join(app, "(en)", "layout.tsx"), "utf8")).toContain("application/ld+json");
    expect(readFileSync(join(app, "fr", "layout.tsx"), "utf8")).toContain("FR Example Studio");
    expect(readFileSync(join(app, "(en)", "layout.tsx"), "utf8")).not.toContain("FR Example Studio");
    expect(readFileSync(join(app, "fr", "page.tsx"), "utf8")).toContain('locale: "fr"');
    expect(readFileSync(join(site, NEXT_BIND_ASSEMBLY), "utf8")).toContain("const localized");
    const report = JSON.parse(readFileSync(join(root, ".out", "install-report.json"), "utf8"));
    expect(report.outputs.map((row: { route: string }) => row.route)).toEqual(expect.arrayContaining(["/api/forms/contact", "/opengraph-image", "/fr/feed.xml", "/llms.txt"]));
    expect(report.pages.map((row: { route: string }) => row.route)).toEqual(expect.arrayContaining(["/", "/about", "/fr", "/fr/about"]));

    // The French route's document is French: its language, its title and its body, never the default's.
    const french = await render(site, "fr/page", "fr/layout");
    expect(french.html).toContain("FR Pages assembled from records");
    expect(french.html).toContain('type="application/ld+json"');
    expect(french.html).toMatch(/^<html lang="fr"/);
    expect(french.title).toMatch(/^FR /);
    const english = await render(site, "(en)/page", "(en)/layout");
    expect(english.html).toContain("Pages assembled from records");
    expect(english.html).not.toContain("FR Pages assembled from records");
    expect(english.html).toMatch(/^<html lang="en"/);
    expect(english.title).toBeDefined();
    expect(english.title).not.toMatch(/^FR /);
    // The French not-found state mounts the French frame copy in the French document.
    const missing = await render(site, "fr/not-found", "fr/layout");
    expect(missing.html).toMatch(/^<html lang="fr"/);
    expect(missing.html).toContain("FR About Example Studio");
    const englishMissing = await render(site, "(en)/not-found", "(en)/layout");
    expect(englishMissing.html).toContain("About Example Studio");
    expect(englishMissing.html).not.toContain("FR About Example Studio");

    // Reinstalling is stable, and a dropped output's marked files are removed.
    expect((await install(root, app, true)).files.filter(file => file.state === "drift")).toEqual([]);
    const dir = slotDir(root, "publisher", "publication.example-site");
    const value = JSON.parse(readFileSync(join(dir, "candidates", candidate), "utf8"));
    delete value.outputs.share;
    writeFileSync(join(dir, "candidates", "publication-v4.json"), `${JSON.stringify(value, null, 2)}\n`);
    pin(root, "publisher", "publication.example-site", "publication-v4.json");
    const dropped = await install(root, app);
    expect(blocking(dropped)).toEqual([]);
    expect(dropped.files.filter(file => file.state === "removed").map(file => file.file).sort()).toEqual(["fr/opengraph-image.tsx", "fr/twitter-image.tsx", "opengraph-image.tsx", "twitter-image.tsx"]);
    expect(existsSync(join(app, "opengraph-image.tsx"))).toBe(false);
  });
  it("a French document title the Writer has not drafted blocks the install; the default title never stands in (B3)", { timeout: 120_000 }, async () => {
    const { root, app } = await consumer();
    const { candidate } = await initPublicationOutputs(root, OUTPUTS);
    pin(root, "publisher", "publication.example-site", candidate);
    // The home page's content-map title key (page.home's pinned record).
    const title = "site.studio.name";
    draftFrench(root, [title]);
    const result = await install(root, app);
    expect(blocking(result)).toEqual(expect.arrayContaining([expect.objectContaining({ code: "missing-copy-key", detail: expect.stringMatching(new RegExp(`^fr: example-site: the document title ${title.replace(/\./g, "\\.")} has no fr text`)) })]));
    expect(existsSync(join(app, "fr", "layout.tsx"))).toBe(false);
  });
  it("refuses an output route that would share its path with a page", { timeout: 120_000 }, async () => {
    const { root, app } = await consumer();
    const about = slotDir(root, "publisher", "page.about");
    const page = JSON.parse(readFileSync(join(about, "candidates", "page-v1.json"), "utf8"));
    writeFileSync(join(about, "candidates", "page-v2.json"), `${JSON.stringify({ ...page, path: "/feed.xml" }, null, 2)}\n`);
    pin(root, "publisher", "page.about", "page-v2.json");
    const { candidate } = await initPublicationOutputs(root, { publication: "example-site", meta: ["rss"], origin: "https://example.com", identity: { name: "site.name", summary: "home.hero.body" } });
    pin(root, "publisher", "publication.example-site", candidate);
    const result = await install(root, app);
    expect(blocking(result)).toEqual(expect.arrayContaining([expect.objectContaining({ code: "site-contract", detail: expect.stringMatching(/\/feed\.xml: a publication output collides with a page served at the same path/) })]));
    expect(existsSync(join(app, "feed.xml", "route.ts"))).toBe(false);

    // With locales the default's page sits in its route group, `(en)/feed.xml/page.tsx`: still served at /feed.xml, still refused.
    const localized = await initPublicationOutputs(root, { publication: "example-site", meta: ["rss"], locales: ["en", "fr"], origin: "https://example.com", identity: { name: "site.name", summary: "home.hero.body" } });
    pin(root, "publisher", "publication.example-site", localized.candidate);
    draftFrench(root);
    const grouped = await install(root, app);
    expect(blocking(grouped)).toEqual(expect.arrayContaining([expect.objectContaining({ code: "site-contract", detail: expect.stringMatching(/^\/feed\.xml: a publication output collides with a page served at the same path/) })]));
    expect(existsSync(join(app, "feed.xml", "route.ts"))).toBe(false);
  });
});
