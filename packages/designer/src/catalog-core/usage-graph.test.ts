// @vitest-environment node
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildUsageGraph, closure, graphFindings, usedBy, uses, type UsageGraphInputs } from "./index.js";
import { serializeUsageGraph } from "./usage-graph.js";
import { loadCatalog } from "./index.js";
import { completedCatalogLibrary } from "./__fixtures__/completed-catalog-library.js";
import { libraryFiles } from "../library-cli/fs-library.js";
import { main } from "../library-cli/cli.js";

/** A small consumer library: every input is the shape an existing producer already emits. */
function fixture(): UsageGraphInputs {
  return {
    inventory: {
      themes: ["themes.color", "themes.radius", "themes.spacing", "themes.unused"],
      assets: ["assets.icon-close"],
      components: ["components.button", "components.dialog", "components.icon"],
      sections: ["sections.band", "sections.form"],
      frames: ["frames.app-shell"],
    },
    selection: {
      "themes.color": "foundry/themes.color", "themes.radius": "foundry/themes.radius", "themes.spacing": "foundry/themes.spacing", "themes.unused": "foundry/themes.unused",
      "assets.icon-close": "lucide/assets.icon-close",
      "components.button": "shadcn@aria/components.button", "components.dialog": "shadcn@aria/components.dialog", "components.icon": "foundry/components.icon",
      "sections.form": "foundry/sections.form", "frames.app-shell": "foundry/frames.app-shell",
    },
    // relationships.ts consumptionReport leaves (selected token/asset fills only).
    consumption: { leaves: [
      { id: "assets.icon-close", themes: ["themes.color", "themes.missing"], assets: [] },
      { id: "themes.color", themes: ["themes.color"], assets: [] },
    ] },
    // components-consumption.json: fills plus reverseComposes keyed by the composed leaf.
    components: {
      fills: [
        { id: "shadcn@aria/components.button", slot: "components.button", scanStatus: "lower-bound", declaredReads: { themes: ["themes.color", "themes.spacing"], assets: [] }, scannedReads: { themes: ["themes.color"], assets: [] } },
        { id: "foundry/components.button", slot: "components.button", scanStatus: "lower-bound", declaredReads: { themes: ["themes.radius"], assets: [] }, scannedReads: { themes: ["themes.radius"], assets: [] } },
        { id: "foundry/components.icon", slot: "components.icon", scanStatus: "unavailable", declaredReads: { themes: [], assets: ["assets.icon-close"] } },
      ],
      reverseComposes: {
        "components.button": { declared: ["foundry/components.toast", "shadcn@aria/components.dialog"], scanned: ["shadcn@aria/components.dialog"] },
        "components.icon": { declared: ["shadcn@aria/components.button"], scanned: [] },
      },
    },
    // buildSurfaceConsumption(): fills plus reverseComposes.
    surfaces: {
      fills: [
        { id: "foundry/sections.form", slot: "sections.form", scanStatus: "lower-bound", declaredReads: { themes: ["themes.radius"], assets: [] }, scannedReads: { themes: ["themes.radius"], assets: [] },
          observedComposes: [{ file: "src/blocks/Form.tsx", line: 12, slotId: "components.button", tag: "Button" }, { file: "src/blocks/Form.tsx", line: 3, slotId: "components.link", tag: "Link" }] },
        { id: "foundry/frames.app-shell", slot: "frames.app-shell", scanStatus: "lower-bound", declaredReads: { themes: [], assets: [] }, scannedReads: { themes: [], assets: [] } },
      ],
      reverseComposes: {
        "components.button": { declared: ["foundry/sections.form"], scanned: ["foundry/sections.form"] },
        "components.dialog": { declared: ["foundry/frames.app-shell"], scanned: ["foundry/frames.app-shell"] },
        "sections.band": { declared: ["foundry/sections.form"], scanned: [] },
      },
    },
    // Route registry RuntimeAssemblyBinding projection.
    pages: [{ routeId: "home", binding: {
      frame: { leaf: "frames.app-shell", fill: "foundry/frames.app-shell", config: null, members: [], content: {} },
      frameSlots: {},
      sections: { main: [{ leaf: "sections.form", fill: "foundry/sections.form", config: null, members: [], content: {} }] },
    } }],
  };
}
const rows = (edges: readonly { from: string; to: string; kind: string; evidence: readonly string[] }[]) => edges.map(edge => `${edge.from} -${edge.kind}/${edge.evidence.join("+")}-> ${edge.to}`);

