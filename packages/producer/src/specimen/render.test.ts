import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as publisher from "@clossys/publisher/specimen";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runRenderCli } from "../cli/render.js";
import { FIXTURE_CONSUMER } from "../consumer-root.js";
import { validateAgainst, type JsonSchema } from "../records/schema.js";
import { canonicalLibrary } from "./__fixtures__/canonical-library.js";
import { COMPARE_SPECIMEN, RENDERS_DIR, renderRef, type RenderIndex } from "./render.js";
import { snapshotSpecimen, type SnapshotOptions, type SnapshotResult } from "./thumbnails.js";

const chrome = publisher.findChrome();
const workspace = fileURLToPath(new URL("../../../../", import.meta.url));
const PACKAGE = fileURLToPath(new URL("../../", import.meta.url));
const TALLYHOUSE = join(PACKAGE, "test-fixtures", "tallyhouse");
const RENDER_SCHEMA = JSON.parse(readFileSync(join(PACKAGE, "schemas", "render.json"), "utf8")) as JsonSchema;
const temps: string[] = [];
afterAll(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });

/** A stand-in for the specimen harness: records each call and writes one PNG-named file per width. */
function fakeHarness(root: string) {
  const calls: SnapshotOptions[] = [];
  const snapshot = async (options: SnapshotOptions): Promise<SnapshotResult> => {
    calls.push(options);
    const thumbnails = (options.widths ?? [480]).map(width => {
      const path = join(root, `fake-${calls.length}-${width}.png`);
      writeFileSync(path, `png ${options.element} v${options.version} ${width}`);
      return { width, key: `fake${calls.length}`, path, healthPath: `${path}.json`, cached: false };
    });
    return { element: options.element, version: options.version ?? 0, theme: options.theme ?? "light", cache: root, thumbnails };
  };
  return { calls, snapshot };
}

const writeJson = (path: string, value: unknown) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); };

/**
 * A consumer with candidates for all five agents: the canonical Designer and Writer library, and
 * Director and Producer slots copied from the int2 fixture consumer (test-fixtures/consumer) with
 * one candidate added each, and one Publisher page slot folder (text specimens read the folder; the int2 Publisher IA is empty).
 */
async function allAgentConsumer(): Promise<string> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "producer-render-all-")));
  temps.push(root);
  const consumer = await canonicalLibrary(join(root, "clossys"));
  for (const agent of ["director", "producer"]) cpSync(join(FIXTURE_CONSUMER, "clossys", "agents", agent), join(consumer, "agents", agent), { recursive: true });
  mkdirSync(join(consumer, "agents", "director", "aspiration.purpose.vision", "candidates"), { recursive: true });
  writeFileSync(join(consumer, "agents", "director", "aspiration.purpose.vision", "candidates", "vision-v1.md"),
    "---\nslot: \"aspiration.purpose.vision\"\n---\n\n## Direction\n\nEvery small team closes its books in a day by 2030.\n\n## Because\n\nMonth-end still takes a week.\n");
  mkdirSync(join(consumer, "agents", "producer", "seat.critic", "candidates"), { recursive: true });
  writeFileSync(join(consumer, "agents", "producer", "seat.critic", "candidates", "critic-v1.md"), "---\nstep: \"critic\"\n---\n\nThe blind critic reads the packet and records one critique.\n");
  // The CLI discovers the root by its config file; the config is never executed.
  writeFileSync(join(consumer, "clossys.config.ts"), "throw new Error('Config must not execute');\n");
  writeJson(join(consumer, "agents", "publisher", "pages.home", "candidates", "home-v1.json"), { route: "/", frame: "designer/frames.site-shell", sections: ["designer/sections.hero"] });
  writeJson(join(consumer, "agents", "publisher", "pages.home", "candidates", "home-v2.json"), { route: "/", frame: "designer/frames.site-shell", sections: ["designer/sections.hero", "designer/sections.faq"] });
  return root;
}

