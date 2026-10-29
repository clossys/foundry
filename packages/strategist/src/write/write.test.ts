import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCatalog } from "../catalog.js";
import { formatRef } from "../format/ref.js";
import { activate, propose, createRequest, listRequests, resolveRequest } from "./index.js";

const a = "focus.segment.core", b = "advantage.proposition.promise", session = "2026-10-29-1";
let root: string;
function put(path: string, bytes: string) {
  const file = join(root, path);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, bytes);
}
function bytes(id = a, version = 1, status = "draft") {
  const keys = loadCatalog().cells.find(c => c.id === id)!.mustContain.map(k => k.key);
  return `---\nid: ${id}\nversion: ${version}\nstatus: ${status}\nupdated: 2026-10-29\ncites: [msg:${session}#U1]\nfeeds: []\nfunctions: [product]\n${status === "active" ? `confirmed: msg:${session}#U3\n` : ""}---\n\n## Direction\n${keys.map(k => `- ${k}: Only ceramic studios with 40 members over home potters.`).join("\n")}\n\n## Because\n- The studio owner reported 40 members (msg:${session}#U1).\n\n## Watch\n- If members falls below 20 by 2027-01-01, then review this choice.\n`;
}
function playback(refs: string[], confirm = "U3") {
  put(`sessions/${session}.md`, `- U1: We have 40 studio members.\n- S2: Playback for confirm: ${refs.join(", ")}\n- ${confirm}: Yes, those choices.\n`);
}
function tree(active: Record<string, number | null> = {}) {
  put("tree.json", JSON.stringify({ schemaVersion: 1, catalog: "@clossys/strategist#strategy-v1", archetype: "default", core: "archetype", active }));
}
const confirm = `msg:${session}#U3`;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "strategy-write-")); tree(); playback([formatRef({ kind: "cell", ref: { cell: a, version: 1 } })]); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("propose", () => {
  it("creates catalog-key v1 and never overwrites existing versions", () => {
    expect(propose(root, a, { today: "2026-10-29" }).version).toBe(1);
    const first = readFileSync(join(root, `cells/${a}/v1.md`), "utf8");
    expect(first).toContain("## Direction");
    for (const key of loadCatalog().cells.find(c => c.id === a)!.mustContain) expect(first).toContain(`- ${key.key}:`);
    expect(propose(root, a).version).toBe(2);
    expect(readFileSync(join(root, `cells/${a}/v1.md`), "utf8")).toBe(first);
  });
  it("copies a pinned version into max+1, drops confirmation and preserves its body", () => {
    put(`cells/${a}/v1.md`, bytes(a, 1, "active")); tree({ [a]: 1 });
    put(`cells/${a}/v4.md`, bytes(a, 4, "retired"));
    expect(propose(root, a, { from: 1, option: "B" }).version).toBe(5);
    const draft = readFileSync(join(root, `cells/${a}/v5.md`), "utf8");
    expect(draft).toContain("status: draft"); expect(draft).toContain("note: option B");
    expect(draft).not.toContain("confirmed:"); expect(body(draft)).toBe(body(bytes(a, 1, "active")));
  });
  it("defaults to the latest existing content and clears its active confirmation", () => {
    put(`cells/${a}/v1.md`, bytes(a, 1, "active")); tree({ [a]: 1 });
    const next = propose(root, a);
    expect(next.version).toBe(2);
    const draft = readFileSync(join(root, `cells/${a}/v2.md`), "utf8");
    expect(body(draft)).toBe(body(bytes(a, 1, "active")));
    expect(draft).toContain("status: draft"); expect(draft).not.toContain("confirmed:");
  });
  it("rejects unknown ids, invalid versions, missing source and traversal", () => {
    for (const id of ["../escape", "unknown.cell.id"]) expect(() => propose(root, id)).toThrow();
    expect(() => propose(root, a, { from: 0 })).toThrow();
    expect(() => propose(root, a, { from: 4 })).toThrow();
  });
});
function body(text: string) { return text.slice(text.indexOf("\n---", 4) + 4); }
function snap() { return readFileSync(join(root, "tree.json"), "utf8") + readFileSync(join(root, `cells/${a}/v1.md`), "utf8"); }

