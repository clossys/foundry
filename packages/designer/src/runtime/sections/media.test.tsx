import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createCopyResolver } from "../../../../writer/src/resolve.js";
import type { CopyRef, CopyRegistry } from "../../../../writer/src/types.js";
import type { RuntimeJson } from "../../catalog-core/runtime-ports.js";
import sections from "../../catalog/slots/sections.json";
import passages from "../../../../writer/src/catalog/slots/passages.json";
import { FOUNDRY_SECTION_MAP, generatedFoundrySectionFiles } from "../../importers/foundry-sections.js";
import { sectionRenderers } from "./index.js";
import { mediaInputs, renderMediaSection } from "./media.js";
import type { SectionRenderInput } from "./group-a-content.js";

afterEach(cleanup);
const image = { kind: "illustration", src: "/workspace.webp", width: 1440, height: 900, alt: "Workspace", sizes: "100vw",
  sources: [{ src: "/workspace-large.webp", width: 2880, height: 1800, media: "(min-width: 40rem)" }] };
const figure = { media: { kind: "image", resource: image } };
const callouts = { label: "Writer highlights", items: [{ id: "review", body: "Writer review" }, { id: "history", body: "Writer history" }] };
const members = ["chrome.browser", "chrome.device", "chrome.bare"];
const descriptor = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../catalog/fills/foundry/sections.media.json"), "utf8")).sections.media;
function input(values: Record<string, RuntimeJson> = { figure }, selected: readonly string[] = []): SectionRenderInput {
  return { fill: { leaf: "sections.media", slots: Object.keys(descriptor.slotMap), members: Object.keys(descriptor.propMap) },
    selection: { leaf: "sections.media", members: selected },
    content: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])) } as unknown as SectionRenderInput;
}

describe("sections.media specimen runtime", () => {
  it.each(members)("renders %s through the registered real section and generated fill", member => {
    expect(sectionRenderers["sections.media"]!.render).toBe(renderMediaSection);
    const { container } = render(<>{sectionRenderers["sections.media"]!.render(input({ figure, callouts }, [member]))}</>);
    expect(container.querySelector(`[data-screenshot-chrome="${member.slice(7)}"]`)).toBeTruthy();
    expect(screen.getByRole("img", { name: image.alt })).toHaveAttribute("src", image.src);
    expect(container.querySelector("picture")!.parentElement!.style.aspectRatio).toBe("1440 / 900");
    expect(within(screen.getByRole("list", { name: callouts.label })).getAllByRole("listitem")).toHaveLength(2);
    expect(container.querySelector('[data-ds-leaf="sections.media"]')).toHaveAttribute("data-ds-fill", "foundry/sections.media");
  });

  it("maps the optional callouts slot and every chrome member to the existing public MediaFigure", () => {
    const contract = sections.find(row => row.id === "sections.media")!.contract;
    expect(contract.slots).toContainEqual({ name: "callouts", type: "records", required: false });
    expect(contract.members.names).toEqual(members);
    expect(mediaInputs).toEqual({ slots: ["figure", "callouts"], members });
    expect(FOUNDRY_SECTION_MAP.media!.slotMap.callouts).toBe("./blocks#MediaFigure.callouts");
    expect(FOUNDRY_SECTION_MAP.media!.propMap).toEqual(Object.fromEntries(members.map(name => [name, `./blocks#MediaFigure.chrome=${name.slice(7)}`])));
    expect(descriptor).toEqual(JSON.parse(generatedFoundrySectionFiles()["sections.media.json"]!).sections.media);
    expect(passages.find(row => row.id === "passages.media")!.contract.copy).toEqual(contract.copy);
    expect(contract.copy.fields.map(row => row.key)).toEqual(expect.arrayContaining(["figure.chromeLabel", "callouts.label", "callouts.items[].body"]));
  });

  it("renders chrome and annotation copy resolved from Writer CopyRefs at the content boundary", () => {
    const registry: CopyRegistry = { id: "specimen-copy", locale: "en", revision: "1", source: { kind: "consumer", reference: "editorial/specimen" },
      entries: [
        { id: "specimen.browser", text: "Writer workspace", context: "browser title", status: "approved" },
        { id: "specimen.highlights", text: "Writer annotations", context: "callout list name", status: "approved" },
        { id: "specimen.review", text: "Writer review queue", context: "callout body", status: "approved" },
        { id: "specimen.draft", text: "Unresolved draft", context: "callout body", status: "draft" },
      ] };
    const resolver = createCopyResolver(registry);
    const copy = (ref: CopyRef) => resolver(ref)?.text;
    const chromeLabel = copy({ id: "specimen.browser", locale: "en" })!;
    const label = copy({ id: "specimen.highlights", locale: "en" })!;
    const body = copy({ id: "specimen.review", locale: "en" })!;
    render(<>{renderMediaSection(input({ figure: { ...figure, chromeLabel }, callouts: { label, items: [{ id: "review", body }] } }, ["chrome.browser"]))}</>);
    expect(screen.getByText(chromeLabel)).toBeVisible();
    expect(within(screen.getByRole("list", { name: label })).getByRole("listitem")).toHaveTextContent(body);
    expect(copy({ id: "specimen.draft", locale: "en" })).toBeUndefined();
    expect(() => renderMediaSection(input({ figure, callouts: { label, items: [{ id: "draft" }] } }))).toThrow(/body/);
  });

  it("supports omitted annotations, intrinsic bare media and existing registered chart/mark content", () => {
    const { container } = render(<>{renderMediaSection(input())}</>);
    expect(container.querySelector('[data-screenshot-chrome="bare"]')).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    expect(container.textContent).toBe("");
    cleanup();
    render(<>{renderMediaSection(input({ figure: { media: { kind: "mark", src: "/mark.svg", title: "Writer mark" }, caption: "Writer caption" } }))}</>);
    expect(screen.getByText("Writer caption")).toBeVisible();
  });

  it.each([
    [{ figure, callouts: { items: callouts.items } }, [], /label/],
    [{ figure, callouts: { ...callouts, label: " " } }, [], /label/],
    [{ figure, callouts: { ...callouts, items: [] } }, [], /non-empty/],
    [{ figure, callouts: { ...callouts, items: [{ id: "one", body: " " }] } }, [], /body/],
    [{ figure, callouts: { ...callouts, items: [{ id: "one", body: "A" }, { id: "one", body: "B" }] } }, [], /duplicate/],
    [{ figure, callouts: { ...callouts, extra: "ignored" } }, [], /extra/],
    [{ figure: { ...figure, extra: "ignored" } }, [], /extra/],
    [{ figure: { ...figure, chromeLabel: "Writer title" } }, ["chrome.device"], /chrome.browser/],
    [{ figure: { ...figure, ratio: "invented" } }, [], /canonical image ratio/],
    [{ figure: { media: { kind: "image", resource: { ...image, width: 0 } } } }, [], /image resource/],
    [{ figure }, ["chrome.browser", "chrome.device"], /more than one chrome/],
    [{ figure }, ["chrome.unknown"], /chrome.unknown/],
    [{ figure, extra: "ignored" }, [], /extra/],
  ] satisfies readonly [Record<string, RuntimeJson>, readonly string[], RegExp][])("refuses unsupported or incomplete content %#", (values, selected, message) => {
    expect(() => renderMediaSection(input(values, selected))).toThrow(message);
  });
});
