/**
 * DET-STEPS round 2, planner D5 "Adopt = A": code authors a candidate (`code:adopt`) only in a slot whose contract
 * adopts byte-exact, and only the source-ladder stock item, unmodified; the normal certify gate judges it. The agent
 * creates whenever there is no stock item (or the slot is not code's to author).
 *
 * The world is test-fixtures/consumer: designer/components.checkbox is an empty adopt-first components slot whose
 * contract fixture ships as shadcn-aria/checkbox; components.chart-area has no stock fixture; components.button already
 * holds a candidate; sections.hero is a crafted (not byte-exact) slot.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { buildContext } from "../constitution/index.js";
import { R14 } from "../constitution/checks/R14-provenance.js";
import { r03_2, r03_4 } from "../constitution/rules/r03.js";
import { CODE_ADOPT, CODE_ADOPT_RUNG, codeAdoptRefusal, codeAdoptSlotRefusal, stockItemOf } from "../records/code-adopt.js";
import { PINNED_THEME_READER } from "../read/theme-pins.js";
import { writeCandidate } from "../records/slot-write.js";
import { readLedger } from "../records/slots.js";
import { startRun, type AgentPacket, type CodeCall, type RunHooks } from "./runner.js";
import { runOptionsCli } from "../cli/options.js";
import { packagePath } from "../package-path.js";

const REF_VERBATIM_CLI = fileURLToPath(new URL("../../../designer/scripts/check-ref-verbatim.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const CHECKBOX = "components.checkbox";
/** shadcn-aria/sonner reads --border, --popover, --popover-foreground and --radius bare: every one a fixture theme pin. */
const TOAST = "components.toast";
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function world(): { root: string; consumer: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "code-adopt-")));
  roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  return { root, consumer: join(root, "clossys") };
}

/** loop.create's hooks: `certify` exits as `certify` says; the agent seat's create is recorded and writes nothing. */
function hooks(certify: (call: CodeCall, count: number) => number = () => 0): RunHooks & { readonly agentSteps: string[]; readonly codeSteps: string[] } {
  const agentSteps: string[] = [];
  const codeSteps: string[] = [];
  let certified = 0;
  return {
    agentSteps, codeSteps,
    agent(packet: AgentPacket) { agentSteps.push(packet.step); return { exit: 0, model: "stub-model" }; },
    code(call: CodeCall) { codeSteps.push(call.step); return { exit: call.step === "certify" ? certify(call, certified++) : 0 }; },
  };
}
const settleOf = (root: string, runId: string) => JSON.parse(readFileSync(join(root, "clossys", ".state", "runs", "loops", `${runId}.settle`, "adopt.json"), "utf8"));
const clock = () => { let tick = 0; return () => new Date(Date.parse("2026-11-21T12:30:00Z") + 1000 * tick++); };
const candidatesOf = (consumer: string, slotId: string): string[] => {
  const dir = join(consumer, "agents", "designer", slotId, "candidates");
  return existsSync(dir) ? (readLedger(join(consumer, "agents", "designer", slotId), "slot")!.events.filter(event => event.verb === "submit").map(event => String(event.name))) : [];
};

describe("the code:adopt slot rule and stock item", () => {
  it("names the checkbox's stock item and refuses crafted, consumer-asset and non-Designer slots", () => {
    const { root } = world();
    expect(codeAdoptSlotRefusal(root, "designer", CHECKBOX)).toBeUndefined();
    const found = stockItemOf(root, CHECKBOX);
    expect("stock" in found && found.stock.ref).toMatch(/^shadcn-aria\/checkbox@/);
    expect(codeAdoptSlotRefusal(root, "designer", "sections.hero")).toMatch(/is not a byte-exact adopt slot: it is not of the components layer/);
    expect(codeAdoptSlotRefusal(root, "writer", "voice.tone")).toMatch(/only a Designer components slot adopts byte-exact/);
    expect(stockItemOf(root, "components.chart-area")).toMatchObject({ none: expect.stringMatching(/no shadcn-aria or diceui stock item ships|has no contract fixture file/) });
  });
});

