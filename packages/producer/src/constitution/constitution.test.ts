import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../cli/args.js";
import { buildContext } from "./context.js";
import { readRules, registeredRules, RULE_MODULES } from "./registry.js";
import { formatReport, runConstitution } from "./run.js";
import { constitutionSchema, SCHEMA_NAMES, validateSchema } from "./schema.js";
import { cleanSpec, contextOf, expectCatches, writeWorkspace, NO_HISTORY } from "./__fixtures__/workspace.js";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const IDS = Array.from({ length: 14 }, (_, index) => `R${String(index + 1).padStart(2, "0")}`);
const ENFORCED = ["R04", "R06", "R07", "R08", "R09", "R10", "R11", "R13"];

describe("constitution registry", () => {
  it("rules.json lists R01-R14 once each, scope all-records, with existing module and test paths", () => {
    const rules = readRules();
    expect(rules.map(rule => rule.id)).toEqual(IDS);
    for (const rule of rules) {
      expect(rule.scope).toBe("all-records");
      expect(rule.statement.length).toBeGreaterThan(20);
      expect(existsSync(`${packageRoot}${rule.check}`), rule.check).toBe(true);
      expect(existsSync(`${packageRoot}${rule.test}`), rule.test).toBe(true);
    }
    expect(rules.filter(rule => rule.status === "enforced").map(rule => rule.id)).toEqual(ENFORCED);
  });

  it("joins rules.json to the modules strictly both ways", () => {
    expect(registeredRules().map(rule => rule.run.length)).toEqual(readRules().map(rule => rule.checks.length));
    const [first, ...rest] = RULE_MODULES;
    expect(() => registeredRules(readRules(), [{ ...first!, checks: { ...first!.checks, "R01.99": () => [] } }, ...rest])).toThrow(/R01.99 is missing from rules.json/);
    expect(() => registeredRules(readRules(), rest)).toThrow(/R01 has no module/);
    expect(() => registeredRules(readRules().slice(1))).toThrow(/module R01 is missing from rules.json/);
  });

  it("every pending check reports a pending row naming its owner; no enforced check is a stub", () => {
    const ctx = contextOf(cleanSpec());
    for (const rule of registeredRules()) for (const check of rule.run) {
      const rows = check.fn(ctx);
      if (check.status === "pending") expect(rows, check.id).toEqual([expect.objectContaining({ pending: true, reason: expect.stringMatching(/^pending: owned by unit /) })]);
      else expect(rows.some(row => row.pending), check.id).toBe(false);
    }
  });

  it("mutation proof: a disabled check (() => []) fails the failing-first contract every rule test uses", () => {
    const clean = contextOf(cleanSpec());
    const spec = cleanSpec();
    spec.designer!["ui.button"]!.pin = false;
    const broken = contextOf(spec);
    const r04 = RULE_MODULES.find(module => module.rule === "R04")!.checks.R04!;
    expect(expectCatches(r04, clean, broken)).toHaveLength(1);
    expect(() => expectCatches(() => [], clean, broken)).toThrow(/silent on the broken workspace/);
    expect(() => expectCatches(r04, broken, broken)).toThrow(/flags the clean workspace/);
  });
});

