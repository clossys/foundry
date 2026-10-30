// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { instanceFixture, key } from "../../core/__fixtures__/instance-binding/fixtures.js";
import { FIXTURE_BREAKPOINTS } from "../instances/__fixtures__/standard-instances.js";
import { PageBar } from "@clossys/designer/blocks";
import { FrameSlotProvider } from "@clossys/designer/shell";
import { installFrameTestEnvironment } from "./__fixtures__/frame-test-environment.js";
import { PublisherPage } from "./PublisherPage.js";
import { publisherCopyFixtureResolver } from "./__fixtures__/writer-copy.js";
import { acceptedExampleStore } from "./__fixtures__/example-plan.js";
import { AppPack } from "./app/AppPack.js";
import { appBindingFixture } from "./app/__fixtures__/binding.js";
import { deriveAppPipeline } from "./app/pipeline.js";
import { ItemAssemblyView } from "./assembly/ItemAssemblyView.js";
import * as pipeline from "./pipeline.js";
import { productionSettingsFromBinding } from "./production-settings.js";

let errors: ReturnType<typeof vi.spyOn>;
const keyWarnings = () => errors.mock.calls.filter(call => /same key|unique ["']?key/i.test(call.map(String).join(" ")));
beforeEach(() => { installFrameTestEnvironment(); errors = vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => {
  cleanup();
  const warnings = keyWarnings();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(warnings).toEqual([]);
});

it("keeps repeated LK7 reasons in App details without duplicate keys", () => {
  const f = appBindingFixture();
  f.binding.fills.body!.push(structuredClone(f.binding.fills.body![0]!));
  f.fills.delete(key("sections.content", "default"));
  const item = deriveAppPipeline({ ...f, settings: f.settings }).items.find(item => item.route.id === "sample.record")!;
  const reasons = item.stages.flatMap(stage => stage.reasons.map(reason => `${stage.name}: ${reason}`));
  const repeated = reasons.find((reason, index) => reason.includes("LK7") && reasons.indexOf(reason) !== index)!;
  expect(repeated).toBeDefined();
  // The original content-based keys produce a warning for these actual reasons.
  const control = render(<ul>{item.stages.flatMap(stage => stage.reasons.map(reason => <li key={`${stage.name}-${reason}`}>{reason}</li>))}</ul>);
  expect(keyWarnings().length).toBeGreaterThan(0);
  control.unmount();
  errors.mockClear();
  render(<AppPack {...f} productionSettings={f.settings} />);
  fireEvent.click(screen.getByRole("button", { name: /^Open Sample record/ }));
  const details = screen.getByRole("heading", { name: "Sample record · route details" }).closest("section")!;
  const reasonList = within(details).getAllByText(repeated).map(node => node.closest("ul"));
  expect(reasonList).toHaveLength(2);
  expect(within(reasonList[0]!).getAllByRole("listitem").map(node => node.textContent)).toEqual(reasons);
});

function repeatedPendingFixture() {
  const f = instanceFixture();
  f.binding.instanceId = "standard.home";
  f.binding.packIds = ["pack.standard-website"];
  const settings = { [f.binding.instanceId]: productionSettingsFromBinding(f.binding) };
  const result = pipeline.derivePackPipeline([f.binding], f.library, f.registries, undefined, settings);
  const item = { ...result.items[0]!, stages: result.items[0]!.stages.map(stage => stage.name === "Checks"
    ? { ...stage, pending: ["Repeated proof", "Other proof", "Repeated proof"] } : stage) };
  return { ...f, settings, result: { ...result, items: [item] }, item };
}

it("preserves repeated pending evidence in the channel item detail", async () => {
  const f = repeatedPendingFixture();
  vi.spyOn(pipeline, "derivePackPipeline").mockReturnValue(f.result);
  render(<FrameSlotProvider><PageBar root={{ label: "Workspace" }} labels={{ breadcrumb: "Trail", collapsedBreadcrumb: "Trail", pageInfo: "Info", pageActions: "Actions" }} /><PublisherPage copyResolver={publisherCopyFixtureResolver} instances={[f.binding]} library={f.library} registries={f.registries}
    productionSettings={{ instances: f.settings }} planStore={await acceptedExampleStore(f.registries)}
    breakpointValues={FIXTURE_BREAKPOINTS} designerHref="/designer" /></FrameSlotProvider>);
  fireEvent.click(screen.getByRole("button", { name: /^Open Home/ }));
  const rows = screen.getByRole("region", { name: "Home · item details" });
  const entries = within(rows).getAllByText("Checks: Repeated proof");
  expect(entries).toHaveLength(2);
  expect(Array.from(entries[0]!.closest("ul")!.children).map(node => node.textContent).filter(text => text?.startsWith("Checks:")))
    .toEqual(["Checks: Repeated proof", "Checks: Other proof", "Checks: Repeated proof"]);
});

it("preserves repeated pending evidence beside assembly findings", () => {
  const f = repeatedPendingFixture();
  render(<ItemAssemblyView item={f.item} registries={f.registries} designerHref="/designer" onOpenFormats={() => {}} targetPrefix="host" />);
  const checks = screen.getByRole("region", { name: "Assembly check results" });
  expect(within(checks).getAllByText("Repeated proof")).toHaveLength(2);
  expect(within(checks).getAllByRole("listitem").map(node => node.textContent).slice(-3))
    .toEqual(["Repeated proof", "Other proof", "Repeated proof"]);
});