describe("writeCandidate --by code:adopt: code authors only the stock item of a byte-exact adopt slot", () => {
  it("refuses a code-authored candidate in a non-byte-exact slot (mutation 3), and writes nothing", () => {
    const { root, consumer } = world();
    const found = stockItemOf(root, CHECKBOX);
    if (!("stock" in found)) throw new Error(found.none);
    const { stock } = found;
    const fields = { basis: "code", rung: CODE_ADOPT_RUNG, seed: stock.seed, ladder: { rung: CODE_ADOPT_RUNG, seed: stock.seed } };
    const before = readFileSync(join(consumer, "agents", "designer", "sections.hero", "ledger.json"), "utf8");
    expect(() => writeCandidate(consumer, "designer", "sections.hero", "hero", { ...stock.item, meta: { ...stock.item.meta, slot: "sections.hero" } }, {
      at: "2026-11-21T12:00:00Z", provenance: { verb: "submit", by: CODE_ADOPT }, fields,
    })).toThrow(/--by code:adopt: designer\/sections\.hero is not a byte-exact adopt slot/);
    expect(readFileSync(join(consumer, "agents", "designer", "sections.hero", "ledger.json"), "utf8")).toBe(before);
  });

  it("refuses a code adopt whose bytes are not the stock item's, or whose rung or seed is not the stock rung's", () => {
    const { root, consumer } = world();
    const found = stockItemOf(root, CHECKBOX);
    if (!("stock" in found)) throw new Error(found.none);
    const { stock } = found;
    const fields = { basis: "code", rung: CODE_ADOPT_RUNG, seed: stock.seed };
    const edited = { ...stock.item, files: stock.item.files.map((file, index) => index === 0 ? { ...file, content: `${file.content}// edited\n` } : file) };
    expect(codeAdoptRefusal(root, "designer", CHECKBOX, edited, fields)).toMatch(/is not byte-exact/);
    expect(codeAdoptRefusal(root, "designer", CHECKBOX, stock.item, { ...fields, rung: "L2" })).toMatch(/submits rung L1/);
    expect(codeAdoptRefusal(root, "designer", CHECKBOX, stock.item, fields)).toBeUndefined();
    expect(() => writeCandidate(consumer, "designer", CHECKBOX, "checkbox", edited, { at: "2026-11-21T12:00:00Z", provenance: { verb: "submit", by: CODE_ADOPT }, fields })).toThrow(/is not byte-exact/);
    expect(candidatesOf(consumer, CHECKBOX)).toEqual([]);
  });

  it("R03.2 flags a ledger submit by code:adopt into a slot code may not author", () => {
    const { root, consumer } = world();
    const found = stockItemOf(root, CHECKBOX);
    if (!("stock" in found)) throw new Error(found.none);
    const codeRows = () => r03_2(buildContext(root, consumer)).filter(row => /submitted by code:adopt/.test(row.reason));
    expect(codeRows()).toEqual([]);
    // A planner-written candidate whose submit event names code:adopt as its author, in a crafted slot.
    writeCandidate(consumer, "designer", "sections.hero", "hero", { $schema: "https://ui.shadcn.com/schema/registry-item.json", name: "hero", type: "registry:block", files: [{ path: "hero.tsx", type: "registry:block", content: "export function Hero() { return <section />; }\n" }], meta: { slot: "sections.hero", source: { kind: "original", ref: [] } } }, { at: "2026-11-21T12:00:00Z", provenance: { verb: "submit", by: "planner" } });
    const ledgerFile = join(consumer, "agents", "designer", "sections.hero", "ledger.json");
    const ledger = JSON.parse(readFileSync(ledgerFile, "utf8"));
    ledger.events.at(-1).by = CODE_ADOPT;
    ledger.events.at(-1).rung = CODE_ADOPT_RUNG;
    ledger.events.at(-1).seed = found.stock.seed;
    writeFileSync(ledgerFile, `${JSON.stringify(ledger, null, 2)}\n`);
    const rows = codeRows();
    expect(rows.map(row => `${row.agent}/${row.slot}: ${row.reason}`).join("\n")).toMatch(/^designer\/sections\.hero: submitted by code:adopt where code may not author: designer\/sections\.hero is not a byte-exact adopt slot/);
  }, 60_000);
});

