// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "tailwindcss";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { AppFrame } from "@clossys/designer/frames";
import type { ReactNode } from "react";
import { PublisherPlanView } from "./PublisherPlanView.js";
import { PublisherPlanStore } from "../../planning/change-set.js";
import { PublisherPage } from "./PublisherPage.js";
import { PublisherSection } from "./PublisherSection.js";
import type { PublisherCopyResolver } from "./copy.js";
import { publisherCopyFixtureResolver } from "./__fixtures__/writer-copy.js";
import { installFrameTestEnvironment } from "./__fixtures__/frame-test-environment.js";
import { acceptedExampleStore, createAppExampleDraft } from "./__fixtures__/example-plan.js";
import { STANDARD_PACK_INSTANCES, STANDARD_PACK_REGISTRIES, createStandardPackLibrary } from "./__fixtures__/standard-website.js";
import { appBindingFixture } from "./app/__fixtures__/binding.js";
import type { PublisherPageProps } from "./PublisherPage.js";

const pseudo: PublisherCopyResolver = ref => ({ ref, text: `[[${ref.id}]]` });
const sections = new Set(JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../designer/src/catalog/slots/sections.json"), "utf8")).map((row: { id: string }) => row.id));
// The contract check reads the actual registry; blocks retain Designer's own provenance.
function unregisteredCopy(root: Element) {
  const failures: string[] = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.textContent?.trim()) continue;
    const leaf = node.parentElement?.closest("[data-ds-leaf]")?.getAttribute("data-ds-leaf");
    if (!leaf?.startsWith("sections.") || !sections.has(leaf)) failures.push(node.textContent);
  }
  return failures;
}
function rawValues(root: Element, values: readonly string[]) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), failures: string[] = [];
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent?.trim();
    if (text && /^(?:\[\[[^\]]+\]\])+$/.test(text)) continue;
    if (text && (/\b(?:M[1-4]|DE2b|LK\d+|[A-Z]{1,10}-\d+)\b|\b(?:pack|frames|layouts|sections|tokens|web|app|st|sl|stack|split|bento|sidebar-content)\.[\w.-]+/i.test(text) || values.some(value => text.includes(value)))) failures.push(text);
  }
  return failures;
}
function boldNodes(root: Element) {
  return [...root.querySelectorAll<HTMLElement>("*")].filter(node => /^(?:700|bold|bolder)$/.test(node.style.fontWeight) || node.matches("strong,b,.font-bold,.font-extrabold"));
}
let css = "";
beforeAll(async () => {
  const req = createRequire(import.meta.url), base = resolve(import.meta.dirname, "../../../../designer");
  const compiler = await compile('@import "tailwindcss"; @import "./styles/theme-keys.css";', { base,
    loadStylesheet: async (id, root) => { const path = id.startsWith("tailwindcss") ? req.resolve(id === "tailwindcss" ? "tailwindcss/index.css" : `${id}.css`) : resolve(root, id); return { path, base: resolve(path, ".."), content: readFileSync(path, "utf8") }; },
  });
  css = compiler.build(["font-display", "font-medium", "font-normal", "[&_strong]:font-medium"]);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.head.querySelectorAll("[data-stage-proof]").forEach(node => node.remove()); });
