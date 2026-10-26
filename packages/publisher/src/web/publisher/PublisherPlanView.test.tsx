// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PublisherPage } from "./PublisherPage.js";
import { PublisherPlanStore } from "../../planning/change-set.js";
import { createM1ExampleDraft, createAppExampleDraft } from "./__fixtures__/example-plan.js";
import { STANDARD_PACK_INSTANCES, STANDARD_PACK_REGISTRIES, createStandardPackLibrary } from "./__fixtures__/standard-website.js";
import { projectAppInventory } from "./app/inventory.js";
import { genericInventory } from "./app/__fixtures__/generic.js";
const props = { instances: STANDARD_PACK_INSTANCES, library: createStandardPackLibrary({}), registries: STANDARD_PACK_REGISTRIES, breakpointValues: {}, designerHref: "/designer" };
afterEach(cleanup);
it("starts with Plan, no forced website and exact pack empty state before Align", () => {
  render(<PublisherPage {...props} />);
  expect(screen.getByRole("tab", { name: "Plan" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByText("Tell Publisher your milestones")).toBeVisible();
  expect(screen.getByRole("region", { name: "Publisher menu" })).toBeVisible();
  fireEvent.click(screen.getByRole("tab", { name: "Standard website" }));
  expect(screen.getByText("Tell Publisher your milestones")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Open Home/ })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "App" }));
  expect(screen.getByText("Tell Publisher your milestones")).toBeVisible();
});
it("aligns a suggested M1 via the adapter, renders Showcase and preserves aligned items during later drafts", async () => {
  const store = new PublisherPlanStore(STANDARD_PACK_REGISTRIES), apply = vi.fn(() => true), draft = createM1ExampleDraft();
  const { rerender } = render(<PublisherPage {...props} planStore={store} draftPlan={draft} onApplyPlan={apply} />);
  expect(screen.getByRole("region", { name: "Proposed plan" })).toHaveTextContent("example.first-impression");
  fireEvent.click(screen.getByRole("tab", { name: "Standard website" }));
  expect(screen.queryByRole("button", { name: /Open Home/ })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Plan" }));
  fireEvent.click(screen.getByRole("button", { name: "Align plan" }));
  await waitFor(() => expect(store.current?.version).toBe(1));
  expect(apply).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("tab", { name: "Brand assets" }));
  expect(screen.getByText("assets.brand")).toBeVisible();
  expect(screen.getByText("assets.share")).toBeVisible();
  fireEvent.click(screen.getByRole("tab", { name: "Standard website" }));
  expect(screen.getAllByRole("button", { name: /Open .* · to do/ })).toHaveLength(8);
  expect(screen.getByRole("button", { name: /Expand Showcase/ })).toBeVisible();
  expect(screen.queryByRole("button", { name: /Expand Auth/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Expand Showcase/ }));
  expect(within(screen.getByRole("table", { name: "Showcase items" })).getByText("stack.index")).toBeVisible();
  const nextDraft = { ...draft, version: 2, milestones: [{ id: "M1" as const, packs: [] }] };
  rerender(<PublisherPage {...props} planStore={store} draftPlan={nextDraft} onApplyPlan={apply} />);
  expect(screen.getAllByRole("button", { name: /Open .* · to do/ })).toHaveLength(8);
  fireEvent.click(screen.getByRole("tab", { name: "Plan" }));
  expect(screen.getByText("Draft version 2")).toBeVisible();
  expect(screen.getByText(/Aligned version 1/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Align plan" }));
  await waitFor(() => expect(store.current?.version).toBe(2));
  fireEvent.click(screen.getByRole("tab", { name: "Standard website" }));
  expect(screen.getByText("Tell Publisher your milestones")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Open Home/ })).toBeNull();
});
it("requires the explicit host callback and keeps a refused draft out of production", async () => {
  const store = new PublisherPlanStore(STANDARD_PACK_REGISTRIES), draft = createM1ExampleDraft();
  const { rerender } = render(<PublisherPage {...props} planStore={store} draftPlan={draft} />);
  expect(screen.getByRole("button", { name: "Align plan" })).toBeDisabled();
  rerender(<PublisherPage {...props} planStore={store} draftPlan={draft} onApplyPlan={() => false} />);
  fireEvent.click(screen.getByRole("button", { name: "Align plan" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Host refused");
  fireEvent.click(screen.getByRole("tab", { name: "Standard website" }));
  expect(screen.queryByRole("button", { name: /Open Home/ })).toBeNull();
});
it("aligns an independent inventory App plan with parent record tabs and no website enrollment", async () => {
  const inventory = projectAppInventory(genericInventory()), store = new PublisherPlanStore(STANDARD_PACK_REGISTRIES), draft = createAppExampleDraft(inventory);
  render(<PublisherPage {...props} appInventory={inventory} planStore={store} draftPlan={draft} onApplyPlan={() => true} />);
  const proposed = screen.getByRole("region", { name: "Proposed plan" });
  expect(within(proposed).getByText("app.sample.record")).toBeVisible();
  expect(within(proposed).getByText("sample.record")).toBeVisible();
  expect(within(proposed).queryByText("app.sample.tab")).toBeNull();
  expect(within(proposed).queryByText("sample.tab")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Align plan" }));
  await waitFor(() => expect(store.current?.version).toBe(1));
  fireEvent.click(screen.getByRole("tab", { name: "App" }));
  expect(screen.getByText("3 pages · 0 Ready · 3 not ready")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Expand Record · 1 pages" }));
  fireEvent.click(screen.getByRole("button", { name: "Expand Sample record tabs · 1" }));
  expect(screen.getByRole("button", { name: "↳ Overview" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Open Sample record/ }));
  expect(screen.getByRole("heading", { name: "Sample record · route details" })).toBeVisible();
  fireEvent.click(screen.getByRole("tab", { name: "Standard website" }));
  expect(screen.getByText("Tell Publisher your milestones")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Open Home/ })).toBeNull();
});

it("shows aligned concepts outside the current milestone without creating a renderer", async () => {
  const store = new PublisherPlanStore(STANDARD_PACK_REGISTRIES);
  const draft = { ...createM1ExampleDraft(), milestones: [{ id: "M1" as const, packs: [] }, { id: "M2" as const, packs: [{ id: "pack.conversation" as const, items: [{ id: "email", menuRef: "conversation.email", lane: "Email" as const, format: "email.html" as const, answerIds: ["example.first-impression"], openNeeds: [] }] }] }] };
  render(<PublisherPage {...props} planStore={store} draftPlan={draft} onApplyPlan={() => true} />);
  fireEvent.click(screen.getByRole("button", { name: "Align plan" }));
  await waitFor(() => expect(store.current?.version).toBe(1));
  fireEvent.click(screen.getByRole("tab", { name: "Conversation" }));
  expect(screen.getByRole("tabpanel")).toHaveTextContent("not in current milestone");
  expect(screen.getByText(/Concept-only · no renderer/)).toBeVisible();
  expect(screen.getByText("email")).toBeVisible();
  expect(screen.queryByRole("complementary", { name: "Instance inspector" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Open / })).toBeNull();
});

it("uses host Plan and Configure messages without changing alignment or production choices", async () => {
  const store = new PublisherPlanStore(STANDARD_PACK_REGISTRIES), apply = vi.fn(() => true);
  render(<PublisherPage {...props} planStore={store} draftPlan={createM1ExampleDraft()} onApplyPlan={apply}
    planMessages={{ planLabel: "Publication plan", proposalLabel: "Suggested scope", alignLabel: "Accept scope" }}
    messages={{ openItemLabel: (label, state) => `Inspect ${label} · ${state}` }}
    productionMessages={{ heading: "Build settings", applyLabel: "Use settings", resetLabel: "Clear settings" }} />);
  expect(screen.getByRole("heading", { name: "Publication plan" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Suggested scope" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Accept scope" }));
  await waitFor(() => expect(store.current?.version).toBe(1));
  expect(apply).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("tab", { name: "Standard website" }));
  fireEvent.click(screen.getByRole("button", { name: "Inspect About · to do" }));
  expect(screen.getByRole("heading", { name: "Build settings" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Clear settings" })).toBeVisible();
  const frameInput = screen.getByLabelText("Frame config"), layoutInput = screen.getByLabelText("Layout config");
  expect(frameInput.getAttribute("list")).not.toBe(layoutInput.getAttribute("list"));
  expect(document.getElementById(frameInput.getAttribute("list")!)).toHaveProperty("tagName", "DATALIST");
  expect(document.getElementById(layoutInput.getAttribute("list")!)).toHaveProperty("tagName", "DATALIST");
  fireEvent.click(screen.getByRole("button", { name: "Use settings" }));
  expect(screen.getByRole("complementary", { name: "Instance inspector" })).toHaveTextContent("standard.about");
});

it("forwards host App decision messages and keeps the heading reference connected", async () => {
  const inventory = projectAppInventory(genericInventory(), [{ id: "sample.pending", label: "Sample pending", lane: "Record" }]), store = new PublisherPlanStore(STANDARD_PACK_REGISTRIES);
  render(<PublisherPage {...props} appInventory={inventory} planStore={store} draftPlan={createAppExampleDraft(inventory)} onApplyPlan={() => true}
    appMessages={{ decisionLabel: "· undecided page", openDecisionLabel: label => `Inspect decision ${label}`, closeDecisionLabel: "Close decision" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Align plan" }));
  await waitFor(() => expect(store.current?.version).toBe(1));
  fireEvent.click(screen.getByRole("tab", { name: "App" }));
  fireEvent.click(screen.getByRole("button", { name: /Inspect decision/ }));
  const heading = screen.getByRole("heading", { name: /· undecided page/ });
  expect(heading).toHaveFocus();
  expect(heading.closest("section")).toHaveAttribute("aria-labelledby", heading.id);
  expect(screen.getByRole("button", { name: "Close decision" })).toBeVisible();
});

it("edits and resets recommendations before Align, records explicit overrides, and keeps production Apply outside history", async () => {
  const store = new PublisherPlanStore(STANDARD_PACK_REGISTRIES), apply = vi.fn(() => true), draft = createM1ExampleDraft();
  render(<PublisherPage {...props} planStore={store} draftPlan={draft} onApplyPlan={apply} deploymentSurfaceIds={["fixture.web-preview"]} />);
  const summary = screen.getByText("Configure recommendation · standard.home");
  fireEvent.click(summary);
  const editor = summary.closest("details")!;
  const layout = within(editor).getByLabelText("Layout config");
  expect(layout).toHaveValue("stack.landing");
  expect(within(editor).getByLabelText("Format").querySelectorAll("option")).toHaveLength(1);
  expect(editor).toHaveTextContent("example.first-impression");
  fireEvent.change(layout, { target: { value: "stack.index" } });
  fireEvent.click(within(editor).getByRole("button", { name: "Update proposed configuration" }));
  expect(store.versions).toEqual([]);
  fireEvent.click(within(editor).getByRole("button", { name: "Reset configuration" }));
  expect(layout).toHaveValue("stack.landing");
  fireEvent.change(layout, { target: { value: "stack.index" } });
  fireEvent.change(within(editor).getByLabelText("Deployment surface ID"), { target: { value: "fixture.web-preview" } });
  fireEvent.click(within(editor).getByRole("button", { name: "Update proposed configuration" }));
  fireEvent.click(screen.getByRole("tab", { name: "Standard website" }));
  fireEvent.click(screen.getByRole("tab", { name: "Plan" }));
  fireEvent.click(screen.getByRole("button", { name: "Align plan" }));
  await waitFor(() => expect(store.current?.version).toBe(1));
  const item = store.current!.milestones[0]!.packs[0]!.items[0]!;
  expect(item.recommendation?.configuration).toMatchObject({ layout: { config: "stack.landing" } });
  expect(item.configuration).toMatchObject({ layout: { config: "stack.index" }, deploymentSurface: "fixture.web-preview" });
  expect(item.overrides).toContainEqual({ field: "layout", original: { leaf: "layouts.stack", config: "stack.landing" }, value: { leaf: "layouts.stack", config: "stack.index" } });
  expect(apply).toHaveBeenCalledOnce();
  const before = JSON.stringify(store.current);
  fireEvent.click(screen.getByRole("tab", { name: "Standard website" }));
  fireEvent.click(screen.getByRole("button", { name: "Open Home · to do" }));
  expect(screen.getByLabelText("Layout config")).toHaveValue("stack.index");
  expect(screen.getByLabelText("Deployment surface ID")).toHaveValue("fixture.web-preview");
  fireEvent.click(screen.getByRole("button", { name: "Apply configuration" }));
  expect(within(screen.getByRole("list", { name: "Full publish stages" })).getByText("Export: concept-only")).toBeVisible();
  expect(within(screen.getByRole("list", { name: "Full publish stages" })).getByText("Deploy: unknown")).toBeVisible();
  expect(store.versions).toHaveLength(1);
  expect(JSON.stringify(store.current)).toBe(before);
  expect(screen.queryByRole("button", { name: /export|deploy|publish/i })).toBeNull();
});

it("requires explicit editable or flat slide delivery before Align and never creates concept renderers", async () => {
  const { createDeliveryExampleDraft } = await import("./__fixtures__/example-plan.js");
  const store = new PublisherPlanStore(STANDARD_PACK_REGISTRIES);
  render(<PublisherPage {...props} planStore={store} draftPlan={createDeliveryExampleDraft()} onApplyPlan={() => true} />);
  const summary = screen.getByText("Configure recommendation · conversation.deck");
  fireEvent.click(summary);
  const editor = summary.closest("details")!;
  fireEvent.click(within(editor).getByRole("checkbox", { name: /PowerPoint/ }));
  expect(screen.getByRole("button", { name: "Align plan" })).toBeDisabled();
  expect(within(editor).queryByLabelText("Layout config")).toBeNull();
  expect(within(editor).queryByLabelText("Frame config")).toBeNull();
  fireEvent.change(within(editor).getByLabelText("Slide fidelity · PowerPoint"), { target: { value: "flat" } });
  expect(screen.getByRole("button", { name: "Align plan" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Align plan" }));
  await waitFor(() => expect(store.current?.version).toBe(1));
  const deck = store.current!.milestones[0]!.packs[0]!.items.find(item => item.menuRef === "conversation.deck")!;
  expect(deck.configuration).toEqual({ kind: "concept-only", format: "deck.16x9", deliveries: [{ id: "pdf" }, { id: "pptx", fidelity: "flat" }] });
  expect(deck.recommendation?.configuration.deliveries).toEqual([{ id: "pdf" }]);
  fireEvent.click(screen.getByRole("tab", { name: "Conversation" }));
  expect(screen.getAllByText("Export: concept-only · Deploy: unknown")).toHaveLength(4);
  expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
  expect(screen.queryByRole("complementary", { name: "Instance inspector" })).toBeNull();
});

it("forwards host delivery and requirement messages while retaining registered selections", () => {
  const store = new PublisherPlanStore(STANDARD_PACK_REGISTRIES);
  render(<PublisherPage {...props} planStore={store} draftPlan={createM1ExampleDraft()} onApplyPlan={() => true}
    requirementMessages={{ deploymentQuestion: "Select the fixture handoff surface" }}
    productionMessages={{ deliveryLabel: "Handoff choices", deploymentSurfaceLabel: "Host surface", recommendationLabel: "Suggested by answers" }} />);
  expect(screen.getAllByText("Select the fixture handoff surface")).toHaveLength(8);
  const summary = screen.getByText("Configure recommendation · standard.home");
  fireEvent.click(summary);
  const editor = summary.closest("details")!;
  expect(within(editor).getByRole("group", { name: "Handoff choices" })).toBeVisible();
  expect(within(editor).getByLabelText("Host surface")).toHaveValue("");
  expect(editor).toHaveTextContent("Suggested by answers example.first-impression");
});

it("binds brand roster references and Formats to the supplied host data", async () => {
  const draft = createM1ExampleDraft();
  const boundDraft = { ...draft, milestones: draft.milestones.map(milestone => ({ ...milestone, packs: milestone.packs.map(pack => ({ ...pack, items: pack.items.map(item => item.id === "assets.brand" ? { ...item, assetId: "fixture.brand" } : item) })) })) };
  const registries = { ...STANDARD_PACK_REGISTRIES, formats: STANDARD_PACK_REGISTRIES.formats.map(format => ({ ...format, label: `Host ${format.label}` })) };
  const store = new PublisherPlanStore(registries);
  render(<PublisherPage {...props} registries={registries} planStore={store} draftPlan={boundDraft} onApplyPlan={() => true} brandAssets={{ "fixture.brand": [] }} />);
  fireEvent.click(screen.getByRole("button", { name: "Align plan" }));
  await waitFor(() => expect(store.current?.version).toBe(1));
  fireEvent.click(screen.getByRole("tab", { name: "Brand assets" }));
  expect(screen.getByText("Asset reference: fixture.brand")).toBeVisible();
  expect(screen.getByText("Roster metadata needs input")).toBeVisible();
  expect(screen.getByText('missing required role "favicon-svg"')).toBeVisible();
  expect(screen.getByText("Choose a consumer asset reference.")).toBeVisible();
  fireEvent.click(screen.getByRole("tab", { name: "Formats" }));
  expect(screen.getByRole("heading", { name: `Host ${STANDARD_PACK_REGISTRIES.formats[0]!.label}` })).toBeVisible();
  expect(screen.getByRole("region", { name: "Final deliveries" })).toHaveTextContent("Static site bundle · concept-only");
});
