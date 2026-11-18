/**
 * foundry-build-0048 Amendment 2026-11-18b (A1, A3): `clossys init` seats the admin workspace in every consumer, a fixed
 * Publisher responsibility, and `publisher.admin-seated` fails an initialised consumer that lacks it.
 * Synthetic: a tmp workspace (`clossys/clossys.config.ts` only), the Publisher `admin` starter as this repository ships it.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ADMIN_SEATED, adminSeatedSummary, runAdminSeated } from "../check/admin-seated.js";
import { listRequests } from "../records/request.js";
import { resolveSlot } from "../records/resolve.js";
import { listSlots } from "../records/slots.js";
import { ADMIN_PUBLICATION_SLOT, adminPlan, adminUnder } from "./admin-plan.js";
import { runInitCli } from "./init.js";
import { runCli } from "./main.js";

const AT = "2026-11-18T09:00:00Z";
const PAGES = ["page.admin-home", "page.admin-gallery", "page.admin-slot", "page.admin-requests", "page.admin-questions"];
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function workspace(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "init-admin-")));
  roots.push(root);
  mkdirSync(join(root, "clossys"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
  return root;
}
type Seat = { started: boolean; placed: string[]; requests: { id: string; target: string; from: string; created: boolean }[] };
const seatOf = (output: unknown) => (output as { admin: Seat }).admin;
const iaSlots = (root: string) => {
  const ia = JSON.parse(readFileSync(join(root, "clossys", "agents", "publisher", "ia.json"), "utf8")) as { nodes: { id: string; children: { id: string; slots: string[] }[] }[] };
  return ia.nodes.flatMap(l1 => l1.children.map(l2 => [`${l1.id}/${l2.id}`, l2.slots] as const));
};

describe("the admin plan is the Publisher admin starter", () => {
  it("names five pages on frames plus sections, and the five data-bound admin sections (their contracts name the clossys records they read)", () => {
    const plan = adminPlan(workspace());
    expect(plan.publication).toBe(ADMIN_PUBLICATION_SLOT);
    expect(plan.pages.map(page => page.id)).toEqual(PAGES);
    for (const page of plan.pages) {
      expect(page.uses[0], page.id).toMatch(/^frames\./);
      expect(page.uses.slice(1).every(use => use.startsWith("sections.")), page.id).toBe(true);
    }
    expect(plan.pages.flatMap(page => page.dataBound).sort()).toEqual(["sections.candidate-preview", "sections.question-packet", "sections.queue-list", "sections.slot-detail", "sections.slot-gallery"]);
    expect(plan.pages.find(page => page.id === "page.admin-slot")!.route).toBe("/admin/<agent>/<slot>");
  });
});

describe("clossys init seats the admin workspace", () => {
  it("places the five admin pages and publication.admin in the admin tab of a new Publisher IA, one group each", async () => {
    const root = workspace();
    const result = await runInitCli(["--at", AT], root);
    expect(result.exitCode, result.message).toBe(0);
    const seat = seatOf(result.output);
    expect(seat.started).toBe(true);
    expect(seat.placed).toEqual([...PAGES, ADMIN_PUBLICATION_SLOT]);
    expect(iaSlots(root)).toEqual([...PAGES, ADMIN_PUBLICATION_SLOT].map(slot => [adminUnder(slot), [slot]]));
    expect(iaSlots(root).map(([under]) => under)).toEqual(["admin/home", "admin/gallery", "admin/slot", "admin/requests", "admin/questions", "admin/publication"]);
    const consumer = join(root, "clossys");
    expect(listSlots(consumer, "publisher").map(entry => entry.id)).toEqual(expect.arrayContaining([...PAGES, ADMIN_PUBLICATION_SLOT]));
    expect(result.message).toContain("seated the admin workspace: 6 Publisher slots placed");
  });

  it("cites only the Designer units the workspace holds and raises one Designer request for each unit it lacks", async () => {
    const root = workspace();
    const plan = adminPlan(root);
    const seat = seatOf((await runInitCli(["--at", AT], root)).output);
    const units = [...new Set(plan.pages.flatMap(page => page.uses))];
    expect(units).toEqual(expect.arrayContaining(["sections.slot-gallery", "sections.slot-detail", "sections.candidate-preview", "sections.question-packet", "sections.queue-list"]));
    expect(seat.requests.map(request => [request.from, request.target, request.created])).toEqual(units.map(unit => ["owner", `designer/${unit}`, true]));
    const consumer = join(root, "clossys");
    for (const request of listRequests(consumer).map(read => read.request!)) {
      expect(request.why, request.target).toContain("no workspace slot holds");
      const bound = plan.pages.some(page => page.dataBound.includes(request.target.slice("designer/".length)));
      expect(request.why.includes("data-bound admin section that reads clossys records read-only"), request.target).toBe(bound);
    }
    // The page cites nothing the workspace does not hold (a bare workspace holds no Designer slot); its contract names the whole composition.
    for (const page of plan.pages) {
      const slot = JSON.parse(readFileSync(join(consumer, "agents", "publisher", page.id, "slot.json"), "utf8")) as { uses: string[]; contract: { composes: string[] } };
      expect(slot.uses, page.id).toEqual([]);
      expect(slot.contract.composes, page.id).toEqual(page.uses.map(use => `designer/${use}`));
    }
  });

  it("cites the frame and sections a workspace holds: with the Designer IA adopted, every page reads its whole composition and nothing is raised", async () => {
    const root = workspace();
    for (const agent of ["director", "designer"]) {
      const adopted = await runCli(["ia", agent, "--adopt", "--root", root]);
      expect(adopted.exitCode, adopted.message).toBe(0);
    }
    const result = await runInitCli(["--at", AT], root);
    expect(result.exitCode, result.message).toBe(0);
    const seat = seatOf(result.output);
    expect(seat.placed).toEqual([...PAGES, ADMIN_PUBLICATION_SLOT]);
    expect(seat.requests).toEqual([]);
    const consumer = join(root, "clossys");
    for (const page of adminPlan(root).pages) {
      const slot = JSON.parse(readFileSync(join(consumer, "agents", "publisher", page.id, "slot.json"), "utf8")) as { inputs: string[]; uses: string[] };
      expect(slot.uses, page.id).toEqual(page.uses);
      expect(slot.inputs, page.id).toEqual(page.uses);
    }
  }, 60_000);

  it("is idempotent: a second run places nothing and raises nothing new", async () => {
    const root = workspace();
    const first = seatOf((await runInitCli(["--at", AT], root)).output);
    const again = await runInitCli(["--at", "2026-11-18T10:00:00Z"], root);
    expect(again.exitCode, again.message).toBe(0);
    const second = seatOf(again.output);
    expect(second.started).toBe(false);
    expect(second.placed).toEqual([]);
    expect(second.requests.map(request => request.id)).toEqual(first.requests.map(request => request.id));
    expect(second.requests.every(request => !request.created)).toBe(true);
    expect(again.message).toContain("the admin workspace is already seated");
  });

  it("seeds each admin page with its package default: a placed page with no pin resolves to it as a sample", async () => {
    const root = workspace();
    await runInitCli(["--at", AT], root);
    for (const page of PAGES) {
      const resolution = resolveSlot(root, "publisher", page);
      expect(resolution.state, page).toBe("sample");
      if (resolution.state === "sample") expect(resolution.candidate, page).toBe("starter-v1.json");
    }
  });

  it("seats a workspace reached through a symbolic link (the slot model runs on its real path)", async () => {
    const real = workspace();
    const link = join(realpathSync(mkdtempSync(join(tmpdir(), "init-admin-link-"))), "ws");
    roots.push(dirname(link));
    symlinkSync(real, link, "dir");
    const result = await runInitCli(["--at", AT, "--root", link], link);
    expect(result.exitCode, result.message).toBe(0);
    expect(seatOf(result.output).placed).toEqual([...PAGES, ADMIN_PUBLICATION_SLOT]);
  });

  it("refuses a bad --at", async () => {
    await expect(runInitCli(["--at", "yesterday"], workspace())).rejects.toThrow(/--at requires an ISO timestamp/);
  });
});

describe("publisher.admin-seated", () => {
  it("skips a workspace clossys init has not run in", () => {
    const result = runAdminSeated(workspace());
    expect(result.status).toBe("skip");
    expect(adminSeatedSummary(result)).toBeUndefined();
  });

  it("passes once clossys init has seated the admin workspace", async () => {
    const root = workspace();
    await runInitCli(["--at", AT], root);
    expect(runAdminSeated(root)).toEqual({ check: ADMIN_SEATED, status: "pass", findings: [] });
  });

  it("mutation: an initialised consumer with no Publisher IA fails", async () => {
    const root = workspace();
    await runInitCli(["--at", AT], root);
    rmSync(join(root, "clossys", "agents", "publisher"), { recursive: true, force: true });
    const result = runAdminSeated(root);
    expect(result.status).toBe("fail");
    expect(result.findings.map(finding => finding.subject)).toEqual(["publisher/ia.json"]);
  });

  it("mutation: an initialised consumer whose Publisher IA lacks publication.admin fails, and clossys check exits non-zero", async () => {
    const root = workspace();
    await runInitCli(["--at", AT], root);
    // A consumer that lost it: the slot folder gone and its group dropped from ia.json (clossys ia --remove keeps a slot with records).
    const publisher = join(root, "clossys", "agents", "publisher"), iaFile = join(publisher, "ia.json");
    const ia = JSON.parse(readFileSync(iaFile, "utf8")) as { nodes: { children: { slots: string[] }[] }[] };
    for (const l1 of ia.nodes) l1.children = l1.children.filter(l2 => !l2.slots.includes(ADMIN_PUBLICATION_SLOT));
    writeFileSync(iaFile, `${JSON.stringify(ia, null, 2)}\n`);
    rmSync(join(publisher, ADMIN_PUBLICATION_SLOT), { recursive: true, force: true });
    const result = runAdminSeated(root);
    expect(result.status).toBe("fail");
    expect(result.findings).toEqual([{ subject: `publisher/${ADMIN_PUBLICATION_SLOT}`, detail: "not placed in the Publisher IA; run clossys init: the admin workspace is a fixed Publisher publication" }]);
    const check = await runCli(["check", "--root", root]);
    expect(check.exitCode).not.toBe(0);
    expect(check.message).toContain(`${ADMIN_SEATED}: fail (1)`);
    expect((check as unknown as { checks?: Record<string, unknown> }).checks?.[ADMIN_SEATED]).toMatchObject({ status: "fail" });
  });
});