/** The result validates against schemas/render.json (`clossys.render/1`, system.md 12.4). */
function expectRenderIndex(index: RenderIndex) {
  expect(validateAgainst(RENDER_SCHEMA, index)).toEqual([]);
  expect(index.schema).toBe("clossys.render/1");
  expect(index.inputsSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(Number.isNaN(Date.parse(index.renderedAt))).toBe(false);
  expect(index.by).toMatchObject({ actor: "code", cli: "clossys render" });
  expect(index.specimens.length).toBeGreaterThan(0);
  for (const row of index.specimens) {
    expect(typeof row.candidate).toBe("string");
    expect(typeof row.specimen).toBe("string");
    expect(row.png ?? row.html).toMatch(/^clossys\/\.state\/renders\//);
  }
}

describe("clossys render <agent>/<slot>[/<candidate>]", () => {
  let root: string;
  beforeAll(async () => { root = await allAgentConsumer(); });

  it("renders one candidate per agent under clossys/.state/renders and returns clossys.render/1", async () => {
    const harness = fakeHarness(root);
    const refs = [
      "designer/components.card/sample-card-v1.json",
      "director/aspiration.purpose.vision/vision-v1.md",
      "writer/strings.sample/sample-v1.md",
      "publisher/pages.home/home-v1.json",
      "producer/seat.critic/critic-v1.md",
    ];
    for (const ref of refs) {
      const result = await runRenderCli([ref, "--json"], root, harness.snapshot);
      expect(result.exitCode, result.message).toBe(0);
      const index = JSON.parse(result.message) as RenderIndex;
      expectRenderIndex(index);
      expect(index.ref).toBe(ref);
      const [agent, slot, candidate] = ref.split("/");
      const dir = join(root, RENDERS_DIR, agent!, slot!, candidate!.replace(/\.(md|json)$/, ""));
      expect(JSON.parse(readFileSync(join(dir, "index.json"), "utf8"))).toMatchObject({ schema: "clossys.render/1", ref });
      for (const row of index.specimens) expect(existsSync(join(root, row.png ?? row.html!))).toBe(true);
    }
    expect(harness.calls).toHaveLength(1); // only the Designer candidate goes through the image harness
    const writer = JSON.parse((await runRenderCli(["writer/strings.sample/sample-v1.md", "--json"], root)).message) as RenderIndex;
    expect(writer.specimens).toEqual([expect.objectContaining({ specimen: "copy", locale: "en" })]);
    expect(readFileSync(join(root, writer.specimens[0]!.html!), "utf8")).toContain("Weekly report ready");
    const director = JSON.parse((await runRenderCli(["director/aspiration.purpose.vision/vision-v1.md", "--json"], root)).message) as RenderIndex;
    expect(readFileSync(join(root, director.specimens[0]!.html!), "utf8")).toContain("closes its books");
    // A slot ref renders every live candidate; the same inputs give the same digest.
    const slot = await renderRef({ root, ref: "publisher/pages.home" });
    expect(slot.specimens.map(row => row.candidate)).toEqual(["home-v1.json", "home-v2.json"]);
    expect((await renderRef({ root, ref: "publisher/pages.home" })).inputsSha256).toBe(slot.inputsSha256);
  });

  it("--compare returns both candidates' paths and one combined side-by-side file", async () => {
    const result = await runRenderCli(["publisher/pages.home/home-v2.json", "--compare", "publisher/pages.home/home-v1.json", "--json"], root);
    expect(result.exitCode, result.message).toBe(0);
    const index = JSON.parse(result.message) as RenderIndex;
    expectRenderIndex(index);
    expect(index.compare).toBe("publisher/pages.home/home-v1.json");
    const dir = `${RENDERS_DIR}/compare/home-v2--home-v1`;
    expect(index.specimens.map(row => [row.candidate, row.specimen, row.html])).toEqual([
      ["home-v2.json", "page", `${dir}/home-v2-page.html`],
      ["home-v1.json", "page", `${dir}/home-v1-page.html`],
      ["home-v2.json", COMPARE_SPECIMEN, `${dir}/compare.html`],
    ]);
    const combined = readFileSync(join(root, index.specimens[2]!.html!), "utf8");
    expect(combined).toContain('src="home-v2-page.html"');
    expect(combined).toContain('src="home-v1-page.html"');
    for (const row of index.specimens) expect(existsSync(join(root, row.html!))).toBe(true);
    // Designer compare: two candidates of one slot, images side by side.
    const cards = join(root, "clossys", "agents", "designer", "components.card", "candidates");
    const v1 = JSON.parse(readFileSync(join(cards, "sample-card-v1.json"), "utf8")) as { meta?: Record<string, unknown> };
    writeFileSync(join(cards, "sample-card-v2.json"), `${JSON.stringify({ ...v1, meta: { ...v1.meta, direction: "compare" } }, null, 2)}\n`);
    try {
      const harness = fakeHarness(root);
      const designer = await renderRef({ root, ref: "designer/components.card/sample-card-v2.json", compare: "designer/components.card/sample-card-v1.json", snapshot: harness.snapshot });
      expectRenderIndex(designer);
      const designerDir = `${RENDERS_DIR}/compare/sample-card-v2--sample-card-v1`;
      expect(designer.specimens.map(row => row.png ?? row.html)).toEqual([
        `${designerDir}/sample-card-v2-480.png`,
        `${designerDir}/sample-card-v1-480.png`,
        `${designerDir}/compare.html`,
      ]);
      const page = readFileSync(join(root, `${designerDir}/compare.html`), "utf8");
      expect(page).toContain('<img src="sample-card-v2-480.png"');
      expect(page).toContain('<img src="sample-card-v1-480.png"');
    } finally { rmSync(join(cards, "sample-card-v2.json")); }
  });

  it("a candidate whose bytes change is a new key, never a cache hit", async () => {
    const harness = fakeHarness(root);
    const ref = "designer/components.card/sample-card-v1.json";
    const path = join(root, "clossys", "agents", "designer", "components.card", "candidates", "sample-card-v1.json");
    const original = readFileSync(path, "utf8");
    try {
      await renderRef({ root, ref, snapshot: harness.snapshot });
      const calls = harness.calls.length;
      await renderRef({ root, ref, snapshot: harness.snapshot });
      expect(harness.calls.length).toBe(calls); // same bytes: cached
      const item = JSON.parse(original) as Record<string, unknown>;
      writeFileSync(path, `${JSON.stringify({ ...item, meta: { ...(item.meta as object | undefined), changed: true } }, null, 2)}\n`);
      const first = await renderRef({ root, ref, snapshot: harness.snapshot });
      expect(harness.calls.length).toBe(calls + 1); // new bytes: rendered again
      writeFileSync(path, original);
      expect((await renderRef({ root, ref, snapshot: harness.snapshot })).inputsSha256).not.toBe(first.inputsSha256);
    } finally { writeFileSync(path, original); }
  });

  it("--draft renders under clossys/.state/renders and never writes the candidate folder", async () => {
    const slotDir = join(root, "clossys", "agents", "designer", "components.card");
    const tree = () => readdirSync(slotDir, { recursive: true }).map(String).sort().map(path => [path, statSync(join(slotDir, path)).isFile() ? readFileSync(join(slotDir, path), "utf8") : "/"]);
    const before = tree();
    const pinned = JSON.parse(readFileSync(join(slotDir, "candidates", "sample-card-v1.json"), "utf8")) as { meta?: Record<string, unknown> };
    writeFileSync(join(root, "draft.json"), JSON.stringify({ ...pinned, meta: { ...pinned.meta, draftDirection: "d2" } }));
    const harness = fakeHarness(root);
    const result = await runRenderCli(["designer/components.card", "--draft", "draft.json", "--json"], root, harness.snapshot);
    expect(result.exitCode, result.message).toBe(0);
    const index = JSON.parse(result.message) as RenderIndex;
    expectRenderIndex(index);
    expect(index.ref).toBe("designer/components.card/sample-card-v2.json");
    expect(index.specimens[0]!.png).toBe(`${RENDERS_DIR}/designer/components.card/sample-card-v2/element-480.png`);
    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0]!.records[0]).not.toBe(join(root, "clossys"));
    expect(tree()).toEqual(before);
    expect((await runRenderCli(["writer/strings.sample", "--draft", "draft.json"], root)).exitCode).toBe(2);
  });

  it("refuses bad refs with exit 2", async () => {
    expect((await runRenderCli(["publisher/pages.home/nope-v9.json"], root)).exitCode).toBe(2);
    expect((await runRenderCli(["publisher/no.such.slot"], root)).exitCode).toBe(2);
    expect((await runRenderCli(["publisher/pages.home/home-v1.json", "--compare", "publisher/pages.home"], root)).exitCode).toBe(2);
    expect((await runRenderCli(["components.card", "--compare", "publisher/pages.home/home-v1.json"], root)).exitCode).toBe(2);
  });
});

