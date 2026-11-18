/**
 * foundry-build-0048 U20b: the admin records reader. Read-only and never throwing: a valid record becomes a port row,
 * a missing or invalid one is left out with its reason in `issues`, and an absent workspace yields empty ports (so a
 * data-bound section renders its empty state). `adminRouteParams` gives a dynamic route only the values no static
 * sibling route reserves.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { raiseRequest } from "../records/request.js";
import { ADMIN_RECORDS_SCHEMA, adminRouteParams, readAdminRecords, type AdminRecords } from "./admin-records.js";

const AT = "2026-11-18T09:00:00Z";
const fixture = join(import.meta.dirname, "__fixtures__", "install-consumer");
const temps: string[] = [];
afterAll(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });
const scratch = () => { const dir = realpathSync(mkdtempSync(join(tmpdir(), "admin-records-"))); temps.push(dir); return dir; };
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function question(root: string, id: string, fields: Record<string, unknown>) {
  const dir = join(root, "clossys", "agents", "producer", "queue.pick", "entries");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), json({
    schema: "clossys.queue-entry/1", id, agent: "producer", kind: "queue-entry", status: "open", queue: "queue.pick",
    ask: "DRAFT Which hero candidate ships?", subject: "designer/sections.hero", decider: "owner", default: "simple-hero-v3",
    createdAt: AT, refs: [], events: [{ at: AT, op: "raised", by: "agent:designer" }], ...fields,
  }));
}

function workspace(): string {
  const root = scratch();
  cpSync(fixture, root, { recursive: true });
  return root;
}

describe("readAdminRecords", () => {
  it("fills the five ports from valid records: placed slots, slot detail with pin, candidates, open questions, requests", () => {
    const root = workspace();
    question(root, "20261118T0900Z-hero-pick", {});
    raiseRequest(join(root, "clossys"), { target: "designer/sections.pricing-matrix", from: "owner", rel: "uses", why: "DRAFT the pricing page needs a matrix", source: "ia", by: "producer", at: AT });
    const records = readAdminRecords(root);
    expect(records.schema).toBe(ADMIN_RECORDS_SCHEMA);
    expect([...records.agents].sort()).toEqual(["designer", "director", "publisher", "writer"]);
    expect(records.ports.slots.designer!.map(row => row.id)).toContain("frames.plain");
    expect(records.ports.slots.designer!.find(row => row.id === "frames.plain")).toEqual({ id: "frames.plain", kind: "element", status: null, group: "frames.extensions/extensions" });
    expect(records.slots).toContainEqual({ agent: "designer", slot: "frames.plain" });
    expect(records.ports.slot["designer/frames.plain"]).toMatchObject({ agent: "designer", kind: "element", inputs: [], uses: [], pin: { candidate: "plain-frame-v3.json", decidedBy: "planner:COPY-SLOT-CONTRACT" } });
    expect(records.ports.candidates["designer/frames.plain"]).toEqual([
      { name: "plain-frame-v1.json", version: 1, pinned: false },
      { name: "plain-frame-v2.json", version: 2, pinned: false },
      { name: "plain-frame-v3.json", version: 3, pinned: true },
    ]);
    expect(records.ports.questions[""]).toEqual([{ id: "20261118T0900Z-hero-pick", queue: "queue.pick", ask: "DRAFT Which hero candidate ships?", subject: "designer/sections.hero", default: "simple-hero-v3", options: [] }]);
    expect(records.ports.entries[""]!.map(row => [row.target, row.status, row.why])).toEqual([["designer/sections.pricing-matrix", "open", "DRAFT the pricing page needs a matrix"]]);
  });

  it("leaves out a missing or invalid record with its reason, never throwing; a closed question is no row", () => {
    const root = workspace();
    // A placed slot with no slot.json (sections.hero holds candidates only) and a slot whose slot.json is not JSON.
    writeFileSync(join(root, "clossys", "agents", "designer", "frames.plain", "slot.json"), "{ not json");
    question(root, "20261118T0901Z-closed", { status: "closed" });
    question(root, "20261118T0902Z-no-ask", { ask: "" });
    const requests = join(root, "clossys", "agents", "producer", "queue.slot", "entries");
    mkdirSync(requests, { recursive: true });
    writeFileSync(join(requests, "broken.json"), "{");
    let records: AdminRecords | undefined;
    expect(() => { records = readAdminRecords(root); }).not.toThrow();
    const ids = records!.ports.slots.designer!.map(row => row.id);
    expect(ids).not.toContain("frames.plain");
    expect(ids).not.toContain("sections.hero");
    expect(records!.ports.slot["designer/frames.plain"]).toBeUndefined();
    expect(records!.slots).not.toContainEqual({ agent: "designer", slot: "frames.plain" });
    expect(records!.issues).toEqual(expect.arrayContaining([
      "designer/frames.plain: slot.json is missing or not a valid slot",
      "designer/sections.hero: slot.json is missing or not a valid slot",
      "queue.pick/20261118T0902Z-no-ask: not a valid clossys.queue-entry/1 entry",
    ]));
    expect(records!.issues.some(issue => issue.startsWith("agents/producer/queue.slot/entries/broken.json: not JSON"))).toBe(true);
    expect(records!.ports.questions[""]).toEqual([]);
    expect(records!.ports.entries[""]).toEqual([]);
  });

  it("an unreadable ia.json leaves that agent out; an absent workspace yields empty ports", () => {
    const root = workspace();
    writeFileSync(join(root, "clossys", "agents", "writer", "ia.json"), "{ not json");
    const records = readAdminRecords(root);
    expect(records.agents).not.toContain("writer");
    expect(records.ports.slots.writer).toBeUndefined();
    expect(records.issues.some(issue => issue.startsWith("writer/ia.json: "))).toBe(true);

    const empty = readAdminRecords(scratch());
    expect(empty).toEqual({ schema: ADMIN_RECORDS_SCHEMA, agents: [], slots: [], ports: { slots: {}, slot: {}, candidates: {}, questions: { "": [] }, entries: { "": [] } }, issues: [] });
  });

  it("writes nothing: the workspace bytes are unchanged by a read", () => {
    const root = workspace();
    const pin = join(root, "clossys", "agents", "designer", "frames.plain", "pin.json");
    const before = readFileSync(pin, "utf8");
    readAdminRecords(root);
    expect(readFileSync(pin, "utf8")).toBe(before);
  });
});

describe("adminRouteParams", () => {
  const records = {
    schema: ADMIN_RECORDS_SCHEMA, agents: ["designer", "requests"], issues: [],
    slots: [{ agent: "designer", slot: "sections.hero" }, { agent: "requests", slot: "sections.hero" }],
    ports: { slots: {}, slot: {}, candidates: {}, questions: { "": [] }, entries: { "": [] } },
  } as AdminRecords;
  const routes = ["/admin", "/admin/<agent>", "/admin/<agent>/<slot>", "/admin/requests", "/admin/questions"];

  it("gives <agent> the placed agents and <agent>/<slot> their slots, minus values a static sibling reserves", () => {
    expect(adminRouteParams(records, "/admin/<agent>", routes)).toEqual([{ agent: "designer" }]);
    // Only a static sibling at the same depth reserves a value: no static route sits at /admin/requests/<slot>.
    expect(adminRouteParams(records, "/admin/<agent>/<slot>", routes)).toEqual([{ agent: "designer", slot: "sections.hero" }, { agent: "requests", slot: "sections.hero" }]);
    expect(adminRouteParams(records, "/admin/<agent>/<slot>", [...routes, "/admin/requests/settings"])).toEqual([{ agent: "designer", slot: "sections.hero" }]);
  });

  it("a route with any other parameter has no values from the records", () => {
    expect(adminRouteParams(records, "/admin/<page>", routes)).toBeUndefined();
    expect(adminRouteParams(records, "/admin", routes)).toBeUndefined();
  });
});
