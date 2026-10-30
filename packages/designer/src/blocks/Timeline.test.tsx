import { beforeAll, describe, expect, it } from "vitest";
import { Suspense, type ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { Timeline } from "./Timeline.js";
import { timelineSample } from "./timeline/sample.js";
import { SemanticContent } from "../components/SemanticContent.js";
import { ConsumerComponentProvider, SelectedComponentLeaf, type ConsumerComponentSelection } from "../runtime/component-leaf.client.js";
import { componentDescriptorHash, verifyComponentOutput, type ComponentCandidate, type ResolvedComponents } from "../catalog-core/resolve-components.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import cardDocument from "../catalog/fills/shadcn@aria/components.card.json" with { type: "json" };
import selectedProfile from "../studio/__fixtures__/default-component-preview-profile.json" with { type: "json" };
import fillDocument from "../catalog/fills/foundry/sections.timeline.json" with { type: "json" };
import { loadSectionRegistry } from "../catalog-core/sections-contract.js";
import { renderTimeline, timelineSection } from "../runtime/sections/timeline.js";
import { timelineA270Contribution } from "../runtime/sections/timeline.a270.contribution.js";
import type { SectionRenderInput } from "../runtime/sections/group-b-support.js";
import { runtimeHash } from "../catalog-core/runtime-ports.js";

let selection: ConsumerComponentSelection;
beforeAll(async () => {
  // Compile actual, hash-verified native materializer output in memory.
  const bundle = loadCatalogBundles().sourceBundles.find(row => row.slot === "components.card")!;
  const descriptor = cardDocument.components.card as unknown as ComponentCandidate;
  if (descriptor.impl.kind !== "source") throw new Error("Timeline fixture requires selected source Card");
  verifyComponentOutput(descriptor, bundle.files);
  const entry = descriptor.impl.entry;
  // Node owns compilation, avoiding jsdom's cross-realm Uint8Array boundary.
  const compiled = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { build } from "esbuild";
    import { readFileSync } from "node:fs";
    import { dirname, posix } from "node:path";
    const { entry, sourceFiles } = JSON.parse(readFileSync(0, "utf8"));
    const files = new Map(sourceFiles.map(file => [file.path, file.content]));
    const output = await build({ stdin: { contents: "export * from " + JSON.stringify(entry), loader: "ts" }, bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic", plugins: [{ name: "timeline-selected-source", setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, args => {
        const path = args.path.startsWith(".") ? posix.normalize(posix.join(dirname(args.importer), args.path)) : args.path;
        const target = [path, path + ".ts", path + ".tsx", path + "/index.ts"].find(candidate => files.has(candidate));
        return target ? { path: target, namespace: "timeline-selected-source" } : { path: args.path, external: true };
      });
      plugin.onLoad({ filter: /.*/, namespace: "timeline-selected-source" }, args => ({ contents: files.get(args.path), loader: args.path.endsWith(".tsx") ? "tsx" : "ts" }));
    } }] });
    process.stdout.write(output.outputFiles[0].text);
  `], { input: JSON.stringify({ entry, sourceFiles: bundle.files }), encoding: "utf8" });
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(createRequire(import.meta.url), module, module.exports);
  const profile = structuredClone(selectedProfile) as unknown as ResolvedComponents;
  profile.components = {
    "components.card": { ...profile.components["components.card"]!, descriptor, impl: descriptor.impl, propMap: descriptor.propMap, origin: { kind: "adopted", source: descriptor.source, fill: cardDocument.$extensions["com.clossys.fill"].id, pin: descriptor.pin, license: descriptor.license, sha256: componentDescriptorHash(descriptor), adoptedAt: "2026-10-30" } },
    "components.semantic-content": profile.components["components.semantic-content"]!,
  };
  profile.files = bundle.files;
  profile.selectionHash = componentDescriptorHash(descriptor);
  selection = {
    profile: { components: profile }, selectionHash: profile.selectionHash,
    descriptors: Object.fromEntries(Object.entries(profile.components).map(([leaf, chosen]) => [leaf, componentDescriptorHash(chosen.descriptor)])),
    modules: { [entry]: module.exports, "@clossys/designer/components": { SemanticContent } },
  };
});
const selected = (children: ReactNode, value = selection) => <ConsumerComponentProvider value={value}><Suspense>{children}</Suspense></ConsumerComponentProvider>;

function runtimeInput(): SectionRenderInput {
  const reference = { kind: "records", ref: "timeline:events" } as const;
  const events = timelineSample.events.map(event => ({ id: event.id, at: event.at, dateText: event.dateText, heading: String(event.heading), description: String(event.description) }));
  return {
    path: "body/0", cell: { theme: "light", state: "default", width: 390 },
    fill: { kind: "section", library: "foundry", fill: "foundry/sections.timeline", leaf: "sections.timeline", config: null, slots: ["events"], members: [], states: ["default"], renderer: { id: "sections.timeline#test", source: { entry: "timeline.tsx", files: {}, dependencies: {} }, sourceHash: runtimeHash("timeline") } },
    selection: { leaf: "sections.timeline", fill: "foundry/sections.timeline", config: null, members: [], content: { events: reference } },
    content: { events: { reference, value: events, hash: runtimeHash(events) } },
    sectionHost: { timelineLabel: timelineSample["aria-label"] }, slots: {}, profile: {} as SectionRenderInput["profile"],
  };
}

describe("Timeline selected component composition", () => {
  it("renders native ordered semantics, authored dates and actual selected Card parts", async () => {
    const { container } = render(selected(<Timeline {...timelineSample} />));
    const list = await screen.findByRole("list", { name: timelineSample["aria-label"] });
    expect(list.tagName).toBe("OL");
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(timelineSample.events.length);
    expect(rows.map(row => row.hasAttribute("data-timeline-rail"))).toEqual([true, true, false]);
    expect(rows[0]!.querySelector("time")).toHaveAttribute("datetime", timelineSample.events[0]!.at);
    expect(within(rows[0]!).getByText(timelineSample.events[0]!.dateText)).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 3 }).map(heading => heading.textContent)).toEqual(timelineSample.events.map(event => event.heading));
    for (const slot of ["card", "card-header", "card-title", "card-content"]) expect(container.querySelectorAll(`[data-slot=${slot}]`)).toHaveLength(timelineSample.events.length);
    expect(container.querySelector("[data-slot=card]")).toHaveClass("bg-(--color-surface-raised)");
  });
  it.each([2, 4] as const)("honours heading level %s and caller order without sorting dates", async headingLevel => {
    const events = [...timelineSample.events].reverse();
    render(selected(<Timeline {...timelineSample} events={events} headingLevel={headingLevel} />));
    await screen.findByRole("list");
    expect(screen.getAllByRole("heading", { level: headingLevel }).map(heading => heading.textContent)).toEqual(events.map(event => event.heading));
    expect(screen.getAllByRole("listitem").map(row => row.querySelector("time")!.dateTime)).toEqual(events.map(event => event.at));
  });
  it("ends the rail at the last marker and omits absent descriptions", async () => {
    const event = timelineSample.events[0]!;
    const { container } = render(selected(<Timeline {...timelineSample} events={[{ id: event.id, at: event.at, dateText: event.dateText, heading: event.heading }]} />));
    const row = await screen.findByRole("listitem");
    expect(row).not.toHaveAttribute("data-timeline-rail");
    expect(container.querySelector(".w-px")).toBeNull();
    expect(container.querySelector("[data-slot=card-content]")).toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });
  it("refuses empty events and missing selected modules with explicit NEED", () => {
    expect(() => renderToString(<Timeline events={[]} />)).toThrow(/Timeline: events must not be empty/);
    expect(() => renderToString(<ConsumerComponentProvider value={{ ...selection, modules: {} }}><SelectedComponentLeaf leaf="components.card" parts={[]} componentProps={{}} /></ConsumerComponentProvider>)).toThrow(/NEED component selection: components.card/);
  });
  it("renders the registered runtime from caller records and optional host label", async () => {
    expect(loadSectionRegistry().slots.some(slot => slot.id === timelineSection.leaf)).toBe(true);
    expect(timelineSection.slots).toEqual(Object.keys(fillDocument.sections.timeline.slotMap));
    const input = runtimeInput();
    render(selected(renderTimeline(input)));
    const list = await screen.findByRole("list", { name: timelineSample["aria-label"] });
    expect(list).toHaveAttribute("data-ds-leaf", "sections.timeline");
    expect(within(list).getAllByRole("heading").map(heading => heading.textContent)).toEqual(timelineSample.events.map(event => event.heading));
    expect(() => renderTimeline({ ...input, sectionHost: { timelineLabel: "" } })).toThrow(/resolved copy/);
    expect(renderTimeline({ ...input, sectionHost: undefined }).props["aria-label"]).toBeUndefined();
  });
  it("renders the keyed Studio contribution with the existing authored sample", async () => {
    expect(timelineA270Contribution.id).toBe("sections.timeline");
    expect(fillDocument.sections.timeline.impl.export).toBe("Timeline");
    render(selected(timelineA270Contribution.renderSpecimen()));
    expect(await screen.findByRole("list", { name: timelineSample["aria-label"] })).toBeVisible();
    expect(screen.getAllByRole("heading")).toHaveLength(timelineSample.events.length);
  });
});
