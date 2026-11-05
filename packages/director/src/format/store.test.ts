import { reader } from "../../test/store.js";
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStrategyRoot } from "../store.js";
import type { DirectorStoreReader } from "../store-io.js";
import { evidenceDir, stageFinding, stageSlot, strategyRoot } from "../ground/fixtures.js";

const temps: string[] = [];
afterEach(() => { for (const path of temps.splice(0)) rmSync(path, { recursive: true, force: true }); });
function base() { const path = mkdtempSync(join(tmpdir(), "strategy-flat-")); temps.push(path); return path; }
const SEGMENT = "focus.segment.core";

/** Records every root-relative path the reader is asked for. */
function recording(): { reader: DirectorStoreReader; paths: string[] } {
  const paths: string[] = [];
  return {
    paths,
    reader: {
      stat: (root, path) => { paths.push(path); return reader.stat(root, path); },
      list: (root, path) => { paths.push(path); return reader.list(root, path); },
      read: (root, path) => { paths.push(path); return reader.read(root, path); },
    },
  };
}

describe("flat slot root reader", () => {
  it("reads the pinned candidate of a flat slot folder as the active cell", () => {
    const root = strategyRoot(base());
    const { path, bytes } = stageSlot(root, SEGMENT, 2, "Who: owner-led studios.", { refs: ["finding:signups"] });
    const model = readStrategyRoot(root, reader);
    expect(model.issues).toEqual([]);
    expect(model.tree!.active[SEGMENT]).toBe(2);
    expect(model.cells).toHaveLength(1);
    expect(model.cells[0]).toMatchObject({ id: SEGMENT, version: 2, status: "active", path, updated: "2026-10-29", cites: [{ kind: "finding", id: "signups" }] });
    expect(model.cells[0]!.direction).toEqual([expect.objectContaining({ key: "Who", text: "owner-led studios." })]);
    expect(model.files[path]).toBe(bytes);
  });
  it("never reads a legacy tree.json, cells/, sessions/, requests/ or role findings/ path", () => {
    const root = strategyRoot(base());
    stageSlot(root, SEGMENT, 1, "Who: owner-led studios.");
    stageFinding(root, "signups");
    for (const legacy of ["cells", "sessions", "requests", "findings"]) mkdirSync(join(root, legacy));
    writeFileSync(join(root, "tree.json"), "{}");
    const { reader: spy, paths } = recording();
    const model = readStrategyRoot(root, spy);
    expect(model.cells.map(cell => cell.id)).toEqual([SEGMENT]);
    expect(model.findings.map(finding => finding.id)).toEqual(["signups"]);
    expect(paths.filter(path => /^(tree\.json|cells|sessions|requests|findings)(\/|$)/.test(path))).toEqual([]);
  });
  it("leaves an unpinned slot without an active cell", () => {
    const root = strategyRoot(base());
    stageSlot(root, SEGMENT, 1, "Who: owner-led studios.", { unpinned: true });
    const model = readStrategyRoot(root, reader);
    expect(model.issues).toEqual([]);
    expect(model.cells).toEqual([]);
    expect(model.tree!.active[SEGMENT]).toBeNull();
    expect(model.candidateVersions).toEqual({ [SEGMENT]: [1] });
  });
  it("refuses a pinned candidate whose bytes disagree with the pin sha256", () => {
    const root = strategyRoot(base());
    const { path } = stageSlot(root, SEGMENT, 1, "Who: owner-led studios.");
    writeFileSync(join(root, path), readFileSync(join(root, path), "utf8").replace("owner-led", "agency"));
    const model = readStrategyRoot(root, reader);
    expect(model.cells).toEqual([]);
    expect(model.tree!.active[SEGMENT]).toBeNull();
    expect(model.issues).toContainEqual(expect.objectContaining({ path, reason: "invalid-format", message: expect.stringMatching(/sha256/) }));
  });
  it("reports malformed pin JSON and a missing root without throwing", () => {
    const root = strategyRoot(base());
    stageSlot(root, SEGMENT, 1, "Who: owner-led studios.");
    writeFileSync(join(root, SEGMENT, "pin.json"), "{\n broken\n");
    expect(readStrategyRoot(root, reader).issues).toContainEqual(expect.objectContaining({ path: `${SEGMENT}/pin.json`, reason: "invalid-json" }));
    expect(readStrategyRoot(join(root, "absent"), reader).issues).toContainEqual(expect.objectContaining({ path: ".", reason: "unreadable" }));
  });
  it("reports a pinned candidate without Direction bullets by its path", () => {
    const root = strategyRoot(base());
    const { path } = stageSlot(root, SEGMENT, 1, []);
    const model = readStrategyRoot(root, reader);
    expect(model.cells).toEqual([]);
    expect(model.issues).toContainEqual(expect.objectContaining({ path, reason: "invalid-format", message: expect.stringMatching(/no Direction bullets/) }));
  });
  it("reads only top-level evidence/director findings, and none for a root outside a consumer", () => {
    const root = strategyRoot(base());
    stageFinding(root, "signups");
    mkdirSync(join(evidenceDir(root), "findings"));
    writeFileSync(join(evidenceDir(root), "findings", "ignored.md"), "not a finding");
    const model = readStrategyRoot(root, reader);
    expect(model.issues).toEqual([]);
    expect(model.findings.map(finding => [finding.id, finding.path])).toEqual([["signups", "../../evidence/director/signups.md"]]);
    const loose = base();
    stageSlot(loose, SEGMENT, 1, "Who: owner-led studios.");
    expect(readStrategyRoot(loose, reader).findings).toEqual([]);
  });
  it("groups by ia.json and reports an ia.json that does not place every leaf", () => {
    const root = strategyRoot(base());
    writeFileSync(join(root, "ia.json"), JSON.stringify({ schema: "clossys.ia/1", nodes: [{ id: "focus", label: "Focus", children: [{ id: "focus.segment", label: "Segment", slots: [SEGMENT] }] }] }));
    const model = readStrategyRoot(root, reader);
    expect(model.issues.some(issue => issue.path === "ia.json" && issue.reason === "invalid-format")).toBe(true);
    expect(model.tree!.tree).toBeUndefined();
  });
  it("refuses a symlinked pinned candidate without reading its target", () => {
    const root = strategyRoot(base());
    const { path } = stageSlot(root, SEGMENT, 1, "Who: owner-led studios.");
    const outside = base(); const target = join(outside, "secret.md"); writeFileSync(target, "PRIVATE SENTINEL");
    rmSync(join(root, path)); symlinkSync(target, join(root, path));
    const model = readStrategyRoot(root, reader);
    expect(model.issues).toContainEqual(expect.objectContaining({ path, reason: "outside-root" }));
    expect(Object.values(model.files).join("")).not.toContain("PRIVATE SENTINEL");
  });
});