describe("loop.create's adopt step (clossys settle adopt): code installs the stock item, or the agent creates", () => {
  it("settles create in an empty adopt slot: the stock item is submitted by code:adopt at L1, certify judges it, the agent never creates", async () => {
    const { root, consumer } = world();
    const h = hooks();
    const run = await startRun(root, { loop: "loop.create", slot: `designer/${CHECKBOX}` }, h, { now: clock() });
    expect(run.state, run.message).toBeDefined();
    const settle = settleOf(root, run.state!.runId);
    expect(settle).toMatchObject({ schema: "clossys.settle/1", rule: "adopt", outcome: "settled", settles: ["create"], answer: expect.stringMatching(/^adopt shadcn-aria\/checkbox@/) });
    expect(h.agentSteps).not.toContain("create");
    expect(h.codeSteps).toContain("certify");
    const submits = readLedger(join(consumer, "agents", "designer", CHECKBOX), "slot")!.events.filter(event => event.verb === "submit");
    expect(submits).toEqual([expect.objectContaining({ by: CODE_ADOPT, model: "none", tier: "none", basis: "code", rung: CODE_ADOPT_RUNG, seed: "shadcn-aria/checkbox", name: "checkbox-v1.json" })]);
    // R03 (rung, byte-exact adopt) and R14 (provenance: verb, skill, model none for code) find nothing on the slot.
    const ctx = buildContext(root, consumer);
    expect([...r03_2(ctx), ...r03_4(ctx), ...Object.values(R14.checks).flatMap(check => check(ctx))].filter(row => row.slot === CHECKBOX)).toEqual([]);
  }, 60_000);

  it("a failed certify sends the run back to the agent's create: the settle is cleared and the agent creates", async () => {
    const { root } = world();
    const h = hooks((_call, count) => count === 0 ? 1 : 0);
    const run = await startRun(root, { loop: "loop.create", slot: `designer/${CHECKBOX}` }, h, { now: clock() });
    expect(run.state, run.message).toBeDefined();
    expect(h.codeSteps.filter(step => step === "certify").length).toBeGreaterThanOrEqual(1);
    // The adopt step settled create and code submitted the stock item; certify refused it, so the retry cleared the
    // settle and the agent's create ran (the agent seat, not code, makes the next candidate).
    expect(settleOf(root, run.state!.runId)).toMatchObject({ rule: "adopt", outcome: "settled", settles: ["create"] });
    expect(h.codeSteps.indexOf("certify")).toBeGreaterThan(-1);
    expect(h.agentSteps).toContain("create");
    expect(run.state!.settled?.create).toBeUndefined();
  }, 60_000);

  it("clossys options --reference prints the files the adopt step writes, byte for byte, plus the step skill text", async () => {
    const { root, consumer } = world();
    const shown = await runOptionsCli([`designer/${CHECKBOX}`, "--reference", "--json"], root);
    expect(shown.exitCode, shown.message).toBe(0);
    const output = shown.output as { reference: string; item: { files: { path: string; content: string }[] }; adopt: { byCode: boolean; run: string }; skill: { path: string; text: string } };
    expect(output.adopt).toMatchObject({ byCode: true, run: `clossys run loop.create --slot designer/${CHECKBOX}` });
    expect(output.skill.text).toBe(readFileSync(packagePath(root, output.skill.path), "utf8"));
    expect(shown.message).toContain(output.skill.text);
    // The adopt path itself (loop.create's clossys settle adopt step) then writes the candidate: its files are the printed ones.
    const run = await startRun(root, { loop: "loop.create", slot: `designer/${CHECKBOX}` }, hooks(), { now: clock() });
    expect(run.state, run.message).toBeDefined();
    const written = JSON.parse(readFileSync(join(consumer, "agents", "designer", CHECKBOX, "candidates", "checkbox-v1.json"), "utf8")) as { content: { files: { path: string; content: string }[] } };
    expect(written.content.files.length).toBeGreaterThan(0);
    expect(output.item.files.map(file => [file.path, Buffer.from(file.content, "utf8").toString("hex")]))
      .toEqual(written.content.files.map(file => [file.path, Buffer.from(file.content, "utf8").toString("hex")]));
    for (const file of written.content.files) expect(shown.message).toContain(`--- file ${file.path}\n${file.content}\n`);
    // No stock item, or another agent's slot, refuses: there is no fallback reference.
    expect(await runOptionsCli(["designer/components.chart-area", "--reference"], root)).toMatchObject({ exitCode: 1, message: expect.stringMatching(/has no reference item/) });
    expect(await runOptionsCli(["writer/page.about.meta", "--reference"], root)).toMatchObject({ exitCode: 1, message: expect.stringMatching(/reads a Designer slot's stock item/) });
  }, 60_000);

  it("hands create to the agent with no stock item (chart-area) or a held candidate (button), and writes nothing", async () => {
    for (const slotId of ["components.chart-area", "components.button"]) {
      const { root, consumer } = world();
      const held = candidatesOf(consumer, slotId);
      const h = hooks();
      const run = await startRun(root, { loop: "loop.create", slot: `designer/${slotId}` }, h, { now: clock() });
      expect(run.state, run.message).toBeDefined();
      expect(settleOf(root, run.state!.runId), slotId).toMatchObject({ rule: "adopt", outcome: "agent", settles: [], why: expect.stringMatching(/the agent creates$/) });
      expect(h.agentSteps).toContain("create");
      expect(candidatesOf(consumer, slotId)).toEqual(held);
    }
  }, 60_000);
});

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
/** Re-pin `themes.<name>` after `edit` changes its candidate item: the candidate's bytes and the pin's sha256 move together. */
function repinTheme(consumer: string, name: string, edit: (item: { cssVars: Record<string, Record<string, string>> }) => void): void {
  const dir = join(consumer, "agents", "designer", `themes.${name}`);
  const pinFile = join(dir, "pin.json");
  const pin = JSON.parse(readFileSync(pinFile, "utf8"));
  const file = join(dir, "candidates", pin.candidate);
  const doc = JSON.parse(readFileSync(file, "utf8"));
  edit(doc.content ?? doc);
  const bytes = `${JSON.stringify(doc, null, 2)}\n`;
  writeFileSync(file, bytes);
  writeFileSync(pinFile, `${JSON.stringify({ ...pin, sha256: sha256(bytes) }, null, 2)}\n`);
}
const toastStock = (root: string) => {
  const found = stockItemOf(root, TOAST);
  if (!("stock" in found)) throw new Error(found.none);
  return found.stock;
};
const adoptFields = (seed: string) => ({ basis: "code", rung: CODE_ADOPT_RUNG, seed, ladder: { rung: CODE_ADOPT_RUNG, seed } });

describe("a consumer adoption writes the consumer's pinned theme values as its token fallbacks (D5-2D)", () => {
  it("every bare read of the stock item carries the consumer's pinned value, and the record names the reader and output sha", () => {
    const { root } = world();
    expect(codeAdoptSlotRefusal(root, "designer", TOAST)).toBeUndefined();
    const stock = toastStock(root);
    expect(stock.ref).toMatch(/^shadcn-aria\/sonner@/);
    const [file] = stock.item.files;
    for (const [name, value] of [["--border", "oklch(0.922 0 0)"], ["--popover", "oklch(1 0 0)"], ["--popover-foreground", "oklch(0.145 0 0)"], ["--radius", "0.625rem"]]) {
      expect(file!.content).toContain(`var(${name}, ${value})`);
    }
    expect(file!.content).not.toMatch(/var\(--[a-zA-Z0-9_-]+\)/);
    expect(stock.item.meta.refVerbatim).toEqual({ files: { [file!.path]: file!.path }, reader: PINNED_THEME_READER, outputSha256: { [file!.path]: sha256(file!.content) } });
    expect(codeAdoptRefusal(root, "designer", TOAST, stock.item, adoptFields(stock.seed))).toBeUndefined();
  });

  it("follows a changed pin byte-exact, and refuses a hand-edited fallback (mutation 1)", () => {
    const { root, consumer } = world();
    repinTheme(consumer, "radius", item => { item.cssVars.light!.radius = "0.375rem"; });
    const stock = toastStock(root);
    const [file] = stock.item.files;
    expect(file!.content).toContain("var(--radius, 0.375rem)");
    expect(file!.content).not.toContain("0.625rem");
    const fields = adoptFields(stock.seed);
    expect(codeAdoptRefusal(root, "designer", TOAST, stock.item, fields)).toBeUndefined();
    // The written file's fallback hand-changed: the proof against the reference normalized through the same reader fails.
    const edited = { ...stock.item, files: [{ ...file!, content: file!.content.replace("var(--radius, 0.375rem)", "var(--radius, 0.625rem)") }] };
    expect(codeAdoptRefusal(root, "designer", TOAST, edited, fields)).toMatch(/is not byte-exact to shadcn-aria\/sonner@[^ ]+'s reference normalized through consumer pinned themes/);
    // The recorded reader or output sha must be the adoption's own.
    expect(codeAdoptRefusal(root, "designer", TOAST, { ...stock.item, meta: { ...stock.item.meta, refVerbatim: { ...stock.item.meta.refVerbatim as object, reader: "package declared fallbacks" } } }, fields)).toMatch(/names its fallback reader "consumer pinned themes"/);
    expect(codeAdoptRefusal(root, "designer", TOAST, { ...stock.item, meta: { ...stock.item.meta, refVerbatim: { ...stock.item.meta.refVerbatim as object, outputSha256: { [file!.path]: "0".repeat(64) } } } }, fields)).toMatch(/records .* output sha256/);
  });

  it("refuses the adoption when the pins do not declare a name the stock item reads (mutation 2): no default, no package value", () => {
    const { root, consumer } = world();
    repinTheme(consumer, "radius", item => { delete item.cssVars.light!.radius; });
    expect(() => stockItemOf(root, TOAST)).toThrow(expect.objectContaining({ name: "UndeclaredTokenFallbackError", message: expect.stringContaining("--radius") }));
    expect(codeAdoptRefusal(root, "designer", TOAST, {}, adoptFields("shadcn-aria/sonner"))).toMatch(/stock item cannot be read: .*--radius/);
  });

  it("the submit guard and R03.4 prove a written consumer adoption byte-exact through the same reader", () => {
    const { root, consumer } = world();
    repinTheme(consumer, "popover", item => { item.cssVars.light!.popover = "oklch(0.99 0.01 250)"; });
    const stock = toastStock(root);
    expect(stock.item.files[0]!.content).toContain("var(--popover, oklch(0.99 0.01 250))");
    const written = writeCandidate(consumer, "designer", TOAST, stock.item.name, stock.item, {
      at: "2026-11-21T12:00:00Z", provenance: { verb: "submit", by: CODE_ADOPT }, fields: adoptFields(stock.seed), guard: true,
    });
    const rowsOf = () => r03_4(buildContext(root, consumer)).filter(row => row.slot === TOAST && row.candidate === written.name);
    expect(rowsOf()).toEqual([]);
    // The written file's fallback hand-changed on disk: R03.4's proof through the same reader fails.
    const file = join(consumer, "agents", "designer", TOAST, "candidates", written.name);
    const bytes = readFileSync(file, "utf8");
    expect(bytes).toContain("var(--popover, oklch(0.99 0.01 250))");
    writeFileSync(file, bytes.replace("var(--popover, oklch(0.99 0.01 250))", "var(--popover, oklch(1 0 0))"));
    expect(rowsOf().map(row => row.reason).join("\n")).toMatch(/is adopt-first: .* is not byte-exact to the normalized reference shadcn-aria\/sonner@/);
  }, 60_000);

  it("the designer check:ref-verbatim CLI proves a written consumer adoption through the same reader, and names re-adopt for a pin moved after it", () => {
    const { root, consumer } = world();
    const stock = toastStock(root);
    const written = writeCandidate(consumer, "designer", TOAST, stock.item.name, stock.item, {
      at: "2026-11-21T12:00:00Z", provenance: { verb: "submit", by: CODE_ADOPT }, fields: adoptFields(stock.seed), guard: true,
    });
    // The strict one-candidate mode (the pin gate): this adoption alone, not the fixture's unrelated lockfile rows.
    const [, element, version] = /^(.+)-v(\d+)\.json$/.exec(written.name)!;
    const cli = () => spawnSync(process.execPath, [REF_VERBATIM_CLI, "--root", consumer, "--element", `${TOAST}/${element}/v${version}`, "--report", join(root, "ref-verbatim.json")], { encoding: "utf8" });
    const adopted = cli();
    expect(adopted.status, adopted.stderr).toBe(0);
    expect(adopted.stdout).toMatch(/^pass +components\.toast\//m);
    // N1: the pin moves after the adoption; the unchanged adoption fails byte-exact and the finding names re-adoption.
    repinTheme(consumer, "radius", item => { item.cssVars.light!.radius = "0.375rem"; });
    const moved = cli();
    expect(moved.status).toBe(1);
    expect(moved.stderr).toMatch(/components\.toast\/.*unchanged since adoption, so a pinned theme value changed after it: re-adopt it \(code:adopt the stock item again\)/);
    const rows = r03_4(buildContext(root, consumer)).filter(row => row.slot === TOAST).map(row => row.reason).join("\n");
    expect(rows).toMatch(/is not byte-exact .*; its files are unchanged since adoption, so a pinned theme value changed after it: re-adopt it/);
  }, 60_000);
});

/** Pin `themes.<name>` with a copy of the pinned `themes.<like>` candidate, renamed: the stock sidebar's theme reads pinned. */
function pinThemeLike(consumer: string, like: string, name: string): void {
  const from = join(consumer, "agents", "designer", `themes.${like}`);
  const pin = JSON.parse(readFileSync(join(from, "pin.json"), "utf8"));
  const rename = (text: string) => text.split(like).join(name);
  const bytes = rename(readFileSync(join(from, "candidates", pin.candidate), "utf8"));
  const dir = join(consumer, "agents", "designer", `themes.${name}`);
  mkdirSync(join(dir, "candidates"), { recursive: true });
  writeFileSync(join(dir, "candidates", rename(pin.candidate)), bytes);
  writeFileSync(join(dir, "pin.json"), `${JSON.stringify({ ...pin, id: rename(pin.id), candidate: rename(pin.candidate), sha256: sha256(bytes) }, null, 2)}\n`);
}

describe("CP1-G5: stock shadcn sidebar adopts with its inline-set --sidebar-width-icon", () => {
  for (const slot of ["components.sidebar", "components.navigation-tree"]) {
    it(`${slot}'s stock item keeps --sidebar-width-icon as a runtime-only read and certifies through the submit guard`, () => {
      const { root, consumer } = world();
      for (const name of ["sidebar-border", "sidebar-accent"]) pinThemeLike(consumer, "sidebar-foreground", name);
      expect(codeAdoptSlotRefusal(root, "designer", slot)).toBeUndefined();
      const found = stockItemOf(root, slot);
      if (!("stock" in found)) throw new Error(found.none);
      expect(found.stock.ref).toMatch(/^shadcn-aria\/sidebar@/);
      const content = found.stock.item.files.map(file => file.content).join("\n");
      expect(content).toContain("var(--sidebar-width-icon,unset)");
      expect(content).toContain("var(--sidebar-width,unset)");
      expect(content).not.toMatch(/var\(--[a-zA-Z0-9_-]+\)/);
      expect(codeAdoptRefusal(root, "designer", slot, found.stock.item, adoptFields(found.stock.seed))).toBeUndefined();
      const written = writeCandidate(consumer, "designer", slot, found.stock.item.name, found.stock.item, {
        at: "2026-11-21T12:00:00Z", provenance: { verb: "submit", by: CODE_ADOPT }, fields: adoptFields(found.stock.seed),
      });
      // R03.4 proves the written adoption byte-exact through the same reader (the full submit guard also needs the
      // sidebar's imported slots pinned, R05.1: not this world's).
      expect(r03_4(buildContext(root, consumer)).filter(row => row.slot === slot && row.candidate === written.name)).toEqual([]);
    }, 120_000);
  }
});