describe("activate", () => {
  beforeEach(() => put(`cells/${a}/v1.md`, bytes()));
  it.each([undefined, `msg:${session}#S2`, `msg:${session}#U99`, "finding:approval"])("refuses invalid confirmation %s without writes", confirm => {
    const before = snap(); expect(() => activate(root, [formatRef({ kind: "cell", ref: { cell: a, version: 1 } })], { confirm })).toThrow(); expect(snap()).toBe(before);
  });
  it("rejects a strategist S-confirm directly after the listed playback", () => {
    playback([formatRef({ kind: "cell", ref: { cell: a, version: 1 } })], "S3"); const before = snap();
    expect(() => activate(root, [formatRef({ kind: "cell", ref: { cell: a, version: 1 } })], { confirm: `msg:${session}#S3` })).toThrow();
    expect(snap()).toBe(before);
  });
  it.each([formatRef({ kind: "cell", ref: { cell: a, version: 10 } }), `${formatRef({ kind: "cell", ref: { cell: a, version: 1 } })}oops`, `${formatRef({ kind: "cell", ref: { cell: a, version: 1 } })}.5`, `${formatRef({ kind: "cell", ref: { cell: a, version: 1 } })}/other`, `other.${formatRef({ kind: "cell", ref: { cell: a, version: 1 } })}`, `prefix-${formatRef({ kind: "cell", ref: { cell: a, version: 1 } })}`, `X${formatRef({ kind: "cell", ref: { cell: a, version: 1 } })}`, `other_${formatRef({ kind: "cell", ref: { cell: a, version: 1 } })}`])("refuses near-match playback token %s", token => {
    playback([token]); const before = snap();
    expect(() => activate(root, [formatRef({ kind: "cell", ref: { cell: a, version: 1 } })], { confirm })).toThrow(); expect(snap()).toBe(before);
  });
  it("accepts a listed ref followed by sentence punctuation", () => {
    playback([`${formatRef({ kind: "cell", ref: { cell: a, version: 1 } })}.`]); expect(activate(root, [formatRef({ kind: "cell", ref: { cell: a, version: 1 } })], { confirm }).activated).toEqual([formatRef({ kind: "cell", ref: { cell: a, version: 1 } })]);
  });
  it("refuses an unlisted target, an omitted listed target, duplicate ids and retired targets", () => {
    playback([formatRef({ kind: "cell", ref: { cell: b, version: 1 } })]); expect(() => activate(root, [formatRef({ kind: "cell", ref: { cell: a, version: 1 } })], { confirm })).toThrow();
    playback([formatRef({ kind: "cell", ref: { cell: a, version: 1 } }), formatRef({ kind: "cell", ref: { cell: b, version: 1 } })]); expect(() => activate(root, [formatRef({ kind: "cell", ref: { cell: a, version: 1 } })], { confirm })).toThrow();
    playback([formatRef({ kind: "cell", ref: { cell: a, version: 1 } })]); expect(() => activate(root, [formatRef({ kind: "cell", ref: { cell: a, version: 1 } }), formatRef({ kind: "cell", ref: { cell: a, version: 1 } })], { confirm })).toThrow();
    put(`cells/${a}/v1.md`, bytes(a, 1, "retired")); expect(() => activate(root, [formatRef({ kind: "cell", ref: { cell: a, version: 1 } })], { confirm })).toThrow();
  });
  it("refuses a hard Q finding and judge failure before changing any file", () => {
    put(`cells/${a}/v1.md`, bytes().replace("Only ceramic studios with 40 members over home potters.", "best-in-class solutions"));
    const before = snap(); expect(() => activate(root, [formatRef({ kind: "cell", ref: { cell: a, version: 1 } })], { confirm })).toThrow(); expect(snap()).toBe(before);
    put(`cells/${a}/v1.md`, bytes());
    expect(() => activate(root, [formatRef({ kind: "cell", ref: { cell: a, version: 1 } })], { confirm, judgeVerdicts: { [`Q2:${formatRef({ kind: "cell", ref: { cell: a, version: 1 } })}`]: "fail" } })).toThrow();
  });
  it("activates exactly a listed batch, moves pointers, and only changes sibling status", () => {
    put(`cells/${a}/v1.md`, bytes(a, 1, "active")); tree({ [a]: 1 });
    put(`cells/${a}/v2.md`, bytes(a, 2)); put(`cells/${a}/v3.md`, bytes(a, 3).replace("functions: [product]", "functions: [product]\nnote: option C"));
    put(`cells/${a}/v4.md`, bytes(a, 4, "retired"));
    put(`cells/${a}/v5.md`, bytes(a, 5));
    put(`cells/${b}/v1.md`, bytes(b)); playback([formatRef({ kind: "cell", ref: { cell: a, version: 2 } }), formatRef({ kind: "cell", ref: { cell: b, version: 1 } })]);
    const old = [1, 3, 4].map(n => readFileSync(join(root, `cells/${a}/v${n}.md`), "utf8"));
    expect(activate(root, [formatRef({ kind: "cell", ref: { cell: b, version: 1 } }), formatRef({ kind: "cell", ref: { cell: a, version: 2 } })], { confirm }).activated).toHaveLength(2);
    expect(JSON.parse(readFileSync(join(root, "tree.json"), "utf8")).active).toEqual({ [a]: 2, [b]: 1 });
    [1, 3, 4].forEach((n, i) => expect(readFileSync(join(root, `cells/${a}/v${n}.md`), "utf8")).toBe(old[i]!.replace(/^status: .+$/m, "status: retired")));
    expect(body(readFileSync(join(root, `cells/${a}/v2.md`), "utf8"))).toBe(body(bytes(a, 2)));
    expect(readFileSync(join(root, `cells/${a}/v5.md`), "utf8")).toBe(bytes(a, 5));
  });
  it("refuses same-cell batch options and leaves the full batch untouched on one bad cell", () => {
    put(`cells/${a}/v2.md`, bytes(a, 2)); playback([formatRef({ kind: "cell", ref: { cell: a, version: 1 } }), formatRef({ kind: "cell", ref: { cell: a, version: 2 } })]);
    expect(() => activate(root, [formatRef({ kind: "cell", ref: { cell: a, version: 1 } }), formatRef({ kind: "cell", ref: { cell: a, version: 2 } })], { confirm })).toThrow();
    put(`cells/${b}/v1.md`, bytes(b).replace("## Watch", "## Invalid")); playback([formatRef({ kind: "cell", ref: { cell: a, version: 1 } }), formatRef({ kind: "cell", ref: { cell: b, version: 1 } })]);
    const before = snap(); expect(() => activate(root, [formatRef({ kind: "cell", ref: { cell: a, version: 1 } }), formatRef({ kind: "cell", ref: { cell: b, version: 1 } })], { confirm })).toThrow(); expect(snap()).toBe(before);
  });
});