describe("constitution runner", () => {
  it("fails a clean workspace while any rule is pending, and says so", () => {
    const { root, consumer } = writeWorkspace(cleanSpec());
    const report = runConstitution({ root, consumer, history: () => NO_HISTORY, now: () => 0 });
    expect(report.ok).toBe(false);
    expect(report.total).toBe(report.pending);
    expect(report.pending).toBeGreaterThan(0);
    expect(report.records).toEqual({ slots: 6, liveSlots: 6, pins: 6, candidates: 6 });
    const text = formatReport(report);
    expect(text).toMatch(/^R01 PENDING {2}rows 6/m);
    expect(text).toMatch(/^R04 ok {2}rows 0$/m);
    expect(text).toMatch(/constitution: FAIL {2}rows \d+ \(pending \d+, findings 0\)/);
  });

  it("passes an enforced rule alone on a clean workspace and fails it on a broken one, with counts by agent and check", () => {
    const { root, consumer } = writeWorkspace(cleanSpec());
    expect(runConstitution({ root, consumer, rule: "R04", history: () => NO_HISTORY })).toMatchObject({ ok: true, total: 0 });
    const spec = cleanSpec();
    spec.designer!["ui.button"]!.pin = false;
    spec.producer!.director!.pin = false;
    const bad = writeWorkspace(spec);
    const report = runConstitution({ root: bad.root, consumer: bad.consumer, rule: "R04", history: () => NO_HISTORY });
    expect(report).toMatchObject({ ok: false, total: 2, pending: 0 });
    expect(report.rules).toEqual([expect.objectContaining({ id: "R04", rows: 2, byAgent: { designer: 1, producer: 1 }, byCheck: { R04: 2 } })]);
    expect(formatReport(report)).toMatch(/^R04 FAIL {2}rows 2 {2}\(designer 1, producer 1; R04 2\)/m);
  });

  it("refuses an unknown rule", () => {
    const { root, consumer } = writeWorkspace(cleanSpec());
    expect(() => runConstitution({ root, consumer, rule: "R15" })).toThrow(/Unknown constitution rule R15/);
  });

  it("is deterministic: the same records give the same rows", () => {
    const { root, consumer } = writeWorkspace(cleanSpec());
    const once = runConstitution({ root, consumer, history: () => NO_HISTORY, now: () => 0 });
    const twice = runConstitution({ root, consumer, history: () => NO_HISTORY, now: () => 0 });
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    expect(buildContext(root, consumer).agents.map(agent => agent.agent)).toEqual(["director", "designer", "writer", "publisher", "producer"]);
  });
});

describe("constitution schemas", () => {
  it("loads every schema and rejects unknown keywords", () => {
    for (const name of SCHEMA_NAMES) expect(constitutionSchema(name)).toBeTypeOf("object");
    expect(() => validateSchema({ type: "string", format: "date" }, "x")).toThrow(/format/);
  });

  it("validates $ref, anyOf, oneOf and not", () => {
    const schema = { $defs: { id: { type: "string", pattern: "^[a-z]+$" } }, type: "object", properties: { id: { $ref: "#/$defs/id" } }, not: { required: ["bad"] } };
    expect(validateSchema(schema, { id: "abc" })).toEqual([]);
    expect(validateSchema(schema, { id: "ABC" }).length).toBe(1);
    expect(validateSchema(schema, { id: "abc", bad: 1 }).length).toBe(1);
    expect(validateSchema({ oneOf: [{ type: "string" }, { minLength: 0, type: "string" }] }, "x").length).toBe(1);
    expect(validateSchema({ anyOf: [{ type: "number" }, { type: "string" }] }, "x")).toEqual([]);
  });
});

describe("clossys check --constitution arguments", () => {
  it("parses --constitution and --rule on check", () => {
    expect(parseArgs(["check", "--constitution", "--rule", "R04", "--json"])).toMatchObject({ verb: "check", constitution: true, rule: ["R04"], json: true });
  });

  it("accumulates repeated --rule flags, and the runner runs every named rule", () => {
    expect(parseArgs(["check", "--constitution", "--rule", "R11", "--rule", "R13", "--strict"])).toMatchObject({ constitution: true, rule: ["R11", "R13"] });
    expect(() => parseArgs(["check", "--constitution", "--rule", "R11", "--rule", "R15"])).toThrow(/R01..R14/);
    const { root, consumer } = writeWorkspace(cleanSpec());
    const report = runConstitution({ root, consumer, rule: ["R04", "R09"], history: () => NO_HISTORY });
    expect(report.rules.map(rule => rule.id)).toEqual(["R04", "R09"]);
    expect(parseArgs(["check"])).toMatchObject({ constitution: false });
  });

  it("refuses --constitution off check, --rule without --constitution and an unknown rule id", () => {
    expect(() => parseArgs(["publish", "--constitution"])).toThrow(/--constitution requires check/);
    expect(() => parseArgs(["check", "--rule", "R04"])).toThrow(/--rule requires check --constitution/);
    expect(() => parseArgs(["check", "--constitution", "--rule", "R15"])).toThrow(/R01..R14/);
  });
});
