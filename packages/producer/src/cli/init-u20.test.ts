/**
 * foundry-build-0048 U20: the admin core pages. The admin plan states each data-bound section's binding and each page's
 * dynamic route format; `clossys init` seeds every admin slot with its package default as a real record (pinned through
 * the pin gate when it certifies) and adopts the loops of every agent the workspace places.
 * Synthetic: a tmp workspace (`clossys/clossys.config.ts` only), the Publisher and Designer packages as this repository ships them.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pageOptionOf } from "../actions/page-option.js";
import { LOOP_AGENT_STANDARD, runLoopAgentStandard } from "../check/loop-connected.js";
import { AGENT_LOOPS } from "../loop/agent-loops.js";
import { ADMIN_PUBLICATION_SLOT, adminContract, adminPlan, adminPlanFindings, dataBoundSections, type AdminPlan } from "./admin-plan.js";
import { runInitCli } from "./init.js";

const AT = "2026-11-18T09:00:00Z";
const PAGES = ["page.admin-home", "page.admin-gallery", "page.admin-slot", "page.admin-requests", "page.admin-questions"];
const BOUND = ["sections.candidate-preview", "sections.question-packet", "sections.queue-list", "sections.slot-detail", "sections.slot-gallery"];
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function workspace(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "init-u20-")));
  roots.push(root);
  mkdirSync(join(root, "clossys"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
  return root;
}
const publisherSlot = (root: string, slot: string) => join(root, "clossys", "agents", "publisher", slot);
type Seat = { seeded: string[]; pinned: string[]; waiting: { slot: string; reason: string }[] };
type Loops = { agents: string[]; adopted: string[]; pinned: string[]; issues: string[] };
const outputOf = (result: { output?: unknown }) => result.output as { admin: Seat; loops: Loops };
const withPage = (plan: AdminPlan, id: string, change: Record<string, unknown>): AdminPlan => ({ ...plan, pages: plan.pages.map(page => page.id === id ? { ...page, ...change } : page) });

describe("the admin plan states each data-bound binding and each dynamic route", () => {
  it("the data-bound sections are the Designer contracts bound host-injected, and each page contract names what it reads", () => {
    const root = workspace();
    expect([...dataBoundSections(root)].sort()).toEqual(BOUND);
    const plan = adminPlan(root);
    expect(adminContract(plan, "page.admin-slot")).toMatchObject({
      route: "/admin/<agent>/<slot>",
      reads: { access: "read-only", binding: "host-injected", sections: [
        { section: "designer/sections.slot-detail", records: expect.any(String), scope: "agent, slot" },
        { section: "designer/sections.candidate-preview", records: expect.any(String), scope: "agent, slot" },
      ] },
      routeFormat: { pattern: "/admin/<agent>/<slot>", params: ["agent", "slot"], reserved: { agent: [], slot: [] } },
    });
    expect(adminContract(plan, "page.admin-gallery")).toMatchObject({ routeFormat: { params: ["agent"], reserved: { agent: ["questions", "requests"] } } });
    // A static page reads under workspace scope and has no route format.
    expect(adminContract(plan, "page.admin-requests")).not.toHaveProperty("routeFormat");
    expect(adminContract(plan, "page.admin-home")).not.toHaveProperty("reads");
    expect(adminPlanFindings(plan)).toEqual([]);
  });

  it("mutation: a section read under a scope its route does not supply, or an agent id a static route reserves, is a finding", () => {
    const plan = adminPlan(workspace());
    const gallery = plan.pages.find(page => page.id === "page.admin-gallery")!;
    const unscoped = withPage(plan, "page.admin-gallery", { reads: gallery.reads.map(read => ({ ...read, scope: "agent, slot" })) });
    expect(adminPlanFindings(unscoped)).toEqual([{ subject: "publisher/page.admin-gallery", detail: expect.stringContaining('read under scope "agent, slot", but route /admin/<agent> supplies no <slot>; the host cannot scope its records') }]);
    expect(adminPlanFindings(plan, ["designer", "requests"])).toEqual([{ subject: "publisher/page.admin-gallery", detail: "agent requests is a value static admin routes reserve for <agent> (questions, requests): /admin/requests would never reach this page" }]);
  });

  it("mutation: the fixed admin publication rooted at /, or a page route outside its root, is a plan finding", () => {
    const plan = adminPlan(workspace());
    const subject = `publisher/${ADMIN_PUBLICATION_SLOT}`;
    expect(adminPlanFindings({ ...plan, root: "/" })).toEqual([{ subject, detail: `${ADMIN_PUBLICATION_SLOT}: a fixed publication roots under its own static prefix, never /` }]);
    expect(adminPlanFindings({ ...plan, root: "/x" }).map(finding => finding.detail)).toContain(`${ADMIN_PUBLICATION_SLOT}: page route /admin is outside the publication root /x`);
    expect(adminPlanFindings({ ...plan, root: "/Admin" })).toEqual([{ subject, detail: `${ADMIN_PUBLICATION_SLOT}: root "/Admin" is not a static route` }]);
  });

  it("the seeded page record binds Writer copy to every section but the data-bound ones, and titles itself from the default's meta", () => {
    const plan = adminPlan(workspace());
    for (const page of plan.pages) {
      const record = page.record as { schema: string; path: string; frame: string; sections: string[]; title?: string; bindings?: Record<string, unknown>; meta: { source: { ref: string[] } } };
      expect(record.schema, page.id).toBe("clossys.page/1");
      expect(record.path, page.id).toBe(page.route);
      // The page composes its frame, the admin sidebar chrome's unit (rendered by the layout, not placed by the record), then its sections.
      expect([record.frame, "frames.app-sidebar", ...record.sections], page.id).toEqual(page.uses);
      expect(Object.keys(record.bindings ?? {}).filter(key => BOUND.includes(key)), page.id).toEqual([]);
      expect(record.meta.source.ref, page.id).toEqual([`@clossys/publisher:defaults/${page.id}/starter-v1.json`]);
    }
    expect(plan.record).toMatchObject({ schema: "clossys.publication/1", entryOrder: ["admin-home", "admin-gallery", "admin-slot", "admin-requests", "admin-questions"], routePack: { packId: "admin", homeRouteId: "admin-home" } });
  });

  it("mutation: a page option holding a data-bound section is exempt from the Writer-binding rule only while the section is data-bound, and may bind no copy", () => {
    const root = workspace();
    const plan = adminPlan(root);
    const gallery = plan.pages.find(page => page.id === "page.admin-gallery")!;
    const page = { kind: "page", publication: "admin", path: gallery.route, layouts: [`publisher/${gallery.layout}`] } as never;
    const layoutOf = () => undefined;
    const ruled = (dataBound: ReadonlySet<string>, record = gallery.record as Record<string, unknown>) =>
      pageOptionOf(gallery.id, record, page, layoutOf, [], dataBound).findings.filter(finding => finding.check === "page.record-key").map(finding => finding.message);
    expect(ruled(dataBoundSections(root))).toEqual([]);
    expect(ruled(new Set())).toContain("page.admin-gallery: sections.slot-gallery binds no Writer record (bindings.sections.slot-gallery.copy)");
    const bound = { ...gallery.record, bindings: { ...(gallery.record.bindings as Record<string, unknown>), "sections.slot-gallery": { copy: { "sections.slot-gallery.copy": "sections.slot-gallery.copy#x" } } } };
    expect(ruled(dataBoundSections(root), bound)).toEqual(["page.admin-gallery: sections.slot-gallery is a data-bound record section: it renders the clossys records it reads and binds no Writer copy (remove bindings.sections.slot-gallery)"]);
  });
});

describe("clossys init seeds the admin slots and adopts the loops of the agents it places", () => {
  // CP1-U2 (G14): a record is seeded only when the slot declares every slot it cites (candidates are immutable, R08, so an
  // inconsistent record is never written). A bare workspace holds no page's frame, sections or copy and no publication
  // meta copy, so every admin slot waits unseeded; the seeded path is pinned on a full world (publish/install-admin.e2e).
  it("--starters admin on a bare workspace seeds no admin record: each slot waits, its citations not yet declared", async () => {
    const root = workspace();
    const result = await runInitCli(["--starters", "admin", "--at", AT], root);
    expect(result.exitCode, result.message).toBe(0);
    const { admin } = outputOf(result);
    expect(admin.seeded).toEqual([]);
    expect(admin.pinned).toEqual([]);
    expect(admin.waiting.map(item => item.slot)).toEqual([...PAGES, ADMIN_PUBLICATION_SLOT]);
    for (const item of admin.waiting) expect(item.reason, item.slot).toMatch(/^not seeded: the record's citations are not the slot's declared inputs and uses \(undeclared: /);
    expect(admin.waiting.at(-1)!.reason).toContain("publication.admin.meta");
    for (const slot of [...PAGES, ADMIN_PUBLICATION_SLOT]) {
      const dir = join(publisherSlot(root, slot), "candidates");
      expect(existsSync(dir) ? readdirSync(dir) : [], slot).toEqual([]);
      expect(existsSync(join(publisherSlot(root, slot), "pin.json")), slot).toBe(false);
    }
    expect(result.message).toContain(`seeded 0 admin records; pinned 0; 6 wait (upstream pins, or citations that are not the declared inputs and uses): ${[...PAGES, ADMIN_PUBLICATION_SLOT].join(", ")}`);
  }, 120_000);

  it("a second init seeds nothing new; a slot holding another candidate is the consumer's and is not retried", async () => {
    const root = workspace();
    expect((await runInitCli(["--starters", "admin", "--at", AT], root)).exitCode).toBe(0);
    // The consumer's own candidate in one slot: init leaves that slot alone.
    mkdirSync(join(publisherSlot(root, "page.admin-home"), "candidates"), { recursive: true });
    writeFileSync(join(publisherSlot(root, "page.admin-home"), "candidates", "mine-v1.json"), "{}\n");
    const again = await runInitCli(["--starters", "admin", "--at", "2026-11-18T10:00:00Z"], root);
    expect(again.exitCode, again.message).toBe(0);
    const { admin } = outputOf(again);
    expect(admin.seeded).toEqual([]);
    expect(admin.pinned).toEqual([]);
    expect(admin.waiting.map(item => item.slot)).toEqual([...PAGES.slice(1), ADMIN_PUBLICATION_SLOT]);
    expect(readdirSync(join(publisherSlot(root, "page.admin-home"), "candidates"))).toEqual(["mine-v1.json"]);
  }, 120_000);

  it("a stray non-candidate file (.DS_Store) in an admin slot's candidates/ is ignored: the slot is still retried, not silently skipped", async () => {
    const root = workspace();
    expect((await runInitCli(["--starters", "admin", "--at", AT], root)).exitCode).toBe(0);
    mkdirSync(join(publisherSlot(root, "page.admin-gallery"), "candidates"), { recursive: true });
    writeFileSync(join(publisherSlot(root, "page.admin-gallery"), "candidates", ".DS_Store"), "\0\0\0\1Bud1");
    const again = await runInitCli(["--starters", "admin", "--at", "2026-11-18T10:00:00Z"], root);
    expect(again.exitCode, again.message).toBe(0);
    expect(outputOf(again).admin.waiting.map(item => item.slot)).toEqual([...PAGES, ADMIN_PUBLICATION_SLOT]);
  }, 120_000);

  it("on a workspace placing Director, Designer and Writer too, a fresh init adopts and pins all four agents' loops", async () => {
    const root = workspace();
    for (const agent of ["director", "designer", "writer"]) {
      mkdirSync(join(root, "clossys", "agents", agent), { recursive: true });
      writeFileSync(join(root, "clossys", "agents", agent, "ia.json"), `${JSON.stringify({
        schema: "clossys.ia/1", source: `consumer#agents/${agent}/tree.json`, extensions: [], nodes: [{ id: "main", label: "Main", children: [] }],
      }, null, 2)}\n`);
    }
    const result = await runInitCli(["--starters", "admin", "--at", AT], root);
    expect(result.exitCode, result.message).toBe(0);
    const { loops } = outputOf(result);
    expect([...loops.agents].sort()).toEqual(["designer", "director", "publisher", "writer"]);
    expect(loops.issues).toEqual([]);
    expect(loops.pinned).toHaveLength(4 * AGENT_LOOPS.length);
    expect(runLoopAgentStandard(root)).toEqual({ check: LOOP_AGENT_STANDARD, status: "pass", findings: [] });
  }, 180_000);

  it("adopts and pins Publisher's five loops on a fresh init, so loop.agent-standard passes; a second init changes nothing", async () => {
    const root = workspace();
    const result = await runInitCli(["--starters", "admin", "--at", AT], root);
    expect(result.exitCode, result.message).toBe(0);
    const { loops } = outputOf(result);
    // The init adopts the installed Director's IA too (CHAT-DIR gap 8), so the Director's loops are adopted with Publisher's.
    expect(loops.agents).toEqual(["director", "publisher"]);
    expect(loops.issues).toEqual([]);
    expect(loops.pinned).toHaveLength(2 * AGENT_LOOPS.length);
    expect(result.message).toContain(`adopted and pinned ${2 * AGENT_LOOPS.length} agent loops (director, publisher)`);
    expect(runLoopAgentStandard(root)).toEqual({ check: LOOP_AGENT_STANDARD, status: "pass", findings: [] });
    const again = await runInitCli(["--starters", "admin", "--at", "2026-11-18T10:00:00Z"], root);
    expect(again.exitCode, again.message).toBe(0);
    expect(outputOf(again).loops.pinned).toEqual([]);
    expect(runLoopAgentStandard(root).status).toBe("pass");
  }, 120_000);

  it("mutation: a placed agent whose loops init did not adopt is red in loop.agent-standard (the adoption is what makes it pass)", async () => {
    const root = workspace();
    expect((await runInitCli(["--starters", "admin", "--at", AT], root)).exitCode).toBe(0);
    rmSync(join(root, "clossys", "agents", "publisher", "loop.scope"), { recursive: true, force: true });
    const result = runLoopAgentStandard(root);
    expect(result.status).toBe("fail");
    expect(result.findings.map(finding => finding.subject)).toContain("publisher/loop.scope");
  }, 120_000);
});
