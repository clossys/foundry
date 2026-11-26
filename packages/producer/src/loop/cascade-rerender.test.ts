/**
 * loop.cascade v2 (foundry-build-0048 CP1-L1): after the reverdict, the `rerender` code step renders every
 * re-verdicted Designer dependant again and re-installs the published pages that place them.
 *
 * On a temp copy of test-fixtures/consumer (the fixture itself is never written):
 * - the fixture's pinned frame (frames.site-shell, scored) stays; the Writer copy is pinned through the gate and a
 *   page placing the frame is pinned as a record;
 * - the owner pins producer/loop.cascade to the package's cascade-v2.json and every agent's own loop.cascade is
 *   recertified against it (its v1 steps plus the rerender step, in the standard's order);
 * - the frame is rendered once and the page has a prior `publish --install` report (its selection).
 *
 * Then a theme the frame takes as input is repinned and `clossys run loop.cascade --slot
 * designer/themes.primary` runs through the real runner and the real `clossys render` (only the specimen harness and
 * the shadcn/npm install are stand-ins): each dependant's render index carries a new inputsSha256, the page is
 * marked stale and installed again with its selection, and it leaves the stale list.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { defaultInstallOut, INSTALL_MARKER } from "@clossys/publisher/build";
import { runCli, type CliResult } from "../cli/main.js";
import { runRenderCli } from "../cli/render.js";
import { PRODUCER_ROOT } from "../package-path.js";
import { buildCandidateHeader, candidatePath, serializeCandidate, writeCandidateFile } from "../records/candidate.js";
import { buildPin, cliActor, pinPath, writePinDoc } from "../records/pin.js";
import { writeCandidate } from "../records/slot-write.js";
import type { SnapshotOptions, SnapshotResult } from "../specimen/thumbnails.js";
import { certifiedStandardRef, currentStandardOf } from "./agent-loops.js";
import { runLoopCli } from "./cli.js";
import { readStalePages, RERENDER_CLI } from "./rerender.js";

const AT = "2026-11-26T12:00:00Z";
const BY = "planner:foundry-build-0048-cp1-l1";
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const COPY = `---
slot: "sections.hero.copy"
locales: ["en"]
reason: "realises director:advantage.proposition.promise for the hero"
source: {"kind":"derived","ref":["director:identity.verbal.voice","director:advantage.proposition.promise","director:identity.naming.name"]}
provenance: {"voice":"director:identity.verbal.voice"}
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
  schema: "clossys.page/1", path: "/", title: "sections.hero.copy#header.heading", frame: "frames.site-shell", sections: [],
  copy: { heading: "sections.hero.copy#header.heading" }, meta: { source: { kind: "original", ref: [] } },
};
/** The fixture consumer's pinned frame: scored, and takes designer/themes.primary as input. */
const DEPENDANTS = ["frames.site-shell"] as const;

/** A stand-in for the specimen harness: one PNG per width, as cli/render.test.ts has it. */
function fakeSnapshot(root: string) {
  let calls = 0;
  return async (options: SnapshotOptions): Promise<SnapshotResult> => {
    calls++;
    const thumbnails = (options.widths ?? [480]).map(width => {
      const path = join(root, `fake-${calls}-${width}.png`);
      writeFileSync(path, `png ${options.element} v${options.version} ${width}`);
      return { width, key: `fake${calls}`, path, healthPath: `${path}.json`, cached: false };
    });
    return { element: options.element, version: options.version ?? 0, theme: options.theme ?? "light", cache: root, thumbnails };
  };
}

function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cascade-rerender-")));
  roots.push(root);
  cpSync(join(PRODUCER_ROOT, "test-fixtures", "consumer"), root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  const consumer = join(root, "clossys");
  const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));
  const cli = async (...args: string[]) => ({ ...(await runCli([...args, "--root", root])), args });
  const submit = (agent: "designer" | "writer" | "publisher", slot: string, stem: string, content: unknown) =>
    writeCandidate(consumer, agent, slot, stem, content, { at: AT, provenance: { by: `agent:${agent}`, model: "claude-opus-5-5", tier: "high" } }).name;
  const pin = (ref: string, candidate: string) => cli("pin", ref, candidate, "--by", BY, "--at", AT);
  return { root, consumer, cli, submit, pin, readJson };
}

/** The owner picks producer/loop.cascade cascade-v2.json; every agent's own loop.cascade is recertified against it. */
function pinCascadeV2(root: string): void {
  const packaged = JSON.parse(readFileSync(join(PRODUCER_ROOT, "loops", "loop.cascade", "cascade-v2.json"), "utf8")) as { content: { steps: { id: string; cli: string }[]; exit: unknown } };
  const name = "cascade-v2.json";
  const header = buildCandidateHeader({ agent: "producer", slotId: "loop.cascade", name, createdBy: { actor: "planner", ref: "test" }, createdAt: AT, source: { kind: "original", ref: [] } });
  const sha256 = writeCandidateFile(candidatePath(root, "producer", "loop.cascade", name), serializeCandidate(name, header, packaged.content));
  const id = "20261126T1200Z-loop-cascade";
  writePinDoc(pinPath(root, "producer", "loop.cascade"), buildPin({ agent: "producer", slotId: "loop.cascade", record: { candidate: name, sha256, decidedBy: `owner:queue.pick#${id}`, basis: "picked", at: AT }, refs: [{ to: "producer/queue.pick" as never, record: id, rel: "answers" }], createdBy: cliActor("clossys pin") }));
  const current = currentStandardOf(root, "loop.cascade");
  if (!current.ok) throw new Error(current.reason);
  const rerender = packaged.content.steps.find(step => step.id === "rerender")!;
  // Every agent's own loop.cascade extends the standard, so each is recertified: its v1 steps plus rerender, the new exit.
  for (const agent of ["designer", "director", "publisher", "writer"] as const) {
    const own = JSON.parse(readFileSync(join(root, "clossys", "agents", agent, "loop.cascade", "candidates", "cascade-v1.json"), "utf8")) as { content: { steps: { id: string }[] } };
    const steps = [...own.content.steps];
    steps.splice(steps.findIndex(step => step.id === "reverdict") + 1, 0, rerender);
    const ownHeader = buildCandidateHeader({ agent, slotId: "loop.cascade", name, createdBy: { actor: "planner", ref: "test" }, createdAt: AT, source: { kind: "original", ref: [] } });
    const ownSha = writeCandidateFile(candidatePath(root, agent, "loop.cascade", name), serializeCandidate(name, ownHeader, { ...own.content, steps, exit: packaged.content.exit }));
    writePinDoc(pinPath(root, agent, "loop.cascade"), buildPin({ agent, slotId: "loop.cascade", record: { candidate: name, sha256: ownSha, decidedBy: BY, basis: "planner", at: AT }, refs: [certifiedStandardRef(current.file)], createdBy: cliActor("clossys pin") }));
  }
}

