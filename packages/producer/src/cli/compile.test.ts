import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./main.js";
import { COMPILE_USAGE } from "./compile.js";

/**
 * A consumer store shaped like the recut product snapshot: its Publisher IA places one page (`page.home` under
 * site/site-pages, clossys.slot/2, kind page, refs to a frame and three sections) and no publication, and the
 * Studio publication is not placed. `publications` adds placed publication slot ids to the same group.
 */
function snapshotStore(publications: string[] = []): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "compile-consumer-")));
  const publisher = join(root, "clossys", "agents", "publisher");
  mkdirSync(join(publisher, "page.home"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
  writeFileSync(join(publisher, "ia.json"), `${JSON.stringify({
    schema: "clossys.ia/1", source: "consumer#agents/publisher/tree.json", extensions: [],
    nodes: [{ id: "site", label: "Site", children: [{ id: "site-pages", label: "Pages", slots: ["page.home", ...publications] }] }],
  }, null, 2)}\n`);
  writeFileSync(join(publisher, "page.home", "slot.json"), `${JSON.stringify({
    schema: "clossys.slot/2", id: "page.home", agent: "publisher", kind: "page", status: "starter",
    ia: { l0: "page", l1: "page/site", l2: "page/site/site-pages", order: 0 },
    createdBy: { actor: "code", cli: "clossys migrate slot-1-to-2", version: "0.1.0" }, createdAt: "2026-11-17T06:47:33Z",
    refs: ["designer/frames.site-shell", "designer/sections.hero", "designer/sections.content", "designer/sections.call-to-action"].map(to => ({ to, rel: "uses" })),
    base: null, standard: "page",
    brief: { purpose: "Fill publisher/page.home to the page standard.", mustDo: [], inputs: [], acceptance: [] },
    contract: { kind: "page", route: "/", frame: "required", sections: "ordered" }, tighten: [],
  }, null, 2)}\n`);
  roots.push(root);
  return root;
}
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

describe("clossys compile", () => {
  it("prints its own usage and refuses unknown or valueless flags", async () => {
    await expect(runCli(["compile", "--help"])).resolves.toMatchObject({ exitCode: 0, message: COMPILE_USAGE });
    await expect(runCli(["compile", "--model", "x"])).resolves.toMatchObject({ exitCode: 2, message: expect.stringContaining("Unknown compile argument: --model") });
    await expect(runCli(["compile", "--out"])).resolves.toMatchObject({ exitCode: 2, message: expect.stringContaining("--out needs a directory") });
  });

  it("skips the Studio on a consumer that does not place it, and with no publication placed exits 1 naming the seating step", async () => {
    const root = snapshotStore();
    const result = await runCli(["compile", "--root", root]);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("the Studio is not placed, so it is skipped");
    expect(result.message).toContain("compile.no-publication: publisher/ia.json:");
    expect(result.message).toContain("clossys ia publisher/publication.<id> --under <l1>/<l2>");
    const out = join(root, ".clossys", "generated");
    // Nothing of the Studio compile: no generated/ or app/ tree, only this compile's own files.
    expect(existsSync(join(out, "generated"))).toBe(false);
    expect(existsSync(join(out, "app"))).toBe(false);
    expect(readJson(join(out, "publications.json"))).toEqual({ schema: "clossys.compiled-publications/1", publications: [] });
    const lock = readJson(join(out, "compile.lock.json"));
    const ia = readFileSync(join(root, "clossys", "agents", "publisher", "ia.json"), "utf8");
    expect(lock).toMatchObject({ schema: "clossys.compile-lock/1", decisionInputs: ["clossys/agents/publisher/ia.json"] });
    expect(lock.inputs).toEqual([{ path: "clossys/agents/publisher/ia.json", sha256: createHash("sha256").update(ia).digest("hex") }]);
    expect(lock.outputs.map((row: { path: string }) => row.path)).toEqual([".clossys/generated/publications.json"]);
    expect(lock.pinSetHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("records a placed publication with no pin as unresolved, not a finding, and exits 0", async () => {
    const root = snapshotStore(["publication.site"]);
    const out = join(root, "out");
    const result = await runCli(["compile", "--root", root, "--out", out]);
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("unresolved publisher/publication.site: publisher/publication.site has no pin yet");
    expect(readJson(join(out, "publications.json")).publications).toEqual([
      { id: "site", slot: "publisher/publication.site", state: "unresolved", reason: "publisher/publication.site has no pin yet; pins.resolve judges it at release" },
    ]);
    expect(existsSync(join(root, ".clossys"))).toBe(false);
  });
});
