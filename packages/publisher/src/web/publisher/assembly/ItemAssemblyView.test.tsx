// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppFrame } from "@clossys/designer/frames";
import { PublisherPage } from "../PublisherPage.js";
import { installFrameTestEnvironment } from "../__fixtures__/frame-test-environment.js";
import { FIXTURE_BREAKPOINTS } from "../../instances/__fixtures__/standard-instances.js";
import { STANDARD_PACK_INSTANCES, STANDARD_PACK_REGISTRIES, createStandardPackLibrary } from "../__fixtures__/standard-website.js";
import { fixtureCompiler } from "../__fixtures__/compiler.js";
import { ItemAssemblyView } from "./ItemAssemblyView.js";
import { derivePackPipeline } from "../pipeline.js";
import { productionSettingsFromBinding } from "../production-settings.js";
import { instanceFixture } from "../../../core/__fixtures__/instance-binding/fixtures.js";
import { acceptedExampleStore } from "../__fixtures__/example-plan.js";
import type { PublisherPlanStore } from "../../../planning/change-set.js";

let planStore: PublisherPlanStore;
beforeEach(async () => { installFrameTestEnvironment(); planStore = await acceptedExampleStore(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const props = { instances: STANDARD_PACK_INSTANCES, library: createStandardPackLibrary({}), registries: STANDARD_PACK_REGISTRIES, compiler: fixtureCompiler, breakpointValues: FIXTURE_BREAKPOINTS, designerHref: "/designer" };
function Host({ ownerHref, binding }: { ownerHref?: (node: { owner: string }) => string; binding?: typeof STANDARD_PACK_INSTANCES[number] }) {
  return <AppFrame brand={{ markSrc: "/mark.svg", wordmark: "Workspace", label: "Workspace" }}
    navigation={{ tree: [{ id: "home", label: "Home", href: "/home" }], activeId: "home", label: "Workspace navigation" }}
    account={{ signedOutLabel: "Signed out", sections: [] }}
    commands={{ heading: "Commands", searchLabel: "Search", closeLabel: "Close", emptyMessage: "No commands", triggerLabel: "Find a command", groups: [], shortcutEnabled: false }}
    header={{ title: "Fallback" }}><PublisherPage {...props} instances={binding ? props.instances.map(source => source.instanceId === binding.instanceId ? binding : source) : props.instances} planStore={planStore} assemblyOwnerHref={ownerHref} formatsPanel={<h2>Host Formats configuration</h2>} /></AppFrame>;
}

it("keeps failed Checks visible when a blocking question takes overall state priority", () => {
  const f = instanceFixture();
  const item = derivePackPipeline([f.binding], f.library, f.registries, undefined,
    { [f.binding.instanceId]: productionSettingsFromBinding(f.binding) },
    { [f.binding.instanceId]: [{ slot: "host.approval", question: "Which content should ship?" }] }).items[0]!;
  expect(item.state).toBe("needs input");
  expect(item.findings.map(finding => finding.code)).toEqual(expect.arrayContaining(["LK11", "LK15"]));
  render(<ItemAssemblyView item={item} registries={f.registries} designerHref="/designer" onOpenFormats={() => {}} targetPrefix="host" />);
  const checks = screen.getByRole("region", { name: "Assembly check results" });
  expect(checks).toHaveTextContent("failed");
  expect(checks).toHaveTextContent("LK11");
  expect(checks).toHaveTextContent("LK15");
  expect(checks).toHaveTextContent("LK12");
  expect(screen.getByRole("region", { name: "Assembly render result" })).toHaveTextContent("pending");
});

it("opens current item assembly, follows host owner links and reveals nested Formats", () => {
  const ownerHref = vi.fn(({ owner }: { owner: string }) => `/host/designer/${owner.toLowerCase()}`);
  render(<Host ownerHref={ownerHref} />);
  const opener = screen.getByRole("button", { name: "Open Home · to do" });
  fireEvent.click(opener);
  fireEvent.click(screen.getByRole("button", { name: "Apply configuration" }));
  expect(screen.getByRole("region", { name: "Home · item details" })).toHaveFocus();
  expect(screen.getByRole("link", { name: "Open Layouts in Designer" })).toHaveAttribute("href", "/host/designer/layouts");
  expect(ownerHref).toHaveBeenCalledWith(expect.objectContaining({ owner: "Layouts", references: ["layouts.stack", "stack.landing"], instanceId: "standard.home" }));
  expect(screen.getAllByRole("complementary", { name: "Instance inspector" })).toHaveLength(1);
  expect(screen.getByRole("region", { name: "Assembly render result" })).toHaveTextContent("Ready remains pending");
  expect(screen.getByRole("region", { name: "Assembly check results" })).toHaveTextContent("LK12");
  fireEvent.click(screen.getByRole("button", { name: "Open Formats" }));
  expect(screen.getByRole("heading", { name: "Host Formats configuration" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Close item details" }));
  const currentOpener = screen.getByRole("button", { name: /^Open Home · / });
  expect(currentOpener).toHaveAttribute("id", opener.id);
  expect(currentOpener).toHaveFocus();
  expect(screen.queryByRole("region", { name: "Item assembly" })).toBeNull();
});

it("retains failed content evidence in assembly without turning placeholder rendering into Ready", () => {
  const fixture = instanceFixture();
  const library = { ...fixture.library, resolveContent: () => undefined };
  const item = derivePackPipeline([fixture.binding], library, fixture.registries, fixtureCompiler,
    { [fixture.binding.instanceId]: productionSettingsFromBinding(fixture.binding) }).items[0]!;
  render(<ItemAssemblyView item={item} registries={fixture.registries} designerHref="/designer" onOpenFormats={() => {}} targetPrefix="host" />);
  const content = screen.getByRole("region", { name: "Content assembly lane" });
  expect(content).toHaveTextContent("failed");
  expect(content).toHaveTextContent("LK10");
  const renderResult = screen.getByRole("region", { name: "Assembly render result" });
  expect(renderResult).toHaveTextContent("pending");
  expect(within(renderResult).getByRole("link", { name: "Open placeholder render" })).toHaveAttribute("href", "#host-render");
});


it("opens supplied frame host content beside its assembly lane and leaves real owner/runtime inputs pending", () => {
  const source = STANDARD_PACK_INSTANCES[0]!;
  const reference = Object.values(STANDARD_PACK_INSTANCES[1]!.fills.lead![0]!.content)[0]!;
  const binding = { ...source, frame: { ...source.frame, content: { "skip-link": reference } } };
  render(<Host binding={binding} />);
  fireEvent.click(screen.getByRole("button", { name: "Open Home · to do" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply configuration" }));
  const lane = screen.getByRole("region", { name: "Content assembly lane" });
  expect(lane).toHaveTextContent(`${reference.kind} · ${reference.ref}`);
  expect(lane).toHaveTextContent("pending");
  expect(lane).toHaveTextContent("Frame host content required-slot, value and hash verification pending");
  expect(within(lane).queryByRole("link", { name: "Open Content in Designer" })).toBeNull();
  const inspector = screen.getByRole("complementary", { name: "Instance inspector" });
  const host = within(inspector).getByRole("group", { name: "Frame host content references" });
  expect(host).toHaveTextContent(`skip-link: ${reference.kind} · ${reference.ref} · reference resolved`);
  expect(screen.getAllByRole("complementary", { name: "Instance inspector" })).toHaveLength(1);
  expect(within(screen.getByRole("region", { name: "Ordered slot fills" })).queryByText("skip-link")).toBeNull();
  expect(screen.getByRole("region", { name: "Assembly render result" })).toHaveTextContent("Ready remains pending");
});
