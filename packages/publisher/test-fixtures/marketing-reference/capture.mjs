#!/usr/bin/env node
/** Native fixture rehearsal. Images require an explicitly supplied capture driver. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { JSDOM, VirtualConsole } from "jsdom";

export const dimensions = Object.freeze({ themes: ["light", "dark", "inverse"], widths: [1440, 390], directions: ["ltr", "rtl"], reducedMotion: [false, true] });

/** Keep each dimension explicit so capture drivers never infer missing cases. */
export function captureManifest(routes, gaps = []) {
  const seen = new Set(), filenames = new Set();
  for (const route of routes) {
    if (!route || typeof route.path !== "string" || !/^\/(?:[a-z0-9-]+\/?)*$/.test(route.path) || seen.has(route.path)) throw new TypeError("Routes require unique local paths");
    if (typeof route.family !== "string" || !route.family.trim()) throw new TypeError("Routes require an actual section family");
    const filename = route.path === "/" ? "home" : route.path.slice(1).replaceAll("/", "-");
    if (filenames.has(filename)) throw new TypeError("Routes require distinct capture filenames");
    filenames.add(filename); seen.add(route.path);
  }
  return {
    fixture: "Example Co.",
    captureStatus: "not-run",
    dimensions,
    routes: routes.map(({ path, family }) => ({ path, family })),
    gaps,
    cases: routes.flatMap(route => dimensions.themes.flatMap(theme => dimensions.widths.flatMap(width => dimensions.directions.flatMap(dir => dimensions.reducedMotion.map(reducedMotion => ({
      id: `${route.path === "/" ? "home" : route.path.slice(1).replaceAll("/", "-")}-${theme}-${width}-${dir}-${reducedMotion ? "reduce" : "motion"}`,
      route: route.path, family: route.family, theme, width, height: 900, dir, reducedMotion,
    })))))),
  };
}

const words = value => String(value).normalize("NFKC").match(/[\p{L}]+/gu)?.map(word => word.toLocaleLowerCase("en")) ?? [];
/** Writer values come from the fixture's real resolver report, never DOM markers. */
export function probeHtml(html, writerValues) {
  if (!Array.isArray(writerValues) || !writerValues.every(value => typeof value === "string")) throw new TypeError("Probes require resolved Writer values");
  const dom = new JSDOM(html, { virtualConsole: new VirtualConsole() }), { document, NodeFilter } = dom.window;
  const findings = [];
  const headings = document.querySelectorAll("h1").length;
  if (headings !== 1) findings.push({ code: "heading-count", actual: headings });
  for (const backdrop of document.querySelectorAll("[data-backdrop], [data-scene-backdrop], [data-hero-backdrop], [data-runtime-backdrop]")) {
    if (backdrop.getAttribute("aria-hidden") !== "true") findings.push({ code: "backdrop-visible", tag: backdrop.tagName });
  }
  const vocabulary = writerValues.map(value => words(value).join(" "));
  function check(value, location) {
    const text = words(value).join(" ");
    if (text && !vocabulary.some(record => ` ${record} `.includes(` ${text} `))) findings.push({ code: "unresolved-copy", location, text: String(value).trim() });
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.parentElement?.closest("script, style, template")) check(node.textContent, "text");
  }
  for (const element of document.body.querySelectorAll("[aria-label], [alt], [placeholder], [title]")) {
    for (const attribute of ["aria-label", "alt", "placeholder", "title"]) if (element.hasAttribute(attribute)) check(element.getAttribute(attribute), attribute);
  }
  dom.window.close();
  return findings;
}

export async function rehearse({ fixture, out, driver, inputs }) {
  if (!fixture || !Array.isArray(fixture.routes) || fixture.routes.length === 0 || typeof fixture.render !== "function") throw new TypeError("Fixture must export routes and native render(case)");
  const manifest = captureManifest(fixture.routes, fixture.gaps ?? []);
  await mkdir(out, { recursive: true });
  const results = [];
  for (const item of manifest.cases) {
    const rendered = await fixture.render(item);
    if (!rendered || typeof rendered.html !== "string") throw new TypeError("Fixture must return native HTML and resolved Writer values");
    const findings = probeHtml(rendered.html, rendered.writerValues);
    await writeFile(join(out, item.id + ".html"), rendered.html);
    const result = { id: item.id, findings, capture: "not-run" };
    if (findings.length === 0 && driver) {
      const bytes = await driver.shoot({ html: rendered.html, width: item.width, height: item.height, reducedMotion: item.reducedMotion, dir: item.dir });
      if (!(bytes instanceof Uint8Array) || bytes.length < 12 || Buffer.from(bytes.subarray(0, 4)).toString() !== "RIFF" || Buffer.from(bytes.subarray(8, 12)).toString() !== "WEBP") throw new Error("Capture driver must return WebP bytes");
      await writeFile(join(out, item.id + ".webp"), bytes);
      result.capture = "captured";
      result.sha256 = createHash("sha256").update(bytes).digest("hex");
    }
    results.push(result);
  }
  const environment = driver && typeof driver.environment === "function" ? await driver.environment() : undefined;
  const report = { ...(inputs ? { inputs } : {}), ...(environment ? { environment } : {}), probeCoverage: "DOM text and accessible attributes; CSS-generated text is not covered", captureStatus: driver ? "executed" : "not-run", cases: results, gaps: manifest.gaps };
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  return { ok: results.every(result => result.findings.length === 0), manifest, report };
}

export async function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--fixture", "--out", "--driver"].includes(args[i]) || !args[i + 1]) throw new TypeError("Usage: --fixture <module> --out <directory> [--driver <module>]");
    options[args[i].slice(2)] = args[i + 1];
  }
  if (!options.fixture || !options.out) throw new TypeError("Usage: --fixture <module> --out <directory> [--driver <module>]");
  const fixture = await import(pathToFileURL(resolve(options.fixture)).href);
  const driver = options.driver ? await import(pathToFileURL(resolve(options.driver)).href) : undefined;
  if (driver && typeof driver.shoot !== "function") throw new TypeError("Capture driver must export shoot");
  const inputs = { fixtureSha256: createHash("sha256").update(await readFile(resolve(options.fixture))).digest("hex"), ...(options.driver ? { driverSha256: createHash("sha256").update(await readFile(resolve(options.driver))).digest("hex") } : {}) };
  const result = await rehearse({ fixture, out: resolve(options.out), driver, inputs });
  console.log(JSON.stringify({ ok: result.ok, routes: result.manifest.routes.length, cases: result.report.cases.length, captureStatus: result.report.captureStatus, gaps: result.report.gaps }));
  return result.ok ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
