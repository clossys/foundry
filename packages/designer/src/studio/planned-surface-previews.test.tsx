/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { importFoundryFrames, importFoundrySections, loadBuildCatalog, planSurfaceDefaults } from "../catalog-core/index.js";
import type { SurfaceDefaultCandidateDocument, SurfaceDefaultsInput } from "../catalog-core/index.js";
import * as studioEntry from "./index.js";
import { packageSurfacePreview, planSurfacePreviews, SURFACE_SAMPLE_STATES } from "./planned-surface-previews.js";
import { surfaceStateSample } from "./surface-preview-sample-content.js";
import { specimenDataset } from "./specimen-dataset.js";

const SITE_SHELL_GAP = { slot: "frames.site-shell", reason: "@clossys/publisher/web#SiteFrame is not a designer export; the designer does not render it" };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function realPlan() {
  const slots = loadBuildCatalog().slots.filter(slot => slot.layer === "sections" || slot.layer === "frames") as SurfaceDefaultsInput["catalog"]["slots"];
  const fills: SurfaceDefaultCandidateDocument[] = [...importFoundrySections().fills, ...importFoundryFrames().fills];
  return { fills, plan: planSurfaceDefaults({ catalog: { slots, fills }, slots: slots.map(slot => slot.id), preference: ["foundry"] }) };
}

