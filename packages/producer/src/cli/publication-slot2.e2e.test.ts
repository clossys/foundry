/**
 * foundry-build-0038 r1: a consumer store recut to clossys.slot/2 seats, pins, checks and compiles a publication
 * end to end, with no clossys.slot/1 or pin/1 file written on the way.
 * Synthetic: a tmp copy of test-fixtures/consumer (a git repository with no commit), and the Writer strings and
 * Publisher record shapes of src/publish/__fixtures__/install-consumer.
 *  1. `clossys migrate recut --apply` moves the store to slot/2 and pin/2.
 *  2. `clossys ia` places a page, a publication and a Writer strings slot; each slot.json is slot/2 (the store is).
 *  3. `clossys pin` pins the clossys.page/1 and clossys.publication/1 records (they carry no candidate/1 header)
 *     as clossys.pin/2, and the strings record as a clossys.pin-map/1 record.
 *  4. `clossys check` reports no row about any of them and no pin-schema row: its findings are exactly the recut
 *     store's own (the fixture's unpinned slots), so its exit code is that store's.
 *  5. `clossys compile` projects the publication from those pins.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recutCandidateBytes } from "../migrate/recut.js";
import { PRODUCER_ROOT } from "../package-path.js";
import { runCli } from "./main.js";

const AT = "2026-11-17T10:00:00Z";
const BY = "planner:foundry-build-0038";
const INSTALL = join(PRODUCER_ROOT, "src", "publish", "__fixtures__", "install-consumer", "clossys", "agents");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));
/** The check rows, without the per-agent count lines (they count the slots this test adds). */
const rows = (message: string) => message.split("\n").filter(line => line.startsWith("  "));

function store() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "publication-slot2-")));
  roots.push(root);
  cpSync(join(PRODUCER_ROOT, "test-fixtures", "consumer", "clossys"), join(root, "clossys"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  const agent = (...rest: string[]) => join(root, "clossys", "agents", ...rest);
  const file = (name: string, value: unknown) => { const path = join(root, name); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); return path; };
  const put = (path: string, bytes: string) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, bytes); };
  return { root, agent, file, put };
}

const PAGE = {
  schema: "clossys.page/1", path: "/", title: "site.studio.name", frame: "frames.app-shell", sections: [], copy: {},
  meta: { source: { kind: "original", ref: [] }, entry: { publication: "site", entryId: "home", fields: { kind: "page" } } },
};
const PUBLICATION = {
  schema: "clossys.publication/1", format: "web.page.responsive", entryOrder: ["home"],
  meta: { source: { kind: "derived", ref: ["publisher:fixture"] }, tree: { id: "site", name: "site.publication", children: [{ id: "site.pages", name: "site.pages", cells: ["page.home"] }] } },
};

async function seatAndPin(s: ReturnType<typeof store>) {
  const steps: { args: string[]; exitCode: number; message: string }[] = [];
  const run = async (args: string[]) => { const result = await runCli([...args, "--root", s.root]); steps.push({ args, ...result }); return result; };
  const contract = (name: string, value: unknown) => s.file(name, value);
  await run(["ia", "publisher/page.home", "--contract", contract("page.json", { kind: "page", route: "/", frame: "required", sections: "ordered" }), "--standard", "page", "--under", "site/site-pages", "--kind", "page", "--at", AT]);
  await run(["ia", "publisher/publication.site", "--contract", contract("publication.json", { kind: "publication" }), "--standard", "publication", "--under", "site/site-pages", "--kind", "publication", "--inputs", "page.home", "--uses", "page.home", "--at", AT]);
  await run(["ia", "writer/strings.site", "--contract", contract("strings.json", {}), "--under", "strings.identity/identity-names", "--kind", "strings", "--at", AT]);

  const strings = "site-v1.md";
  s.put(s.agent("writer", "strings.site", "candidates", strings), recutCandidateBytes(strings, readFileSync(join(INSTALL, "writer", "strings.site", "candidates", "site-v2.md"), "utf8"),
    { agent: "writer", slotId: "strings.site", at: AT, version: "0.0.0", sourceRef: `agents/writer/strings.site/candidates/${strings}` } as never));
  s.put(s.agent("publisher", "page.home", "candidates", "home-v1.json"), `${JSON.stringify(PAGE, null, 2)}\n`);
  s.put(s.agent("publisher", "publication.site", "candidates", "site-v1.json"), `${JSON.stringify(PUBLICATION, null, 2)}\n`);
  await run(["pin", "writer/strings.site#site", strings, "--by", BY, "--at", AT]);
  await run(["pin", "publisher/page.home", "home-v1.json", "--by", BY, "--at", AT]);
  await run(["pin", "publisher/publication.site", "site-v1.json", "--by", BY, "--at", AT]);
  return steps;
}

describe("a recut (clossys.slot/2) consumer store seats, pins, checks and compiles a publication", () => {
  it("migrate recut --apply, ia, pin, check, compile", async () => {
    const s = store();
    const recut = await runCli(["migrate", "recut", "--apply", "--at", AT, "--root", s.root]);
    expect(recut.exitCode, recut.message).toBe(0);
    const baseline = await runCli(["check", "--root", s.root]);

    const steps = await seatAndPin(s);
    for (const step of steps) expect(step.exitCode, `clossys ${step.args.join(" ")}: ${step.message}`).toBe(0);
    for (const id of ["publisher/page.home", "publisher/publication.site", "writer/strings.site"]) expect(readJson(s.agent(id, "slot.json")).schema, id).toBe("clossys.slot/2");
    expect(readJson(s.agent("publisher", "page.home", "pin.json"))).toMatchObject({ schema: "clossys.pin/2", id: "publisher/page.home/pin", candidate: "home-v1.json", basis: "planner" });
    expect(readJson(s.agent("publisher", "publication.site", "pin.json"))).toMatchObject({ schema: "clossys.pin/2", id: "publisher/publication.site/pin", candidate: "site-v1.json" });
    expect(readJson(s.agent("writer", "strings.site", "pin.json"))).toMatchObject({ schema: "clossys.pin-map/1", records: { site: { candidate: "site-v1.md" } } });

    const check = await runCli(["check", "--root", s.root]);
    expect(rows(check.message).filter(line => /publisher[:/]|strings\.site|pin\.json|\[schema\] .*pin|Invalid pin|Unknown key/.test(line))).toEqual([]);
    expect(rows(check.message)).toEqual(rows(baseline.message));
    expect(check.exitCode).toBe(baseline.exitCode);
    expect(check.message).toMatch(/^publisher: 2 slots \/ 2 with candidate \/ 2 pinned;/m);

    const compile = await runCli(["compile", "--root", s.root]);
    expect(compile.exitCode, compile.message).toBe(0);
    expect(readJson(join(s.root, ".clossys", "generated", "publications.json")).publications).toEqual([{ id: "site", slot: "publisher/publication.site", state: "compiled", file: "publications/site.json" }]);
    const projected = readJson(join(s.root, ".clossys", "generated", "publications", "site.json"));
    expect(projected).toMatchObject({ publicationId: "site", map: { publicationId: "site", format: "web.page.responsive" } });
    expect(projected.map.entries.map((entry: { id: string }) => entry.id)).toContain("home");
  }, 300_000);
});
