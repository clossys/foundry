import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
// Director's own fixtures (test-only source import; @clossys/director ships them in no export).
import { stageFinding, strategyRoot } from "../../../director/src/__fixtures__/slot-model.js";
import { runCli } from "./main.js";

/** `clossys director check|rate-check`: Director's commands, run through the compiled clossys CLI. */
const cli = fileURLToPath(new URL("../../dist/cli/index.js", import.meta.url));
const roots: string[] = [];
const temp = () => { const root = mkdtempSync(join(tmpdir(), "clossys-director-verb-")); roots.push(root); return root; };
const run = (...args: string[]) => {
  const child = spawnSync(process.execPath, [cli, "director", ...args], { encoding: "utf8" });
  expect(child.error).toBeUndefined();
  return { code: child.status, stdout: child.stdout, stderr: child.stderr };
};
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

describe("clossys director", () => {
  it("check <strategy-dir> <scan-dir> with no subcommand runs ground over the consumer's Director evidence", { timeout: 30_000 }, () => {
    const base = temp(); const strategy = strategyRoot(base); const scan = join(base, "surfaces");
    mkdirSync(scan); stageFinding(strategy);
    writeFileSync(join(scan, "about.md"), "We now serve 4,200 customers.");
    const clean = run("check", strategy, scan);
    expect(clean.stdout).toContain("No findings."); expect(clean.code).toBe(0);
    writeFileSync(join(scan, "about.md"), "We now serve 9,999 customers.");
    const finding = run("check", strategy, scan);
    expect(finding.stdout).toContain("finding(s)"); expect(finding.code).toBe(1);
  });

  it("check --json prints Director's own JSON once, with nothing appended", { timeout: 30_000 }, () => {
    const base = temp(); const strategy = strategyRoot(base); const scan = join(base, "surfaces");
    mkdirSync(scan); stageFinding(strategy);
    writeFileSync(join(scan, "about.md"), "We now serve 4,200 customers.");
    const result = run("check", strategy, scan, "--json");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ findings: [], filesScanned: 1 });
  });

  it("rate-check rates a caller-supplied assessment and maps input errors to 2", { timeout: 30_000 }, () => {
    const file = join(temp(), "assessment.json");
    writeFileSync(file, JSON.stringify({ asOf: "2026-09-18T12:00:00Z", declaredClaims: [{ id: "claim-one" }], observations: [{
      claimId: "claim-one", independent: true, currentEvidence: true, derived: true, approved: true, observerRef: "observer-a",
      evidence: [{ id: "evidence-one", description: "Independent observation evidence." }] }] }));
    const ok = run("rate-check", file);
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.stdout)).toMatchObject({ state: "satisfied", metric: "strategy traceability rate", rate: 1 });
    const missing = run("rate-check", join(temp(), "missing.json"));
    expect(missing.code).toBe(2); expect(missing.stderr).toContain("clossys director rate-check: ");
  });

  it("check brand|direction|apply give their verdicts over the pinned slots and write nothing", { timeout: 30_000 }, () => {
    const fx = fileURLToPath(new URL("../../../../governance/release-qualification-fixtures/producer/current-direct/director/", import.meta.url));
    const root = (name: string) => join(fx, name, "clossys", "agents", "director");
    const files = () => readdirSync(fx, { recursive: true }).map(String).sort();
    const before = files();
    const verdict = (...args: string[]) => { const result = run("check", ...args, "--json"); return [result.code, JSON.parse(result.stdout)] as const; };
    expect(verdict("brand", "--root", root("identity"))).toMatchObject([0, { state: "satisfied", findings: [] }]);
    const [uncoveredCode, uncovered] = verdict("brand", "--root", root("ready"));
    expect(uncoveredCode).toBe(1);
    expect(uncovered.findings.map((finding: { cell: string }) => finding.cell)).toContain("identity.brand.essence");
    expect(verdict("direction", "--root", root("identity"))).toMatchObject([0, { state: "satisfied" }]);
    expect(verdict("direction", "--root", root("superseded"))).toMatchObject([1, { findings: [{ rule: "direction-superseded", cell: "identity.verbal.voice" }] }]);
    expect(verdict("direction", "--root", root("unpinned"))).toMatchObject([2, { state: "indeterminate" }]);
    expect(verdict("apply", join(fx, "pages", "applied"), "--root", root("identity"))).toMatchObject([0, { state: "satisfied" }]);
    expect(verdict("apply", join(fx, "pages", "grounded"), "--root", root("identity"))).toMatchObject([1, { findings: [{ rule: "apply-uncited" }] }]);
    expect(verdict("apply", join(fx, "pages", "grounded"), "--root", root("ready"))).toMatchObject([2, { state: "indeterminate" }]);
    expect(files()).toEqual(before);
  });

  it("refuses an unknown subcommand without running anything", async () => {
    const result = await runCli(["director", "nope"]);
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain("clossys director: unknown command nope");
  });
});
