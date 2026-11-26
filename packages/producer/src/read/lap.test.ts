import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runRequestCli } from "../cli/request.js";
import { OPEN_FIX, requestsWorld, requireMissingCopyField, staleVerdicts, type RequestsWorld } from "../conform/__fixtures__/requests-world.js";
import { appendEvent } from "../engine/log.js";
import { answerRequest, closeWork } from "../records/request.js";
import { lapPath, lapReceipt, LAP_SCHEMA } from "./lap.js";

vi.setConfig({ testTimeout: 120_000 });

// CP1-L3: `clossys request <id> --receipt` joins the entry, the engine log, the queues and git into clossys.lap/1.
const worlds: RequestsWorld[] = [];
afterEach(() => { for (const world of worlds.splice(0)) world.dispose(); });

const git = (root: string, args: readonly string[]) => execFileSync("git", args, {
  cwd: root, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid", GIT_AUTHOR_DATE: "2026-11-20T09:00:00Z", GIT_COMMITTER_DATE: "2026-11-20T09:00:00Z" },
});
const event = (root: string, kind: string, subject: string, at: string) => appendEvent(root, { actor: "code:clossys run", kind, subject, at, inputs: [] });

describe("clossys request <id> --receipt (clossys.lap/1)", () => {
  it("a fix's lifecycle: every field from the records, unknown where no record holds it, and the same bytes twice", async () => {
    const made = await requestsWorld();
    worlds.push(made);
    const { root, consumer } = made;
    const fix = made.raised.fix.find(item => item.target === OPEN_FIX)!;

    // Before git: hand edits and outside-leaf writes are unknown, never 0.
    const bare = lapReceipt(root, fix.id);
    expect(bare.handEdits).toBe("unknown");
    expect(bare.outsideLeafWrites).toBe("unknown");
    expect(bare.wall.totalSeconds).toBe("unknown");
    expect(bare.window).toEqual({ from: fix.createdAt, to: "unknown" });

    // Writer's fix check fails again (a required copy field its record lacks), so its fixed claim is rejected.
    requireMissingCopyField(root);
    staleVerdicts(root, "writer", "sections.hero.copy");
    git(root, ["init", "-q"]);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "baseline"]);

    // The lap: one agent run and one submit in the window (one of each before it), a rejected close, the claim, the owner's answer.
    event(root, "run.state", "loop:loop.create/20261120T0900Z-before", "2026-11-20T09:00:30.000Z");
    event(root, "run.state", "loop:loop.create/20261120T1000Z-lap", "2026-11-20T10:00:00.000Z");
    event(root, "run.state", "loop:loop.create/20261120T1000Z-lap", "2026-11-20T10:00:30.000Z");
    event(root, "slot.submit", "writer/sections.hero.copy", "2026-11-20T09:00:40.000Z");
    event(root, "slot.submit", "writer/sections.hero.copy", "2026-11-20T10:01:00.000Z");
    expect(() => closeWork(consumer, fix.id, { by: "writer", at: "2026-11-20T10:04:00Z", outcome: "fixed", result: OPEN_FIX })).toThrow(/stays open/);
    closeWork(consumer, fix.id, { by: "writer", at: "2026-11-20T10:05:00Z", outcome: "declined", result: OPEN_FIX });
    await answerRequest(consumer, fix.id, { option: "decline", at: "2026-11-20T10:06:00Z", via: "chat", quote: "decline it" });

    // Two record edits no verb made: one in the assignee's own folder, one in another agent's.
    const touch = (rel: string) => { const file = join(consumer, "agents", rel); writeFileSync(file, `${readFileSync(file, "utf8")}\n`); };
    touch("writer/sections.hero.copy/slot.json");
    touch("designer/sections.hero/slot.json");

    const result = await runRequestCli([fix.id, "--receipt", "--changed-since", "recipe r2: tighter hero copy", "--root", root], root);
    expect(result.exitCode).toBe(0);
    const receipt = result.output as ReturnType<typeof lapReceipt>;
    const file = lapPath(root, fix.id);
    expect(result.message).toBe(`request ${fix.id} --receipt: wrote clossys/.state/laps/${fix.id}.json`);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(receipt);

    expect(receipt).toMatchObject({
      schema: LAP_SCHEMA, request: fix.id, kind: "fix", target: OPEN_FIX, from: "owner", assignee: "writer", status: "closed", outcome: "declined",
      changedSince: "recipe r2: tighter hero copy",
      window: { from: "2026-11-20T09:32:00Z", to: "2026-11-20T10:06:00Z" },
      wall: { totalSeconds: 2040 },
      agentRuns: { loopRuns: 1, runIds: ["20261120T1000Z-lap"], submits: 1 },
      ownerAsks: 1,
      rework: { rejected: 1, cascadeFixes: 1, fixIds: [made.raised.fix.find(item => item.target === "publisher/page.home")!.id] },
      gateFailuresBeforeGreen: "unknown",
      handEdits: { count: 2, files: ["clossys/agents/designer/sections.hero/slot.json", "clossys/agents/writer/sections.hero.copy/slot.json"] },
      outsideLeafWrites: { count: 1, files: ["clossys/agents/designer/sections.hero/slot.json"] },
    });
    expect(receipt.steps.map(step => [step.op, step.by, step.at, step.seconds])).toEqual([
      ["raised", "producer", "2026-11-20T09:32:00Z", 0],
      ["routed", "producer", "2026-11-20T09:32:00Z", 0],
      ["rejected", "producer", "2026-11-20T10:04:00Z", 1920],
      ["asked", "producer", "2026-11-20T10:05:00Z", 60],
      ["answered", "owner", "2026-11-20T10:06:00Z", 60],
      ["closed", `owner:queue.fix#${fix.id}`, "2026-11-20T10:06:00Z", 0],
    ]);
    expect(receipt.steps.map(step => step.event)).toEqual(readRequestEvents(consumer, fix.id));

    // Deterministic: a second receipt over the same records writes the same bytes.
    const bytes = readFileSync(file, "utf8");
    await runRequestCli([fix.id, "--receipt", "--changed-since", "recipe r2: tighter hero copy", "--root", root], root);
    expect(readFileSync(file, "utf8")).toBe(bytes);
  });
});

function readRequestEvents(consumer: string, id: string): string[] {
  const doc = JSON.parse(readFileSync(join(consumer, "agents/producer/queue.fix/entries", `${id}.json`), "utf8")) as { events: { id: string }[] };
  return doc.events.map(item => item.id);
}
