// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { AppFrame } from "@clossys/designer/frames";
import { installFrameTestEnvironment } from "./__fixtures__/frame-test-environment.js";
import { PublisherPage } from "./PublisherPage.js";
import type { PublisherPageProps } from "./PublisherPage.js";
import { publisherChannelFromHref } from "./publisher-channels.js";
import type { PublisherChannelId } from "./publisher-channels.js";
import { FIXTURE_BREAKPOINTS, FIXTURE_INSTANCE_LIBRARY, FIXTURE_INSTANCE_REGISTRIES } from "../instances/__fixtures__/standard-instances.js";
import { acceptedExampleStore, createAppExampleDraft, createDeliveryExampleDraft, createM1ExampleDraft } from "./__fixtures__/example-plan.js";
import { PublisherPlanStore } from "../../planning/change-set.js";
import { STANDARD_PACK_INSTANCES, createStandardPackLibrary, STANDARD_PACK_REGISTRIES } from "./__fixtures__/standard-website.js";
import { appBindingFixture } from "./app/__fixtures__/binding.js";
import { fixtureCompiler } from "./__fixtures__/compiler.js";

let planStore: PublisherPlanStore;
beforeEach(async () => { installFrameTestEnvironment(); planStore = await acceptedExampleStore(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const props = { instances: STANDARD_PACK_INSTANCES, library: FIXTURE_INSTANCE_LIBRARY, registries: FIXTURE_INSTANCE_REGISTRIES, breakpointValues: FIXTURE_BREAKPOINTS, designerHref: "/designer" };
function Host({ delegate, ...inputs }: PublisherPageProps & { delegate?: (href: string) => void }) {
  const [channel, setChannel] = useState<PublisherChannelId>("site");
  return <AppFrame brand={{ markSrc: "/mark.svg", wordmark: "Workspace", label: "Workspace" }}
    navigation={{ tree: [{ id: "home", label: "Home", href: "/home" }], activeId: "home", label: "Workspace navigation" }}
    account={{ signedOutLabel: "Signed out", sections: [] }}
    commands={{ heading: "Commands", searchLabel: "Search", closeLabel: "Close", emptyMessage: "No commands", triggerLabel: "Find a command", groups: [], shortcutEnabled: false }}
    header={{ title: "Fallback" }} onNavigate={href => {
    const next = publisherChannelFromHref(href);
    if (next) setChannel(next); else delegate?.(href);
  }}><PublisherPage {...inputs} activeChannel={channel} /></AppFrame>;
}

// Row 668 (REAL, hand-styled raw li): each milestone step is a Foundry Card inside a bare list item.
it("renders every channel milestone as a Foundry Card inside an unstyled list item", () => {
  render(<Host {...props} planStore={planStore} />);
  const items = within(screen.getByRole("list", { name: "Site milestones" })).getAllByRole("listitem");
  expect(items).toHaveLength(4);
  for (const item of items) {
    expect(item.getAttribute("class") ?? "").toBe("");
    expect(item.firstElementChild).toHaveAttribute("data-variant", "outline");
  }
  expect(items.filter(item => item.hasAttribute("aria-current"))).toHaveLength(1);
});
it("leases one Frame header and shows channel milestones instead of Plan, Formats or a body header", () => {
  render(<Host {...props} planStore={planStore} />);
  expect(screen.getAllByRole("heading", { level: 1 }).map(heading => heading.textContent)).toEqual(["Publisher"]);
  const nav = screen.getByRole("navigation", { name: "Publisher delivery channels" });
  expect(within(nav).getAllByRole("link").map(link => link.textContent)).toEqual(["Site"]);
  expect(within(nav).getByRole("link", { name: "Site" })).toHaveAttribute("aria-current", "page");
  const body = screen.getByRole("region", { name: "Publisher workspace" });
  expect(body.querySelector("header,h1,nav")).toBeNull();
  expect(within(body).queryByRole("tab")).toBeNull();
  expect(within(body).getByRole("list", { name: "Site milestones" }).children).toHaveLength(4);
  const items = within(body).getByRole("grid", { name: "M1 Site lane process" });
  expect(within(items).getAllByRole("button", { name: /Open .* · to do/ })).toHaveLength(8);
  expect(within(items).getAllByText("Output format: web.page.responsive")).toHaveLength(8);
});

it("retains controlled Configure, exact host bindings and downstream pending evidence", () => {
  const onChange = vi.fn();
  const inputs = { ...props, library: createStandardPackLibrary({}), registries: STANDARD_PACK_REGISTRIES, compiler: fixtureCompiler };
  const { rerender } = render(<Host {...inputs} planStore={planStore} productionSettings={{}} onProductionSettingsChange={onChange} checkMessages={{ title: "Host check evidence" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Open Home · to do" }));
  expect(screen.getByRole("region", { name: "Home · item details" })).toHaveFocus();
  expect(screen.queryByRole("region", { name: "Host check evidence" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Apply configuration" }));
  const next = onChange.mock.calls[0]![0];
  expect(screen.queryByRole("region", { name: "Host check evidence" })).toBeNull();
  rerender(<Host {...inputs} planStore={planStore} productionSettings={next} onProductionSettingsChange={onChange} checkMessages={{ title: "Host check evidence" }} />);
  const evidence = screen.getByRole("region", { name: "Host check evidence" });
  expect(within(within(evidence).getByRole("row", { name: "LK7" })).getByRole("gridcell", { name: "passed" })).toBeVisible();
  expect(within(within(evidence).getByRole("row", { name: "LK12" })).getByRole("gridcell", { name: "pending" })).toBeVisible();
  expect(props.instances[0]!.instanceId).toBe("standard.home");
  fireEvent.click(screen.getByRole("button", { name: "Close item details" }));
  expect(screen.queryByRole("region", { name: "Home · item details" })).toBeNull();
  expect(screen.getByRole("button", { name: /Open Home/ })).toHaveFocus();
});

it("resets Configure and keeps the shared inspector source findings intact", () => {
  render(<Host {...props} planStore={planStore} />);
  fireEvent.click(screen.getByRole("button", { name: "Open About · to do" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply configuration" }));
  expect(screen.getByRole("region", { name: "Source binding findings" })).toHaveTextContent("LK2");
  expect(screen.getByRole("complementary", { name: "Instance inspector" })).toHaveTextContent("standard.about");
  fireEvent.click(screen.getByRole("button", { name: "Reset configuration" }));
  expect(screen.getByRole("button", { name: "Open About · to do" })).toBeVisible();
  expect(screen.queryByRole("complementary", { name: "Instance inspector" })).toBeNull();
});

it("navigates through the real Frame callback to nested format Configure and Evidence", async () => {
  render(<Host {...props} draftPlan={createDeliveryExampleDraft()} />);
  const nav = screen.getByRole("navigation", { name: "Publisher delivery channels" });
  expect(within(nav).getAllByRole("link").map(link => link.textContent)).toEqual(["Messages", "Documents"]);
  fireEvent.click(within(nav).getByRole("link", { name: "Documents" }));
  await waitFor(() => expect(screen.getByRole("link", { name: "Documents" })).toHaveAttribute("aria-current", "page"));
  expect(screen.getByRole("list", { name: "Documents milestones" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Open One-pager PDF · proposed" }));
  expect(screen.getByRole("heading", { name: "Configure", exact: true })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Evidence", exact: true })).toBeVisible();
  expect(screen.getByLabelText("Output format")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Inspect output format" }));
  expect(screen.queryByRole("tab", { name: "Formats" })).toBeNull();
  expect(screen.getByRole("region", { name: "One-pager PDF · item details" })).toHaveTextContent("No production clearance");
});

it("delegates unknown header hrefs and does not consume modified navigation clicks", async () => {
  const delegate = vi.fn();
  render(<Host {...props} planStore={planStore} channelHref={() => "#other"} delegate={delegate} />);
  const link = screen.getByRole("link", { name: "Site" });
  fireEvent.click(link, { ctrlKey: true });
  expect(delegate).not.toHaveBeenCalled();
  fireEvent.click(link);
  await waitFor(() => expect(delegate).toHaveBeenCalledWith("#other"));
});

it("keeps alignment in the actual header action and does not enroll before host acceptance", async () => {
  const store = new PublisherPlanStore(STANDARD_PACK_REGISTRIES);
  const onApply = vi.fn(() => true);
  render(<Host {...props} registries={STANDARD_PACK_REGISTRIES} planStore={store} draftPlan={createM1ExampleDraft()} onApplyPlan={onApply} />);
  expect(screen.getByRole("button", { name: "Open Home · proposed" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Align plan" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Open Home · to do" })).toBeVisible());
  expect(onApply).toHaveBeenCalledTimes(1);
  expect(store.current?.milestones[0]!.packs[0]!.items[0]!.id).toBe("standard.home");
});

it("reuses the measured Frame mobile menu and compact action callback", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function () { return (this as HTMLElement).classList.contains("frame-header-grid") ? 320 : 0; });
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function () { return (this as HTMLElement).tagName === "NAV" ? 600 : 100; });
  render(<Host {...props} draftPlan={createDeliveryExampleDraft()} />);
  const trigger = await screen.findByRole("button", { name: /Publisher \/ Messages/ });
  expect(screen.queryByRole("navigation", { name: "Publisher delivery channels" })).toBeNull();
  expect(screen.getByRole("button", { name: "Align plan" })).toHaveTextContent("Align");
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("menuitem", { name: "Documents" }));
  await waitFor(() => expect(screen.getByRole("button", { name: /Publisher \/ Documents/ })).toBeVisible());
  expect(screen.getByRole("list", { name: "Documents milestones" })).toBeVisible();
});

it("classifies an existing host route as Admin without inventing a qualified Admin frame", async () => {
  const fixture = appBindingFixture();
  const store = new PublisherPlanStore(fixture.registries);
  await store.apply(store.propose(createAppExampleDraft(fixture.inventory)), () => true);
  render(<Host {...props} instances={[]} library={fixture.library} registries={fixture.registries}
    appInventory={fixture.inventory} appPageBindings={fixture.pageBindings} appSubrowBindings={fixture.subrowBindings}
    routeChannels={{ "sample.record": "admin", "sample.dashboard": "admin" }} planStore={store} />);
  const nav = screen.getByRole("navigation", { name: "Publisher delivery channels" });
  expect(within(nav).getAllByRole("link").map(link => link.textContent)).toEqual(["Admin"]);
  fireEvent.click(screen.getByRole("button", { name: "Open Sample record · needs input" }));
  expect(screen.getByRole("region", { name: "Sample record · item details" })).toHaveTextContent("Exact registered route composition is unavailable");
  expect(fixture.binding.frame.leaf).toBe("frames.app-shell");
  expect(store.current!.milestones[0]!.packs[0]!.items[0]!.appRouteId).toBe("sample.record");
});

// This finite test projection exercises the display bridge only. Node adoption is separate.
it("joins the plain registry into Admin and keeps real host acceptance ahead of production", async () => {
  const { syntheticRoute, syntheticPlan, SYNTHETIC_ROUTE_REGISTRIES } = await import("../../core/__fixtures__/registered-route.js");
  const route = syntheticRoute(), draft = syntheticPlan([route]);
  const store = new PublisherPlanStore(SYNTHETIC_ROUTE_REGISTRIES);
  const projection = JSON.parse(JSON.stringify({ kind: "publisher.route-projection", version: 1, authentication: "unverified", consumer: "example", routes: [{ kind: "static-route-view", registration: route }] }));
  const apply = vi.fn(() => false);
  const inputs = { ...props, instances: [], registries: SYNTHETIC_ROUTE_REGISTRIES, planStore: store, draftPlan: draft, registeredRouteProjection: projection, routeChannels: { [route.routeId]: "app" as const }, onApplyPlan: apply };
  render(<Host {...inputs} />);
  expect(screen.getByRole("link", { name: "Admin" })).toBeVisible();
  expect(screen.queryByRole("link", { name: "App" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open Tools · proposed" }));
  expect(screen.getByRole("list", { name: "Registered route evidence" })).toHaveTextContent("Exact plan alignment pending");
  fireEvent.click(screen.getByRole("button", { name: "Align plan" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Host refused plan alignment"));
  expect(store.current).toBeUndefined();
  apply.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Align plan" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Open Tools · needs input" })).toBeVisible());
  expect(apply).toHaveBeenCalledTimes(2);
  expect(store.current!.milestones[0]!.packs[0]!.items[0]!.id).toBe(route.planItemId);
  expect(screen.getByRole("list", { name: "Registered route evidence" })).not.toHaveTextContent("Exact plan alignment pending");
  expect(screen.getByRole("list", { name: "Registered route evidence" })).toHaveTextContent("Real Frame/provider and whole-instance runtime evidence pending");
  expect(screen.getByRole("region", { name: "Tools · item details" })).toHaveTextContent("No production clearance");
});

it("refuses malformed plain route data instead of reverting to host audience inference", () => {
  render(<Host {...props} draftPlan={createAppExampleDraft(appBindingFixture().inventory)} routeChannels={{ "sample.record": "admin" }} registeredRouteProjection={{ authentication: "verified" } as never} />);
  expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Open Sample record/ })).toBeNull();
  expect(screen.getByRole("list", { name: "Registered route findings" })).toHaveTextContent("Registered route display projection is invalid");
});

it("shows lane rollups and Configure placement before exposing the existing stage evidence", () => {
  render(<Host {...props} planStore={planStore} />);
  const process = screen.getByRole("grid", { name: "M1 Site lane process" });
  const landing = within(process).getByRole("row", { name: /Expand Landing/ });
  expect(within(landing).getAllByRole("gridcell")[0]).toHaveTextContent("Home");
  expect(within(landing).getByRole("button", { name: /Expand Landing · 1 items · 1 not ready/ })).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(within(landing).getByRole("button", { name: /Expand Landing/ }));
  const items = screen.getByRole("grid", { name: "M1 Site Landing items" });
  const home = within(items).getByRole("row", { name: /Home standard.home/ });
  expect(home).toHaveTextContent("to do");
  expect(home).toHaveTextContent("waiting");
  expect(within(items).queryByRole("columnheader", { name: "States" })).toBeNull();
  fireEvent.click(within(home).getByRole("button", { name: "Inspect Home" }));
  expect(screen.getByRole("region", { name: "Home · item details" })).toHaveFocus();
});

it("browses nested output formats without changing controlled production choices", () => {
  const onChange = vi.fn();
  render(<Host {...props} planStore={planStore} productionSettings={{}} onProductionSettingsChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Open Home · to do" }));
  fireEvent.click(screen.getByRole("button", { name: "Inspect output format" }));
  const formats = screen.getByRole("region", { name: "Home · item details" });
  const image = within(within(formats).getByRole("navigation", { name: "Formats by medium and family" })).getByRole("row", { name: "Open Graph image", exact: true });
  fireEvent.click(image);
  expect(within(formats).getByRole("heading", { name: "Open Graph image", exact: true })).toBeVisible();
  expect(within(formats).getByText("Concept configuration only. No renderer is available; instances cannot use this format.")).toBeVisible();
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Inspect output format" }));
  fireEvent.click(screen.getByRole("button", { name: "Close item details" }));
  fireEvent.click(screen.getByRole("button", { name: "Open About · to do" }));
  fireEvent.click(screen.getByRole("button", { name: "Inspect output format" }));
  expect(within(screen.getByRole("region", { name: "About · item details" })).getByRole("heading", { name: "Responsive web page", exact: true })).toBeVisible();
  expect(onChange).not.toHaveBeenCalled();
});

it("opens actual App subroutes with parent ownership and scoped States evidence", async () => {
  const fixture = appBindingFixture(), store = new PublisherPlanStore(fixture.registries);
  await store.apply(store.propose(createAppExampleDraft(fixture.inventory)), () => true);
  render(<Host {...props} instances={[]} library={fixture.library} registries={fixture.registries} appInventory={fixture.inventory}
    appPageBindings={fixture.pageBindings} appSubrowBindings={fixture.subrowBindings} productionSettings={{ appPages: fixture.settings }} planStore={store} />);
  fireEvent.click(screen.getByRole("button", { name: /Expand Record · 1 items/ }));
  fireEvent.click(screen.getByRole("button", { name: "Expand Sample record routes" }));
  const grid = screen.getByRole("grid", { name: "M1 App Record items" });
  const nested = within(grid).getByRole("row", { name: /Details app.sample.record\/route\/sample.child/ });
  expect(nested).toHaveTextContent("Parent page owns Frame");
  expect(nested).toHaveTextContent("Parent page owns Layout");
  expect(nested).toHaveTextContent("Parent subrow: app.sample.record/route/sample.tab");
  expect(nested).toHaveTextContent("/#/samples/:sampleId?tab=overview&panel=details");
  expect(nested).toHaveTextContent("State declaration has a different scope; implementation proof pending");
  fireEvent.click(within(nested).getByRole("button", { name: "Inspect Details" }));
  const detail = screen.getByRole("region", { name: "Details · item details" });
  expect(detail).toHaveFocus();
  expect(within(detail).getByRole("list", { name: "App publish evidence" })).toHaveTextContent("States: pending");
  fireEvent.click(within(detail).getByRole("button", { name: "Close item details" }));
  expect(within(nested).getByRole("button", { name: "Inspect Details" })).toHaveFocus();
});


it("returns from a browsed concept to the bound format and focuses the swimlane target", async () => {
  const onChange = vi.fn();
  render(<Host {...props} planStore={planStore} onProductionSettingsChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Open Home · to do" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply configuration" }));
  expect(onChange).toHaveBeenCalledTimes(1);
  const configured = onChange.mock.calls[0]![0];
  expect(configured.instances["standard.home"].format).toBe("web.page.responsive");
  fireEvent.click(screen.getByRole("button", { name: "Inspect output format" }));
  const target = screen.getByRole("region", { name: "Home · output format" });
  const tree = within(target).getByRole("treegrid", { name: "Formats by medium and family" });
  const deck = within(tree).getByRole("row", { name: "16:9 deck", exact: true });
  fireEvent.click(deck);
  expect(within(target).getByRole("heading", { name: "16:9 deck", exact: true })).toBeVisible();
  expect(target).toHaveTextContent("No renderer is available");
  expect(within(target).queryByText("Ready", { exact: true })).toBeNull();
  const openFormats = within(screen.getByRole("region", { name: "Format assembly lane" })).getByRole("button", { name: "Open Formats" });
  expect(openFormats).toHaveAttribute("aria-controls", target.id);
  openFormats.focus();
  fireEvent.click(openFormats);
  await waitFor(() => expect(target).toHaveFocus());
  expect(within(target).getByRole("heading", { name: "Responsive web page", exact: true })).toBeVisible();
  expect(within(tree).getByRole("row", { name: "Responsive web page", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(within(target).queryByRole("heading", { name: "16:9 deck", exact: true })).toBeNull();
  expect(screen.getByRole("button", { name: "Inspect output format" })).toHaveAttribute("aria-controls", target.id);
  expect(screen.getByRole("button", { name: "Inspect output format" })).toHaveAttribute("aria-expanded", "true");
  openFormats.focus();
  fireEvent.click(openFormats);
  await waitFor(() => expect(target).toHaveFocus());
  fireEvent.click(screen.getByRole("button", { name: "Inspect output format" }));
  expect(screen.queryByRole("region", { name: "Home · output format" })).toBeNull();
  fireEvent.click(openFormats);
  await waitFor(() => expect(screen.getByRole("region", { name: "Home · output format" })).toHaveFocus());
  expect(within(screen.getByRole("region", { name: "Home · output format" })).getByRole("heading", { name: "Responsive web page", exact: true })).toBeVisible();
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0]![0]).toEqual(configured);
  expect(screen.getByRole("region", { name: "Assembly render result" })).toHaveTextContent("Ready remains pending");
});


it.each(["Site", "Admin App"] as const)("restores the bound format and focus when proposed %s inspection reopens", async channel => {
  const fixture = appBindingFixture();
  const store = new PublisherPlanStore(channel === "Site" ? STANDARD_PACK_REGISTRIES : fixture.registries);
  const onApply = vi.fn(() => true), onChange = vi.fn();
  const draft = channel === "Site" ? createM1ExampleDraft() : createAppExampleDraft(fixture.inventory);
  render(<Host {...props} planStore={store} draftPlan={draft} onApplyPlan={onApply} onProductionSettingsChange={onChange}
    {...(channel === "Admin App" ? { instances: [], library: fixture.library, registries: fixture.registries, appInventory: fixture.inventory,
      routeChannels: { "sample.record": "admin", "sample.dashboard": "admin" } } : {})} />);
  const opener = screen.getAllByRole("button", { name: channel === "Site" ? "Open Home · proposed" : "Open App operations inventory · proposed" })[0]!;
  fireEvent.click(opener);
  const detail = screen.getByRole("region", { name: / · item details$/ });
  const inspect = within(detail).getByRole("button", { name: "Inspect output format" });
  inspect.focus();
  fireEvent.click(inspect);
  let target = within(detail).getByRole("region", { name: / · output format$/ });
  expect(inspect).toHaveAttribute("aria-controls", target.id);
  await waitFor(() => expect(target).toHaveFocus());
  expect(within(target).getByRole("heading", { name: "Responsive web page", exact: true })).toBeVisible();
  const tree = within(target).getByRole("treegrid", { name: "Formats by medium and family" });
  fireEvent.click(within(tree).getByRole("row", { name: "16:9 deck", exact: true }));
  expect(within(target).getByRole("heading", { name: "16:9 deck", exact: true })).toBeVisible();
  expect(target).toHaveTextContent("No renderer is available");
  inspect.focus();
  fireEvent.click(inspect);
  expect(within(detail).queryByRole("region", { name: / · output format$/ })).toBeNull();
  expect(inspect).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(inspect);
  target = within(detail).getByRole("region", { name: / · output format$/ });
  await waitFor(() => expect(target).toHaveFocus());
  expect(inspect).toHaveAttribute("aria-expanded", "true");
  expect(inspect).toHaveAttribute("aria-controls", target.id);
  expect(within(target).getByRole("heading", { name: "Responsive web page", exact: true })).toBeVisible();
  expect(within(target).getByRole("row", { name: "Responsive web page", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(within(target).queryByRole("heading", { name: "16:9 deck", exact: true })).toBeNull();
  expect(detail).toHaveTextContent("Align this proposal before configuring production choices");
  expect(detail).toHaveTextContent("No production clearance");
  expect(onApply).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
  expect(store.current).toBeUndefined();
  expect(draft.status).toBe("draft");
});