describe("requests", () => {
  it("allocates requests and links drafting to the actual activated version", () => {
    const request = createRequest(root, { raisedBy: "researcher", kind: "change", cells: [a], detail: "Clarify the studio segment.", today: "2026-10-29" });
    expect(request.id).toBe("REQ-0001");
    expect(createRequest(root, { raisedBy: "researcher", kind: "missing", cells: [b], detail: "Add promise." }).id).toBe("REQ-0002");
    const draft = propose(root, a, { requestIds: [request.id] });
    expect(listRequests(root).find(r => r.id === request.id)?.status).toBe("drafted");
    expect(() => resolveRequest(root, request.id, formatRef({ kind: "cell", ref: { cell: a, version: 1 } }), confirm)).toThrow();
    put(`cells/${a}/v${draft.version}.md`, bytes(a, draft.version));
    activate(root, [formatRef({ kind: "cell", ref: { cell: a, version: 1 } })], { confirm });
    expect(listRequests(root).map(r => r.status)).toEqual(["resolved", "open"]);
    expect(listRequests(root)[0]?.resolvedBy).toEqual({ kind: "cell", ref: { cell: a, version: 1 } });
    expect(JSON.parse(readFileSync(join(root, "requests/REQ-0001.json"), "utf8")).resolvedBy).toBe(formatRef({ kind: "cell", ref: { cell: a, version: 1 } }));
  });
  it("repairs resolution only against an already activated linked ref and its actual confirmation", () => {
    const request = createRequest(root, { raisedBy: "researcher", kind: "change", cells: [a], detail: "Review." });
    propose(root, a, { requestIds: [request.id] }); put(`cells/${a}/v1.md`, bytes());
    activate(root, [formatRef({ kind: "cell", ref: { cell: a, version: 1 } })], { confirm });
    const path = `requests/${request.id}.json`;
    const resolved = JSON.parse(readFileSync(join(root, path), "utf8")); put(path, JSON.stringify({ ...resolved, status: "drafted" }));
    expect(() => resolveRequest(root, request.id, formatRef({ kind: "cell", ref: { cell: a, version: 1 } }), `msg:${session}#S2`)).toThrow();
    expect(resolveRequest(root, request.id, formatRef({ kind: "cell", ref: { cell: a, version: 1 } }), confirm).status).toBe("resolved");
  });
  it("does not resolve a request linked to a sibling option", () => {
    const request = createRequest(root, { raisedBy: "researcher", kind: "change", cells: [a], detail: "Review." });
    propose(root, a, { option: "A", requestIds: [request.id] }); propose(root, a, { from: 1, option: "B" });
    put(`cells/${a}/v2.md`, bytes(a, 2)); playback([formatRef({ kind: "cell", ref: { cell: a, version: 2 } })]); activate(root, [formatRef({ kind: "cell", ref: { cell: a, version: 2 } })], { confirm });
    expect(listRequests(root)[0]?.status).toBe("drafted");
    expect(() => resolveRequest(root, request.id, formatRef({ kind: "cell", ref: { cell: a, version: 2 } }), confirm)).toThrow();
  });
});
