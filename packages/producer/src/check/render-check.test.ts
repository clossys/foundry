/**
 * CP1-RENDERCHECK: `clossys check --render` captures and audits rendered pages, fails closed, and files its findings
 * as requests. No browser runs here: the runtime below loads saved, already-measured captures into jsdom and
 * evaluates the same expressions a browser would, except the measuring step (a saved capture carries the browser's
 * marks already).
 */
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runRequestCli } from "../cli/request.js";
import { runRenderCheckCli } from "../cli/render-check.js";
import { auditRender, MEASURE_EXPRESSION, type RenderFinding } from "./render-audit.js";
import { AUDIT_OPTIONS, renderVerdict, runRenderCheck, type CaptureRuntime, type RenderRecord } from "./render-check.js";

vi.setConfig({ testTimeout: 60_000 });

const PARITY = fileURLToPath(new URL("./__fixtures__/render-parity/", import.meta.url));
const CONSUMER = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const CASES = ["clean", "icon-name", "overflow"] as const;
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const temp = (prefix: string) => { const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix))); dirs.push(dir); return dir; };

const capture = (name: string) => readFileSync(join(PARITY, name, "capture.html"), "utf8");
const recorded = (name: string) => (JSON.parse(readFileSync(join(PARITY, name, "recorded.json"), "utf8")) as { findings: Pick<RenderFinding, "rule" | "slot" | "agent" | "selector">[] }).findings;
const audit = (html: string) => auditRender(new JSDOM(html).window.document, AUDIT_OPTIONS);
const brief = (findings: readonly RenderFinding[]) => findings.map(({ rule, slot, agent, selector }) => ({ rule, slot, agent, selector }));

/** A browser stand-in over saved captures: fetches the served page and evaluates expressions in jsdom. */
function savedHtmlRuntime(options: { failGoto?: boolean; failLaunch?: boolean } = {}): CaptureRuntime & { pages: string[] } {
  const pages: string[] = [];
  return {
    pages,
    chromium: {
      launch: async () => {
        if (options.failLaunch) throw new Error("Executable doesn't exist at /nowhere/chromium");
        return {
          close: async () => {},
          newContext: async () => {
            let dom: JSDOM | undefined;
            return {
              close: async () => { dom?.window.close(); },
              newPage: async () => ({
                goto: async (url: string) => {
                  if (options.failGoto) throw new Error("net::ERR_CONNECTION_REFUSED");
                  const response = await fetch(url);
                  if (!response.ok) throw new Error(`HTTP ${response.status}`);
                  pages.push(new URL(url).pathname);
                  dom = new JSDOM(await response.text(), { runScripts: "outside-only" });
                  return response;
                },
                evaluate: async <T,>(expression: string): Promise<T> => (expression === MEASURE_EXPRESSION ? 0 : dom!.window.eval(expression)) as T,
              }),
            };
          },
        };
      },
    },
  };
}

/** A built static site holding the named captures, with its routes file. */
function site(names: readonly string[], routes: unknown[] = names.map(name => ({ path: `/${name}`, file: `${name}.html` }))): string {
  const dir = temp("render-site-");
  mkdirSync(join(dir, "dist"));
  for (const name of names) writeFileSync(join(dir, "dist", `${name}.html`), capture(name));
  const file = join(dir, "routes.json");
  writeFileSync(file, JSON.stringify({ schema: "clossys.render-routes/1", site: "dist", viewports: [{ width: 1280, height: 800 }], routes }));
  return file;
}

