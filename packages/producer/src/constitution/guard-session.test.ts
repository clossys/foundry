/**
 * The guard session (U29c): a run's guards carry one context and re-read only the folders the run wrote
 * (refreshContext), so a pin reads the tree once (its CHOOSE gate's read) instead of twice, and `clossys migrate
 * slots` once instead of once per folder. The rows judged must be the rows a fresh read gives: these tests compare
 * the refreshed context with a fresh buildContext, and every guard a real pin and a real migrate run with the same
 * guard run fresh, on temp copies of `test-fixtures/consumer` and `test-fixtures/consumer-legacy-tree` (copied as
 * is; the fixtures stay byte-identical).
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { buildContext, refreshContext } from "./context.js";
import { guardMessages, runGuard, type GuardOptions, type GuardTarget } from "./guard.js";
import type { ConstitutionContext, Row } from "./types.js";
import { registerGuardRunner, writeCandidate, type GuardVerb } from "../records/slot-write.js";
import { ownerEntry } from "../cli/__fixtures__/owner-entry.js";
import { pinUpstream } from "../cli/__fixtures__/upstream.js";
import { runPinCli } from "../cli/pin.js";
import { applySlotsMigration, planSlotsMigration } from "../migrate/slots.js";

// Each comparison runs the guard twice (with the session and fresh) over a whole fixture consumer.
vi.setConfig({ testTimeout: 300_000 });

const FIXTURES = fileURLToPath(new URL("../../test-fixtures/", import.meta.url));
const AT = "2026-11-17T12:00:00Z";
const COPY = (heading: string) => `---
slot: "sections.hero.copy"
locales: ["en"]
reason: "realises director:advantage.proposition.promise for the hero"
source: {"kind":"derived","ref":["director:identity.verbal.voice","director:advantage.proposition.promise","director:identity.naming.name"]}
provenance: {"voice":"director:identity.verbal.voice"}
---

## en
### header.heading
<!-- {"id":"header.heading","bindings":[]} -->
${heading}
### actions.primary.label
<!-- {"id":"actions.primary.label","bindings":[]} -->
Get started
`;
const SUBMIT = { at: AT, provenance: { by: "agent:writer", model: "claude-opus-5-5", tier: "high" } } as const;
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
// The comparing runner below wraps the real one; every test leaves the real one registered.
afterEach(() => registerGuardRunner({ run: runGuard, messages: guardMessages }));

function copyOf(fixture: string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "guard-session-")));
  roots.push(root);
  cpSync(join(FIXTURES, fixture), root, { recursive: true });
  return { root, consumer: join(root, "clossys") };
}

/** A context's records, without its reader functions (history, Foundry leaves, skill shas, action kinds). */
function records(ctx: ConstitutionContext) {
  const { history: _history, foundryLeaves: _leaves, skillShas: _skills, actionKind: _kinds, ...rest } = ctx;
  return { ...rest, order: ctx.agents.map(agent => [agent.agent, [...agent.slots.keys()]]) };
}

interface Compared { readonly verb: GuardVerb; readonly targets: readonly GuardTarget[]; readonly session: boolean; readonly kept: boolean; readonly rows: readonly Row[]; readonly fresh: readonly Row[] }
/** Registers a runner that runs every guard as given and again fresh (no session), recording both row lists. */
function comparingRunner(): Compared[] {
  const compared: Compared[] = [];
  registerGuardRunner({
    run: (consumer: string, verb: GuardVerb, targets: readonly GuardTarget[], options: GuardOptions) => {
      const session = options.session?.context !== undefined;
      const rows = runGuard(consumer, verb, targets, options);
      const { session: _session, ...plain } = options;
      const fresh = runGuard(consumer, verb, targets, plain);
      compared.push({ verb, targets, session, kept: options.session?.context !== undefined, rows, fresh });
      return rows;
    },
    messages: guardMessages,
  });
  return compared;
}

describe("refreshContext: the tree as a fresh read gives it", () => {
  it("re-reads the changed folders, new and removed folders and the agent-level files; keeps the rest", () => {
    const { root, consumer } = copyOf("consumer");
    const base = buildContext(root, consumer);
    const agents = join(consumer, "agents");
    // A changed folder: a candidate submitted through the writer (candidate file and slot ledger event).
    writeCandidate(consumer, "writer", "sections.hero.copy", "copy", COPY("Ship your site this week"), SUBMIT);
    // A designer folder written by hand: a placed candidate and an unreadable pin.
    const designer = join(agents, "designer");
    const held = readdirSync(designer).sort().find(name => existsSync(join(designer, name, "slot.json")))!;
    mkdirSync(join(designer, held, "candidates"), { recursive: true });
    writeFileSync(join(designer, held, "candidates", "item-v1.json"), `${JSON.stringify({ name: "item", type: "registry:item", files: [] }, null, 2)}\n`);
    writeFileSync(join(designer, held, "pin.json"), "{ not json");
    // A folder the base does not hold, and one removed.
    const director = join(agents, "director");
    const slots = readdirSync(director).filter(name => existsSync(join(director, name, "slot.json"))).sort();
    cpSync(join(director, slots[0]!), join(director, "zz.session.probe"), { recursive: true });
    rmSync(join(director, slots[1]!), { recursive: true });
    // The Writer ia.json places one slot fewer: that unchanged folder's `live` flips.
    const iaFile = join(agents, "writer", "ia.json");
    const ia = JSON.parse(readFileSync(iaFile, "utf8")) as { nodes: { children: { slots: string[] }[] }[] };
    const placed = ia.nodes.flatMap(node => node.children).find(child => child.slots.some(id => id !== "sections.hero.copy"))!;
    const unplaced = placed.slots.find(id => id !== "sections.hero.copy")!;
    placed.slots = placed.slots.filter(id => id !== unplaced);
    writeFileSync(iaFile, `${JSON.stringify(ia, null, 2)}\n`);

    const changed = [{ agent: "writer", slot: "sections.hero.copy" }, { agent: "designer", slot: held }];
    const fresh = records(buildContext(root, consumer));
    const refreshed = records(refreshContext(base, changed));
    expect(refreshed).toEqual(fresh);
    expect(fresh.agents.find(agent => agent.agent === "writer")!.slots.get(unplaced)?.live).toBe(false);
    expect(fresh.agents.find(agent => agent.agent === "director")!.slots.has("zz.session.probe")).toBe(true);
    // The session's contract is its callers' to keep: a changed folder left out is read as it was.
    expect(records(refreshContext(base, changed.slice(0, 1)))).not.toEqual(fresh);
    expect(records(refreshContext(base, changed.slice(1)))).not.toEqual(fresh);
  });
});