describe("planSurfacePreviews", () => {
  it("exports the producer from the studio entry as the same function", () => {
    expect(studioEntry.planSurfacePreviews).toBe(planSurfacePreviews);
  });

  it("accounts for every planned Sections/Frames leaf of the real catalog: a preview or a named reason", () => {
    const { plan, fills } = realPlan();
    const planned = plan.rows.filter(row => row.status !== "not-chosen");
    expect(planned.filter(row => row.slot.startsWith("sections."))).toHaveLength(45);
    expect(planned.filter(row => row.slot.startsWith("frames."))).toHaveLength(9);
    const result = planSurfacePreviews({ plan, fills });
    const previewed = Object.keys(result.previews), gaps = result.unrenderable.map(gap => gap.slot);
    expect([...previewed, ...gaps].sort()).toEqual(planned.map(row => row.slot).sort());
    // Every planned designer export has sample content; only the Publisher frame waits for its host.
    expect(previewed.filter(slot => slot.startsWith("sections."))).toHaveLength(45);
    for (const slot of ["sections.activity-feed", "sections.audit-log", "sections.timeline", "sections.usage"]) expect(previewed, slot).toContain(slot);
    for (const leaf of ["consent", "error-state", "stats", "data-grid", "cards", "call-to-action", "notices", "gallery", "data-table"]) expect(previewed, leaf).toContain(`sections.${leaf}`);
    expect(previewed.filter(slot => slot.startsWith("frames.")).sort()).toEqual(["frames.app-header", "frames.app-shell", "frames.app-sidebar", "frames.command", "frames.inspector", "frames.sheet", "frames.site-footer", "frames.site-header"]);
    expect(result.unrenderable).toEqual([SITE_SHELL_GAP]);
  });

  it("renders a non-designer export only from the host's own sample for that exact pointer", () => {
    const { plan, fills } = realPlan();
    const host = { "@clossys/publisher/web#SiteFrame": () => <p>host-site-frame</p> };
    const result = planSurfacePreviews({ plan, fills, samples: host });
    expect(result.unrenderable).toEqual([]);
    expect(result.previews["frames.site-shell"]).toMatchObject({ pointer: "@clossys/publisher/web#SiteFrame", fill: "foundry/frames.site-shell" });
    expect(renderToStaticMarkup(<>{result.previews["frames.site-shell"]!.render()}</>)).toBe("<p>host-site-frame</p>");
    // A sample for another pointer is never borrowed.
    expect(planSurfacePreviews({ plan, fills, samples: { "@clossys/publisher/web#Other": host["@clossys/publisher/web#SiteFrame"] } }).previews["frames.site-shell"]).toBeUndefined();
  });

  it("previews an adopted package pointer document through the same runtime renderers, and names why it cannot", () => {
    const { fills } = realPlan();
    const doc = (slot: string) => fills.find(candidate => candidate.$extensions["com.clossys.fill"].slot === slot)!;
    const table = packageSurfacePreview(doc("sections.data-table"));
    expect(table).toMatchObject({ pointer: "@clossys/designer/blocks#DataTable" });
    expect(renderToStaticMarkup(<>{"render" in table ? table.render() : null}</>)).toContain(specimenDataset.sections.dataTable.rows[1]!.customer);
    expect(packageSurfacePreview(doc("frames.site-shell"))).toEqual({ reason: "@clossys/publisher/web#SiteFrame is not a designer export; the designer does not render it" });
    expect(packageSurfacePreview({ ...doc("sections.faq"), sections: {} } as SurfaceDefaultCandidateDocument)).toEqual({ reason: "planned fill has no package export pointer" });
  });

  it("previews only planned rows and carries the plan's own fill and source, never a new provenance", () => {
    const { plan, fills } = realPlan();
    const result = planSurfacePreviews({ plan, fills });
    for (const row of plan.rows) {
      const preview = result.previews[row.slot];
      if (row.status === "not-chosen") { expect(preview).toBeUndefined(); continue; }
      if (!preview) continue;
      expect(preview).toMatchObject({ slot: row.slot, fill: row.fill, source: row.source });
    }
    expect(result.previews["sections.faq"]?.pointer).toBe("@clossys/designer/blocks#Faq");
    // Not-chosen rows produce nothing, even when a sample exists for the export.
    const demoted = { rows: plan.rows.map(row => row.slot === "sections.faq" ? { ...row, status: "not-chosen" as const } : row) };
    expect(planSurfacePreviews({ plan: demoted, fills }).previews["sections.faq"]).toBeUndefined();
  });

  it("renders each preview through its package runtime renderer and the specimen dataset", () => {
    const { plan, fills } = realPlan();
    const result = planSurfacePreviews({ plan, fills });
    const html = Object.fromEntries(Object.values(result.previews).map(preview => [preview.slot, renderToStaticMarkup(<>{preview.render()}</>)]));
    for (const [slot, markup] of Object.entries(html)) expect(markup.length, slot).toBeGreaterThan(20);
    expect(html["sections.faq"]).toContain(specimenDataset.sections.faq.items[0]!.question);
    expect(html["sections.access-matrix"]).toContain(specimenDataset.sections.accessMatrix.groups[0]!.permissions[0]!.label);
    expect(html["sections.pagination"]).toContain("nav");
    expect(html["frames.site-header"]).toContain("Northwind");
    expect(html["sections.filter-builder"]).toContain("Filter records");
    expect(html["sections.settings"]).toContain("Save changes");
    expect(html["sections.wizard"]).toContain("Upload progress");
    expect(html["frames.inspector"]).toContain("<aside");
    expect(result.previews["frames.inspector"]?.pointer).toBe("@clossys/designer/frames#InspectorFrame");
    // Structured Sections render their real block with the dataset's rows, tiers and items.
    const samples: Record<string, string> = { "sections.comparison": specimenDataset.sections.comparison.rows[0]!.label, "sections.content": specimenDataset.sections.content.heading, "sections.data-table": specimenDataset.sections.dataTable.rows[1]!.customer, "sections.form": specimenDataset.sections.form.fields[0]!.label, "sections.pricing": specimenDataset.sections.pricing.tiers[0]!.cta, "sections.resource-list": specimenDataset.sections.resourceList.items[0]!.title, "sections.status-list": specimenDataset.sections.statusList.groups![0]!.items[0]!.label, "sections.task-list": specimenDataset.sections.taskList.items[0]!.title, "frames.sheet": specimenDataset.dialog.trigger };
    for (const [slot, text] of Object.entries(samples)) expect(html[slot], slot).toContain(text);
    expect(result.previews["sections.comparison"]?.pointer).toBe("@clossys/designer/blocks#Matrix");
    expect(html["sections.comparison"]).toContain("<table");
    expect(result.previews["frames.site-header"]?.pointer).toBe("@clossys/designer/shell/server#SiteHeader");
    // vf34: the app sidebar renders the real AppNavigation with the dataset's navigation tree.
    expect(result.previews["frames.app-sidebar"]?.pointer).toBe("@clossys/designer/blocks#AppNavigation");
    expect(html["frames.app-sidebar"]).toContain(specimenDataset.navigation.label);
    for (const item of specimenDataset.navigation.items) expect(html["frames.app-sidebar"]).toContain(item.label);
    // Adopted leaves render their real export with the dataset's content.
    const adopted: Record<string, [pointer: string, text: string]> = {
      "sections.chat": ["@clossys/designer/blocks#Chat", specimenDataset.sections.chat.messages[0]!.content],
      "sections.explorer": ["@clossys/designer/blocks#Explorer", specimenDataset.list.items[0]!.label],
      "sections.hero": ["@clossys/designer/blocks#Hero", specimenDataset.sections.hero.heading],
      "sections.newsletter": ["@clossys/designer/blocks#NewsletterBand", specimenDataset.sections.newsletter.emailLabel],
      "frames.app-shell": ["@clossys/designer/frames#AppFrame", "Skip to content"],
      "frames.command": ["@clossys/designer/blocks#CommandMenu", "Open command menu"],
    };
    for (const [slot, [pointer, text]] of Object.entries(adopted)) {
      expect(result.previews[slot]?.pointer, slot).toBe(pointer);
      expect(html[slot], slot).toContain(text);
    }
    expect(html["sections.newsletter"]).toContain('type="email"');
    expect(html["frames.app-shell"]).toContain("<main");
    // The command menu is an overlay: it previews closed, as its opener, never as an open dialog over the board.
    expect(html["frames.command"]).not.toContain('role="dialog"');
    expect(html["frames.command"]).toContain("<button");
  });

  it("opens the real command menu from the closed command preview", async () => {
    const { plan, fills } = realPlan();
    const user = userEvent.setup();
    render(<>{planSurfacePreviews({ plan, fills }).previews["frames.command"]!.render()}</>);
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Open command menu" }));
    const dialog = await screen.findByRole("dialog");
    for (const item of [...specimenDataset.navigation.items, ...specimenDataset.menu.items]) expect(dialog).toHaveTextContent(item.label);
  });

  it("keeps the app frame preview off the board's keyboard: its command shortcut never opens a menu", () => {
    vi.stubGlobal("matchMedia", vi.fn((media: string) => ({ media, matches: true, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true })));
    const { plan, fills } = realPlan();
    render(<>{planSurfacePreviews({ plan, fills }).previews["frames.app-shell"]!.render()}</>);
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Skip to content" })).toBeInTheDocument();
    for (const init of [{ key: "k", metaKey: true }, { key: "k", ctrlKey: true }]) act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true })));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reports a planned fill missing from the candidate documents instead of rendering it", () => {
    const { plan } = realPlan();
    const result = planSurfacePreviews({ plan, fills: [] });
    expect(Object.keys(result.previews)).toHaveLength(0);
    expect(result.unrenderable.find(gap => gap.slot === "sections.faq")?.reason).toBe("planned fill foundry/sections.faq is not among the candidate documents");
  });
});

