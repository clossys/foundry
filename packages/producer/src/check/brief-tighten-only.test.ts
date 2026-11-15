import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runBriefCli } from "../cli/brief.js";
import { readBaseSlot, syncedSlot } from "../records/slot.js";
import type { Slot, Tighten } from "../records/types.js";
import { AT, LATER, baseSlot, slot2Workspace } from "../records/__fixtures__/slot2-workspace.js";
import { BRIEF_TIGHTEN_ONLY, runBriefTightenOnly } from "./brief-tighten-only.js";

const HEADING = "contract.copy.fields[heading].maxLength.en";
const ID = "sections.hero.copy";
const entry = (op: Tighten["op"], value: unknown, path = HEADING): Tighten => ({ path, op, value, why: "owner asked", by: { actor: "owner", ref: "fb-1" }, at: AT });

function synced(): { ws: ReturnType<typeof slot2Workspace>; slot: Slot } {
  const ws = slot2Workspace();
  ws.base(baseSlot("writer", ID));
  const slot = syncedSlot(readBaseSlot(ws.root, "writer", ID)!, undefined, AT);
  ws.consumer("writer", ID, slot);
  return { ws, slot };
}

describe(BRIEF_TIGHTEN_ONLY, () => {
  it("passes a stricter tighten list", () => {
    const { ws, slot } = synced();
    ws.consumer("writer", ID, { ...slot, tighten: [entry("max", 40), entry("add", "Name the price", "brief.mustDo")] });
    expect(runBriefTightenOnly(ws.root)).toEqual({ check: BRIEF_TIGHTEN_ONLY, status: "pass", findings: [] });
  });

  it("fails a tighten that widens a budget", () => {
    const { ws, slot } = synced();
    ws.consumer("writer", ID, { ...slot, tighten: [entry("max", 40), entry("max", 90)] });
    const result = runBriefTightenOnly(ws.root);
    expect(result.status).toBe("fail");
    expect(result.findings).toEqual([{ subject: `writer/${ID}`, detail: expect.stringMatching(/^tighten\[1\] max .*max 90 is looser than the base 60/) }]);
  });

  it("fails a widened allowed set and a dropped requirement", () => {
    const { ws, slot } = synced();
    ws.consumer("writer", ID, { ...slot, tighten: [entry("add", "loud", "contract.tones"), entry("remove", "Lead with the outcome", "brief.mustDo")] });
    expect(runBriefTightenOnly(ws.root).findings.map(finding => finding.detail)).toEqual([expect.stringMatching(/add widens/), expect.stringMatching(/drops a requirement/)]);
  });

  it("fails a base that is missing or whose sha no longer matches", () => {
    const { ws, slot } = synced();
    ws.consumer("writer", ID, { ...slot, base: { ...slot.base!, sha256: "0".repeat(64) } });
    expect(runBriefTightenOnly(ws.root).findings[0]!.detail).toMatch(/does not match the installed @clossys\/writer/);
    ws.consumer("writer", "sections.gone.copy", { ...slot, id: "sections.gone.copy", base: { ...slot.base!, path: "src/catalog/slots/sections.gone.copy/slot.json" } });
    expect(runBriefTightenOnly(ws.root).findings.map(finding => finding.detail)).toContainEqual(expect.stringMatching(/is not installed/));
  });

  it("judges a consumer-added slot (base null) against its own brief", () => {
    const ws = slot2Workspace();
    const own = baseSlot("writer", "sections.extra.copy");
    ws.consumer("writer", own.id, { ...own, tighten: [entry("max", 50)] });
    expect(runBriefTightenOnly(ws.root).status).toBe("pass");
    ws.consumer("writer", own.id, { ...own, tighten: [entry("max", 70)] });
    expect(runBriefTightenOnly(ws.root).status).toBe("fail");
  });
});

describe("clossys brief --tighten", () => {
  const argv = (op: string, value: string, path = HEADING): string[] => [`writer/${ID}`, "--tighten", "--path", path, "--op", op, "--value", value, "--why", "owner asked", "--by", "owner:fb-7", "--at", LATER];

  it("appends a stricter entry and stamps updatedAt", async () => {
    const { ws } = synced();
    const result = await runBriefCli([...argv("max", "40"), "--root", ws.root], ws.root);
    expect(result.exitCode).toBe(0);
    const slot = ws.read("writer", ID);
    expect(slot.tighten).toEqual([{ path: HEADING, op: "max", value: 40, why: "owner asked", by: { actor: "owner", ref: "fb-7" }, at: LATER }]);
    expect(slot.updatedAt).toBe(LATER);
    expect(runBriefTightenOnly(ws.root).status).toBe("pass");
    const shown = await runBriefCli([`writer/${ID}`], ws.root);
    expect(shown.exitCode).toBe(0);
    expect(shown.message).toContain('"en": 40');
  });

  it("refuses a widening entry and writes nothing", async () => {
    const { ws } = synced();
    const before = readFileSync(ws.file("writer", ID), "utf8");
    const result = await runBriefCli(argv("max", "90"), ws.root);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/brief.tighten-only: refused, nothing written: .*max 90 is looser than the base 60/);
    expect(readFileSync(ws.file("writer", ID), "utf8")).toBe(before);
  });

  it("refuses bad arguments with usage", async () => {
    const { ws } = synced();
    expect((await runBriefCli(["writer/" + ID, "--tighten", "--path", HEADING], ws.root)).exitCode).toBe(2);
    expect((await runBriefCli([...argv("max", "40").slice(0, -4), "--by", "agent:x"], ws.root)).exitCode).toBe(2);
    expect((await runBriefCli(argv("widen", "40"), ws.root)).exitCode).toBe(2);
    expect((await runBriefCli(["nobody/" + ID], ws.root)).exitCode).toBe(2);
    expect((await runBriefCli(["writer/sections.none.copy"], ws.root)).exitCode).toBe(1);
  });
});
