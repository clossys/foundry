/**
 * foundry-build-0048 U18: `clossys init --publication` records a publication's outputs on a new
 * submitted candidate, and `clossys publish --install --next --bind` installs them from the pinned
 * records: a form endpoint, share images drawn from the Designer's pinned mark, llms.txt, a feed,
 * JSON-LD in the layout, and every page again per non-default locale, bound to that locale's
 * pinned Writer copy. A locale the Writer has not drafted blocks the install; nothing falls back.
 * Synthetic: a tmp copy of test-fixtures/consumer-legacy-tree recut to clossys.slot/2 (as init-outputs-slot2.e2e.test.ts),
 * holding the Designer, Writer and Publisher records of src/publish/__fixtures__/install-consumer; init runs the real write guard.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
import { recutCandidateBytes } from "../migrate/recut.js";
import { STEPS } from "../pipeline/steps/index.js";
import { writeTargetPin } from "../records/pin-map.js";
import { cliActor } from "../records/pin.js";
import { readLedger } from "../records/slots.js";
import { runCli } from "../cli/main.js";
import { designerShareMark, writerLocaleCopy } from "./install-outputs.js";
import { publishNext, type PublishNextResult } from "./install-next.js";
import { localItemRunner, NEXT_BIND_ASSEMBLY } from "./install-next-bind.js";

const AT = "2026-11-18T00:00:00Z";
const BY = "planner:foundry-build-0048";
const INSTALL = join(import.meta.dirname, "__fixtures__", "install-consumer");
const LEGACY = join(import.meta.dirname, "..", "..", "test-fixtures", "consumer-legacy-tree", "clossys");
const template = join(import.meta.dirname, "..", "..", "..", "publisher", "templates", "site");
const SKILL = STEPS.find(step => step.id === "publisher.candidates")!.command.skill!;
const PUBLICATION = "publication.example-site";
const temps: string[] = [];
const MARK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-label="Example"><circle cx="12" cy="12" r="10"/></svg>';
afterAll(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });

const slotDir = (root: string, agent: string, id: string) => join(root, "clossys", "agents", agent, id);
const file = (root: string, name: string, value: unknown) => { const path = join(root, name); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); return path; };
async function run(root: string, ...args: string[]): Promise<void> {
  const result = await runCli([...args, "--root", root]);
  expect(result.exitCode, `clossys ${args.join(" ")}: ${result.message}`).toBe(0);
}
/** A candidate seated in a slot/2 slot: its bytes under a candidate/1 header (re-addressed when it carries one). */
function seat(root: string, agent: string, id: string, name: string, text: string): void {
  mkdirSync(join(slotDir(root, agent, id), "candidates"), { recursive: true });
  writeFileSync(join(slotDir(root, agent, id), "candidates", name), recutCandidateBytes(name, text, { agent, slotId: id, at: AT, version: "0.0.0", sourceRef: `agents/${agent}/${id}/candidates/${name}` } as never));
}
/** A test-side pin of a candidate already in the slot, by the pin writer directly (fixture setup, not under test). */
function pin(root: string, agent: string, id: string, candidate: string, record?: string): void {
  writeTargetPin(root, { agent, slotId: id, candidate, ...(record ? { record } : {}), decidedBy: BY, basis: "planner", at: AT, createdBy: cliActor("clossys pin") } as never);
}
/** The next free candidate name of a record (`<record>-v<n+1>.<ext>`). */
function nextName(root: string, agent: string, id: string, record: string, ext: string): string {
  const dir = join(slotDir(root, agent, id), "candidates");
  const versions = (existsSync(dir) ? readdirSync(dir) : []).map(name => new RegExp(`^${record}-v(\\d+)\\.`).exec(name)?.[1]).filter(Boolean).map(Number);
  return `${record}-v${Math.max(0, ...versions) + 1}.${ext}`;
}
/** A Publisher record (page/1 or publication/1, which carry no candidate/1 header) written as the slot's next candidate and pinned. */
function repin(root: string, id: string, record: string, value: unknown): string {
  const name = nextName(root, "publisher", id, record, "json");
  mkdirSync(join(slotDir(root, "publisher", id), "candidates"), { recursive: true });
  writeFileSync(join(slotDir(root, "publisher", id), "candidates", name), `${JSON.stringify(value, null, 2)}\n`);
  pin(root, "publisher", id, name);
  return name;
}
/** The pinned Writer strings text. */
function pinnedStrings(root: string): string {
  const map = JSON.parse(readFileSync(join(slotDir(root, "writer", "strings.site"), "pin.json"), "utf8")) as { records: { site: { candidate: string } } };
  return readFileSync(join(slotDir(root, "writer", "strings.site"), "candidates", map.records.site.candidate), "utf8");
}
/** The Writer's strings as the next candidate of record `site`, pinned. */
function writeStrings(root: string, text: string): void {
  const name = nextName(root, "writer", "strings.site", "site", "md");
  seat(root, "writer", "strings.site", name, text);
  pin(root, "writer", "strings.site", name, "site");
}

