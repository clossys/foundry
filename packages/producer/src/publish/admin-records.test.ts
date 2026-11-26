/**
 * foundry-build-0048 U20b: the admin records reader. Read-only and never throwing: a valid record becomes a port row,
 * a missing or invalid one is left out with its reason in `issues`, and an absent workspace yields empty ports (so a
 * data-bound section renders its empty state). `adminRouteParams` gives a dynamic route only the values no static
 * sibling route reserves. CP1-G1: the rows carry the slot contract, the candidates' metadata and specimen, the IA tree
 * fields and the detail href; the record set carries the labels of the pinned `writer/sections.records.copy`.
 */
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveRequirements } from "../constitution/criteria/core/verdict.js";
import { migrateSlot1To2 } from "../migrate/slot-1-to-2.js";
import { recutCandidateBytes } from "../records/candidate-codec.js";
import { raiseRequest } from "../records/request.js";
import { readStandard } from "../records/standards.js";
import { ADMIN_LABELS_SLOT, ADMIN_RECORDS_SCHEMA, adminRouteParams, readAdminRecords, type AdminRecords } from "./admin-records.js";

const AT = "2026-11-18T09:00:00Z";
const fixture = join(import.meta.dirname, "__fixtures__", "install-consumer");
const temps: string[] = [];
afterAll(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });
const scratch = () => { const dir = realpathSync(mkdtempSync(join(tmpdir(), "admin-records-"))); temps.push(dir); return dir; };
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const UNPINNED = `writer/${ADMIN_LABELS_SLOT}: not pinned, so the record sections have no labels`;