describe("usage graph", () => {
  it("derives exact uses, usedBy and closures from a fixture library", () => {
    const graph = buildUsageGraph(fixture());
    expect(rows(uses(graph, "components.button"))).toEqual([
      "components.button -composes/declared-> components.icon",
      "components.button -reads/declared+scanned-> themes.color",
      "components.button -reads/declared-> themes.spacing",
    ]);
    expect(rows(usedBy(graph, "components.button"))).toEqual([
      "components.dialog -composes/declared+scanned-> components.button",
      "sections.form -composes/declared+scanned-> components.button",
    ]);
    expect(usedBy(graph, "components.button").find(edge => edge.from === "sections.form")?.at).toEqual([{ file: "src/blocks/Form.tsx", line: 12, tag: "Button" }]);
    expect(rows(usedBy(graph, "sections.form"))).toEqual([
      "frames.app-shell -hosts/declared-> sections.form",
      "pages.home -renders/declared-> sections.form",
    ]);
    expect(rows(uses(graph, "pages.home"))).toEqual([
      "pages.home -renders/declared-> frames.app-shell",
      "pages.home -renders/declared-> sections.form",
    ]);
    // Members resolve to their leaf; an unknown id has no edges.
    expect(rows(usedBy(graph, "themes.radius.aside"))).toEqual(["sections.form -reads/declared+scanned-> themes.radius"]);
    expect(uses(graph, "components.unknown")).toEqual([]);
    expect(closure(graph, "themes.color", "usedBy")).toEqual(["assets.icon-close", "components.button", "components.dialog", "components.icon", "frames.app-shell", "pages.home", "sections.form"]);
    expect(closure(graph, "pages.home", "uses")).toEqual(["assets.icon-close", "components.button", "components.dialog", "components.icon", "frames.app-shell", "sections.band", "sections.form", "themes.color", "themes.missing", "themes.radius", "themes.spacing"]);
    expect(closure(graph, "themes.unused", "usedBy")).toEqual([]);
    expect(graph.nodes.find(node => node.id === "components.button")).toEqual({ id: "components.button", layer: "components", leaf: "components.button", fill: { id: "shadcn@aria/components.button", source: "shadcn@aria" }, origin: "inventory", scan: "lower-bound" });
    expect(graph.nodes.find(node => node.id === "pages.home")).toEqual({ id: "pages.home", layer: "pages", leaf: "pages.home", origin: "route" });
    expect(graph.summary).toEqual({ nodes: { assets: 1, components: 3, frames: 1, pages: 1, sections: 2, themes: 5 }, edges: { composes: 5, hosts: 1, reads: 6, renders: 2 }, evidence: { declared: 14, runtime: 0, scanned: 5 } });
  });

  it("drops composes edges when the reverseComposes input is absent", () => {
    const input = fixture();
    const graph = buildUsageGraph({ ...input, surfaces: { ...input.surfaces!, reverseComposes: undefined } });
    expect(rows(usedBy(graph, "components.button"))).toEqual(["components.dialog -composes/declared+scanned-> components.button"]);
  });

  it("is order-independent, hash-stamped and never treats absent runtime evidence as an error", () => {
    const input = fixture(), graph = buildUsageGraph(input);
    const reversed = buildUsageGraph({ ...input, consumption: { leaves: [...input.consumption!.leaves].reverse() }, components: { ...input.components, fills: [...input.components!.fills!].reverse() }, surfaces: { ...input.surfaces, fills: [...input.surfaces!.fills!].reverse() } });
    expect(serializeUsageGraph(reversed)).toBe(serializeUsageGraph(graph));
    expect(graph.inputsHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(graph.inputs).toMatchObject({ runtime: "absent", pages: expect.stringMatching(/^sha256:/) });
    expect(buildUsageGraph({ ...input, inventory: { ...input.inventory, themes: [...input.inventory.themes!, "themes.extra"] } }).inputsHash).not.toBe(graph.inputsHash);
    expect(serializeUsageGraph(graph)).not.toMatch(/"(?:generatedAt|timestamp|date)"/);
    const findings = graphFindings(graph);
    expect(findings.every(finding => finding.severity !== "error")).toBe(true);
    expect(findings.map(finding => `${finding.code} ${finding.subject}${finding.target ? ` -> ${finding.target}` : ""}`)).toEqual([
      "dangling-endpoint assets.icon-close -> themes.missing",
      "unselected-endpoint sections.form -> sections.band",
      "unused-declaration components.button -> components.icon",
      "unused-declaration components.button -> themes.spacing",
      "unused-declaration sections.form -> sections.band",
      "used-nowhere themes.unused",
    ]);
  });

  it("merges runtime observations onto existing edges without inventing a new kind", () => {
    const graph = buildUsageGraph({ ...fixture(), runtime: [{ from: "pages.home", to: "sections.form", kind: "renders", route: "home", selector: "[data-ds-leaf=\"sections.form\"]" }] });
    expect(uses(graph, "pages.home").find(edge => edge.to === "sections.form")).toMatchObject({ evidence: ["declared", "runtime"], at: [{ route: "home", selector: "[data-ds-leaf=\"sections.form\"]" }, { route: "home", slot: "main" }] });
  });
});

describe("designer-library graph", () => {
  let temporary: string, root: string;
  beforeEach(async () => {
    const catalog = loadCatalog(), library = completedCatalogLibrary(catalog, { id: "example", kind: "consumer", author: "consumer", license: "UNLICENSED" }, "2026-10-23");
    temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "designer-graph-"))); root = join(temporary, "library");
    for (const [name, content] of libraryFiles(catalog, library)) { await fs.mkdir(dirname(join(root, name)), { recursive: true }); await fs.writeFile(join(root, name), content); }
  });
  afterEach(async () => { await fs.rm(temporary, { recursive: true, force: true }); });
  const invoke = async (...args: string[]) => {
    const out: string[] = [], error: string[] = [];
    const code = await main(args, { out: text => out.push(text), error: text => error.push(text) });
    return { code, out: out.join("\n"), error: error.join("\n") };
  };

  it("writes the consumer graph, reports it current, and fails --check on a hand edit", async () => {
    expect((await invoke("graph", "--root", root, "--check")).code).toBe(1);
    const written = await invoke("graph", "--root", root, "--write");
    expect(written.code).toBe(0);
    const path = join(root, "usage-graph.json"), bytes = await fs.readFile(path, "utf8");
    const report = JSON.parse(bytes);
    expect(report.inputsHash).toMatch(/^sha256:/);
    expect(report.edges.some((edge: { from: string; to: string; kind: string }) => edge.kind === "reads" && edge.from.startsWith("assets.") && edge.to.startsWith("themes."))).toBe(true);
    expect((await invoke("graph", "--root", root, "--check")).code).toBe(0);
    expect((await invoke("graph", "--root", root, "--write")).code).toBe(0);
    expect(await fs.readFile(path, "utf8")).toBe(bytes);
    await fs.writeFile(path, bytes.replace(/"reads"/, "\"composes\""));
    const drift = await invoke("graph", "--root", root, "--check");
    expect(drift.code).toBe(1);
    expect(drift.out + drift.error).toContain("usage-graph.json is stale");
    expect((await invoke("graph", "--root", root)).code).toBe(2);
    expect((await invoke("graph", "--root", root, "--check", "--write")).code).toBe(2);
  });
});
