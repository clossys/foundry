// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppFrame } from "@clossys/designer/frames";
import { PublisherPage } from "./PublisherPage.js";
import { PUBLISHER_COPY_REFS, type PublisherCopyResolver } from "./copy.js";
import { publisherValueRef } from "./value-names.js";
import { createM1ExampleDraft, createDeliveryExampleDraft } from "./__fixtures__/example-plan.js";
import { FIXTURE_BREAKPOINTS, FIXTURE_INSTANCE_LIBRARY, FIXTURE_INSTANCE_REGISTRIES } from "../instances/__fixtures__/standard-instances.js";
import { installFrameTestEnvironment } from "./__fixtures__/frame-test-environment.js";
const pseudo: PublisherCopyResolver = ref => ({ ref, text: `[[${ref.id}]]` });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount(draftPlan = createM1ExampleDraft(), resolver = pseudo) {
  installFrameTestEnvironment();
  // AppFrame docks the inspector only when the stage retains its minimum width.
  vi.stubGlobal("innerWidth", 1440);
  return render(<AppFrame copyResolver={pseudo} brand={{ markSrc: "/mark.svg" }} navigation={{ tree: [], label: "host navigation" }}
    account={{ signedOutLabel: "host account", sections: [] }} themeControl={null} rightPanel={{ label: "host inspector", handleLabel: "host resize", min: 240, max: 440, defaultValue: 320, children: null }}
    commands={{ heading: "host commands", searchLabel: "host search", closeLabel: "host close", emptyMessage: "host empty", triggerLabel: "host trigger", groups: [], shortcutEnabled: false }}>
    <PublisherPage copyResolver={resolver} draftPlan={draftPlan} activeChannel="site" instances={[]} library={FIXTURE_INSTANCE_LIBRARY} registries={FIXTURE_INSTANCE_REGISTRIES} breakpointValues={FIXTURE_BREAKPOINTS} designerHref="/designer" />
  </AppFrame>);
}
it("does not repeat a resource title as its trailing action", () => {
  const view = mount();
  for (const row of view.getAllByRole("row")) {
    const title = row.querySelector('[data-publisher-item-title]');
    expect(title).not.toBeNull();
    expect(within(row).queryByRole("button", { name: title!.textContent! })).toBeNull();
  }
});
it("renders the existing Writer page heading and description", () => {
  const view = mount();
  const heading = within(view.container.querySelector("[data-publisher-stage]")! as HTMLElement).getByRole("heading", { level: 1, name: `[[${PUBLISHER_COPY_REFS.title.id}]]` });
  expect(heading.querySelector('[data-copy-ref]')?.getAttribute("data-copy-ref")).toBe(PUBLISHER_COPY_REFS.title.id);
  expect(view.container.querySelector('[data-copy-ref="st.2tw3ay17tc"]')?.textContent).toBe("[[st.2tw3ay17tc]]");
});
it("hides channel navigation for one channel and retains it for multiple channels", () => {
  const view = mount();
  expect(view.queryByRole("navigation", { name: `[[${PUBLISHER_COPY_REFS.channels.id}]]` })).toBeNull();
  view.unmount();
  const multiple = mount(createDeliveryExampleDraft());
  expect(multiple.getByRole("navigation", { name: `[[${PUBLISHER_COPY_REFS.channels.id}]]` })).toBeTruthy();
});
it("separates row status from the actionable next stage and opens its inspector", () => {
  const view = mount();
  const row = view.getAllByRole("row")[0]!;
  const status = within(row).getByRole("status");
  expect(status.textContent).toBe(`[[${publisherValueRef("admin.enum", "proposed")!.id}]]`);
  const action = within(row).getByRole("button", { name: `[[${publisherValueRef("publisher.stage", "Configure")!.id}]]` });
  expect(status.contains(action)).toBe(false);
  fireEvent.click(action);
  expect(view.container.querySelector('[data-publisher-display-needs]')).not.toBeNull();
});
it("stamps each resolved stage text node with the exact CopyRef identity", () => {
  const view = mount();
  const stage = view.container.querySelector('[data-publisher-stage]')!;
  const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
  let count = 0;
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent?.trim() ?? "";
    const match = /^\[\[(st\.[^\]]+)\]\]$/.exec(text);
    if (!match) continue;
    count++;
    expect(walker.currentNode.parentElement?.getAttribute("data-copy-ref")).toBe(match[1]);
  }
  expect(count).toBeGreaterThan(15);
});
it("fails closed when the existing description CopyRef cannot resolve", () => {
  expect(() => mount(createM1ExampleDraft(), ref => ref.id === "st.2tw3ay17tc" ? undefined : pseudo(ref))).toThrow(/unresolved: st.2tw3ay17tc/);
});
