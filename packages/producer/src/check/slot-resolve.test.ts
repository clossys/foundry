import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveSlots, runSlotResolve, slotResolveSummary, type SlotCandidate, type SlotStore } from "./slot-resolve.js";
import { sha256Hex } from "../records/hash.js";
import { serializeFrontmatter, slotPositions, type IaDoc, type SlotAgent } from "../records/slot-model/index.js";
import { parseArgs } from "../cli/args.js";

const hash = "a".repeat(64);
const source = { kind: "original" as const, ref: [] };
const candidate = (): SlotCandidate => ({ id: "synthetic-v1.json", hash, schemaIssues: [], copyKeys: ["site.synthetic.title"], source });
const store = (agent: SlotStore["agent"] = "designer"): SlotStore => ({ agent, ia: ["sections.synthetic"], iaSource: "synthetic#fixture", candidates: { "sections.synthetic": [candidate()] }, pins: { "sections.synthetic": [{ id: "synthetic-v1.json", hash }] } });
const writer = () => new Map([["site.synthetic.title", ["A synthetic title"]]]);
const codes = (input: SlotStore, strings = writer()) => resolveSlots([input], strings, new Map())[0]!.findings.map(row => row.code);
const entry = resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/cli/index.js");
const designer = resolve(dirname(fileURLToPath(import.meta.url)), "../../../designer");
const manifest = JSON.parse(readFileSync(join(designer, "references/manifest.json"), "utf8"));
const button = manifest.items.find((row: any) => row.registry === "shadcn-aria" && row.name === "button");
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "synthetic-slot-check-")));
  const consumer = join(root, "clossys");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "components.json"), readFileSync(join(designer, "ui/components.json")));
  writeFileSync(join(consumer, "clossys.config.ts"), "export default {};\n");
  const dirs: Record<string, string> = {};
  const slots: [SlotAgent, string, string, string][] = [
    ["director", "brief.synthetic", "brief", "brief"],
    ["designer", "components.synthetic", "components.examples", "element"],
    ["writer", "strings.synthetic", "strings.examples", "strings"],
    ["publisher", "page.synthetic", "pages", "page"],
  ];
  for (const [agent, id, l1, kind] of slots) {
    const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [{ id: l1, label: "Examples", children: [{ id: "examples", label: "Examples", slots: [id] }] }] };
    const dir = join(consumer, "agents", agent, id);
    dirs[agent] = dir;
    mkdirSync(join(dir, "candidates"), { recursive: true });
    save(join(consumer, "agents", agent, "ia.json"), ia);
    save(join(dir, "slot.json"), { schema: "clossys.slot/1", id, agent, ia: slotPositions(agent, ia).get(id), kind, contract: {}, inputs: agent === "director" ? [] : agent === "publisher" ? ["components.synthetic", "strings.synthetic"] : ["brief.synthetic"], uses: agent === "publisher" ? ["components.synthetic", "strings.synthetic"] : [] });
    let bytes: string;
    if (kind === "brief") bytes = serializeFrontmatter({ slot: id, source, feeds: [], functions: [] }, "## Direction\n- example: A direction\n\n## Because\n- example: A reason\n\n## Watch\n- example: A constraint\n");
    else if (kind === "strings") bytes = serializeFrontmatter({ slot: id, locales: ["en"], source }, '## en\n### site.synthetic.title\n<!-- {"id":"synthetic-title","bindings":[]} -->\nA synthetic title\n');
    else if (kind === "page") bytes = JSON.stringify({ schema: "clossys.page/1", path: "/", title: "site.synthetic.title", frame: null, sections: ["components.synthetic"], copy: { "site.synthetic.title": "strings.synthetic#site.synthetic.title" }, meta: { source } });
    else bytes = JSON.stringify({ name: "button", type: "registry:ui", files: [{ path: "button.tsx", type: "registry:ui", content: readFileSync(join(designer, "ui/src/components/ui/button.tsx"), "utf8") }], meta: {
      source: { kind: "registry", ref: [button.dir], hash: button.hash },
      refVerbatim: { files: { "button.tsx": "registry/aria-nova/ui/button.tsx" } },
    } });
    const name = `sample-v1.${kind === "brief" || kind === "strings" ? "md" : "json"}`;
    writeFileSync(join(dir, "candidates", name), bytes);
    save(join(dir, "pin.json"), { candidate: name, sha256: sha256Hex(bytes), decidedBy: "migrated", at: "2026-10-31T00:00:00Z" });
  }
  return { root, consumer, dirs };
}
const native = (root: string, flags: string[] = []) => spawnSync(process.execPath, [entry, "check", "--root", root, "--json", ...flags], { encoding: "utf8" });