describe("clossys render on the Tallyhouse fixture (system.md 14.7)", () => {
  it("renders one candidate per text agent and each result validates", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "producer-render-tallyhouse-")));
    temps.push(root);
    cpSync(TALLYHOUSE, root, { recursive: true });
    const refs = [
      "director/identity.naming.name/name-v1.md",
      "writer/sections.hero.copy/home.hero-v3.json",
      "writer/narratives.legal-document/privacy-v2.md",
      "publisher/page.home/home-v2.json",
      "producer/loop.refine/refine-v2.json",
    ];
    for (const ref of refs) {
      const index = await renderRef({ root, ref });
      expectRenderIndex(index);
      expect(index.ref).toBe(ref);
      for (const row of index.specimens) expect(readFileSync(join(root, row.html!), "utf8")).toMatch(/^<!doctype html>/);
    }
    // Renders are machine state under clossys/.state/renders/; the records beside it are never written.
    const records = (dir: string) => readdirSync(dir, { recursive: true }).map(String).filter(path => path !== ".state" && !path.startsWith(".state/")).sort();
    expect(records(join(root, "clossys"))).toEqual(records(join(TALLYHOUSE, "clossys")));
    expect(readdirSync(join(root, "clossys", ".state", "renders")).sort()).toEqual(["director", "producer", "publisher", "writer"]);
  });
});

describe.skipIf(!chrome)("Designer render in Chrome", () => {
  it("writes the same image bytes the Studio specimen harness captures for the candidate", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "producer-render-chrome-")));
    temps.push(root);
    const consumer = await canonicalLibrary(join(root, "clossys"));
    // npm imports in payloads resolve from the repository workspace, as in specimen.test.ts.
    const harness = (options: SnapshotOptions) => snapshotSpecimen({ ...options, workspace, cwd: workspace, cache: join(root, "render-harness") });
    const index = await renderRef({ root, ref: "designer/components.card/sample-card-v1.json", widths: [480], snapshot: harness });
    const rendered = readFileSync(join(root, index.specimens[0]!.png!));
    const studio = await snapshotSpecimen({ records: [consumer], element: "components.card/sample-card", version: 1, theme: "light", widths: [480], cache: join(root, "studio-cache"), workspace, cwd: workspace });
    expect(rendered.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(rendered.equals(readFileSync(studio.thumbnails[0]!.path))).toBe(true);
  }, 180_000);
});