function mount(props: Partial<PublisherPageProps> = {}, resolver = pseudo, content?: ReactNode) {
  installFrameTestEnvironment();
  vi.stubGlobal("innerWidth", 1440);
  return render(<AppFrame copyResolver={pseudo} brand={{ markSrc: "/mark.svg" }} navigation={{ tree: [], label: "[[navigation]]", emptyMessage: "[[empty]]", openLabel: "[[open]]", closeLabel: "[[close]]" }}
    account={{ signedOutLabel: "[[account]]", sections: [] }} themeControl={null}
    commands={{ heading: "[[commands]]", searchLabel: "[[search]]", closeLabel: "[[close]]", emptyMessage: "[[empty]]", triggerLabel: "[[trigger]]", groups: [], shortcutEnabled: false }}
    rightPanel={{ label: "[[inspector]]", handleLabel: "[[resize]]", min: 240, max: 440, defaultValue: 320, children: null }}
    skipLabel="[[skip]]" breadcrumbLabel="[[breadcrumb]]" collapsedBreadcrumbLabel="[[earlier]]" pageInfoLabel="[[info]]" pageActionsLabel="[[actions]]">
    {content ?? <PublisherPage copyResolver={resolver} instances={STANDARD_PACK_INSTANCES} registries={STANDARD_PACK_REGISTRIES} library={createStandardPackLibrary({})} breakpointValues={{}} designerHref="/designer" {...props} />}
  </AppFrame>);
}
it("renders only registered section copy on the empty and populated stage, with no weight 700", async () => {
  const empty = mount();
  const emptyStage = empty.container.querySelector("[data-publisher-stage]")!;
  expect(unregisteredCopy(emptyStage)).toEqual([]); expect(boldNodes(emptyStage)).toEqual([]);
  empty.unmount();
  const page = mount({ planStore: await acceptedExampleStore() });
  const stage = page.container.querySelector("[data-publisher-stage]")!;
  expect(stage.querySelector('[data-ds-leaf="sections.stats"]')).not.toBeNull();
  expect(stage.querySelector('[data-ds-leaf="sections.resource-list"]')).not.toBeNull();
  expect(unregisteredCopy(stage)).toEqual([]); expect(boldNodes(stage)).toEqual([]);
});
it("opens selected item details only in the frame inspector, then restores focus on close", async () => {
  const page = mount({ planStore: await acceptedExampleStore() }, publisherCopyFixtureResolver);
  const stage = page.container.querySelector("[data-publisher-stage]")!;
  const open = within(stage as HTMLElement).getAllByRole("button", { name: "Home" })[0]!;
  open.focus(); fireEvent.click(open);
  const detail = screen.getByRole("region", { name: "Home" });
  expect(detail.closest('[data-application-frame-panel="pane"]')).not.toBeNull();
  expect(stage.contains(detail)).toBe(false);
  expect(detail).toHaveFocus();
  expect(unregisteredCopy(detail)).toEqual([]);
  expect(detail.querySelector('[data-ds-leaf="sections.record-detail"]')).not.toBeNull();
  expect(detail.querySelector('[data-ds-leaf="sections.data-table"]')).not.toBeNull();
  fireEvent.click(within(detail).getByRole("button", { name: "Close item details" }));
  expect(screen.queryByRole("region", { name: "Home" })).toBeNull();
  expect(open).toHaveFocus();
});
it("rejects an unregistered wrapper and a raw item identity (mutation controls)", async () => {
  const page = mount({ planStore: await acceptedExampleStore() });
  const stage = page.container.querySelector("[data-publisher-stage]")!;
  expect(unregisteredCopy(stage)).toEqual([]);
  const wrapper = document.createElement("section"); wrapper.dataset.dsLeaf = "sections.unregistered"; wrapper.textContent = "[[mutated]]"; stage.append(wrapper);
  expect(unregisteredCopy(stage)).toEqual(["[[mutated]]"]);
  wrapper.remove();
  const first = stage.querySelector('[data-ds-leaf="sections.resource-list"]')!;
  const mutant = document.createElement("span"); mutant.textContent = "app.raw-secret-item"; first.append(mutant);
  expect(rawValues(stage, ["app.raw-secret-item"])).toContain("app.raw-secret-item");
});
it.each(["/agents/designer", "/agents/writer", "/agents/publisher"])("keeps %s planning identities and codes out of stage and inspector text", path => {
  const fixture = appBindingFixture();
  const original = fixture.inventory.routes.find(route => route.kind !== "detail-tab")!;
  const inventory = { ...fixture.inventory, routes: [{ ...original, id: "app.raw-secret-item", path }] };
  const draft = createAppExampleDraft(inventory);
  const page = mount({ instances: [], appInventory: inventory, draftPlan: draft, activeChannel: "app" }, publisherCopyFixtureResolver);
  const stage = page.container.querySelector("[data-publisher-stage]")!;
  expect(rawValues(stage, ["app.raw-secret-item", "example.app-operations"])).toEqual([]);
  expect(stage.textContent).toContain(path.split("/").at(-1)!.replace(/^./, letter => letter.toUpperCase()));
  const button = within(stage as HTMLElement).getAllByRole("button")[0]!; fireEvent.click(button);
  const inspector = page.container.querySelector('[data-application-frame-panel="pane"]')!;
  expect(rawValues(inspector, ["app.raw-secret-item", "example.app-operations"])).toEqual([]);
});
it("keeps table toolbar headings inside the registered table root", () => {
  const page = render(<PublisherSection registries={STANDARD_PACK_REGISTRIES} onCommand={() => {}} data={{ id: "table", section: "sections.data-table", label: "[[table]]", columns: [{ id: "item", label: "[[item]]" }], rows: [{ id: "row", cells: { item: { kind: "text", text: "[[value]]" } } }] }} />);
  expect(unregisteredCopy(page.container)).toEqual([]);
});

