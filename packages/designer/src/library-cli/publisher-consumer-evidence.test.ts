/** @vitest-environment node */
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dogfoodComposes } from "../catalog-core/dogfood.js";
import themeSlots from "../catalog/slots/themes.json" with { type: "json" };
import { consumerDogfoodSources, runConsumerDogfood, type ConsumerDogfoodContract } from "./consumer-dogfood.js";

// Read the current Publisher graph in this checkout. A copied excerpt, frozen
// finding count or empty replacement dependency cannot establish this evidence.
const publisher = new URL("../../../publisher/src/", import.meta.url);
const layout = "web/internal/PageLayout.tsx";
const links = "web/internal/ViewLinks.tsx";
const app = "web/publisher/app/AppPack.tsx";
const themes = themeSlots.map(slot => ({ id: slot.id, contract: { emit: Object.fromEntries(Object.entries(slot.contract.emit ?? {}).filter(([, property]) => typeof property === "string")) } }));
let root: string;
let route: string;
let input: Awaited<ReturnType<typeof consumerDogfoodSources>>;
let themeCss: string;
let contract: ConsumerDogfoodContract;
const load = () => consumerDogfoodSources(["ConsumerRoute.tsx", fileURLToPath(new URL("../../styles/theme.css", import.meta.url))], contract, root, root);
const observed = () => ({ ...input, themes, themeCss });
const source = (suffix: string) => {
  const file = input.files.find(file => file.file.endsWith(`/${suffix}`));
  if (!file) throw new Error(`Publisher source not reached: ${suffix}`);
  return file;
};
function mutate(suffix: string, change: (content: string) => string) {
  const target = source(suffix);
  const content = change(target.content);
  expect(content).not.toBe(target.content);
  return { ...observed(), files: input.files.map(file => file === target ? { ...file, content } : file) };
}
const rows = (report: ReturnType<typeof runConsumerDogfood>, suffix: string) => report.findings.filter(row => row.file.endsWith(`/${suffix}`));

beforeAll(async () => {
  root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "publisher-consumer-")));
  route = await fs.readFile(new URL("./__fixtures__/publisher-consumer-evidence/ConsumerRoute.tsx.txt", import.meta.url), "utf8");
  await fs.writeFile(join(root, "ConsumerRoute.tsx"), route);
  contract = { version: 1, pages: ["ConsumerRoute.tsx"], sources: {
    "publisher-layout": fileURLToPath(new URL(layout, publisher)),
    "publisher-links": fileURLToPath(new URL(links, publisher)),
    "publisher-app": fileURLToPath(new URL(app, publisher)),
  } };
  input = await load();
  themeCss = input.files.filter(file => file.file.endsWith(".css")).map(file => file.content).join("\n");
});
afterAll(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); });

describe("current Publisher consumer evidence (zero finding allowlist)", () => {
  it("reaches actual public, same-file helper and React Fragment bodies without suppressions", () => {
    expect(source(layout).content).toContain("<PageLayoutHeader");
    expect(source(links).content).toContain("<ViewLinksSection");
    expect(source(app).content).toContain("<Fragment");
    expect(source(app).content).toContain('<Button type="button"');
    const report = runConsumerDogfood(observed());
    expect(report.ignored).toEqual([]);
    expect(report.exceptions).toEqual([]);
    expect(report.scanned.map(file => file.file)).toEqual(expect.arrayContaining([source(layout).file, source(links).file, source(app).file]));
    expect(report.findings.some(row => row.code === "DF8")).toBe(false);
  });

  it("requires the real Publisher server exports to resolve to registered public slots", () => {
    // This target assertion exposes a real boundary gap until the gate owner
    // supports these exact package exports. It is never a helper exemption.
    const report = runConsumerDogfood(observed());
    for (const [file, tag, module] of [[layout, "Card", "@clossys/designer/components/server"], [links, "Item", "@clossys/designer/blocks/server"], [links, "Items", "@clossys/designer/blocks/server"]] as const) {
      expect(rows(report, file).filter(row => row.code === "DF5" && row.tag === tag)).toEqual([]);
      expect(dogfoodComposes(observed())).toEqual(expect.arrayContaining([expect.objectContaining({ file: source(file).file, tag, module })]));
    }
  });

  it("records unresolved local helpers and Fragment instead of declaring the entire Publisher graph clean", () => {
    const report = runConsumerDogfood(observed());
    for (const [file, tag] of [[layout, "PageLayoutHeader"], [links, "ViewLinksSection"], [app, "Fragment"]]) {
      expect(rows(report, file!)).toEqual(expect.arrayContaining([expect.objectContaining({ code: "DF5", tag })]));
    }
    expect(report.ok).toBe(false);
  });

  it.each([
    ['<button>Publish</button>', "DF1", "button"],
    ['<span style={{ color: "#123456" }}>Publish</span>', "DF2", "span"],
  ])("retains reachable helper-body rejection for %s", (addition, code, tag) => {
    const report = runConsumerDogfood(mutate(layout, content => content.replace("<PageLayoutHeader title=", `${addition}<PageLayoutHeader title=`)));
    expect(rows(report, layout)).toEqual(expect.arrayContaining([expect.objectContaining({ code, tag })]));
    expect(report.ok).toBe(false);
    expect(report.exceptions).toEqual([]);
  });

  it("refuses missing and conditional CSS instead of accepting a reduced closure", async () => {
    try {
      await fs.writeFile(join(root, "ConsumerRoute.tsx"), `${route}\nimport "./consumer.css";`);
      await expect(load()).rejects.toThrow(/Unresolved/);
      await fs.writeFile(join(root, "consumer.css"), '@import "./nested.css" layer(tokens);');
      await fs.writeFile(join(root, "nested.css"), ":root { --spacing-example: 1rem; }");
      await expect(load()).rejects.toThrow(/conditional/);
    } finally {
      await fs.writeFile(join(root, "ConsumerRoute.tsx"), route);
    }
  });
});
