import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadActions } from "../pipeline/actions.js";
import { BINDINGS } from "../pipeline/steps/bindings.js";
import { PRODUCER_ROOT, installedPackageRoot } from "../package-path.js";
import { checkPublisherPages, loadPublisherCheckApi, releasePublisher, runPublisherAction, type PublisherCheckApi, type ReleaseRunner } from "./publisher.js";

const PUBLISHER = installedPackageRoot("publisher")!;
const DEFAULTS = join(PUBLISHER, "defaults");
const STARTER_PAGES = readdirSync(DEFAULTS).filter(name => name.startsWith("page.")).sort();
/** The built `clossys` bin: every declared run starts with `clossys`, so a consumer runs it through this bin. */
const CLI = join(PRODUCER_ROOT, "dist", "cli", "index.js");

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

type Section = { role: string; use: string; copy: string; [key: string]: unknown };
type Candidate = { clossys: Record<string, unknown>; content: { sections: Section[]; [key: string]: unknown } };
const starter = (pageId: string): Candidate => JSON.parse(readFileSync(join(DEFAULTS, pageId, "starter-v1.json"), "utf8")) as Candidate;

/** A consumer root whose page slots each hold the starter option as candidate `<page>-v1.json`, pinned. */
function consumer(pages: readonly string[] = STARTER_PAGES, edit?: (pageId: string, candidate: Candidate) => void): string {
  const root = mkdtempSync(join(tmpdir(), "publisher-actions-"));
  roots.push(root);
  mkdirSync(join(root, "clossys"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
  for (const pageId of pages) {
    const candidate = starter(pageId);
    edit?.(pageId, candidate);
    const name = `${pageId.slice("page.".length)}-v1.json`;
    const dir = join(root, "clossys", "agents", "publisher", pageId);
    mkdirSync(join(dir, "candidates"), { recursive: true });
    writeFileSync(join(dir, "candidates", name), `${JSON.stringify(candidate, null, 2)}\n`);
    writeFileSync(join(dir, "pin.json"), `${JSON.stringify({ schema: "clossys.pin/2", candidate: name })}\n`);
  }
  return root;
}
const checks = (findings: readonly { check: string }[]) => [...new Set(findings.map(finding => finding.check))].sort();
const homeWith = (edit: (candidate: Candidate) => void) => consumer(["page.home"], (_, candidate) => edit(candidate));
const duplicateKey = (candidate: Candidate) => { candidate.content.sections.push({ ...candidate.content.sections[0]! }); };
const retiredSection = (candidate: Candidate) => { candidate.content.sections[1]!.use = "designer/sections.newsletter"; };
const literalCopy = (candidate: Candidate) => { candidate.content.sections[0]!.copy = "Welcome to our product"; };

describe("publisher.check over a consumer's page records", () => {
  it("every clean starter page passes", async () => {
    expect(STARTER_PAGES.length).toBeGreaterThanOrEqual(20);
    const result = await checkPublisherPages(consumer());
    expect(result.findings).toEqual([]);
    expect(result.exit).toBe(0);
    expect(result.checked).toHaveLength(STARTER_PAGES.length);
  });

  it("a duplicate instance key fails page.instance-key", async () => {
    const result = await checkPublisherPages(homeWith(duplicateKey));
    expect(result.exit).toBe(1);
    expect(result.findings).toContainEqual({ check: "page.instance-key", subject: "publisher/page.home/candidates/home-v1.json", detail: "page.home: instance key hero appears twice; each section on a page has its own role" });
  });

  it("a retired Designer section fails page.unit-resolves", async () => {
    const result = await checkPublisherPages(homeWith(retiredSection));
    expect(result.exit).toBe(1);
    expect(result.findings.find(finding => finding.check === "page.unit-resolves")?.detail).toMatch(/places retired designer\/sections\.newsletter/);
  });

  it("literal copy in a page record fails page.no-inline-copy", async () => {
    const result = await checkPublisherPages(homeWith(literalCopy));
    expect(result.exit).toBe(1);
    expect(checks(result.findings)).toContain("page.no-inline-copy");
  });

  it("an unpinned bad candidate fails check but is not in the release set", async () => {
    const root = homeWith(literalCopy);
    rmSync(join(root, "clossys", "agents", "publisher", "page.home", "pin.json"));
    expect((await checkPublisherPages(root)).exit).toBe(1);
    expect((await checkPublisherPages(root, { pinned: true })).checked).toEqual([]);
  });

  it("a pin naming a missing candidate, or a page id Publisher does not have, fails", async () => {
    const root = consumer(["page.home"]);
    writeFileSync(join(root, "clossys", "agents", "publisher", "page.home", "pin.json"), JSON.stringify({ candidate: "gone-v1.json" }));
    expect(checks((await checkPublisherPages(root, { pinned: true })).findings)).toEqual(["page.record"]);
    const unknown = consumer(["page.home"]);
    cpSync(join(unknown, "clossys", "agents", "publisher", "page.home"), join(unknown, "clossys", "agents", "publisher", "page.nowhere"), { recursive: true });
    expect(checks((await checkPublisherPages(unknown)).findings)).toEqual(["page.slot-known"]);
  });

  it("runs the installed Publisher check API, not a stand-in", async () => {
    const api = await loadPublisherCheckApi();
    expect(api.slotContract("page.home")?.kind).toBe("page");
    expect(api.loadDesignerCatalog().retired.has("sections.newsletter")).toBe(true);
  });
});

describe("publisher.release refuses when publisher.check fails", () => {
  const spy = () => {
    const calls: (readonly string[])[] = [];
    const release: ReleaseRunner = async argv => { calls.push(argv); return { exitCode: 0, message: "release: gates pass" }; };
    return { calls, release };
  };

  for (const [name, edit] of [["duplicate instance key", duplicateKey], ["retired section", retiredSection], ["literal copy", literalCopy]] as const) {
    it(`refuses on a pinned page with a ${name}; no release step runs`, async () => {
      const { calls, release } = spy();
      const result = await releasePublisher(homeWith(edit), "site", [], { release });
      expect(result.exit).toBe(1);
      expect(result.released).toBe(false);
      expect(result.message).toMatch(/^publisher\.release: refused/);
      expect(calls).toEqual([]);
    });
  }

  it("hands a clean publication on to clossys release (default --gates) and reports its exit", async () => {
    const root = consumer();
    const { calls, release } = spy();
    const result = await releasePublisher(root, "site", [], { release });
    expect(result.exit).toBe(0);
    expect(result.released).toBe(true);
    expect(calls).toEqual([["site", "--gates", "--root", root]]);
    expect(result.checked.every(subject => /^publisher\/page\.(?:home|about|pricing|contact|terms|privacy|not-found|error)\//.test(subject))).toBe(true);
    expect(result.checked).toHaveLength(8);
    const failing: ReleaseRunner = async () => ({ exitCode: 1, message: "release: gate failed" });
    expect((await releasePublisher(root, "site", ["--build", "--manifest"], { release: failing })).exit).toBe(1);
  });
});

describe("the action entry (what the publisher.check / publisher.release runs execute)", () => {
  const run = (...argv: string[]) => spawnSync(process.execPath, [CLI, "publisher", ...argv], { encoding: "utf8", cwd: tmpdir() });

  it("exits 1 on each bad consumer page and 0 on the clean starter pages", () => {
    for (const edit of [duplicateKey, retiredSection, literalCopy]) {
      const bad = run("check", "--root", homeWith(edit));
      expect(bad.status, bad.stderr).toBe(1);
    }
    const clean = run("check", "--root", consumer(), "--json");
    expect(clean.status, clean.stderr).toBe(0);
    expect((JSON.parse(clean.stdout) as { checked: unknown[] }).checked).toHaveLength(STARTER_PAGES.length);
  });

  it("release exits 1 and runs no release step when the check fails; usage errors exit 2", () => {
    const refused = run("release", "site", "--root", homeWith(literalCopy));
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/publisher\.release: refused/);
    expect(run("release", "--root", consumer(["page.home"])).status).toBe(2);
    expect(run("nonsense", "--root", consumer(["page.home"])).status).toBe(2);
  });

  it("in-process and spawned entries agree", async () => {
    const root = homeWith(retiredSection);
    expect((await runPublisherAction(["check", "--root", root], "/")).exit).toBe(1);
  });
});

describe("registered actions", () => {
  it("publisher.check and publisher.release are in the actions snapshot, run the clossys publisher verb and are bound to it", () => {
    const actions = new Map(loadActions().map(action => [action.contract.id, action.contract]));
    for (const [id, mode] of [["publisher.check", "check"], ["publisher.release", "release"]] as const) {
      const action = actions.get(id);
      expect(action, id).toBeDefined();
      expect(action!.run).toMatch(new RegExp(`^clossys publisher ${mode}\\b`));
      expect(BINDINGS[id]).toEqual({ entry: "src/actions/publisher.ts#runPublisherCli", parser: "src/actions/publisher.ts" });
    }
  });

  // P1-2 (review r1): the declared run string itself, run from inside a consumer, not an absolute built path.
  const declared = (id: string, cwd: string) => {
    const action = JSON.parse(readFileSync(join(PRODUCER_ROOT, "actions", id, "action.json"), "utf8")) as { run: string };
    // The snapshot the pipeline reads carries the same declared run.
    expect(loadActions().find(candidate => candidate.contract.id === id)?.contract.run).toBe(action.run);
    const words = action.run.trim().split(/\s+/).map(word => word === "<publication>" ? "site" : word);
    expect(words[0]).toBe("clossys");
    return spawnSync(process.execPath, [CLI, ...words.slice(1)], { encoding: "utf8", cwd });
  };

  it("the declared publisher.check run resolves inside a consumer: 1 on a bad page, 0 on clean starters", () => {
    const bad = declared("publisher.check", homeWith(literalCopy));
    expect(bad.status, `${bad.stdout}${bad.stderr}`).toBe(1);
    expect(bad.stderr).toMatch(/page\.no-inline-copy/);
    const clean = declared("publisher.check", consumer());
    expect(clean.status, `${clean.stdout}${clean.stderr}`).toBe(0);
    expect(clean.stdout).toMatch(new RegExp(`publisher\\.check: ${STARTER_PAGES.length} page records, 0 findings`));
  });

  it("the declared publisher.release run resolves inside a consumer and refuses a bad pinned page", () => {
    const refused = declared("publisher.release", homeWith(literalCopy));
    expect(refused.status, `${refused.stdout}${refused.stderr}`).toBe(1);
    expect(refused.stderr).toMatch(/publisher\.release: refused/);
  });
});

describe("the consumer root is discovered the way clossys release discovers it (review r1 P1-1)", () => {
  const spy = () => {
    const calls: (readonly string[])[] = [];
    const release: ReleaseRunner = async argv => { calls.push(argv); return { exitCode: 0, message: "spy release ran" }; };
    return { calls, release };
  };
  const nested = () => {
    const root = homeWith(literalCopy);
    mkdirSync(join(root, "apps", "site"), { recursive: true });
    return root;
  };

  for (const [name, at] of [
    ["from <consumer>/clossys", (root: string) => ({ cwd: join(root, "clossys"), argv: [] as string[] })],
    ["from <consumer>/apps/site", (root: string) => ({ cwd: join(root, "apps", "site"), argv: [] as string[] })],
    ["with --root <consumer>/clossys", (root: string) => ({ cwd: "/", argv: ["--root", join(root, "clossys")] })],
  ] as const) {
    it(`check exits 1 and release refuses ${name}; release is never called`, async () => {
      const root = nested();
      const { cwd, argv } = at(root);
      const check = await runPublisherAction(["check", ...argv], cwd);
      expect(check.exit, check.text).toBe(1);
      expect(check.text).toMatch(/publisher\.check: 1 page record, \d+ finding/);
      const { calls, release } = spy();
      const released = await runPublisherAction(["release", "site", ...argv], cwd, { release });
      expect(released.exit, released.text).toBe(1);
      expect(released.text).toMatch(/^publisher\.release: refused/);
      expect(calls).toEqual([]);
    });
  }

  it("the library calls discover the root too, and a clean release hands on the discovered root", async () => {
    const root = nested();
    expect((await checkPublisherPages(join(root, "apps", "site"))).exit).toBe(1);
    const { calls, release } = spy();
    expect((await releasePublisher(join(root, "clossys"), "site", [], { release })).exit).toBe(1);
    expect(calls).toEqual([]);
    const clean = consumer(["page.home"]);
    mkdirSync(join(clean, "apps", "site"), { recursive: true });
    const ok = spy();
    expect((await releasePublisher(join(clean, "apps", "site"), "site", [], { release: ok.release })).exit).toBe(0);
    expect(ok.calls).toEqual([["site", "--gates", "--root", clean]]);
  });

  it("a folder with no consumer root exits 2 (could not run), never 0 with no records", async () => {
    const empty = mkdtempSync(join(tmpdir(), "publisher-noroot-"));
    roots.push(empty);
    const check = await runPublisherAction(["check"], empty);
    expect(check.exit).toBe(2);
    expect(check.text).toMatch(/Root not found/);
    expect((await checkPublisherPages(empty)).exit).toBe(2);
    const { calls, release } = spy();
    const released = await runPublisherAction(["release", "site", "--root", empty], "/", { release });
    expect(released.exit).toBe(2);
    expect(calls).toEqual([]);
  });
});

describe("environment errors exit 2 with a message (review r1 P2)", () => {
  it("a missing Designer catalog exits 2, not a thrown stack, and release refuses", async () => {
    const real = await loadPublisherCheckApi();
    const api: PublisherCheckApi = { ...real, loadDesignerCatalog: () => { throw new Error("Cannot find package '@clossys/designer'"); } };
    const root = consumer(["page.home"]);
    const check = await checkPublisherPages(root, { api });
    expect(check.exit).toBe(2);
    expect(check.message).toMatch(/publisher\.check: could not load the Designer catalog: Cannot find package '@clossys\/designer'/);
    let called = false;
    const released = await releasePublisher(root, "site", [], { api, release: async () => { called = true; return { exitCode: 0, message: "" }; } });
    expect(released.exit).toBe(2);
    expect(called).toBe(false);
  });

  it("a Publisher with no dist/check names the tarball a consumer needs, not a build step", async () => {
    const bare = mkdtempSync(join(tmpdir(), "publisher-nocheck-"));
    roots.push(bare);
    const error = await loadPublisherCheckApi(bare).then(() => undefined, (caught: unknown) => caught as Error);
    expect(error?.message).toMatch(/has no dist\/check\/index\.js; install a @clossys\/publisher tarball that ships dist\/check/);
    expect(error?.message).not.toMatch(/build @clossys\/publisher first/);
  });
});

describe("publisher.check over clossys.page/1 records (DECISION 0048-PAGE-SHAPE, U4b)", () => {
  /** assemble.page's fixture output: the one page shape, the record a Publisher candidate holds. */
  const PAGE_FIXTURE = join(PRODUCER_ROOT, "..", "publisher", "recipes", "assemble.page", "fixture", "page.home.json");
  const pageRecord = (): Record<string, any> => JSON.parse(readFileSync(PAGE_FIXTURE, "utf8"));
  /** A consumer whose page.home pins the page record as `home-v1.json`. */
  const pageConsumer = (edit?: (record: Record<string, any>) => void): string => {
    const root = consumer([]);
    const record = pageRecord();
    edit?.(record);
    const dir = join(root, "clossys", "agents", "publisher", "page.home");
    mkdirSync(join(dir, "candidates"), { recursive: true });
    writeFileSync(join(dir, "candidates", "home-v1.json"), `${JSON.stringify(record, null, 2)}\n`);
    writeFileSync(join(dir, "pin.json"), `${JSON.stringify({ schema: "clossys.pin/2", candidate: "home-v1.json" })}\n`);
    return root;
  };
  const band = (record: Record<string, any>) => {
    record.sections[0] = "sections.band";
    record.bindings["sections.band"] = { copy: { copy: "sections.band.copy#home.hero" } };
    delete record.bindings["sections.hero"];
  };
  /** The real `clossys publisher check` bin, not the library call. */
  const clossys = (...argv: string[]) => spawnSync(process.execPath, [CLI, "publisher", ...argv], { encoding: "utf8", cwd: tmpdir() });

  it("the real clossys publisher check passes the assemble.page fixture record (exit 0)", () => {
    const clean = clossys("check", "--root", pageConsumer());
    expect(clean.status, `${clean.stdout}${clean.stderr}`).toBe(0);
    expect(clean.stdout).toMatch(/publisher\.check: 1 page record, 0 findings/);
  });

  it("mutation: the real command fails a section the layout disallows (exit 1, page.role-allowed)", () => {
    const bad = clossys("check", "--root", pageConsumer(band));
    expect(bad.status, `${bad.stdout}${bad.stderr}`).toBe(1);
    expect(`${bad.stdout}${bad.stderr}`).toMatch(/page\.role-allowed {2}publisher\/page\.home\/candidates\/home-v1\.json: page\.home: hero places designer\/sections\.band; the role allows designer\/sections\.hero/);
  });

  it("reads the record's frame, route, metadata and words: each fault is a finding", async () => {
    const result = async (edit: (record: Record<string, any>) => void) => checks((await checkPublisherPages(pageConsumer(edit))).findings);
    expect(await result(record => { record.frame = "frames.plain"; })).toContain("page.layout-allowed");
    expect(await result(record => { record.path = "/home"; })).toEqual(["page.route"]);
    expect(await result(record => { record.heading = "Welcome to our product"; })).toEqual(["page.no-inline-copy"]);
    expect(await result(record => { record.title = "Welcome"; delete record.copy.meta; })).toEqual(["page.no-inline-copy"]);
    expect(await result(record => { delete record.bindings["sections.steps"]; })).toEqual(["page.record-key"]);
    expect(await result(record => { record.sections.splice(record.sections.indexOf("sections.features"), 1); delete record.bindings["sections.features"]; })).toEqual(["page.required-roles"]);
  });

  /**
   * Fix round 1: the read option keeps only refs, so words and styling anywhere in the record must still fail through
   * the real command, and publisher.release (which refuses on any finding) must refuse them. Each is a review mutation.
   */
  const inline: readonly (readonly [string, (record: Record<string, any>) => void, RegExp])[] = [
    ["an inline title (copy.meta present)", record => { record.title = "Welcome to the studio"; },
      /page\.no-inline-copy {2}\S+: page\.home: page\.title: "Welcome to the studio" is not a Writer ref/],
    ["an inline heading in a binding", record => { record.bindings["sections.hero"].heading = "Welcome to our product"; },
      /page\.no-inline-copy {2}\S+: page\.home: page: bindings\.sections\.hero\.heading is inline text "Welcome to our product"/],
    ["a className in a binding", record => { record.bindings["sections.hero"].className = "text-red-500"; },
      /page\.no-style {2}\S+: page\.home: bindings\.sections\.hero\.className: a page record holds no styling/],
    ["an inline meta.title", record => { record.meta.title = "Hello world"; },
      /page\.no-inline-copy {2}\S+: page\.home: page: meta\.title is inline text "Hello world"/],
    ["a section entry that is not an id", record => { record.sections.push({ text: "Hello there" }); },
      /page\.no-inline-copy {2}\S+: page\.home: sections\[6\]: a section entry is a Designer section id/],
    // Fix round 2: the record's own copy map and the closed meta and nav sets.
    ["inline words in the record's copy map (copy.tagline)", record => { record.copy.tagline = "Build faster today"; },
      /page\.no-inline-copy {2}\S+: page\.home: page\.copy\.tagline: "Build faster today" is not a Writer ref/],
    ["inline words in copy.meta next to a valid title", record => { record.copy.meta = "Hello world, welcome"; },
      /page\.no-inline-copy {2}\S+: page\.home: page\.copy\.meta: "Hello world, welcome" is not a Writer ref/],
    ["an unknown meta key (meta.blurb)", record => { record.meta.blurb = "Our story so far"; },
      /page\.no-inline-copy {2}\S+: page\.home: meta\.blurb: not a page record meta field/],
    ["an unknown nav key (nav.items)", record => { record.nav = { nav: true, items: [{ name: "Home" }] }; },
      /page\.no-inline-copy {2}\S+: page\.home: nav\.items: not a nav field/],
  ];
  for (const [name, edit, line] of inline) {
    it(`mutation: the real command fails ${name} (exit 1)`, () => {
      const bad = clossys("check", "--root", pageConsumer(edit));
      expect(bad.status, `${bad.stdout}${bad.stderr}`).toBe(1);
      expect(`${bad.stdout}${bad.stderr}`).toMatch(line);
    });
  }

  it("publisher.release refuses a page record with styling or inline copy; no release step runs", async () => {
    const calls: (readonly string[])[] = [];
    const release: ReleaseRunner = async argv => { calls.push(argv); return { exitCode: 0, message: "" }; };
    for (const edit of [
      (record: Record<string, any>) => { record.bindings["sections.hero"].className = "text-red-500"; },
      (record: Record<string, any>) => { record.copy.tagline = "Build faster today"; },
      (record: Record<string, any>) => { record.copy.meta = "Hello world, welcome"; },
      (record: Record<string, any>) => { record.meta.blurb = "Our story so far"; },
    ]) {
      const refused = await releasePublisher(pageConsumer(edit), "site", [], { release });
      expect(refused.released).toBe(false);
      expect(refused.message).toMatch(/^publisher\.release: refused/);
    }
    expect(calls).toEqual([]);
    const clean = await releasePublisher(pageConsumer(), "site", [], { release });
    expect(clean.released, clean.message).toBe(true);
    expect(calls).toHaveLength(1);
  });

  /** The alternatives of a flat `STYLE_KEYS = /^(?:a|b|...)$/i` literal in a source or built file; throws when absent. */
  const styleKeysIn = (file: string): string[] => {
    const match = /STYLE_KEYS = \/\^\(\?:([A-Za-z|]+)\)\$\/i;/.exec(readFileSync(file, "utf8"));
    if (!match) throw new Error(`${file} has no flat STYLE_KEYS literal to compare`);
    return match[1]!.split("|");
  };

  it("judges style keys the way the option form does, on the union of both key lists", async () => {
    const lists = {
      publisherSource: styleKeysIn(join(PUBLISHER, "src", "check", "page-sections-instance.ts")),
      publisherBuilt: styleKeysIn(join(PUBLISHER, "dist", "check", "page-sections-instance.js")),
      adapter: styleKeysIn(join(PRODUCER_ROOT, "src", "actions", "page-option.ts")),
    };
    // The lists are the same keys on every side: a key added or dropped on one side only fails here.
    expect([...lists.adapter].sort()).toEqual([...lists.publisherSource].sort());
    expect([...lists.publisherBuilt].sort()).toEqual([...lists.publisherSource].sort());
    // And the running checks agree on every key of the union (plus case variants and fields that are not style keys).
    const union = [...new Set([...lists.publisherSource, ...lists.publisherBuilt, ...lists.adapter])];
    const api = await loadPublisherCheckApi(PUBLISHER) as PublisherCheckApi & { inlineCopyFindings(content: Record<string, unknown>): readonly { check: string }[] };
    for (const key of [...union, ...union.map(key => key.toUpperCase()), "variant", "copy", "links", "tone", "size", "border"]) {
      const option = api.inlineCopyFindings({ meta: { copy: "writer/page.home.meta#home.meta" }, sections: [{ role: "hero", [key]: "x" }] }).some(finding => finding.check === "page.no-style");
      const record = checks((await checkPublisherPages(pageConsumer(doc => { doc.bindings["sections.hero"][key] = "x"; }))).findings).includes("page.no-style");
      expect(record, key).toBe(option);
    }
  });

  it("a record with neither path nor slug fails page.route", async () => {
    const findings = (await checkPublisherPages(pageConsumer(record => { delete record.path; }))).findings;
    expect(findings.map(finding => finding.detail)).toContain("page.home: names no route: a page record carries a path or a slug");
  });

  it("finds a binding keyed by the section's instance key <slot>#n", async () => {
    const keyed = await checkPublisherPages(pageConsumer(record => {
      record.sections[record.sections.indexOf("sections.faq")] = "sections.faq#1";
      record.bindings["sections.faq#1"] = record.bindings["sections.faq"];
      delete record.bindings["sections.faq"];
    }));
    expect(keyed.findings).toEqual([]);
  });
});