describe("uniform slot resolution", () => {
  it.each(["director", "designer", "writer", "publisher"] as const)("applies the identical rule to %s", agent => {
    expect(codes(store(agent))).toEqual([]);
    const mutated = store(agent); mutated.pins = {};
    expect(codes(mutated)).toEqual(["no-pin"]);
  });
  it("reports missing candidates, missing files and multiple pins without collapsing rows", () => {
    const input = store(); input.candidates = {};
    expect(codes(input)).toEqual(["no-candidate", "pin-missing-file"]);
    input.pins["sections.synthetic"]!.push({ id: "missing" });
    expect(codes(input)).toContain("multi-pin");
    expect(resolveSlots([input], writer(), new Map())).toHaveLength(1);
  });
  it("checks real bytes, schemas and the model's one source record", () => {
    const input = store(); const c = input.candidates["sections.synthetic"]![0]!;
    delete input.pins["sections.synthetic"]![0]!.hash;
    c.schemaIssues = ["Synthetic schema failure"]; c.source = { kind: "derived", ref: [] };
    expect(codes(input)).toEqual(["hash-drift", "schema", "no-source"]);
    c.source = { kind: "registry", ref: ["synthetic/item@1"], hash };
    expect(codes(input)).toContain("source-ref-unknown");
    expect(resolveSlots([input], writer(), new Map([["synthetic/item@1", hash]]))[0]!.findings.map(row => row.code)).not.toContain("source-ref-unknown");
    c.source = { kind: "derived", ref: ["synthetic:origin"] };
    expect(codes(input)).not.toContain("no-source");
  });
  it("reports inverse orphan candidates and all named copy failures", () => {
    const input = store(); input.ia = [];
    expect(codes(input)).toEqual(["not-in-ia", "orphan-candidate"]);
    expect(codes(store(), new Map())).toEqual(["copy-missing-key"]);
    for (const value of ["", "TODO: fill", "lorem ipsum", "site.synthetic.title", "title"]) expect(codes(store(), new Map([["site.synthetic.title", [value]]]))).toEqual(["copy-empty"]);
  });
});

