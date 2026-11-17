import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCandidateHeader, candidateCreatedBy, candidatePath, packageDefaultDir, parseCandidateName, readCandidateFile,
  serializeCandidate, writeCandidateFile,
} from "./candidate.js";
import { sha256Hex } from "./hash.js";
import { readRecordHeader } from "./schema.js";
import { existsSync, readdirSync } from "node:fs";
import { PRODUCER_ROOT } from "../package-path.js";

function world(): string {
  const root = mkdtempSync(join(tmpdir(), "candidate-"));
  for (const agent of ["designer", "writer", "producer"]) {
    mkdirSync(join(root, "packages", agent), { recursive: true });
    writeFileSync(join(root, "packages", agent, "package.json"), JSON.stringify({ name: `@clossys/${agent}`, version: "1.2.3" }));
  }
  mkdirSync(join(root, "packages", "designer", "actions", "craft"), { recursive: true });
  writeFileSync(join(root, "packages", "designer", "actions", "craft", "skill.md"), "# craft\n");
  return root;
}

const AT = "2026-11-14T12:00:00Z";
const source = { kind: "original" as const, ref: [] };

describe("candidate header (clossys.candidate/1)", () => {
  it("parses candidate file names", () => {
    expect(parseCandidateName("hero-v2.json")).toEqual({ name: "hero", version: 2, ext: "json" });
    expect(parseCandidateName("home.hero-v1.md")).toEqual({ name: "home.hero", version: 1, ext: "md" });
    expect(parseCandidateName("hero-v0.json")).toBeUndefined();
    expect(parseCandidateName("hero.json")).toBeUndefined();
    expect(parseCandidateName("hero-v1.txt")).toBeUndefined();
  });

  it("records the installed skill digest and package version, and refuses what is not installed", () => {
    const root = world();
    const agent = candidateCreatedBy(root, { actor: "agent", agent: "designer", skill: "packages/designer/actions/craft/skill.md", model: "m", tier: "mid" });
    expect(agent).toMatchObject({ actor: "agent", skillSha256: sha256Hex(readFileSync(join(root, "packages/designer/actions/craft/skill.md"))) });
    expect(candidateCreatedBy(root, { actor: "package", agent: "writer" })).toEqual({ actor: "package", package: "@clossys/writer", version: "1.2.3" });
    expect(() => candidateCreatedBy(root, { actor: "agent", agent: "designer", skill: "packages/designer/actions/missing/skill.md", model: "m", tier: "mid" })).toThrow(/not installed/);
    expect(() => candidateCreatedBy(root, { actor: "package", agent: "publisher" })).toThrow(/not installed/);
  });

  for (const [name, content] of [["hero-v1.json", { title: "x" }], ["hero-v1.md", "# Hero\n\nBody.\n"], ["mark-v1.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0 0\"/></svg>"]] as const) {
    it(`round-trips the header of a ${name.split(".").pop()} candidate`, () => {
      const root = world();
      const header = buildCandidateHeader({ agent: "designer", slotId: "sections.hero", name, createdBy: { actor: "planner", ref: "test" }, createdAt: AT, source });
      const bytes = serializeCandidate(name, header, content);
      expect(readRecordHeader(name, bytes)).toEqual(header);
      const file = candidatePath(root, "designer", "sections.hero", name);
      mkdirSync(dirname(file), { recursive: true });
      const sha = writeCandidateFile(file, bytes);
      const read = readCandidateFile(file, { agent: "designer", slotId: "sections.hero" });
      expect(read.issues).toEqual([]);
      expect(read.sha256).toBe(sha);
      expect(read.header).toEqual(header);
    });
  }

  it("never overwrites a candidate (immutable after submit)", () => {
    const root = world();
    const file = candidatePath(root, "designer", "sections.hero", "hero-v1.json");
    mkdirSync(dirname(file), { recursive: true });
    writeCandidateFile(file, "{}");
    expect(() => writeCandidateFile(file, "{\"x\":1}")).toThrow();
    expect(readFileSync(file, "utf8")).toBe("{}");
  });

  it("flags a header that does not match where the file sits", () => {
    const root = world();
    const header = buildCandidateHeader({ agent: "designer", slotId: "sections.footer", name: "hero-v1.json", createdBy: { actor: "planner", ref: "t" }, createdAt: AT, source });
    const file = candidatePath(root, "designer", "sections.hero", "hero-v1.json");
    mkdirSync(dirname(file), { recursive: true });
    writeCandidateFile(file, serializeCandidate("hero-v1.json", header, {}));
    const issues = readCandidateFile(file, { agent: "designer", slotId: "sections.hero" }).issues;
    expect(issues.join("\n")).toMatch(/header id .* does not match/);
    expect(issues.join("\n")).toMatch(/header slot/);
  });

  it("B11: the Producer package default dir is where the package ships its loops (loops/<slot-id>/)", () => {
    const repo = join(PRODUCER_ROOT, "..", "..");
    for (const loop of ["loop.fill", "loop.refine", "loop.create", "loop.choose", "loop.release", "loop.audit"]) {
      const dir = packageDefaultDir(repo, "producer", loop);
      expect(existsSync(dir), dir).toBe(true);
      expect(readdirSync(dir), loop).toContain(`${loop.slice(5)}-v1.json`);
    }
  });

  it("addresses a package default as package:<name> and requires a package actor", () => {
    const root = world();
    const dir = packageDefaultDir(root, "designer", "sections.hero");
    expect(dir).toBe(join(root, "packages/designer/src/catalog/defaults/sections.hero"));
    expect(packageDefaultDir(root, "producer", "loop.release")).toBe(join(root, "packages/producer/loops/loop.release"));
    mkdirSync(dir, { recursive: true });
    const header = buildCandidateHeader({ agent: "designer", slotId: "sections.hero", name: "hero-v1.json", createdBy: candidateCreatedBy(root, { actor: "package", agent: "designer" }), createdAt: AT, source: { kind: "package-default", ref: [] }, packageDefault: true });
    expect(header.id).toBe("designer/sections.hero/package:hero-v1.json");
    writeCandidateFile(join(dir, "hero-v1.json"), serializeCandidate("hero-v1.json", header, {}));
    expect(readCandidateFile(join(dir, "hero-v1.json"), { agent: "designer", slotId: "sections.hero", packageDefault: true }).issues).toEqual([]);
    const planner = buildCandidateHeader({ agent: "designer", slotId: "sections.hero", name: "alt-v1.json", createdBy: { actor: "planner", ref: "t" }, createdAt: AT, source, packageDefault: true });
    writeCandidateFile(join(dir, "alt-v1.json"), serializeCandidate("alt-v1.json", planner, {}));
    expect(readCandidateFile(join(dir, "alt-v1.json"), { agent: "designer", slotId: "sections.hero", packageDefault: true }).issues.join()).toMatch(/created by the package/);
  });
});
