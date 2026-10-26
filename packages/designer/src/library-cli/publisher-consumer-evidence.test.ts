/** @vitest-environment node */
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dogfoodComposes } from "../catalog-core/dogfood.js";
import tokenSlots from "../catalog/slots/tokens.json" with { type: "json" };
import { consumerDogfoodSources, runConsumerDogfood, type ConsumerDogfoodContract } from "./consumer-dogfood.js";

// Read the current Publisher graph in this checkout. A copied excerpt, frozen
// finding count or empty replacement dependency cannot establish this evidence.
const publisher = new URL("../../../publisher/src/", import.meta.url);
const layout = "web/internal/PageLayout.tsx";
const links = "web/internal/ViewLinks.tsx";
const app = "web/publisher/app/AppPack.tsx";
const tokens = tokenSlots.map(slot => ({ id: slot.id, contract: { emit: Object.fromEntries(Object.entries(slot.contract.emit ?? {}).filter(([, property]) => typeof property === "string")) } }));
let root: string;
let route: string;
let input: Awaited<ReturnType<typeof consumerDogfoodSources>>;
let themeCss: string;
let contract: ConsumerDogfoodContract;
const load = () => consumerDogfoodSources(["ConsumerRoute.tsx", fileURLToPath(new URL("../../styles/theme.css", import.meta.url))], contract, root, root);
const observed = () => ({ ...input, tokens, themeCss });
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

  it("recognizes actual Button aliases while refusing fake exports and foreign identity", () => {
    const aliased = mutate(app, content => content.replace('import { Button }', 'import { Button as PublishButton }').replaceAll("<Button", "<PublishButton").replaceAll("</Button>", "</PublishButton>"));
    expect(dogfoodComposes(aliased)).toEqual(expect.arrayContaining([expect.objectContaining({ file: source(app).file, tag: "PublishButton", symbol: "Button", slotId: "components.button" })]));
    for (const replace of [
      (content: string) => content.replace('import { Button }', 'import { MissingButton as Button }'),
      (content: string) => content.replace('from "@clossys/designer/components"', 'from "foreign-ui"'),
    ]) {
      const report = runConsumerDogfood(mutate(app, replace));
      expect(rows(report, app)).toEqual(expect.arrayContaining([expect.objectContaining({ code: "DF5", tag: "Button" })]));
    }
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

  it("keeps dynamic source and missing authored read contracts unresolved", () => {
    const report = runConsumerDogfood(observed());
    expect(rows(report, layout)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "DF2", evidence: expect.stringContaining("dynamic source") }),
      expect.objectContaining({ code: "DF4", evidence: expect.stringContaining("missing-declared-reads") }),
    ]));
    expect(observed()).not.toHaveProperty("contracts");
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
