// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { instanceFixture } from "../../core/__fixtures__/instance-binding/fixtures.js";
import { ConfigurationSummary, configurationValueLabel, DeliverySettingsFields, InputQuestions, ProductionSettingsForm } from "./ProductionSettingsForm.js";
import { productionSettingsFromBinding } from "./production-settings.js";

afterEach(cleanup);

it("keeps production edits local until Apply and restores the supplied settings on Reset", () => {
  const fixture = instanceFixture();
  const initial = productionSettingsFromBinding(fixture.binding);
  const onApply = vi.fn(), onReset = vi.fn();
  const { container } = render(<ProductionSettingsForm initial={initial} configured={false} registries={fixture.registries} onApply={onApply} onReset={onReset} />);
  expect(container.querySelectorAll("form")).toHaveLength(1);
  const input = screen.getByRole("combobox", { name: "Layout config" });
  fireEvent.change(input, { target: { value: "host.custom" } });
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Apply configuration" }));
  expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ layout: { ...initial.layout, config: "host.custom" } }));
  expect(screen.getByRole("form", { name: "Production settings" })).toHaveTextContent("Later stages use the actual checks");
  fireEvent.click(screen.getByRole("button", { name: "Reset configuration" }));
  expect(input).toHaveValue("Layout config");
  expect(onReset).toHaveBeenCalledOnce();
  expect(onApply).toHaveBeenCalledOnce();
});

it("requires a nonempty layout configuration before Apply", () => {
  const fixture = instanceFixture();
  const onApply = vi.fn();
  render(<ProductionSettingsForm initial={productionSettingsFromBinding(fixture.binding)} configured={false} registries={fixture.registries} onApply={onApply} onReset={() => {}} />);
  fireEvent.change(screen.getByRole("combobox", { name: "Layout config" }), { target: { value: "" } });
  expect(screen.getByRole("button", { name: "Apply configuration" })).toBeDisabled();
  expect(onApply).not.toHaveBeenCalled();
});

const nameValues: Readonly<Record<string, string>> = {
  "publisher.format/web.page.responsive": "Page output",
  "publisher.frame/frames.site-shell": "Site frame",
  "publisher.frameConfig.frames.site-shell/site": "Site preset",
  "publisher.layout/layouts.stack": "Stack layout",
  "publisher.layoutConfig.layouts.stack/stack.landing": "Landing preset",
  "publisher.layoutConfig.layouts.stack/stack.document": "Document preset",
  "publisher.delivery/static-site-bundle": "Site files",
  "publisher.deploymentSurface/host.production": "Live website",
  "publisher.breakpoint/tokens.breakpoint.tablet": "Tablet screens",
  "admin.enum/built": "Available to configure",
  "admin.enum/stable": "Stable",
};
const names = (parent: string, id: string) => nameValues[`${parent}/${id}`];

it("shows resolved production values while Apply retains exact selection IDs", () => {
  const fixture = instanceFixture();
  const onApply = vi.fn();
  const initial = { ...productionSettingsFromBinding(fixture.binding), deploymentSurface: "host.production", deliveries: [{ id: "static-site-bundle" as const }] };
  const { container } = render(<ProductionSettingsForm initial={initial} configured={false} registries={fixture.registries} messages={{ valueNames: names }} deploymentSurfaceIds={["host.production"]} recommendationAnswerIds={["A-42"]} onApply={onApply} onReset={() => {}} />);
  expect(screen.getByRole("combobox", { name: "Frame config" })).toHaveValue("Site preset");
  expect(screen.getByRole("combobox", { name: "Layout config" })).toHaveValue("Landing preset");
  expect(screen.getByRole("combobox", { name: "Deployment surface ID" })).toHaveValue("Live website");
  expect(container).toHaveTextContent("Site files");
  expect(container.textContent).not.toMatch(/frames\.site-shell|layouts\.stack|web\.page\.responsive|stack\.landing|A-42|host\.production|static-site-bundle/);
  fireEvent.click(screen.getByRole("button", { name: "Apply configuration" }));
  expect(onApply).toHaveBeenLastCalledWith(initial);
  fireEvent.change(screen.getByRole("combobox", { name: "Layout config" }), { target: { value: "Document preset" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply configuration" }));
  expect(onApply).toHaveBeenLastCalledWith({ ...initial, layout: { ...initial.layout, config: "stack.document" } });
});

it("keeps unresolved machine values out of displayed defaults and summaries", () => {
  const fixture = instanceFixture();
  const configuration = { kind: "web" as const, ...productionSettingsFromBinding(fixture.binding), format: "web.page.responsive" as const, media: { size: { kind: "responsive" as const, breakpoints: ["tokens.breakpoint.tablet" as const] } }, deliveries: [{ id: "static-site-bundle" as const }], deploymentSurface: "host.production" };
  const { container } = render(<ConfigurationSummary configuration={configuration} messages={{ valueNames: names }} />);
  expect(container).toHaveTextContent("Page output");
  expect(container).toHaveTextContent("Site frame · Site preset");
  expect(container).toHaveTextContent("Stack layout · Landing preset");
  expect(container).toHaveTextContent("Tablet screens");
  expect(container).toHaveTextContent("Live website");
  expect(container.textContent).not.toMatch(/frames\.|layouts\.|tokens\.|host\.|static-site-bundle/);
  expect(configurationValueLabel({ leaf: "frames.host-private", config: "private.config" }, names)).toBe("— · —");
  expect(configurationValueLabel("private.format", names)).toBe("—");
});

it("keeps optional deployment callbacks absent and input slots unnamed when unresolved", () => {
  const fixture = instanceFixture();
  const onChange = vi.fn();
  const { container } = render(<><DeliverySettingsFields format={fixture.registries.formats[0]} choices={[]} onChange={onChange} deploymentSurface="host.secret" deploymentSurfaceIds={["host.secret"]} messages={{ valueNames: names }} /><InputQuestions requests={[{ slot: "integration.secret", question: "Supply the required reference." }]} /></>);
  expect(screen.queryByRole("combobox", { name: "Deployment surface ID" })).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
  expect(container.textContent).not.toMatch(/host\.secret|integration\.secret/);
});

it("selects a named suggestion without saving its emitted display label as the config ID", async () => {
  const user = userEvent.setup();
  const fixture = instanceFixture();
  const onApply = vi.fn();
  const initial = productionSettingsFromBinding(fixture.binding);
  render(<ProductionSettingsForm initial={initial} configured={false} registries={fixture.registries} messages={{ valueNames: names }} onApply={onApply} onReset={() => {}} />);
  const input = screen.getByRole("combobox", { name: "Layout config" });
  await user.click(input.parentElement!.querySelector("button")!);
  await user.click(await screen.findByRole("option", { name: "Document preset" }));
  expect(input).toHaveValue("Document preset");
  await user.click(screen.getByRole("button", { name: "Apply configuration" }));
  expect(onApply).toHaveBeenLastCalledWith({ ...initial, layout: { ...initial.layout, config: "stack.document" } });
});