/** A Writer strings slot under the writer IA node `strings`, group `<group>`, its one candidate pinned. */
function writerStrings(root: string, slot: string, group: string, rows: Record<string, string>): void {
  const writer = join(root, "clossys", "agents", "writer");
  const ia = JSON.parse(readFileSync(join(writer, "ia.json"), "utf8")) as { nodes: { id: string; children: { id: string; label: string; slots: string[] }[] }[] };
  ia.nodes.find(node => node.id === "strings")!.children.push({ id: group, label: group, slots: [slot] });
  writeFileSync(join(writer, "ia.json"), json(ia));
  const dir = join(writer, slot);
  mkdirSync(join(dir, "candidates"), { recursive: true });
  writeFileSync(join(dir, "slot.json"), json({ schema: "clossys.slot/1", id: slot, agent: "writer", kind: "strings", ia: { l0: "strings", l1: "strings", l2: group, order: 0 }, contract: {}, inputs: [], uses: [] }));
  const body = Object.entries(rows).map(([key, text]) => `### ${key}\n<!-- ${JSON.stringify({ id: key, bindings: [] })} -->\n${text}\n`).join("\n");
  const bytes = `---\nslot: ${JSON.stringify(slot)}\nsource: {"kind":"original","ref":[]}\nlocales: ["en"]\n---\n\n## en\n\n${body}`;
  writeFileSync(join(dir, "candidates", "copy-v1.md"), bytes);
  writeFileSync(join(dir, "pin.json"), json({ candidate: "copy-v1.md", sha256: sha(bytes), decidedBy: "planner:CP1-G1-FIXTURE", basis: "planner", at: AT }));
}

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
    expect(records.ports.slots.designer!.find(row => row.id === "frames.plain")).toEqual({
      id: "frames.plain", kind: "element", status: null, group: "frames.extensions/extensions",
      l1: "frames.extensions", l2: "extensions", l1Label: null, l2Label: null, href: null,
    });
    expect(records.slots).toContainEqual({ agent: "designer", slot: "frames.plain" });
    expect(records.ports.slot["designer/frames.plain"]).toMatchObject({ agent: "designer", kind: "element", inputs: [], uses: [], pin: { candidate: "plain-frame-v3.json", decidedBy: "planner:COPY-SLOT-CONTRACT" } });
    const unrecorded = { status: null, rung: null, source: "original", createdBy: null, specimen: null };
    expect(records.ports.candidates["designer/frames.plain"]).toEqual([
      { name: "plain-frame-v1.json", version: 1, pinned: false, ...unrecorded },
      { name: "plain-frame-v2.json", version: 2, pinned: false, ...unrecorded },
      { name: "plain-frame-v3.json", version: 3, pinned: true, ...unrecorded },
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
    // No labels slot is pinned: the labels are absent (no literal fallback) and the reason is the one issue.
    expect(empty).toEqual({ schema: ADMIN_RECORDS_SCHEMA, agents: [], slots: [], ports: { slots: {}, slot: {}, candidates: {}, questions: { "": [] }, entries: { "": [] } }, issues: [UNPINNED] });
  });

  it("CP1-G1: exposes the slot contract, candidate metadata and specimen, IA tree fields and names, and the detail href", () => {
    const root = workspace();
    const designer = join(root, "clossys", "agents", "designer");
    // The slot states its purpose and standard; its standard's requirements resolve to its rule ids.
    const slotFile = join(designer, "frames.plain", "slot.json");
    const contract = { purpose: "DRAFT the plain page frame" };
    writeFileSync(slotFile, json({ ...JSON.parse(readFileSync(slotFile, "utf8")), standard: "frame", contract }));
    // The v3 candidate's submit records its rung; v3 has a render index with one PNG, v2 an index whose PNG escapes the renders folder.
    const v3 = readFileSync(join(designer, "frames.plain", "candidates", "plain-frame-v3.json"), "utf8");
    writeFileSync(join(designer, "frames.plain", "ledger.json"), json({ schema: "clossys.ledger/1", events: [
      { op: "submit", at: AT, by: "agent:designer", verb: "submit", skill: { path: "packages/producer/actions/submit/skill.md", sha256: null }, model: "none", tier: "none", name: "plain-frame-v3.json", sha256: sha(v3), rung: "adapt" },
    ] }));
    const renders = (stem: string) => join(root, "clossys", ".state", "renders", "designer", "frames.plain", stem);
    const png = Buffer.from("DRAFT CP1-G1 fixture png bytes");
    mkdirSync(renders("plain-frame-v3"), { recursive: true });
    writeFileSync(join(renders("plain-frame-v3"), "element-480.png"), png);
    const v3png = "clossys/.state/renders/designer/frames.plain/plain-frame-v3/element-480.png";
    writeFileSync(join(renders("plain-frame-v3"), "index.json"), json({ specimens: [{ candidate: "plain-frame-v3.json", specimen: "element", width: 480, png: v3png }] }));
    mkdirSync(renders("plain-frame-v2"), { recursive: true });
    writeFileSync(join(renders("plain-frame-v2"), "index.json"), json({ specimens: [{ candidate: "plain-frame-v2.json", specimen: "element", width: 480, png: "clossys/agents/designer/frames.plain/pin.json" }] }));
    // The Writer names the slot's IA L1 and L2.
    writerStrings(root, "strings.names", "names", { "designer.ia.frames.extensions": "DRAFT Frame extensions", "designer.ia.extensions": "DRAFT Extensions" });
    const routes = ["/", "/agents", "/agents/<agent>", "/agents/<agent>/<slot>", "/agents/requests"];
    const records = readAdminRecords(root, { routes });

    expect(records.ports.slots.designer!.find(row => row.id === "frames.plain")).toEqual({
      id: "frames.plain", kind: "element", status: null, group: "frames.extensions/extensions",
      l1: "frames.extensions", l2: "extensions", l1Label: "DRAFT Frame extensions", l2Label: "DRAFT Extensions", href: "/agents/designer/frames.plain",
    });
    expect(records.ports.slots.writer!.find(row => row.id === "strings.site")!.href).toBe("/agents/writer/strings.site");
    const requirements = readStandard(root, "designer", "frame").doc!.requirements;
    const rules = resolveRequirements(requirements, contract).map(item => item.check);
    expect(rules.length).toBeGreaterThan(0);
    expect(records.ports.slot["designer/frames.plain"]!.contract).toEqual({ purpose: "DRAFT the plain page frame", inputs: [], uses: [], rules });
    const [v1, v2, v3row] = records.ports.candidates["designer/frames.plain"]!;
    expect(v3row).toEqual({ name: "plain-frame-v3.json", version: 3, pinned: true, status: null, rung: "adapt", source: "original", createdBy: null, specimen: { sha256: sha(png), path: v3png } });
    expect(v1!.specimen).toBeNull();
    expect(v2!.specimen).toBeNull();
    expect(records.issues).toContain("designer/frames.plain/plain-frame-v2.json: render index png clossys/agents/designer/frames.plain/pin.json is outside clossys/.state/renders");
    // A Markdown candidate's source kind is its front matter's.
    expect(records.ports.candidates["writer/strings.site"]!.map(row => row.source)).toEqual(["original", "original"]);

    // No content-map route takes <agent> and <slot>: every href is null.
    const plain = readAdminRecords(root, { routes: ["/", "/agents", "/agents/<agent>"] });
    expect(Object.values(plain.ports.slots).flat().map(row => row.href)).toEqual(Object.values(plain.ports.slots).flat().map(() => null));
    expect(readAdminRecords(root).ports.slots.designer!.find(row => row.id === "frames.plain")!.href).toBeNull();
    // A value a static sibling reserves has no href; two detail routes are ambiguous, so none, and it is an issue.
    const reserved = readAdminRecords(root, { routes: [...routes, "/agents/writer/settings"] });
    expect(reserved.ports.slots.writer!.find(row => row.id === "strings.site")!.href).toBeNull();
    expect(reserved.ports.slots.designer!.find(row => row.id === "frames.plain")!.href).toBe("/agents/designer/frames.plain");
    const twice = readAdminRecords(root, { routes: [...routes, "/admin/<agent>/<slot>"] });
    expect(twice.ports.slots.designer!.find(row => row.id === "frames.plain")!.href).toBeNull();
    expect(twice.issues).toContain("routes: 2 content-map routes take <agent> and <slot> (/agents/<agent>/<slot>, /admin/<agent>/<slot>), so no slot has a detail href");
  });

  it("CP1-G1: a clossys.candidate/1 candidate's row carries its header status and creator", () => {
    const root = workspace();
    const dir = join(root, "clossys", "agents", "designer", "frames.plain", "candidates");
    const at = "2026-11-15T10:00:00Z" as const;
    const name = "plain-frame-v1.json";
    writeFileSync(join(dir, name), recutCandidateBytes(name, readFileSync(join(dir, name), "utf8"), { agent: "designer", slotId: "frames.plain", at, version: "0.0.0", sourceRef: `agents/designer/frames.plain/candidates/${name}` }));
    migrateSlot1To2(root, { at, version: "0.0.0" });
    const row = readAdminRecords(root).ports.candidates["designer/frames.plain"]!.find(each => each.name === name)!;
    expect(row.status).toMatch(/^[a-z]+$/);
    expect(row.createdBy).toMatch(/\S/);
  });

  it("CP1-G1: labels resolve from the pinned writer/sections.records.copy; unpinned or drifted, they are absent and reported", () => {
    const root = workspace();
    expect(readAdminRecords(root).labels).toBeUndefined();
    expect(readAdminRecords(root).issues).toContain(UNPINNED);
    writerStrings(root, ADMIN_LABELS_SLOT, "records", { slot: "DRAFT Slot", "gallery-heading": "DRAFT Slots", "status-live": "DRAFT Live", "sections.records.copy.pin-none": "DRAFT Not pinned" });
    const records = readAdminRecords(root);
    expect(records.labels).toEqual({ slot: "DRAFT Slot", "gallery-heading": "DRAFT Slots", "status-live": "DRAFT Live", "pin-none": "DRAFT Not pinned" });
    expect(records.issues.filter(issue => issue.startsWith(`writer/${ADMIN_LABELS_SLOT}:`))).toEqual([]);
    // Bytes that no longer match the pin are not the pinned labels.
    const candidate = join(root, "clossys", "agents", "writer", ADMIN_LABELS_SLOT, "candidates", "copy-v1.md");
    writeFileSync(candidate, readFileSync(candidate, "utf8").replace("DRAFT Slots", "DRAFT Drifted"));
    const drifted = readAdminRecords(root);
    expect(drifted.labels).toBeUndefined();
    expect(drifted.issues).toContain(`writer/${ADMIN_LABELS_SLOT}: copy-v1.md does not match its pin, so the record sections have no labels`);
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
