/**
 * foundry-build-0048 Amendment 2026-11-18b (A1, A3): `clossys init` seats the admin workspace in every consumer, a fixed
 * Publisher responsibility, and `publisher.admin-seated` fails a slot-model workspace whose admin seat is missing,
 * tampered or not wired to the units the workspace holds.
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
import { ADMIN_PUBLICATION_SLOT, adminPlan, adminUnder, readAdminSlot } from "./admin-plan.js";
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
type Seat = { started: boolean; placed: string[]; rewired: string[]; requests: { id: string; target: string; from: string; created: boolean }[] };
const seatOf = (output: unknown) => (output as { admin: Seat }).admin;
/** The reader's view of one admin slot (slot.json in either format). */
const view = (root: string, id: string) => readAdminSlot(join(root, "clossys", "agents", "publisher", id))!.doc;
const slotPath = (root: string, id: string) => join(root, "clossys", "agents", "publisher", id, "slot.json");
const editSlot = (root: string, id: string, edit: (doc: Record<string, any>) => void) => {
  const doc = JSON.parse(readFileSync(slotPath(root, id), "utf8")) as Record<string, any>;
  edit(doc);
  writeFileSync(slotPath(root, id), `${JSON.stringify(doc, null, 2)}\n`);
};
const adopt = async (root: string) => {
  for (const agent of ["director", "designer"]) {
    const adopted = await runCli(["ia", agent, "--adopt", "--root", root]);
    expect(adopted.exitCode, adopted.message).toBe(0);
  }
};
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
      const slot = view(root, page.id) as unknown as { uses: string[]; contract: { composes: string[] } };
      expect(slot.uses, page.id).toEqual([]);
      expect(slot.contract.composes, page.id).toEqual(page.uses.map(use => `designer/${use}`));
    }
  });

  it("cites the frame and sections a workspace holds: with the Designer IA adopted, every page reads its whole composition and nothing is raised", async () => {
    const root = workspace();
    await adopt(root);
    const result = await runInitCli(["--at", AT], root);
    expect(result.exitCode, result.message).toBe(0);
    const seat = seatOf(result.output);
    expect(seat.placed).toEqual([...PAGES, ADMIN_PUBLICATION_SLOT]);
    expect(seat.requests).toEqual([]);
    for (const page of adminPlan(root).pages) {
      const slot = view(root, page.id);
      expect(slot.uses, page.id).toEqual(page.uses);
      expect(slot.inputs, page.id).toEqual(page.uses);
    }
    expect(runAdminSeated(root)).toEqual({ check: ADMIN_SEATED, status: "pass", findings: [] });
  }, 60_000);

  it("rewires on a re-run: init, then the Director and Designer adopt, then init again cites every held unit and the admin row passes", async () => {
    const root = workspace();
    expect((await runInitCli(["--at", AT], root)).exitCode).toBe(0);
    await adopt(root);
    // Between the runs the pages cite nothing the workspace now holds: the check names each uncited unit.
    const stale = runAdminSeated(root);
    expect(stale.status).toBe("fail");
    expect(stale.findings.map(finding => finding.subject)).toEqual(PAGES.map(page => `publisher/${page}`));
    for (const finding of stale.findings) expect(finding.detail, finding.subject).toMatch(/^inputs and uses cite no frames\.app-shell, sections\.page-header, .*which the workspace holds \(run clossys init to rewire\)/);
    const again = await runInitCli(["--at", "2026-11-18T10:00:00Z"], root);
    expect(again.exitCode, again.message).toBe(0);
    const seat = seatOf(again.output);
    expect(seat.placed).toEqual([]);
    expect(seat.rewired).toEqual(PAGES);
    expect(again.message).toContain(`rewired 5 admin slots to the units the workspace now holds: ${PAGES.join(", ")}`);
    for (const page of adminPlan(root).pages) {
      const slot = view(root, page.id);
      expect(slot.inputs, page.id).toEqual(page.uses);
      expect(slot.uses, page.id).toEqual(page.uses);
    }
    expect(runAdminSeated(root)).toEqual({ check: ADMIN_SEATED, status: "pass", findings: [] });
    const check = await runCli(["check", "--root", root]);
    expect(check.message).toContain(`${ADMIN_SEATED}: pass`);
    expect(check.message).toMatch(/publisher: 6 slots .*inputs-undeclared 0/);
    // A third run on the wired workspace rewrites nothing.
    expect(seatOf((await runInitCli(["--at", "2026-11-18T11:00:00Z"], root)).output).rewired).toEqual([]);
  }, 120_000);

  it("writes each admin slot as clossys.slot/2, so a fresh init passes the admin rows of clossys check", async () => {
    const root = workspace();
    await runInitCli(["--at", AT], root);
    for (const slot of [...PAGES, ADMIN_PUBLICATION_SLOT]) expect(JSON.parse(readFileSync(slotPath(root, slot), "utf8")).schema, slot).toBe("clossys.slot/2");
    const check = await runCli(["check", "--root", root]);
    expect(check.message).toContain(`${ADMIN_SEATED}: pass`);
    expect(check.message).not.toMatch(/agents\/publisher\/[^ ]+\/slot\.json \[schema\]/);
    expect((check as unknown as { checks?: Record<string, unknown> }).checks?.[ADMIN_SEATED]).toBeUndefined();
  });

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
  it("skips, and prints the skip, only a workspace with no slot model and no clossys init", () => {
    const result = runAdminSeated(workspace());
    expect(result.status).toBe("skip");
    expect(adminSeatedSummary(result)).toBe(`${ADMIN_SEATED}: skip (no slot model and no clossys init: no admin workspace to judge)`);
  });

  it("mutation: a slot-model workspace clossys init never ran in is judged, and fails without the admin seat", async () => {
    const root = workspace();
    await adopt(root);
    const result = runAdminSeated(root);
    expect(result.status).toBe("fail");
    expect(result.findings.map(finding => finding.subject)).toEqual(["publisher/ia.json"]);
    const check = await runCli(["check", "--root", root]);
    expect(check.message).toContain(`${ADMIN_SEATED}: fail (1)`);
  }, 60_000);

  it("mutation: removing the views pointer after init opts nothing out (the slot model is judged)", async () => {
    const root = workspace();
    await runInitCli(["--at", AT], root);
    rmSync(join(root, "AGENTS.md"), { force: true });
    rmSync(join(root, "clossys", "agents", "publisher"), { recursive: true, force: true });
    const result = runAdminSeated(root);
    expect(result.status).toBe("fail");
    expect(result.findings.map(finding => finding.subject)).toEqual(["publisher/ia.json"]);
  });

  it("mutation: a hollowed publication.admin (no pages, publication site) fails", async () => {
    const root = workspace();
    await runInitCli(["--at", AT], root);
    editSlot(root, ADMIN_PUBLICATION_SLOT, doc => { doc.contract.pages = []; });
    const empty = runAdminSeated(root);
    expect(empty.status).toBe("fail");
    expect(empty.findings).toHaveLength(1);
    expect(empty.findings[0]!.subject).toBe(`publisher/${ADMIN_PUBLICATION_SLOT}`);
    expect(empty.findings[0]!.detail).toContain(`contract pages lack ${PAGES.join(", ")}`);
    editSlot(root, ADMIN_PUBLICATION_SLOT, doc => { doc.contract.pages = PAGES; doc.contract.publication = "site"; });
    const site = runAdminSeated(root);
    expect(site.status).toBe("fail");
    expect(site.findings.map(finding => finding.detail)).toEqual([expect.stringContaining('contract publication is "site", not "admin"')]);
  });

  it("mutation: page.admin-home repointed (publication site, route /, composes nothing) fails on each", async () => {
    const root = workspace();
    await runInitCli(["--at", AT], root);
    editSlot(root, "page.admin-home", doc => { doc.contract.publication = "site"; doc.contract.route = "/"; doc.contract.composes = []; });
    const result = runAdminSeated(root);
    expect(result.status).toBe("fail");
    expect(result.findings.map(finding => finding.subject)).toEqual(["publisher/page.admin-home"]);
    const detail = result.findings[0]!.detail;
    expect(detail).toContain('contract publication is "site", not "admin"');
    expect(detail).toContain('contract route is "/", not the package route /admin');
    expect(detail).toContain("contract composes [], not the package composition designer/frames.app-shell");
    const check = await runCli(["check", "--root", root]);
    expect(check.message).toContain(`${ADMIN_SEATED}: fail (1)`);
  });

  it("mutation: the admin tab renamed in the Publisher IA fails every admin slot", async () => {
    const root = workspace();
    await runInitCli(["--at", AT], root);
    const iaFile = join(root, "clossys", "agents", "publisher", "ia.json");
    const ia = JSON.parse(readFileSync(iaFile, "utf8")) as { nodes: { id: string }[] };
    for (const l1 of ia.nodes) if (l1.id === "admin") l1.id = "site";
    writeFileSync(iaFile, `${JSON.stringify(ia, null, 2)}\n`);
    const result = runAdminSeated(root);
    expect(result.status).toBe("fail");
    expect(result.findings.map(finding => finding.subject)).toEqual([...PAGES, ADMIN_PUBLICATION_SLOT].map(slot => `publisher/${slot}`));
    for (const finding of result.findings) expect(finding.detail, finding.subject).toContain("sits under the site tab, not admin");
  });

  it("mutation: a page that cites an input outside its composition, or drops a held unit, fails", async () => {
    const root = workspace();
    await adopt(root);
    await runInitCli(["--at", AT], root);
    editSlot(root, "page.admin-gallery", doc => { doc.refs = [...doc.refs, { to: "designer/sections.hero", rel: "input" }]; });
    editSlot(root, "page.admin-requests", doc => { doc.refs = doc.refs.filter((ref: { to: string; rel: string }) => !(ref.to === "designer/sections.queue-list" && ref.rel === "uses")); });
    const result = runAdminSeated(root);
    expect(result.status).toBe("fail");
    expect(result.findings.map(finding => [finding.subject, finding.detail.split("; the admin seat")[0]])).toEqual([
      ["publisher/page.admin-gallery", "inputs name sections.hero, outside its package composition (undeclared input)"],
      ["publisher/page.admin-requests", "uses cite no sections.queue-list, which the workspace holds (run clossys init to rewire)"],
    ]);
  }, 60_000);

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
    const seated = await runCli(["check", "--root", root]);
    expect(seated.message).toContain(`${ADMIN_SEATED}: pass`);
    // A consumer that lost it: the slot folder gone and its group dropped from ia.json (clossys ia --remove keeps a slot with records).
    const publisher = join(root, "clossys", "agents", "publisher"), iaFile = join(publisher, "ia.json");
    const ia = JSON.parse(readFileSync(iaFile, "utf8")) as { nodes: { children: { slots: string[] }[] }[] };
    for (const l1 of ia.nodes) l1.children = l1.children.filter(l2 => !l2.slots.includes(ADMIN_PUBLICATION_SLOT));
    writeFileSync(iaFile, `${JSON.stringify(ia, null, 2)}\n`);
    rmSync(join(publisher, ADMIN_PUBLICATION_SLOT), { recursive: true, force: true });
    const result = runAdminSeated(root);
    expect(result.status).toBe("fail");
    expect(result.findings).toEqual([{ subject: `publisher/${ADMIN_PUBLICATION_SLOT}`, detail: "not placed in the Publisher IA; run clossys init: the admin workspace is a fixed Publisher publication" }]);
    // The fresh seat passed its row above (slot/2 admin seats); the exit code alone is not the assertion (no-candidate rows exit 1 too).
    const check = await runCli(["check", "--root", root]);
    expect(check.exitCode).not.toBe(0);
    expect(check.message).toContain(`${ADMIN_SEATED}: fail (1)`);
    expect(check.message).not.toContain(`${ADMIN_SEATED}: pass`);
    expect((check as unknown as { checks?: Record<string, unknown> }).checks?.[ADMIN_SEATED]).toMatchObject({ status: "fail" });
  });
});
