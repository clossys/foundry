/**
 * `clossys publish --install` on a fixture consumer: its selection pins two library
 * records (a frame and a hero section, each a shadcn registry item), one page record uses
 * both, and its compiled Writer copy holds every key the page binds. The real shadcn CLI
 * runs; `REGISTRY_URL` points its one base-color fetch at a loopback stub.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../cli/main.js";
import { documentTitle, type TitledPageRecord } from "./install.js";
import { withDesignerSlots } from "../specimen/__fixtures__/canonical-library.js";

const fixtureSource = join(import.meta.dirname, "__fixtures__", "install-consumer");
let fixture: string;
const temps: string[] = [];
let stub: Server, previous: string | undefined;
/** The fixture consumer's component selection module (`--selection`). */
const selection = () => join(fixture, "component-selection.ts");
const temp = (prefix: string) => { const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix))); temps.push(dir); return dir; };

beforeAll(async () => {
  fixture = temp("producer-install-fixture-");
  cpSync(fixtureSource, fixture, { recursive: true });
  await withDesignerSlots(join(fixture, "clossys"));
  stub = createServer((request, response) => {
    if (request.url?.startsWith("/r/colors/")) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ inlineColors: { light: {}, dark: {} }, cssVars: { light: {}, dark: {} }, cssVarsV4: { light: {}, dark: {} }, inlineColorsTemplate: "", cssVarsTemplate: "" }));
    } else { response.statusCode = 404; response.end("{}"); }
  });
  await new Promise<void>(done => stub.listen(0, "127.0.0.1", done));
  const address = stub.address();
  previous = process.env.REGISTRY_URL;
  process.env.REGISTRY_URL = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/r`;
});
afterAll(async () => {
  if (previous === undefined) delete process.env.REGISTRY_URL; else process.env.REGISTRY_URL = previous;
  await new Promise(done => stub.close(done));
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe("clossys publish --install", () => {
  it("installs the page's pinned items, binds every copy slot, and renders the page", async () => {
    const out = temp("producer-install-");
    rmSync(out, { recursive: true });
    const result = await runCli(["publish", "--install", "--page", join(fixture, "clossys", "publisher", "pages", "home.json"), "--root", fixture, "--out", out, "--selection", selection()]);
    expect(result.message).toContain("Findings: 0");
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("Bound: home (frame frames.plain/plain-frame + 1 sections + 0 parts, 3 copy slots bound)");
    const html = readFileSync(join(out, "site", "home", "index.html"), "utf8");
    for (const text of ["Example Studio", "Pages assembled from records", "Every word here comes from a Writer key."]) expect(html).toContain(text);
    const again = await runCli(["publish", "--install", "--page", join(fixture, "clossys", "publisher", "pages", "home.json"), "--root", fixture, "--out", out, "--selection", selection()]);
    expect(again.exitCode).toBe(0);
    expect(again.message.match(/ unchanged: /g)).toHaveLength(2);
  }, 120_000);

  it("reads a page id's active Publisher cell, binding `slot = key` bullets and leaving an unbound slot empty", async () => {
    const out = join(temp("producer-install-cell-"), "out");
    const result = await runCli(["publish", "--install", "--page", "about", "--root", fixture, "--out", out, "--selection", selection()]);
    expect(result.message).toContain("Findings: 0 (+1 info)");
    expect(result.message).toContain("unbound-copy-slot");
    expect(result.exitCode).toBe(0);
    const html = readFileSync(join(out, "site", "about", "index.html"), "utf8");
    for (const text of ["About Example Studio", "Read straight from the page cell", '<p data-copy="hero.body"></p>']) expect(html).toContain(text);
  }, 120_000);

  it("exits 1 with a finding when the page references an unpinned slot", async () => {
    const consumer = temp("producer-install-consumer-");
    cpSync(fixture, consumer, { recursive: true });
    const pagePath = join(consumer, "clossys", "publisher", "pages", "home.json");
    const page = JSON.parse(readFileSync(pagePath, "utf8"));
    writeFileSync(pagePath, JSON.stringify({ ...page, sections: [...page.sections, "sections.pricing"] }));
    const out = join(temp("producer-install-out-"), "out");
    const result = await runCli(["publish", "--install", "--page", pagePath, "--root", consumer, "--out", out]);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("unpinned-slot sections.pricing: home: slot sections.pricing has no pinned registry item");
    expect(result.message).not.toContain("Page: ");
  }, 30_000);

  it("renders no page without the consumer's component selection: a NEED finding and exit 1", async () => {
    const out = join(temp("producer-install-unselected-"), "out");
    const result = await runCli(["publish", "--install", "--page", join(fixture, "clossys", "publisher", "pages", "home.json"), "--root", fixture, "--out", out]);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("need-component-selection: NEED component selection: home ");
    expect(result.message).not.toContain("Page: ");
  }, 60_000);

  it("mounts every page inside the substrate's Publisher host with the consumer selection", async () => {
    const out = join(temp("producer-install-host-"), "out");
    const result = await runCli(["publish", "--install", "--page", join(fixture, "clossys", "publisher", "pages", "home.json"), "--root", fixture, "--out", out, "--selection", selection()]);
    expect(result.exitCode).toBe(0);
    const host = readFileSync(join(out, "substrate", "clossys", "publisher-host.tsx"), "utf8");
    expect(host).toMatch(/^"use client";/);
    expect(host).toContain('import { PublisherHost } from "@clossys/publisher/web/host"');
    expect(host).toMatch(/import \{ componentSelection as selection \} from "(\.\.\/)+[^"]*\/component-selection"/);
    expect(readFileSync(join(out, "substrate", "clossys", "pages", "home.tsx"), "utf8")).toContain('createElement(PageHost, null, mount("frames.plain"))');
  }, 120_000);

  it("requires a page record", async () => {
    const result = await runCli(["publish", "--install", "--root", fixture]);
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain("publish --install requires --page");
  });
});

describe("documentTitle: the page's document title is its Writer title key's text", () => {
  const page = (title?: string) => ({ id: "home", frame: "frames.plain", sections: [], ...(title === undefined ? {} : { title }) }) as unknown as TitledPageRecord;
  const copy = { "home.title": "Plain <Studio> & home" };

  it("a title key Writer does not hold is a blocking missing-copy-key, and no text", () => {
    expect(documentTitle(page("home.no.such.title"), copy)).toEqual({ finding: { code: "missing-copy-key", detail: "home: Writer has no key home.no.such.title (for the page title)" } });
  });

  it("a record without a title key is an info unbound-copy-slot, and no text (never the page id)", () => {
    for (const title of [undefined, ""]) expect(documentTitle(page(title), copy)).toEqual({ finding: { code: "unbound-copy-slot", severity: "info", detail: "home: the page names no Writer title key, so the document has no title" } });
  });

  it("a title key Writer holds is its text, with no finding", () => {
    expect(documentTitle(page("home.title"), copy)).toEqual({ text: "Plain <Studio> & home" });
  });
});

describe("clossys publish --install: the document title", () => {
  const pageWith = (dir: string, title?: string): string => {
    const record = JSON.parse(readFileSync(join(fixture, "clossys", "publisher", "pages", "home.json"), "utf8"));
    const path = join(dir, "home.json");
    writeFileSync(path, JSON.stringify(title === undefined ? record : { ...record, title }));
    return path;
  };

  it("a title key Writer does not hold blocks the render: missing-copy-key, exit 1, no HTML", async () => {
    const dir = temp("producer-install-title-missing-"), out = join(dir, "out");
    const result = await runCli(["publish", "--install", "--page", pageWith(dir, "home.no.such.title"), "--root", fixture, "--out", out, "--selection", selection()]);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("  missing-copy-key: home: Writer has no key home.no.such.title (for the page title)");
    expect(result.message).not.toContain("Page: ");
    expect(existsSync(join(out, "site", "home", "index.html"))).toBe(false);
  }, 120_000);

  it("a record with no title key renders with an info unbound-copy-slot and no <title>", async () => {
    const dir = temp("producer-install-title-unbound-"), out = join(dir, "out");
    const result = await runCli(["publish", "--install", "--page", pageWith(dir), "--root", fixture, "--out", out, "--selection", selection()]);
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("  info unbound-copy-slot: home: the page names no Writer title key, so the document has no title");
    const html = readFileSync(join(out, "site", "home", "index.html"), "utf8");
    expect(html).toContain("Pages assembled from records");
    expect(html).not.toContain("<title>");
  }, 120_000);

  it("a title key Writer holds is the escaped <title> text", async () => {
    const consumer = temp("producer-install-title-held-");
    cpSync(fixture, consumer, { recursive: true });
    const strings = join(consumer, "clossys", "agents", "writer", "strings.site");
    const candidate = join(strings, "candidates", "site-v2.md");
    writeFileSync(candidate, `${readFileSync(candidate, "utf8").trimEnd()}\n\n### home.title\n<!-- {"id":"home.title","bindings":[]} -->\nPlain <Studio> & home\n`);
    const pin = JSON.parse(readFileSync(join(strings, "pin.json"), "utf8"));
    writeFileSync(join(strings, "pin.json"), `${JSON.stringify({ ...pin, sha256: createHash("sha256").update(readFileSync(candidate)).digest("hex") }, null, 2)}\n`);
    const out = join(consumer, "out");
    const result = await runCli(["publish", "--install", "--page", pageWith(consumer, "home.title"), "--root", consumer, "--out", out, "--selection", join(consumer, "component-selection.ts")]);
    expect(result.message).toContain("Findings: 0");
    expect(result.message).not.toContain("unbound-copy-slot: home: the page names no Writer title key");
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(out, "site", "home", "index.html"), "utf8")).toContain("<title>Plain &lt;Studio&gt; &amp; home</title>");
  }, 120_000);
});