const indexOf = (root: string, slot: string, stem: string) => JSON.parse(readFileSync(join(root, "clossys", ".state", "renders", "designer", slot, stem, "index.json"), "utf8")) as { inputsSha256: string; ref: string };

describe("loop.cascade v2: the rerender step (CP1-L1)", () => {
  it("a theme repin re-renders its Designer dependants (new render index sha256) and re-installs the published page that places them", async () => {
    const w = world();
    const ok = (result: { exitCode: number; message: string; args: string[] }) => expect(result.exitCode, `clossys ${result.args.join(" ")}: ${result.message}`).toBe(0);
    ok(await w.pin("writer/sections.hero.copy#copy", w.submit("writer", "sections.hero.copy", "copy", COPY)));
    // The page is pinned as a published page record (the fixture's page.home declares no contract fixture, so its own
    // gate verdict is no part of this test): the rerender step reads which frame and sections the pinned page places.
    const page = writeCandidate(w.consumer, "publisher", "page.home", "home", PAGE, { at: AT, provenance: { by: "agent:publisher", model: "claude-opus-5-5", tier: "high" } });
    writePinDoc(pinPath(w.root, "publisher", "page.home"), buildPin({ agent: "publisher", slotId: "page.home", record: { candidate: page.name, sha256: page.sha256, decidedBy: BY, basis: "planner", at: AT }, refs: [], createdBy: cliActor("clossys pin") }));
    pinCascadeV2(w.root);

    // Rendered once, and published once (the report keeps the selection the page mounted in).
    const snapshot = fakeSnapshot(w.root);
    for (const slot of DEPENDANTS) expect((await runRenderCli([`designer/${slot}`, "--root", w.root], w.root, snapshot)).exitCode).toBe(0);
    const before = indexOf(w.root, "frames.site-shell", "site-shell-v1").inputsSha256;
    const out = defaultInstallOut(w.root, "home");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, INSTALL_MARKER), "clossys publish --install output\n");
    writeFileSync(join(out, "install-report.json"), `${JSON.stringify({ page: "home", installed: [], findings: [], selection: { module: join(w.root, "selection.tsx"), export: "Selection" } }, null, 2)}\n`);

    // The theme the frame takes as input is repinned.
    const v1 = w.readJson(join(w.consumer, "agents", "designer", "themes.primary", "candidates", "primary-v1.json"));
    const changed = JSON.parse(JSON.stringify(v1.content).replaceAll("oklch(0.205 0 0)", "oklch(0.3 0.1 250)"));
    changed.meta = { ...changed.meta, source: v1.clossys.source };
    ok(await w.pin("designer/themes.primary", w.submit("designer", "themes.primary", "primary", changed)));

    // The cascade: real verbs, except render's harness and the install's shadcn/npm (recorded instead).
    const installs: string[][] = [];
    const run = async (argv: readonly string[], cwd: string): Promise<CliResult> => {
      if (argv[0] === "render") return runRenderCli(argv.slice(1), cwd, snapshot);
      if (argv[0] === "publish" && argv.includes("--install")) { installs.push([...argv]); return { exitCode: 0, message: "Installed: 0" }; }
      return runCli(argv, cwd);
    };
    const result = await runLoopCli(["loop.cascade", "--slot", "designer/themes.primary", "--root", w.root], w.root, { run });
    expect(result.exitCode, result.message).toBe(0);
    expect(result.message).toMatch(/cascade-v2\.json/);
    const runId = /run (\S+)/.exec(result.message)![1]!;
    const ledger = w.readJson(join(w.consumer, "agents", "producer", "ledger.cascade", "entries", `${runId}.json`)) as { loopVersion: string; steps: { id: string; exit: number; cli: string; decider: { by: string } }[] };
    expect(ledger.loopVersion).toBe("cascade-v2.json");
    expect(ledger.steps.map(step => `${step.id}:${step.decider.by}:${step.exit}`)).toEqual(["reverdict:code:0", "rerender:code:0", "accept:code:0"]);
    expect(ledger.steps[1]!.cli).toBe(RERENDER_CLI);

    // Each dependant's render index is the pin-set it is judged on now: a new inputsSha256.
    expect(indexOf(w.root, "frames.site-shell", "site-shell-v1").inputsSha256).not.toBe(before);
    // The page was installed again, with its selection, and left the stale list.
    expect(installs).toEqual([["publish", "--install", "--page", "home", "--selection", `${join(w.root, "selection.tsx")}#Selection`, "--root", w.root]]);
    expect(readStalePages(w.root).pages).toEqual({});
  }, 300_000);
});
