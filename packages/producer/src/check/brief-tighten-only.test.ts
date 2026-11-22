import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runBriefCli } from "../cli/brief.js";
import { runIaSyncCli } from "../cli/ia-sync.js";
import type { Tighten } from "../records/types.js";
import { LATER, slot2Ids, tallyhouseWorld } from "../records/__fixtures__/slot2-workspace.js";
import { BRIEF_TIGHTEN_ONLY, runBriefTightenOnly } from "./brief-tighten-only.js";

const HERO = "sections.hero.copy";
const HEADING = "contract.copy.fields[header.heading].maxLength.en";
const PROMISE = "director/advantage.proposition.promise:Promise";

/** A Tallyhouse copy after `ia sync` (bases recorded at the installed sha). */
async function synced() {
  const ws = tallyhouseWorld();
  await runIaSyncCli(["--at", LATER], ws.root);
  const slot = ws.read("writer", HERO);
  const entry = (path: string, op: Tighten["op"], value: unknown): Tighten => ({ ...slot.tighten[0]!, path, op, value });
  return { ws, slot, entry };
}

describe(BRIEF_TIGHTEN_ONLY, () => {
  it("passes the Tallyhouse tighten lists once bases are installed", async () => {
    const { ws } = await synced();
    expect(runBriefTightenOnly(ws.root)).toEqual({ check: BRIEF_TIGHTEN_ONLY, status: "pass", findings: [] });
  });

  it("fails a tighten that widens a budget", async () => {
    const { ws, slot, entry } = await synced();
    ws.write("writer", HERO, { ...slot, tighten: [...slot.tighten, entry(HEADING, "max", 48), entry(HEADING, "max", 72)] });
    const result = runBriefTightenOnly(ws.root);
    expect(result.status).toBe("fail");
    expect(result.findings).toEqual([{ subject: `writer/${HERO}`, detail: expect.stringMatching(/^tighten\[2\] max .*max 72 is looser than the base 60/) }]);
  });

  it("fails a widened allowed set and a dropped requirement", async () => {
    const { ws, slot, entry } = await synced();
    ws.write("writer", HERO, { ...slot, tighten: [...slot.tighten, entry("contract.claimsFrom", "add", PROMISE), entry("brief.mustDo", "remove", slot.brief.mustDo[0])] });
    expect(runBriefTightenOnly(ws.root).findings.map(finding => finding.detail)).toEqual([expect.stringMatching(/add widens/), expect.stringMatching(/drops a requirement/)]);
  });

  it("fails the frozen Tallyhouse base shas (illustrative) and a base that is not installed", async () => {
    const ws = tallyhouseWorld();
    const findings = runBriefTightenOnly(ws.root).findings;
    expect(findings.map(finding => finding.subject).sort()).toEqual(slot2Ids(ws.root).map(([agent, id]) => `${agent}/${id}`).sort());
    expect(findings.every(finding => /does not match the installed/.test(finding.detail))).toBe(true);
    rmSync(ws.baseFile("designer", "themes.primary"));
    expect(runBriefTightenOnly(ws.root).findings.find(finding => finding.subject === "designer/themes.primary")!.detail).toMatch(/is not installed/);
  });

  it("judges a consumer-added slot (base null) against its own brief", async () => {
    const { ws, slot, entry } = await synced();
    ws.write("writer", HERO, { ...slot, base: null, tighten: [...slot.tighten, entry(HEADING, "max", 48)] });
    expect(runBriefTightenOnly(ws.root).status).toBe("pass");
    ws.write("writer", HERO, { ...slot, base: null, tighten: [...slot.tighten, entry(HEADING, "max", 72)] });
    expect(runBriefTightenOnly(ws.root).status).toBe("fail");
  });
});

describe("clossys brief --tighten", () => {
  const argv = (op: string, value: string, path = HEADING): string[] => [`writer/${HERO}`, "--tighten", "--path", path, "--op", op, "--value", value, "--why", "owner feedback 20261118T0912Z-home-hero-copy", "--by", "owner:cli:clossys brief 2026-11-16T09:18:40Z", "--at", LATER];

  it("appends a stricter entry and stamps updatedAt", async () => {
    const { ws, slot } = await synced();
    const result = await runBriefCli([...argv("max", "48"), "--root", ws.root], ws.root);
    expect(result.exitCode).toBe(0);
    const next = ws.read("writer", HERO);
    expect(next.tighten).toEqual([...slot.tighten, { path: HEADING, op: "max", value: 48, why: "owner feedback 20261118T0912Z-home-hero-copy", by: { actor: "owner", ref: "cli:clossys brief 2026-11-16T09:18:40Z" }, at: LATER }]);
    expect(next.updatedAt).toBe(LATER);
    expect(runBriefTightenOnly(ws.root).status).toBe("pass");
    const shown = await runBriefCli([`writer/${HERO}`], ws.root);
    expect(shown.exitCode).toBe(0);
    expect(shown.message).toMatch(/"key": "header.heading"[\s\S]*?"en": 48/);
  });

  it("refuses a widening entry and writes nothing", async () => {
    const { ws } = await synced();
    const before = readFileSync(ws.file("writer", HERO), "utf8");
    const result = await runBriefCli(argv("max", "72"), ws.root);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/brief.tighten-only: refused, nothing written: .*max 72 is looser than the base 60/);
    expect(readFileSync(ws.file("writer", HERO), "utf8")).toBe(before);
  });

  it("refuses bad arguments with usage", async () => {
    const { ws } = await synced();
    expect((await runBriefCli([`writer/${HERO}`, "--tighten", "--path", HEADING], ws.root)).exitCode).toBe(2);
    expect((await runBriefCli([...argv("max", "48").slice(0, -4), "--by", "agent:writer"], ws.root)).exitCode).toBe(2);
    expect((await runBriefCli(argv("widen", "48"), ws.root)).exitCode).toBe(2);
    expect((await runBriefCli([`nobody/${HERO}`], ws.root)).exitCode).toBe(2);
    expect((await runBriefCli(["writer/narratives.legal-document"], join(ws.root, "clossys"))).exitCode).toBe(1);
  });
});
