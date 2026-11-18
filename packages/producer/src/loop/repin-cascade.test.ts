/**
 * loop.cascade end to end (foundry-build-0048 U6, R07.5): a repin upstream re-verdicts every pinned dependant whose
 * pinSet it changed, through the one certifier, and a failing dependant goes to its owner as a queue.fix while
 * release refuses it. Unstubbed: real `clossys ia`, `clossys pin` (the CHOOSE gate) and `clossys run loop.cascade`
 * on a temp copy of test-fixtures/consumer (the fixture itself is never written).
 *
 * Setup outside the verbs, on the temp copy only:
 * - the Designer frame and section slots get a contract fixture (props `label`), so their candidates certify;
 * - candidates come in through `writeCandidate`, the submit write `clossys next --submit` uses (a ledger submit at
 *   the candidate's bytes), so the pin gate admits them.
 *
 *  1. frame (web) + section (web) + Writer copy + a page placing them are pinned through the gate.
 *  2. The section is repinned to a candidate that serves only `slide` (`meta.element.media`): the page's layout breaks.
 *  3. R07.5 reports the page's pin as stale (its pinSet changed, nobody re-verdicted).
 *  4. `clossys run loop.cascade --slot designer/sections.hero` re-verdicts the page: it fails, the page is
 *     needs-refresh, a queue.fix goes to agent:publisher, and the release gate slots.stale fails.
 * *  5. Repinning the section to a web candidate and running the cascade again passes the page: needs-refresh goes to live.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runCli } from "../cli/main.js";
import { buildContext } from "../constitution/context.js";
import { staleRows } from "../constitution/cascade.js";
import { PRODUCER_ROOT } from "../package-path.js";
import { SLOT_LOCK, writeCandidate } from "../records/slot-write.js";
import { runGates, SLOTS_STALE } from "../release/gates.js";

const AT = "2026-11-17T12:00:00Z";
const BY = "planner:foundry-build-0048-u6";
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const LABEL = "export function Example({ label }: { label: string }) { return <button type=\"button\">{label}</button>; }\n";
const element = (file: string, element?: Record<string, unknown>) => ({
  name: file.replace(/^.*\/|\.tsx$/g, ""), type: "registry:ui", files: [{ path: file, type: "registry:ui", content: LABEL }],
  meta: { source: { kind: "original", ref: [], license: "MIT" }, ...(element ? { element } : {}) },
});
const COPY = `---
slot: "sections.hero.copy"
locales: ["en"]
reason: "realises director:advantage.proposition.promise for the hero"
source: {"kind":"derived","ref":["director:identity.verbal.voice","director:advantage.proposition.promise","director:identity.naming.name"]}
---

## en
### header.heading
<!-- {"id":"header.heading","bindings":[]} -->
Ship your site this week
### actions.primary.label
<!-- {"id":"actions.primary.label","bindings":[]} -->
Get started
`;
const PAGE = {
  schema: "clossys.page/1", path: "/", title: "sections.hero.copy#header.heading", frame: "frames.site-shell", sections: ["sections.hero"],
  copy: { heading: "sections.hero.copy#header.heading" }, meta: { source: { kind: "original", ref: [] } },
};

function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "repin-cascade-")));
  roots.push(root);
  cpSync(join(PRODUCER_ROOT, "test-fixtures", "consumer"), root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  const consumer = join(root, "clossys");
  const slotFile = (agent: string, slot: string) => join(consumer, "agents", agent, slot, "slot.json");
  const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));
  const withFixture = (slot: string, file: string) => {
    const doc = readJson(slotFile("designer", slot));
    const props = [...new Set([...(Array.isArray(doc.contract?.props) ? doc.contract.props : []), "label"])];
    doc.contract = { ...doc.contract, props, fixture: { schema: "clossys.element-preview/1", fixtures: { file, export: "Example", props: { label: "Go" } } } };
    writeFileSync(slotFile("designer", slot), `${JSON.stringify(doc, null, 2)}\n`);
  };
  withFixture("frames.site-shell", "frames/site-shell.tsx");
  withFixture("sections.hero", "sections/hero.tsx");
  const cli = async (...args: string[]) => {
    const result = await runCli([...args, "--root", root]);
    return { ...result, args };
  };
  const submit = (agent: "designer" | "writer" | "publisher", slot: string, stem: string, content: unknown) =>
    writeCandidate(consumer, agent, slot, stem, content, { at: AT, provenance: { by: `agent:${agent}`, model: "claude-opus-5-5", tier: "high" } }).name;
  const pin = (ref: string, candidate: string) => cli("pin", ref, candidate, "--by", BY, "--at", AT);
  const status = (agent: string, slot: string) => readJson(slotFile(agent, slot)).status as string;
  const queue = (name: string) => {
    const dir = join(consumer, "agents", "producer", name, "entries");
    return existsSync(dir) ? readdirSync(dir).filter(file => file.endsWith(".json")).map(file => readJson(join(dir, file))) : [];
  };
  return { root, consumer, cli, submit, pin, status, queue, readJson };
}

async function seated() {
  const w = world();
  const ok = (result: { exitCode: number; message: string; args: string[] }) => expect(result.exitCode, `clossys ${result.args.join(" ")}: ${result.message}`).toBe(0);
  ok(await w.pin("designer/frames.site-shell", w.submit("designer", "frames.site-shell", "site-shell", element("frames/site-shell.tsx"))));
  ok(await w.pin("designer/sections.hero", w.submit("designer", "sections.hero", "hero", element("sections/hero.tsx"))));
  ok(await w.pin("writer/sections.hero.copy#copy", w.submit("writer", "sections.hero.copy", "copy", COPY)));
  const contract = join(w.root, "page-contract.json");
  writeFileSync(contract, JSON.stringify({ kind: "page", route: "/", frame: "required", sections: "ordered", fixture: { route: { path: "/" } } }));
  ok(await w.cli("ia", "publisher/page.home", "--contract", contract, "--standard", "page", "--under", "site/site-pages", "--kind", "page", "--at", AT));
  ok(await w.pin("publisher/page.home", w.submit("publisher", "page.home", "home", PAGE)));
  return { w, ok };
}

const r075 = (root: string) => staleRows(buildContext(root, join(root, "clossys"))).map(row => `${row.slot} ${row.reason}`);
const staleGate = (root: string) => runGates(root, "site", undefined);

describe("loop.cascade: a repin re-verdicts its dependants (R07.5)", () => {
  it("a section repinned to another medium breaks the page: queue.fix to its owner, needs-refresh, release refused; a web repin restores it", async () => {
    const { w, ok } = await seated();
    // Every pin is fresh: nothing for R07.5, nothing stale for release.
    expect(r075(w.root)).toEqual([]);
    expect(staleGate(w.root).checks[SLOTS_STALE]).toBe("pass");
    const scorecard = w.readJson(join(w.root, ".clossys", "checks", "publisher", "page.home", "scorecard.json"));
    expect(scorecard.candidates[0]).toMatchObject({ candidate: "home-v1.json", certified: true, pinSet: expect.stringMatching(/^[0-9a-f]{64}$/) });

    // 2. The section is repinned to a slide-only candidate.
    ok(await w.pin("designer/sections.hero", w.submit("designer", "sections.hero", "hero", element("sections/hero.tsx", { media: ["slide"] }))));
    // 3. The page's pinSet changed and nobody re-verdicted it: R07.5 and release both see it.
    expect(r075(w.root)).toEqual([expect.stringMatching(/page\.home.*pinned home-v1\.json was judged on pinSet .* not the pinSet now/)]);
    expect(staleGate(w.root).checks[SLOTS_STALE]).toBe("fail");

    // 4. The cascade re-verdicts the page through the one certifier.
    const run = await w.cli("run", "loop.cascade", "--slot", "designer/sections.hero", "--json");
    expect(run.exitCode, run.message).toBe(1);
    expect(run.message).toMatch(/reverdict failed; raised queue\.fix#\S+page-home; loop\.choose runs from queue\.fix#/);
    expect(w.status("publisher", "page.home")).toBe("needs-refresh");
    const reverdict = w.readJson(join(w.root, ".clossys", "checks", "publisher", "page.home", "cascade.json"));
    expect(reverdict).toMatchObject({ schema: "clossys.reverdict/1", slot: "publisher/page.home", cause: "designer/sections.hero" });
    expect(reverdict.verdicts).toEqual([expect.objectContaining({
      candidate: "home-v1.json", certified: false,
      reasons: [expect.objectContaining({ code: "section", message: expect.stringMatching(/serves medium slide, not the page's web .*layout breaks/) })],
    })]);
    const fixes = w.queue("queue.fix");
    expect(fixes).toEqual([expect.objectContaining({
      queue: "queue.fix", status: "open", decider: "agent:publisher", subject: { to: "publisher/page.home", rel: "input" },
      ask: expect.stringMatching(/cascade\.reverdict: .*home-v1\.json: \[section\].*run loop\.create/),
    })]);
    expect(w.queue("queue.clarify")).toEqual([]);
    // The ledger entry is a ledger.cascade run naming both written files.
    const entries = readdirSync(join(w.consumer, "agents", "producer", "ledger.cascade", "entries"));
    expect(entries).toHaveLength(1);
    const entry = w.readJson(join(w.consumer, "agents", "producer", "ledger.cascade", "entries", entries[0]!));
    expect(entry).toMatchObject({ loop: "loop.cascade", loopVersion: "cascade-v1.json", status: "stopped", checks: { "cascade.clean": "fail" } });
    expect(entry.steps[0].wrote.map((item: { file: string }) => item.file)).toEqual([".clossys/checks/publisher/page.home/cascade.json", "publisher/page.home/slot.json"]);
    // Flagged: R07.5 no longer reports it (the slot is marked), release still refuses it.
    expect(r075(w.root)).toEqual([]);
    const gates = staleGate(w.root);
    expect(gates.checks[SLOTS_STALE]).toBe("fail");
    expect(gates.findings.filter(finding => finding.check === SLOTS_STALE)).toEqual([expect.objectContaining({ subject: "publisher/page.home", detail: expect.stringMatching(/needs-refresh/) })]);

    // 5. A web section again: the cascade passes the page and it goes back to live (a fixed point).
    ok(await w.pin("designer/sections.hero", w.submit("designer", "sections.hero", "hero", element("sections/hero.tsx", { media: ["web"] }))));
    const again = await w.cli("run", "loop.cascade", "--slot", "designer/sections.hero");
    expect(again.exitCode, again.message).not.toBe(2);
    expect(w.status("publisher", "page.home")).toBe("live");
    expect(w.readJson(join(w.root, ".clossys", "checks", "publisher", "page.home", "cascade.json")).verdicts).toEqual([expect.objectContaining({ candidate: "home-v1.json", certified: true })]);
    expect(r075(w.root)).toEqual([]);
    expect(staleGate(w.root).checks[SLOTS_STALE]).toBe("pass");
  }, 300_000);
});

describe("the pin gate and the pin are one critical section (U6)", () => {
  it("a pin refuses while another write holds the slot lock, and pins once it is free", async () => {
    const w = world();
    const candidate = w.submit("designer", "sections.hero", "hero", element("sections/hero.tsx"));
    const slot = join(w.consumer, "agents", "designer", "sections.hero");
    const pinFile = join(slot, "pin.json");
    const before = existsSync(pinFile) ? readFileSync(pinFile, "utf8") : undefined;
    // A live writer (this process) holds the slot's write lock, as a submit or a second pin does mid-write.
    const lock = join(slot, SLOT_LOCK);
    mkdirSync(lock);
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, host: hostname(), at: Date.now() }));
    const held = await w.pin("designer/sections.hero", candidate);
    expect(held.exitCode).toBe(1);
    expect(held.message).toMatch(/pin refused: Slot is unavailable or another decision write is in progress/);
    expect(existsSync(pinFile) ? readFileSync(pinFile, "utf8") : undefined).toBe(before);
    expect(existsSync(join(w.root, ".clossys", "checks", "designer", "sections.hero", "scorecard.json"))).toBe(false);
    rmSync(lock, { recursive: true, force: true });
    const free = await w.pin("designer/sections.hero", candidate);
    expect(free.exitCode, free.message).toBe(0);
    expect(w.readJson(pinFile)).toMatchObject({ candidate });
  }, 120_000);
});