/*
 * vf35 capture fixtures: a host (or a capture harness driving it) asks for one sample state for every
 * planned or adopted package preview. A preview whose export supports that state renders it from the
 * real export's own props; every other preview stays on its default sample and says so.
 */
describe("surface sample states", () => {
  const html = (preview: ReturnType<typeof packageSurfacePreview>) => renderToStaticMarkup(<>{"render" in preview ? preview.render() : null}</>);
  const doc = (slot: string) => realPlan().fills.find(candidate => candidate.$extensions["com.clossys.fill"].slot === slot)!;

  it("lists the selectable states, default first", () => {
    expect(SURFACE_SAMPLE_STATES).toEqual(["default", "empty", "loading", "error", "long-content"]);
    expect(studioEntry.SURFACE_SAMPLE_STATES).toBe(SURFACE_SAMPLE_STATES);
  });

  it("renders a supported state from the real export and names it", () => {
    const list = doc("sections.resource-list");
    expect(packageSurfacePreview(list)).toMatchObject({ state: "default" });
    const empty = packageSurfacePreview(list, {}, "empty");
    expect(empty).toMatchObject({ pointer: "@clossys/designer/blocks#ResourceList", state: "empty" });
    expect(html(empty)).toContain("No projects yet");
    expect(html(empty)).not.toContain(specimenDataset.sections.resourceList.items[0]!.title);
    const loading = packageSurfacePreview(list, {}, "loading");
    expect(loading).toMatchObject({ state: "loading" });
    expect(html(loading)).toContain('role="status"');
    expect(html(loading)).toContain(surfaceStateSample.loadingLabel);
    expect(html(loading)).not.toContain(specimenDataset.sections.resourceList.items[0]!.title);
    const error = packageSurfacePreview(list, {}, "error");
    expect(error).toMatchObject({ state: "error" });
    expect(html(error)).toContain(surfaceStateSample.error.title);
    expect(html(error)).not.toContain(specimenDataset.sections.resourceList.items[0]!.title);
    const long = packageSurfacePreview(list, {}, "long-content");
    expect(long).toMatchObject({ state: "long-content" });
    expect(html(long)).toContain(surfaceStateSample.longTitle);
  });

  it("keeps an export without that state on its default sample, and says it is the default", () => {
    const table = packageSurfacePreview(doc("sections.data-table"), {}, "error");
    expect(table).toMatchObject({ state: "default" });
    expect(html(table)).toContain(specimenDataset.sections.dataTable.rows[1]!.customer);
    const faq = packageSurfacePreview(doc("sections.faq"), {}, "empty");
    expect(faq).toMatchObject({ state: "default" });
    expect(html(faq)).toContain(specimenDataset.sections.faq.items[0]!.question);
  });

  it("never applies a state to a host-owned sample", () => {
    const host = { "@clossys/publisher/web#SiteFrame": () => <p>host-site-frame</p> };
    expect(packageSurfacePreview(doc("frames.site-shell"), host, "empty")).toMatchObject({ state: "default" });
  });

  it("threads the requested state through every planned preview and records it", () => {
    const { plan, fills } = realPlan();
    const result = planSurfacePreviews({ plan, fills, sampleState: "empty" });
    expect(result.sampleState).toBe("empty");
    expect(result.previews["sections.resource-list"]?.state).toBe("empty");
    expect(result.previews["sections.faq"]?.state).toBe("default");
    expect(planSurfacePreviews({ plan, fills }).sampleState).toBe("default");
  });

  it("renders every supported state of every planned preview, and each differs from its default", () => {
    const { plan, fills } = realPlan();
    const base = planSurfacePreviews({ plan, fills });
    const supported: string[] = [];
    for (const state of SURFACE_SAMPLE_STATES.slice(1)) {
      for (const preview of Object.values(planSurfacePreviews({ plan, fills, sampleState: state }).previews)) {
        if (preview.state === "default") continue;
        supported.push(`${preview.slot}:${state}`);
        const markup = renderToStaticMarkup(<>{preview.render()}</>);
        expect(markup, `${preview.slot}:${state}`).not.toBe(renderToStaticMarkup(<>{base.previews[preview.slot]!.render()}</>));
      }
    }
    expect(supported.sort()).toEqual([
      "sections.activity-feed:empty", "sections.audit-log:empty", "sections.audit-log:loading",
      "sections.data-grid:empty", "sections.data-grid:loading", "sections.data-grid:long-content",
      "sections.data-table:empty", "sections.data-table:loading", "sections.data-table:long-content",
      "sections.resource-list:empty", "sections.resource-list:error", "sections.resource-list:loading", "sections.resource-list:long-content",
    ]);
  });
});