it("has zero weight-700 nodes under the freshly compiled shipped typography, including an inline-weight mutation control", async () => {
  const page = mount({ planStore: await acceptedExampleStore() });
  const stage = page.container.querySelector("[data-publisher-stage]")!;
  // jsdom cannot parse Tailwind's nested container/motion rules. Read the actual
  // freshly compiled font rules, with their shipped fallback weights, rather than
  // substituting a test font policy. Chromium measurement is a recorded timeout Need.
  const display = css.match(/\.font-display\s*\{([^}]+)\}/)?.[1];
  expect(display).toBeDefined();
  const displayWeight = display!.match(/font-weight:\s*var\(--font-display-weight,\s*(\d+)\)/)?.[1];
  expect(displayWeight).toBe("400");
  expect(css).toMatch(/--font-weight-medium:\s*500/);
  expect(css).toMatch(/--font-weight-normal:\s*400/);
  const sheet = document.createElement("style"); sheet.dataset.stageProof = "";
  const strongStart = css.indexOf("\\:font-medium strong");
  expect(strongStart).toBeGreaterThan(-1);
  const strongRule = css.slice(strongStart, css.indexOf("}", strongStart) + 1);
  expect(strongRule).toMatch(/font-weight:\s*var\(--font-weight-medium\)/);
  sheet.textContent = `h1,h2,h3,h4,h5,h6{font-weight:inherit}.font-display{font-weight:${displayWeight}}.font-medium{font-weight:500}.font-normal{font-weight:400}[class~="[&_strong]:font-medium"] strong{font-weight:500}`;
  document.head.append(sheet);
  const weighted = () => [...stage.querySelectorAll<HTMLElement>("*")].filter(node => getComputedStyle(node).fontWeight === "700");
  expect(weighted()).toEqual([]);
  fireEvent.click(within(stage as HTMLElement).getAllByRole("button")[0]!);
  const inspector = page.container.querySelector('[data-application-frame-panel="pane"]')!;
  expect(inspector.querySelector("strong")).not.toBeNull();
  expect([...inspector.querySelectorAll("*")].filter(node => /^(700|bold|bolder)$/.test(getComputedStyle(node).fontWeight))).toEqual([]);
  const mutation = document.createElement("span"); mutation.style.fontWeight = "700"; mutation.textContent = "[[mutation]]"; stage.append(mutation);
  expect(weighted()).toEqual([mutation]);
});

it("detects an item.id rendered by a real page action (projection mutation)", async () => {
  const store = await acceptedExampleStore(), item = store.current!.milestones[0]!.packs[0]!.items[0]!;
  const page = mount({ planStore: store, messages: { openItemLabel: () => item.id } });
  expect(rawValues(page.container.querySelector("[data-publisher-stage]")!, [item.id])).toContain(item.id);
});
it("keeps source identities on Configure commands and leaves whole-page preview checks pending", async () => {
  const store = await acceptedExampleStore(), onChange = vi.fn();
  const page = mount({ planStore: store, onProductionSettingsChange: onChange }, publisherCopyFixtureResolver);
  fireEvent.click(within(page.container.querySelector("[data-publisher-stage]")! as HTMLElement).getAllByRole("button", { name: "Home" })[0]!);
  const inspector = page.container.querySelector('[data-application-frame-panel="pane"]')!;
  fireEvent.click(within(inspector as HTMLElement).getByRole("button", { name: "Apply configuration" }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ instances: expect.objectContaining({ "standard.home": expect.objectContaining({ format: "web.page.responsive" }) }) }));
  expect(store.versions).toHaveLength(1);
  expect(rawValues(inspector, ["standard.home", "example.first-impression"])).toEqual([]);
  const preview = inspector.querySelector('[data-publisher-check="LK12"]')!.closest('[role="row"]')!;
  expect(preview.textContent).not.toContain("LK12");
  expect(preview.textContent).toMatch(/Waiting|pending/);
});

it.each(["/agents/designer", "/agents/writer", "/agents/publisher"])("renders %s plan projections without identity codes or unregistered stage text", path => {
  const fixture = appBindingFixture(), original = fixture.inventory.routes.find(route => route.kind !== "detail-tab")!;
  const inventory = { ...fixture.inventory, routes: [{ ...original, id: "app.raw-secret-item", path }] }, draft = createAppExampleDraft(inventory);
  const store = new PublisherPlanStore(STANDARD_PACK_REGISTRIES);
  const page = mount({}, publisherCopyFixtureResolver, <PublisherPlanView copyResolver={publisherCopyFixtureResolver} store={store} draft={draft} onApply={() => true} routePathFor={() => path} />);
  const stage = page.container.querySelector("[data-publisher-plan-stage]")!;
  expect(unregisteredCopy(stage)).toEqual([]); expect(boldNodes(stage)).toEqual([]);
  expect(rawValues(stage, ["app.raw-secret-item", "example.app-operations"])).toEqual([]);
  fireEvent.click(within(stage as HTMLElement).getAllByRole("button", { name: "Suggested setup" })[0]!);
  const inspector = page.container.querySelector('[data-application-frame-panel="pane"]')!;
  expect(inspector.textContent).toContain(path.split("/").at(-1)!.replace(/^./, letter => letter.toUpperCase()));
  expect(rawValues(inspector, ["app.raw-secret-item", "example.app-operations"])).toEqual([]);
});
