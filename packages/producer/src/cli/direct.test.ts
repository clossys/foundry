import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverBriefContracts, loadCatalog, type CompletionReport } from "@clossys/director";
import { directorStoreReader } from "../records/slots.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { firstPinned, flatConsumer, runVerb, snapshot } from "./__fixtures__/flat-consumer.js";
import { directorReadiness, readinessFindings } from "./direct.js";

let root: string;
beforeEach(() => { root = flatConsumer(["director", "writer"]); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("clossys direct over the flat slot model", () => {
  it("checks, briefs and compiles the pinned Director set without writing into the consumer", () => {
    const before = snapshot(root);
    const check = runVerb(["direct", "--check"], root);
    // Clean only when there is no finding at all, readiness (MVS and handoff) included.
    expect(check.value).toMatchObject({ verb: "direct", root, check: true, limits: [] });
    expect(check.status).toBe(check.value.findings.length ? 1 : 0);
    expect(check.value.exitCode).toBe(check.status);
    expect(check.value.readiness).toMatchObject({ mvs: expect.any(Boolean), handoffs: expect.any(Array) });
    expect(check.value.readiness.handoffs.map((handoff: { contract: string }) => handoff.contract)).toEqual(expect.arrayContaining(["designer.identity", "writer.messaging"]));
    if (!check.value.readiness.mvs) expect(check.value.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "mvs-not-ready" })]));
    for (const handoff of check.value.readiness.handoffs) {
      if (handoff.state !== "ready") expect(check.value.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: `handoff-${handoff.state}`, slot: handoff.contract })]));
    }
    expect(check.value.summary.pinned).toBeGreaterThan(0);
    for (const args of [["direct", "--brief"], ["direct"]]) {
      const result = runVerb(args, root);
      expect(result.status).toBe(0);
      expect((result.value.brief ?? result.value.compilation).slots.length).toBe(check.value.summary.pinned);
    }
    expect(snapshot(root)).toEqual(before);
  }, 60_000);

  it("reports a pinned candidate whose bytes drifted from its pin as a finding", () => {
    const pinned = firstPinned(root, "director");
    writeFileSync(pinned.candidate, readFileSync(pinned.candidate, "utf8") + "\n");
    const result = runVerb(["direct", "--check"], root);
    expect(result.status).toBe(1);
    expect(result.value.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "hash-drift", slot: pinned.id })]));
  }, 60_000);

  it("fails when MVS is not ready: unpinning a core Director cell makes --check exit 1 with the completion finding", () => {
    const core = new Set(loadCatalog().archetypes.default);
    const pinned = firstPinned(root, "director", id => core.has(id));
    rmSync(join(pinned.dir, "pin.json"));
    const result = runVerb(["direct", "--check"], root);
    expect(result.status).toBe(1);
    expect(result.value.readiness.mvs).toBe(false);
    expect(result.value.readiness.coreNotReady).toEqual(expect.arrayContaining([expect.objectContaining({ id: pinned.id, active: false })]));
    expect(result.value.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "mvs-not-ready", slot: "director" }),
      expect.objectContaining({ code: "mvs-core-cell", slot: pinned.id }),
    ]));
    expect(result.value.message).toContain("Readiness: MVS not ready");
  }, 60_000);

  it("fails when a handoff is not ready: unpinning a cell writer.messaging requires reports that brief as missing", () => {
    const director = join(root, "clossys", "agents", "director");
    const contract = discoverBriefContracts(director, directorStoreReader, loadCatalog()).contracts.find(candidate => candidate.id === "writer.messaging");
    expect(contract?.requires.length).toBeGreaterThan(0);
    const required = contract!.requires.find(id => existsSync(join(director, id, "pin.json")));
    expect(required).toBeDefined();
    rmSync(join(director, required!, "pin.json"));
    const result = runVerb(["direct", "--check"], root);
    expect(result.status).toBe(1);
    expect(result.value.readiness.handoffs).toEqual(expect.arrayContaining([expect.objectContaining({ contract: "writer.messaging", state: "missing", missing: expect.arrayContaining([required]) })]));
    expect(result.value.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "handoff-missing", slot: "writer.messaging" })]));
  }, 60_000);

  it("cites evidence only by known finding ids", () => {
    rmSync(join(root, "clossys", "evidence", "director"), { recursive: true, force: true });
    const result = runVerb(["direct", "--check"], root);
    expect([1, 2]).toContain(result.status);
  }, 60_000);

  it("could not run without a Director IA, or through a symbolic link", () => {
    const ia = join(root, "clossys", "agents", "director", "ia.json");
    const bytes = readFileSync(ia);
    rmSync(ia);
    const missing = runVerb(["direct", "--check"], root);
    expect(missing.status).toBe(2);
    expect(missing.value.message).toContain("clossys/agents/director/ia.json is missing");
    writeFileSync(join(root, "ia-target.json"), bytes);
    symlinkSync(join(root, "ia-target.json"), ia);
    expect(runVerb(["direct", "--check"], root).status).toBe(2);
  }, 60_000);

  it("honors --root from another working directory", () => {
    const nested = join(root, "nested"); mkdirSync(nested);
    const result = runVerb(["direct", "--root", "..", "--check"], nested);
    expect(result.value.root).toBe(root);
    expect(result.value.limits).toEqual([]);
    expect(result.status).toBe(result.value.findings.length ? 1 : 0);
  }, 60_000);
});

describe("direct readiness findings (pure)", () => {
  const report = (mvs: boolean): CompletionReport => ({ mvs, core: { cells: [{ id: "identity.brand.name", version: 1, active: mvs, fresh: true, findings: [] }], l0Clean: true, findings: [] } } as unknown as CompletionReport);
  const brief = (state: "ready" | "missing" | "stale") => ({ contract: "writer.messaging", state, missing: state === "missing" ? ["identity.brand.name"] : [], stale: state === "stale" ? [{ cell: "identity.brand.name", version: 1 }] : [] }) as never;

  it("is empty only when MVS is ready and every handoff is ready", () => {
    expect(readinessFindings(directorReadiness(report(true), [brief("ready")]))).toEqual([]);
  });

  it("mutation: flipping MVS to not ready yields the mvs-not-ready finding", () => {
    const findings = readinessFindings(directorReadiness(report(false), [brief("ready")]));
    expect(findings.map(finding => finding.code)).toEqual(["mvs-not-ready", "mvs-core-cell"]);
  });

  it("mutation: a missing or stale handoff yields its handoff finding", () => {
    expect(readinessFindings(directorReadiness(report(true), [brief("missing")]))).toEqual([expect.objectContaining({ code: "handoff-missing", slot: "writer.messaging" })]);
    expect(readinessFindings(directorReadiness(report(true), [brief("stale")]))).toEqual([expect.objectContaining({ code: "handoff-stale", slot: "writer.messaging" })]);
  });
});
