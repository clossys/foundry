import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadActions } from "../pipeline/actions.js";
import { BINDINGS } from "../pipeline/steps/bindings.js";
import { PRODUCER_ROOT, installedPackageRoot } from "../package-path.js";
import { checkPublisherPages, loadPublisherCheckApi, releasePublisher, runPublisherAction, type ReleaseRunner } from "./publisher.js";

const PUBLISHER = installedPackageRoot("publisher")!;
const DEFAULTS = join(PUBLISHER, "defaults");
const STARTER_PAGES = readdirSync(DEFAULTS).filter(name => name.startsWith("page.")).sort();
const ENTRY = join(PRODUCER_ROOT, "dist", "actions", "publisher.js");

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
  const run = (...argv: string[]) => spawnSync(process.execPath, [ENTRY, ...argv], { encoding: "utf8" });

  it("exits 1 on each bad consumer page and 0 on the clean starter pages", () => {
    for (const edit of [duplicateKey, retiredSection, literalCopy]) {
      const bad = run("check", "--root", homeWith(edit));
      expect(bad.status, bad.stderr).toBe(1);
    }
    const clean = run("check", "--root", consumer(), "--json");
    expect(clean.status, clean.stderr).toBe(0);
    expect((JSON.parse(clean.stdout) as { output: { checked: unknown[] } }).output.checked).toHaveLength(STARTER_PAGES.length);
  });

  it("release exits 1 and runs no release step when the check fails; usage errors exit 2", () => {
    const refused = run("release", "site", "--root", homeWith(literalCopy));
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/publisher\.release: refused/);
    expect(run("release", "--root", consumer(["page.home"])).status).toBe(2);
    expect(run("nonsense").status).toBe(2);
  });

  it("in-process and spawned entries agree", async () => {
    const root = homeWith(retiredSection);
    expect((await runPublisherAction(["check", "--root", root], "/")).exit).toBe(1);
  });
});

describe("registered actions", () => {
  it("publisher.check and publisher.release are in the actions snapshot, run the action entry and are bound to it", () => {
    const actions = new Map(loadActions().map(action => [action.contract.id, action.contract]));
    for (const [id, mode] of [["publisher.check", "check"], ["publisher.release", "release"]] as const) {
      const action = actions.get(id);
      expect(action, id).toBeDefined();
      expect(action!.run).toMatch(new RegExp(`^clossys pipeline trace ${id.replace(".", "\\.")} -- node dist/actions/publisher\\.js ${mode}\\b`));
      expect(BINDINGS[id]).toEqual({ script: "dist/actions/publisher.js" });
    }
  });
});