describe("clossys check --render", () => {
  it("render check fails when zero routes are captured", async () => {
    const empty = await runRenderCheck({ routes: site([], []), runtime: savedHtmlRuntime() });
    expect([empty.verdict, empty.reason, empty.ran.commands]).toEqual(["FAIL", "no-routes", 0]);
    expect(empty.line).toBe("RENDER: FAIL 0/0 capture(s) 0 finding(s)");

    const unreachable = await runRenderCheck({ routes: site(["clean"]), runtime: savedHtmlRuntime({ failGoto: true }) });
    expect([unreachable.verdict, unreachable.reason, unreachable.ran.commands]).toEqual(["FAIL", "no-routes", 0]);
    expect(unreachable.routes.map(route => route.captured)).toEqual([false]);

    const noBrowser = await runRenderCheck({ routes: site(["clean"]), runtime: savedHtmlRuntime({ failLaunch: true }) });
    expect([noBrowser.verdict, noBrowser.reason]).toEqual(["FAIL", "no-browser"]);
    expect(noBrowser.ran.missing).toHaveLength(1);

    const routes = site(["clean"]);
    rmSync(join(routes, "..", "dist"), { recursive: true });
    const noBuild = await runRenderCheck({ routes, runtime: savedHtmlRuntime() });
    expect([noBuild.verdict, noBuild.reason]).toEqual(["FAIL", "no-build"]);
    const noPreview = await runRenderCheck({ root: temp("render-root-"), runtime: savedHtmlRuntime() });
    expect([noPreview.verdict, noPreview.reason]).toEqual(["FAIL", "no-build"]);

    // The verdict alone: nothing captured is never a pass, whatever the findings.
    expect(renderVerdict([], []).verdict).toBe("FAIL");
    expect(renderVerdict([{ path: "/", url: "x", viewport: "1x1", captured: false, findings: 0, error: "e" }], []).verdict).toBe("FAIL");
    // An uncaptured page (no browser marks) is a finding, not a clean page.
    expect(audit("<!doctype html><html><body><p>hello</p></body></html>").map(item => item.rule)).toEqual(["RENDER_NOT_CAPTURED"]);
  });

  it("render check flags an empty icon with its slot", () => {
    const icon = audit(capture("icon-name")).find(item => item.rule === "RENDER_EMPTY_ICON");
    expect(icon).toMatchObject({ slot: "designer/sections.hero", agent: "designer", selector: '[data-slot="designer/sections.hero"] > button > svg' });
    // A shadcn part's data-slot is not a slot ref; content under none is attributed to no slot.
    const loose = audit('<html data-render-viewport="800 600"><body><div data-slot="card"><svg viewBox="0 0 1 1"></svg></div></body></html>');
    expect(loose.find(item => item.rule === "RENDER_EMPTY_ICON")).toMatchObject({ slot: null, agent: "publisher" });
    expect(loose.map(item => item.rule)).toContain("RENDER_SLOT_UNATTRIBUTED");
  });

  it("render check flags a missing accessible name", () => {
    const named = audit(capture("icon-name")).filter(item => item.rule === "RENDER_NO_NAME");
    expect(brief(named)).toEqual([{ rule: "RENDER_NO_NAME", slot: "designer/sections.hero", agent: "designer", selector: '[data-slot="designer/sections.hero"] > button' }]);
    const page = (inner: string) => audit(`<html data-render-viewport="800 600"><body><div data-slot="designer/sections.form" data-copy="form.x">${inner}</div></body></html>`).filter(item => item.rule === "RENDER_NO_NAME").length;
    expect(page('<input id="q"><label for="q">Search</label>')).toBe(0);
    expect(page('<input id="q">')).toBe(1);
    expect(page('<a href="/"><img src="a.png" alt="Home"></a>')).toBe(0);
    expect(page('<a href="/"><img src="a.png" alt=""></a>')).toBe(1);
    expect(page('<button aria-labelledby="l"></button><span id="l">Close</span>')).toBe(0);
    expect(page('<img src="a.png">')).toBe(1);
  });

  it("render check flags glyphs and copy keys for Writer", () => {
    const rules = audit('<html data-render-viewport="800 600"><body><div data-slot="designer/sections.hero"><div data-slot="writer/sections.hero.copy"><p data-copy="hero.title">hero.title</p><p>Loose text</p><p data-copy="hero.lede">Broken � glyph</p></div></div></body></html>');
    expect(brief(rules)).toEqual([
      { rule: "RENDER_COPY_UNRESOLVED", slot: "writer/sections.hero.copy", agent: "writer", selector: '[data-slot="writer/sections.hero.copy"] > p:nth-of-type(1)' },
      { rule: "RENDER_COPY_UNKEYED", slot: "writer/sections.hero.copy", agent: "writer", selector: '[data-slot="writer/sections.hero.copy"] > p:nth-of-type(2)' },
      { rule: "RENDER_GLYPH", slot: "writer/sections.hero.copy", agent: "writer", selector: '[data-slot="writer/sections.hero.copy"] > p:nth-of-type(3)' },
    ]);
  });

  it("a finding files as a request to its owning agent", async () => {
    const root = temp("render-request-");
    cpSync(CONSUMER, root, { recursive: true });
    const routes = site(["icon-name"]);
    const result = await runRenderCheckCli(["check", "--render", "--routes", routes, "--file", "--root", root], root, { runtime: savedHtmlRuntime(), stamp: "test" });
    const rec = result.output as RenderRecord;
    expect(result.exitCode).toBe(1);
    expect(rec.verdict).toBe("FAIL");
    expect(rec.requests).toEqual([expect.stringMatching(/^designer\/sections\.hero -> designer: request: raised /)]);
    const listed = await runRequestCli(["--list", "--open", "--kind", "fix", "--json", "--root", root], root);
    const entries = (listed.output as { requests: { kind: string; target: string; assignee: string; check?: string; findings?: string[] }[] }).requests;
    const fix = entries.filter(entry => entry.target === "designer/sections.hero");
    expect(fix).toHaveLength(1);
    expect(fix[0]).toMatchObject({ kind: "fix", assignee: "designer", check: "check.render" });
    expect(fix[0]!.findings).toHaveLength(2);
    // The capture is saved beside the record, measured, and re-audits to the same findings.
    expect(readdirSync(join(root, "clossys", ".state", "render", "test"))).toEqual(["icon-name@1280x800.html"]);
    expect(brief(audit(readFileSync(join(root, "clossys", ".state", "render", "test", "icon-name@1280x800.html"), "utf8")))).toEqual(brief(rec.findings));
  });

  it("real Chromium captures re-audit to their cause, not their container", () => {
    // Saved by a live run of this verb (Chromium 1243): the empty svg laid out at 0x0, and the section spilled only
    // because its row ran past the viewport.
    const live = (name: string) => brief(audit(readFileSync(fileURLToPath(new URL(`./__fixtures__/render-live/${name}`, import.meta.url)), "utf8")));
    expect(live("icon-name-375.html").map(item => item.rule)).toEqual(["RENDER_NO_NAME", "RENDER_EMPTY_ICON"]);
    expect(live("wide-375.html")).toEqual([
      { rule: "RENDER_OVERFLOW", slot: "designer/sections.feature-grid", agent: "designer", selector: '[data-slot="designer/sections.feature-grid"] > div' },
      { rule: "RENDER_OVERFLOW", slot: "designer/sections.feature-grid", agent: "designer", selector: '[data-slot="designer/sections.feature-grid"] > a' },
    ]);
  });

  it("render check matches the recorded audits", async () => {
    for (const name of CASES) expect(brief(audit(capture(name))), name).toEqual(recorded(name));
    // And through the verb: one capture per fixture, the same findings, PASS only on the clean page.
    const rec = await runRenderCheck({ routes: site(CASES), runtime: savedHtmlRuntime() });
    expect(rec.routes.map(route => [route.path, route.captured])).toEqual(CASES.map(name => [`/${name}`, true]));
    for (const name of CASES) expect(brief(rec.findings.filter(item => item.route === `/${name}`)), name).toEqual(recorded(name));
    expect(rec.verdict).toBe("FAIL");
    const clean = await runRenderCheck({ routes: site(["clean"]), runtime: savedHtmlRuntime() });
    expect([clean.verdict, clean.line]).toEqual(["PASS", "RENDER: PASS 1/1 capture(s) 0 finding(s)"]);
  });
});