describe("guard rows with the session equal a fresh guard's", () => {
  function pinWorld(upstream: boolean) {
    const { root, consumer } = copyOf("consumer");
    if (upstream) pinUpstream(consumer, "writer", "sections.hero.copy", AT);
    const submitted = writeCandidate(consumer, "writer", "sections.hero.copy", "copy", COPY("Ship your site this week"), SUBMIT);
    const by = ownerEntry(consumer, { id: "20261117T1200Z-hero-copy", about: "writer/sections.hero.copy", answer: { candidate: submitted.name }, at: AT });
    return { root, pin: () => runPinCli(["writer/sections.hero.copy#copy", submitted.name, "--by", by, "--at", AT, "--root", root], root) };
  }

  it("clossys pin: the guard reuses the CHOOSE gate's read, passing and refusing as a fresh guard does", async () => {
    const pass = pinWorld(true);
    let compared = comparingRunner();
    const pinned = await pass.pin();
    expect(pinned.exitCode, pinned.message).toBe(0);
    expect(compared.map(each => [each.verb, each.session, each.kept, each.rows.length])).toEqual([["pin", true, true, 0]]);
    expect(compared[0]!.rows).toEqual(compared[0]!.fresh);

    // Upstream unpinned: the gate passes, the guard refuses (R02.2); the session is cleared on the refusal.
    const refuse = pinWorld(false);
    compared = comparingRunner();
    const refused = await refuse.pin();
    expect(refused.exitCode).toBe(1);
    expect(compared.map(each => [each.verb, each.session, each.kept])).toEqual([["pin", true, false]]);
    expect(compared[0]!.rows.length).toBeGreaterThan(0);
    expect(compared[0]!.rows).toEqual(compared[0]!.fresh);
  });

  it("a write the guard refuses is refused with the session: rows read from the folder the write changed", () => {
    const { root, consumer } = copyOf("consumer");
    pinUpstream(consumer, "writer", "sections.hero.copy", AT);
    const session = { context: buildContext(root, consumer) };
    // Written after the session's read: a candidate placed by hand (no submit record) and the pin naming it.
    const dir = join(consumer, "agents", "writer", "sections.hero.copy");
    mkdirSync(join(dir, "candidates"), { recursive: true });
    writeFileSync(join(dir, "candidates", "copy-v1.md"), COPY("Placed by hand"));
    writeFileSync(join(dir, "pin.json"), "{ not json");
    const targets: GuardTarget[] = [{ agent: "writer", slot: "sections.hero.copy", candidate: "copy-v1.md", records: ["clossys/agents/writer/sections.hero.copy/pin.json", "clossys/agents/writer/sections.hero.copy/slot.json"] }];
    for (const verb of ["pin", "submit"] as const) {
      const fresh = runGuard(consumer, verb, targets, { root });
      const held = { context: session.context };
      const rows = runGuard(consumer, verb, targets, { root, session: held });
      expect(fresh.length, verb).toBeGreaterThan(0);
      expect(rows, verb).toEqual(fresh);
      expect(held.context, verb).toBeUndefined();
    }
  });

  it("clossys migrate slots: one read for the run, every folder's rows as a fresh guard gives them", () => {
    const { root } = copyOf("consumer-legacy-tree");
    const options = { at: "2026-11-18T09:12:00Z", version: "0.0.0-test" };
    const plan = planSlotsMigration(root, options);
    expect(plan.findings).toEqual([]);
    const folders = new Set(plan.changes.map(change => change.file.split("/").slice(0, 3).join("/")));
    const compared = comparingRunner();
    applySlotsMigration(root, plan, options);
    expect(compared).toHaveLength(folders.size);
    expect(compared.map(each => each.session)).toEqual(compared.map((_, index) => index > 0));
    expect(compared.every(each => each.verb === "migrate" && each.kept)).toBe(true);
    for (const each of compared) expect(each.rows, `${each.targets[0]!.agent}/${each.targets[0]!.slot}`).toEqual(each.fresh);
  });
});