describe("default native model enforcement", () => {
  it("passes a clean fixture without --slots and reports all agents' coverage and readiness", async () => {
    const f = fixture();
    try {
      const result = native(f.root, ["--readiness"]);
      expect(result.status, result.stderr).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report).toMatchObject({ exitCode: 0, verdict: "satisfied", findings: [] });
      expect(report.slots).toMatchObject({ reportOnly: false });
      expect(report.slots.rows).toHaveLength(4);
      expect(report.suites.suites).toMatchObject([{ suite: "ref-verbatim", exitCode: 0 }]);
      expect(report.slots.coverage.map((row: any) => [row.agent, row.slots, row.withCandidate, row.pinned])).toEqual(["director", "designer", "writer", "publisher"].map(agent => [agent, 1, 1, 1]));
      const slots = await runSlotResolve(f.consumer);
      expect(slots).toMatchObject({ reportOnly: false, exitCode: 0, verdict: "satisfied", findings: [] });
      expect(slotResolveSummary(slots, true)).toContain("publisher blocked-by: none");
      expect(native(f.consumer, ["--slots", "--strict"]).status).toBe(0);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("native JSON aggregate verdict follows stock, forbidden class and restored bytes", () => {
    const f = fixture();
    try {
      const path = join(f.dirs.designer!, "candidates/sample-v1.json");
      const original = JSON.parse(readFileSync(path, "utf8"));
      const run = (item: any, exit: number, verdict: string) => {
        save(path, item);
        const pin = JSON.parse(readFileSync(join(f.dirs.designer!, "pin.json"), "utf8"));
        save(join(f.dirs.designer!, "pin.json"), { ...pin, sha256: sha256Hex(readFileSync(path)) });
        const result = native(f.root);
        expect(result.status, result.stderr).toBe(exit);
        const report = JSON.parse(result.stdout);
        expect(report).toMatchObject({ exitCode: exit, verdict });
        expect(report.slots).toMatchObject({ verdict: "satisfied", findings: [] });
        return report;
      };
      expect(run(original, 0, "satisfied").findings).toEqual([]);
      const altered = structuredClone(original);
      altered.files[0].content = altered.files[0].content.replace("hover:bg-primary/80", "hover:bg-primary/80 shadow-xl");
      expect(altered.files[0].content).not.toBe(original.files[0].content);
      const failed = run(altered, 1, "violated");
      expect(failed.findings.some((finding: any) => finding.rule === "REF-HUNK-CLASS" && finding.severity === "error")).toBe(true);
      expect(failed.summary).not.toContain("passed");
      expect(run(original, 0, "satisfied").findings).toEqual([]);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  const mutations: [string, (dir: string) => void, string][] = [
    ["pin removed", dir => unlinkSync(join(dir, "pin.json")), "no-pin"],
    ["sha changed", dir => { const pin = JSON.parse(readFileSync(join(dir, "pin.json"), "utf8")); save(join(dir, "pin.json"), { ...pin, sha256: "0".repeat(64) }); }, "hash-drift"],
    ["candidate deleted", dir => unlinkSync(join(dir, "candidates", "sample-v1.json")), "pin-missing-file"],
    ["uses names an unknown slot", dir => { const slot = JSON.parse(readFileSync(join(dir, "slot.json"), "utf8")); save(join(dir, "slot.json"), { ...slot, uses: ["unknown.synthetic"] }); }, "schema"],
    ["candidate carries status", dir => { const path = join(dir, "candidates", "sample-v1.json"); save(path, { ...JSON.parse(readFileSync(path, "utf8")), status: "active" }); }, "candidate-status"],
    ["slot is at the wrong IA path", dir => {
      // Folders are flat (agents/<agent>/<slot-id>): a Designer slot under the Writer agent is misplaced.
      renameSync(dir, join(dirname(dirname(dir)), "writer", "components.synthetic"));
    }, "ia-path"],
  ];
  it.each(mutations)("mutation proof: %s returns native rc 1", async (_name, mutate, code) => {
    const f = fixture();
    try {
      expect(native(f.root).status).toBe(0);
      mutate(f.dirs.designer!);
      const slots = await runSlotResolve(f.consumer);
      expect(slots).toMatchObject({ reportOnly: false, exitCode: 1, verdict: "violated" });
      expect(slots.findings).toContainEqual(expect.objectContaining({ rule: code, severity: "error" }));
      const result = native(f.root);
      expect(result.status, result.stderr).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report).toMatchObject({ exitCode: 1, verdict: "violated", slots: { exitCode: 1, verdict: "violated" } });
      expect(report.findings.some((row: any) => row.rule === code)).toBe(true);
      expect(report.slots.coverage).toHaveLength(4);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it.each(["unreadable JSON", "unsupported schema"])("returns rc 2 and error findings for %s model inputs", async input => {
    const f = fixture();
    try {
      const path = join(f.consumer, "agents", "designer", "ia.json");
      if (input === "unreadable JSON") writeFileSync(path, "{");
      else save(path, { ...JSON.parse(readFileSync(path, "utf8")), schema: "clossys.ia/unsupported" });
      const slots = await runSlotResolve(f.consumer);
      expect(slots).toMatchObject({ reportOnly: false, exitCode: 2, verdict: "indeterminate" });
      expect(slots.findings).toContainEqual(expect.objectContaining({ rule: "schema", severity: "error", message: "Slot model inputs could not be read or validated." }));
      for (const flags of [[], ["--slots", "--strict"]]) {
        const result = native(f.root, flags);
        expect(result.status, result.stderr).toBe(2);
        const report = JSON.parse(result.stdout);
        expect(report).toMatchObject({ exitCode: 2, verdict: "indeterminate", slots: { reportOnly: false, exitCode: 2, verdict: "indeterminate" } });
        expect(report.findings).toEqual(expect.arrayContaining(slots.findings));
      }
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("resolves page copy from the bound Writer slot, never another slot's matching key", () => {
    const f = fixture();
    try {
      const dir = f.dirs.publisher!;
      const path = join(dir, "candidates", "sample-v1.json");
      const page = JSON.parse(readFileSync(path, "utf8"));
      page.copy["site.synthetic.title"] = "strings.missing";
      save(path, page);
      const pin = JSON.parse(readFileSync(join(dir, "pin.json"), "utf8"));
      save(join(dir, "pin.json"), { ...pin, sha256: sha256Hex(readFileSync(path)) });
      const result = native(f.root);
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout).findings.some((row: any) => row.rule === "copy-missing-key")).toBe(true);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("fails closed on symlinks and does not fall back to a legacy store", async () => {
    const f = fixture();
    try {
      const path = join(f.dirs.designer!, "candidates", "sample-v1.json");
      const target = join(f.root, "alias-target.json");
      renameSync(path, target); symlinkSync(target, path);
      const slots = await runSlotResolve(f.consumer);
      expect(slots).toMatchObject({ reportOnly: false, exitCode: 2, verdict: "indeterminate" });
      expect(slots.findings).toContainEqual(expect.objectContaining({ rule: "schema", severity: "error" }));
      const result = native(f.root);
      expect(result.status, result.stderr).toBe(2);
      const report = JSON.parse(result.stdout);
      expect(report).toMatchObject({ exitCode: 2, verdict: "indeterminate", slots: { reportOnly: false, exitCode: 2, verdict: "indeterminate" } });
      expect(report.findings).toEqual(expect.arrayContaining(slots.findings));
      rmSync(join(f.consumer, "agents"), { recursive: true, force: true });
      mkdirSync(join(f.consumer, "library")); save(join(f.consumer, "selection.json"), { pins: {} });
      expect(native(f.root).status).toBe(1);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
  it("keeps page checks and suites additive and never lets strict opt out of integrity", () => {
    expect(parseArgs(["check", "--slots", "--suites", "--strict", "--pages", "p.json", "--report", "r.json"])).toMatchObject({ slots: true, suites: true, strict: true });
    expect(() => parseArgs(["publish", "--slots"])).toThrow(/require check/);
  });
});