/**
 * A P2 run for the publication's next candidate (section 5b): brief, three diverging directions, render, then a critique
 * record named for it, so the guarded adapt submit meets R15.7.
 */
async function crafted(root: string, candidate: string): Promise<void> {
  const at = (name: string, value: unknown) => file(root, `${candidate}.${name}.json`, value);
  const craft = ["--model", "fixture", "--tier", "mid", "--skill", SKILL];
  await run(root, "next", `publisher/${PUBLICATION}`, "--stage", "brief", ...craft, "--file", at("brief", { goal: "fixture: the publication's routes and outputs" }));
  // Code chose the run's recipe at brief (its assembled recipe): every direction takes a distinct value on each of its axes.
  const briefed = readLedger(slotDir(root, "publisher", PUBLICATION))?.events.filter(event => event.op === "craft:brief").at(-1) as { assembled?: { recipe?: { axes?: string[] } } } | undefined;
  const axes = briefed?.assembled?.recipe?.axes ?? [];
  await run(root, "next", `publisher/${PUBLICATION}`, "--stage", "diverge", ...craft, "--file", at("diverge", ["flat", "nested", "hub"].map((shape, index) => ({ id: `d${index + 1}`, idea: `a ${shape} route tree`, axes: { shape, ...Object.fromEntries(axes.map(axis => [axis, `${axis}-${shape}`])) } }))));
  await run(root, "next", `publisher/${PUBLICATION}`, "--stage", "render", ...craft);
  writeFileSync(join(root, "render.png"), "fixture render");
  const manifest = [{ role: "taste", ref: "packages/publisher/standards/publication/taste.md" }, { role: "contract", ref: `clossys/agents/publisher/${PUBLICATION}/slot.json#contract` }, { role: "render", ref: "render.png" }];
  await run(root, "critique", `publisher/${PUBLICATION}`, "--record", at("critique", { schema: "clossys.critique/1", slot: PUBLICATION, candidate, standard: "publication", scores: { findability: 4 }, packet: { manifest } }), "--model", "fixture-critic", "--tier", "mid", "--at", AT);
}

/**
 * A recut slot/2 consumer whose publication `example-site` was created (P1 create verdict), submitted and pinned through
 * the gate. The install-consumer records are seated through the verbs: `ia` places each slot with its contract and
 * standard, and the pin writer pins the Designer frame, hero and mark, the Writer strings and the two pages.
 */
