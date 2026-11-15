import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCandidateHeader, candidateCreatedBy, candidatePath, packageDefaultDir, serializeCandidate, slotDir, writeCandidateFile } from "../records/candidate.js";
import type { AgentId } from "../records/types.js";
import { checkRefsDangling, danglingReason, REFS_DANGLING } from "./refs-dangling.js";

// A temp workspace: a `packages/` folder (so package defaults and versions read from it) and a `clossys/` consumer.
function world() {
  const root = mkdtempSync(join(tmpdir(), "target-records-"));
  for (const agent of ["designer", "writer", "publisher", "producer"]) {
    mkdirSync(join(root, "packages", agent), { recursive: true });
    writeFileSync(join(root, "packages", agent, "package.json"), JSON.stringify({ name: `@clossys/${agent}`, version: "1.2.3" }));
  }
  const at = "2026-11-14T12:00:00Z";
  const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
  const api = {
    root,
    slot(agent: AgentId, slotId: string, extra: Record<string, unknown> = {}): void {
      put(join(slotDir(root, agent, slotId), "slot.json"), JSON.stringify({ schema: "clossys.slot/2", id: `${agent}/${slotId}`, agent, kind: "section", status: "open", ...extra }));
    },
    /** Writes a consumer candidate and returns its sha256. */
    candidate(agent: AgentId, slotId: string, name: string, content: unknown = { n: name }, record?: string): string {
      const header = buildCandidateHeader({ agent, slotId, name, createdBy: { actor: "planner", ref: "test" }, createdAt: at, source: { kind: "original", ref: [] }, ...(record ? { record } : {}) });
      const file = candidatePath(root, agent, slotId, name);
      mkdirSync(dirname(file), { recursive: true });
      return writeCandidateFile(file, serializeCandidate(name, header, content));
    },
    packageDefault(agent: AgentId, slotId: string, name: string): string {
      const header = buildCandidateHeader({ agent, slotId, name, createdBy: candidateCreatedBy(root, { actor: "package", agent }), createdAt: at, source: { kind: "package-default", ref: [] }, packageDefault: true });
      const file = join(packageDefaultDir(root, agent, slotId), name);
      mkdirSync(dirname(file), { recursive: true });
      return writeCandidateFile(file, serializeCandidate(name, header, { n: name }));
    },
    queueEntry(kind: string, id: string): void {
      put(join(root, "clossys", "agents", "producer", `queue.${kind}`, "entries", `${id}.json`), JSON.stringify({ id, kind: "queue-entry" }));
    },
    writeJson(rel: string, doc: unknown): void { put(join(root, "clossys", "agents", rel), JSON.stringify(doc, null, 2)); },
    readJson(rel: string): any { return JSON.parse(readFileSync(join(root, "clossys", "agents", rel), "utf8")); },
  };
  return api;
}

const rel = "uses";

describe(REFS_DANGLING, () => {
  it("accepts refs whose targets exist", () => {
    const w = world();
    w.slot("designer", "sections.hero", { refs: [{ to: "publisher/chrome.site-header/package:header-v1.json", rel }], brief: { inputs: [{ to: "facts", rel: "input" }] } });
    w.slot("publisher", "chrome.site-header");
    w.packageDefault("publisher", "chrome.site-header", "header-v1.json");
    writeFileSync(join(w.root, "clossys", "facts.json"), "{}");
    w.queueEntry("pick", "20261114T1200Z-hero");
    w.writeJson("producer/ledger.fill/entries/20261114T1300Z-a.json", { id: "20261114T1300Z-a", refs: [{ to: "producer/queue.pick", record: "20261114T1200Z-hero", rel: "answers" }], trigger: { ref: { to: "designer/sections.hero", rel: "trigger" } } });
    expect(checkRefsDangling(w.root)).toEqual({ check: REFS_DANGLING, status: "pass", findings: [] });
  });

  it("fails a package: ref to a default that is not installed", () => {
    const w = world();
    w.slot("designer", "sections.hero", { refs: [{ to: "publisher/chrome.site-header/package:header-v1.json", rel }] });
    const run = checkRefsDangling(w.root);
    expect(run.status).toBe("fail");
    expect(run.findings).toEqual([expect.objectContaining({ subject: "designer/sections.hero/slot.json", detail: expect.stringMatching(/package default header-v1.json is not installed/) })]);
    expect(danglingReason(w.root, { to: "publisher/chrome.site-header/package:header-v2.json", rel })).toMatch(/v1 of its name/);
  });

  it("fails refs to missing slots, retired slots, candidates, records, queue entries and facts", () => {
    const w = world();
    w.slot("designer", "sections.gone", { status: "retired" });
    w.slot("writer", "sections.hero.copy", { kind: "copy" });
    w.slot("designer", "sections.hero");
    const reason = (to: string, record?: string) => danglingReason(w.root, { to, rel, ...(record ? { record } : {}) });
    expect(reason("designer/sections.nope")).toMatch(/no such slot folder/);
    expect(reason("designer/sections.gone")).toMatch(/retired/);
    expect(reason("designer/sections.hero/hero-v3.json")).toMatch(/no such candidate file/);
    expect(reason("writer/sections.hero.copy", "home.hero")).toMatch(/no pin map record and no package default/);
    expect(reason("producer/queue.pick", "20261114T1200Z-x")).toMatch(/no such entry/);
    expect(reason("producer/queue.fix")).toMatch(/no such queue or ledger folder/);
    expect(reason("facts")).toMatch(/facts.json does not exist/);
    expect(reason("not a ref")).toMatch(/is not a ref/);
    w.packageDefault("writer", "sections.hero.copy", "home.hero-v1.json");
    expect(reason("writer/sections.hero.copy", "home.hero")).toBeUndefined();
  });

  it("reads refs from pin files", () => {
    const w = world();
    w.slot("designer", "sections.hero");
    w.candidate("designer", "sections.hero", "hero-v1.json");
    w.writeJson("designer/sections.hero/pin.json", { schema: "clossys.pin/2", id: "designer/sections.hero/pin", refs: [{ to: "producer/queue.pick", record: "20261114T1200Z-gone", rel: "answers" }] });
    const run = checkRefsDangling(w.root);
    expect(run.findings.map(f => f.subject)).toEqual(["designer/sections.hero/pin.json"]);
    expect(readFileSync(join(w.root, "packages/writer/package.json"), "utf8")).toBeTruthy();
  });
});