async function consumer(): Promise<{ root: string; site: string; app: string }> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "producer-outputs-")));
  temps.push(root);
  cpSync(LEGACY, join(root, "clossys"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  const install = (agent: string, id: string, name: string) => readFileSync(join(INSTALL, "clossys", "agents", agent, id, "candidates", name), "utf8");
  await run(root, "migrate", "recut", "--apply", "--at", AT);
  // The Designer: the fixture frame (a consumer frame), the hero and the mark share images draw.
  await run(root, "ia", "designer/frames.plain", "--contract", file(root, "frame.json", { requirements: [{ check: "compose.layers" }] }), "--under", "frames.frames/frames-shells", "--kind", "element", "--at", AT);
  seat(root, "designer", "frames.plain", "plain-frame-v1.json", install("designer", "frames.plain", "plain-frame-v3.json"));
  pin(root, "designer", "frames.plain", "plain-frame-v1.json");
  seat(root, "designer", "sections.hero", "simple-hero-v1.json", install("designer", "sections.hero", "simple-hero-v3.json"));
  pin(root, "designer", "sections.hero", "simple-hero-v1.json");
  const tokens = { assets: { mark: { positive: { $type: "svg", $value: MARK } } } };
  const item = {
    name: "mark", type: "registry:item",
    files: [{ path: "clossys/assets.mark.json", type: "registry:file", content: JSON.stringify(tokens, null, 2) }],
    meta: { slot: "assets.mark", source: { kind: "original", ref: ["test fixture"], license: "MIT" }, element: {
      id: "mark", package: "designer", layer: "assets", slot: "assets.mark", kind: "registry:item", license: "MIT",
      creator: { agent: "designer", model: "fixture", by: "U18" }, reason: "A fixture mark for share images.", createdAt: AT,
      checks: [{ check: "ref-verbatim", status: "exempt", note: "non-code asset payload" }], deps: { npm: {}, registry: [] }, reads: { copyKeys: [], themeVars: [] },
    } },
  };
  seat(root, "designer", "assets.mark", "mark-v1.json", JSON.stringify(item, null, 2));
  pin(root, "designer", "assets.mark", "mark-v1.json");
  // The Writer strings, then the two pages.
  await run(root, "ia", "writer/strings.site", "--contract", file(root, "strings.json", { requirements: [{ check: "copy.entries" }] }), "--under", "copy.page-metadata/site", "--kind", "strings", "--at", AT);
  writeStrings(root, install("writer", "strings.site", "site-v2.md"));
  for (const [page, route] of [["page.home", "/"], ["page.about", "/about"]] as const) {
    // page.about reads the strings, so the two page contracts do not overlap.
    await run(root, "ia", `publisher/${page}`, "--contract", file(root, `${page}.json`, { kind: "page", route, frame: "required", sections: "ordered", requirements: [{ check: "page.assembled" }] }), "--standard", "page", "--under", "example-site/example-site-pages", "--kind", "page", ...(page === "page.about" ? ["--inputs", "strings.site"] : []), "--at", AT);
    repin(root, page, "page", JSON.parse(install("publisher", page, "page-v1.json")));
  }
  // The publication comes in through the verbs: a P1 create verdict, a crafted create submit, a gated pin.
  await run(root, "ia", `publisher/${PUBLICATION}`, "--contract", file(root, "publication.json", { kind: "publication", fixture: { route: { path: "/" } }, requirements: [{ check: "publication.routes" }] }), "--standard", "publication", "--under", "example-site/example-site-pages", "--kind", "publication", "--inputs", "page.home,page.about,strings.site", "--uses", "page.home,page.about", "--at", AT);
  await run(root, "verdict", `publisher/${PUBLICATION}`, "--record", file(root, "verdict.json", { schema: "clossys.verdict/1", slot: PUBLICATION, create: true, reason: "fixture: outputs are recorded on a new candidate", gaps: [{ id: "findability" }] }), "--model", "fixture", "--tier", "mid", "--by", "agent:publisher.verdict", "--at", AT);
  await crafted(root, "example-site-v1.json");
  const publication = JSON.parse(install("publisher", PUBLICATION, "publication-v2.json")) as { routePack: Record<string, unknown> };
  await run(root, "next", `publisher/${PUBLICATION}`, "--submit", file(root, "publication-seed.json", { ...publication, routePack: { ...publication.routePack, homeRouteId: "home" } }), "--model", "fixture", "--tier", "mid", "--basis", "agent", "--skill", SKILL, "--rung", "create", "--reason", "fixture: no seed publication");
  await run(root, "pin", `publisher/${PUBLICATION}`, "example-site-v1.json", "--by", BY, "--at", AT);
  cpSync(join(INSTALL, "component-selection.ts"), join(root, "component-selection.ts"));
  const site = join(root, "apps", "site");
  cpSync(template, site, { recursive: true, filter: source => !/[\\/](?:node_modules|\.next)(?:[\\/]|$)/.test(source.slice(template.length)) });
  return { root, site, app: join(site, "app") };
}
const install = (root: string, app: string, check = false): Promise<PublishNextResult> => publishNext({
  root, publication: "example-site", app, check, out: join(root, ".out"),
  bind: { selection: { module: join(root, "component-selection.ts") }, runner: localItemRunner },
});
const blocking = (result: PublishNextResult) => result.findings.filter(finding => finding.severity !== "info");
/** The Writer's strings again with a French section: every key the pages and outputs draw (from the English text). */
function draftFrench(root: string, omit: readonly string[] = []): void {
  const en = pinnedStrings(root).split(/\n## fr\n/)[0]!;
  const [, head, body] = /^(---\n[\s\S]*?\n---\n)([\s\S]*)$/.exec(en)!;
  const blocks = body!.split(/\n(?=### )/).slice(1).filter(block => !omit.some(key => block.startsWith(`### ${key}\n`)));
  const fr = blocks.map(block => block.replace(/\n([^\n<][^\n]*)\s*$/, "\nFR $1")).join("\n\n");
  writeStrings(root, `${head!.replace('locales: ["en"]', 'locales: ["en","fr"]')}${body!.trimEnd()}\n\n## fr\n\n${fr.trimEnd()}\n`);
}
/**
 * init through the candidates verb, under the real write guard: each init's candidate is the next P2 run's (crafted first
 * unless a run is already open). init-outputs-slot2.e2e.test.ts proves a real guard finding refuses the write.
 */
async function initPublicationOutputs(root: string, options: InitOutputsOptions) {
  const events = readLedger(slotDir(root, "publisher", PUBLICATION))?.events ?? [];
  const open = events.findLastIndex(event => event.op === "craft:critique") > events.findLastIndex(event => event.op === "submit");
  if (!open) await crafted(root, nextName(root, "publisher", PUBLICATION, "example-site", "json"));
  return initThroughSubmit(root, options, { model: "fixture", tier: "mid", basis: "agent", skill: SKILL });
}
const OUTPUTS = { publication: "example-site", forms: ["contact"] as const, share: true, meta: ["json-ld", "llms", "rss"] as const, locales: ["en", "fr"], origin: "https://example.com", identity: { name: "site.name", summary: "home.hero.body" } };

/** A route rendered inside its own root layout, with the layout's metadata export (what Next sets as <title>). */
async function render(site: string, route: string, layout: string): Promise<{ html: string; title?: string }> {
  return renderEntry(site, route, `import { createElement } from "react"; import Layout, { metadata } from "./app/${layout}"; import Page from "./app/${route}"; export { metadata }; export default function Root() { return createElement(Layout, null, createElement(Page)); }`);
}
/** The Designer shell context the frames read (`useShellCopy`), by file: the same module the Designer frames entry imports. */
const SHELL_CONTEXT = join(import.meta.dirname, "..", "..", "..", "designer", "dist", "components", "Banner.copy-context.js");
/**
 * Designer shell strings as a frame reads them (`useShellCopy`), inside a locale's root layout and the Publisher host a page
 * module of that locale imports: the skip link text and the banner-dismiss aria-label.
 */
async function renderShell(site: string, layout: string, page: string): Promise<string> {
  const host = /from "(\.\.\/publisher-host[^"]*)"/.exec(readFileSync(join(site, "clossys", "pages", `${page}.tsx`), "utf8"))![1]!;
  return (await renderEntry(site, `shell-${page}`, [
    'import { createElement } from "react";',
    'import { SHELL_COPY_REFS } from "@clossys/designer/frames";',
    `import { useShellCopy } from ${JSON.stringify(SHELL_CONTEXT)};`,
    `import Layout from "./app/${layout}";`,
    `import { PageHost } from ${JSON.stringify(`./clossys/pages/${host}`)};`,
    'function Probe() { const copy = useShellCopy(); return createElement("a", { href: "#main", "aria-label": copy(SHELL_COPY_REFS.banner.dismiss) }, copy(SHELL_COPY_REFS.frame.skip)); }',
    "export default function Root() { return createElement(Layout, null, createElement(PageHost, null, createElement(Probe))); }",
  ].join("\n"))).html;
}
async function renderEntry(site: string, route: string, entry: string): Promise<{ html: string; title?: string }> {
  const here = createRequire(import.meta.url);
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
    expect(result.candidate).toBe("example-site-v2.json");
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
    expect(existsSync(join(slotDir(root, "publisher", "publication.example-site"), "candidates", "example-site-v3.json"))).toBe(false);
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
    repin(root, PUBLICATION, "example-site", value);
    const dropped = await install(root, app);
    expect(blocking(dropped)).toEqual([]);
    expect(dropped.files.filter(file => file.state === "removed").map(file => file.file).sort()).toEqual(["fr/opengraph-image.tsx", "fr/twitter-image.tsx", "opengraph-image.tsx", "twitter-image.tsx"]);
    expect(existsSync(join(app, "opengraph-image.tsx"))).toBe(false);
  });
  it("French routes mount the French host: Designer shell strings come from the French Writer copy, and a missing French shell key blocks (B1)", { timeout: 120_000 }, async () => {
    const { root, site, app } = await consumer();
    const { candidate } = await initPublicationOutputs(root, OUTPUTS);
    pin(root, "publisher", "publication.example-site", candidate);
    // The Writer pins two Designer shell strings (the skip link and the banner-dismiss label) in the default locale.
    const shell = { "st.z4jcxtzczb": "Skip to content", "st.ev3xsrhrwe": "Dismiss notice" };
    writeStrings(root, `${pinnedStrings(root).trimEnd()}\n${Object.entries(shell).map(([key, text]) => `\n### ${key}\n<!-- {"id":"${key}","bindings":[]} -->\n${text}\n`).join("")}`);

    // A shell key French lacks blocks the install; the English text never stands in.
    draftFrench(root, ["st.ev3xsrhrwe"]);
    const undrafted = await install(root, app);
    expect(blocking(undrafted)).toEqual([expect.objectContaining({ code: "missing-copy-key", detail: "fr: example-site: the shell string st.ev3xsrhrwe has no fr text; the Writer drafts it before fr installs" })]);
    expect(existsSync(join(site, "clossys", "publisher-host@fr.tsx"))).toBe(false);

    draftFrench(root);
    expect(blocking(await install(root, app))).toEqual([]);
    // Each locale's page modules import that locale's host; the default locale keeps the substrate host.
    for (const page of ["home", "about"]) {
      expect(readFileSync(join(site, "clossys", "pages", `${page}@fr.tsx`), "utf8")).toContain('import { PageHost } from "../publisher-host@fr";');
      expect(readFileSync(join(site, "clossys", "pages", `${page}.tsx`), "utf8")).toContain('import { PageHost } from "../publisher-host";');
    }
    const frenchHost = readFileSync(join(site, "clossys", "publisher-host@fr.tsx"), "utf8");
    expect(frenchHost.split("\n", 1)[0]).toBe(NEXT_ROUTE_MARKER);
    expect(frenchHost).toContain('"st.z4jcxtzczb": "FR Skip to content"');
    expect(frenchHost).not.toContain('"Skip to content"');

    // Rendered: the French document's shell strings, text and aria-label, are French; the English document's are English.
    const french = await renderShell(site, "fr/layout", "home@fr");
    expect(french).toMatch(/^<html lang="fr"/);
    expect(french).toContain('aria-label="FR Dismiss notice"');
    expect(french).toContain(">FR Skip to content</a>");
    expect(french).not.toMatch(/"Dismiss notice"|>Skip to content</);
    const english = await renderShell(site, "(en)/layout", "home");
    expect(english).toMatch(/^<html lang="en"/);
    expect(english).toContain('aria-label="Dismiss notice"');
    expect(english).toContain(">Skip to content</a>");
    expect(english).not.toContain("FR ");

    // A locale dropped from the publication takes its host with it.
    const dir = slotDir(root, "publisher", "publication.example-site");
    const value = JSON.parse(readFileSync(join(dir, "candidates", candidate), "utf8"));
    delete value.outputs.locales;
    repin(root, PUBLICATION, "example-site", value);
    const single = await install(root, app);
    expect(blocking(single)).toEqual([]);
    expect(single.files.filter(file => file.state === "removed").map(file => file.file)).toContain("clossys/publisher-host@fr.tsx");
    expect(existsSync(join(site, "clossys", "publisher-host@fr.tsx"))).toBe(false);
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
    repin(root, "page.about", "page", { ...page, path: "/feed.xml" });
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
