// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { instanceFixture } from "../../core/__fixtures__/instance-binding/fixtures.js";
import { PublisherSection } from "./PublisherSection.js";
import { productionSettingsFromBinding } from "./production-settings.js";

afterEach(cleanup);

it("keeps the selected record's fields and close command together", () => {
  const fixture = instanceFixture(), onCommand = vi.fn();
  render(<PublisherSection registries={fixture.registries} onCommand={onCommand} data={{
    id: "detail", section: "sections.record-detail", label: "Selected item",
    fields: [{ id: "state", label: "State", value: "pending" }],
    actions: [{ kind: "action", label: "Close item details", command: { kind: "close-item" } }],
  }} />);
  const detail = screen.getByRole("region", { name: "Selected item" });
  expect(within(detail).getByRole("definition")).toHaveTextContent("pending");
  fireEvent.click(within(detail).getByRole("button", { name: "Close item details" }));
  expect(onCommand).toHaveBeenCalledWith({ kind: "close-item" });
});

it("submits and resets the selected production item through its existing commands", () => {
  const fixture = instanceFixture(), onCommand = vi.fn();
  const initial = productionSettingsFromBinding(fixture.binding);
  render(<PublisherSection registries={fixture.registries} onCommand={onCommand} data={{
    id: "configure", section: "sections.form", label: "Configure production settings", itemId: fixture.binding.instanceId,
    fields: { kind: "production", initial, configured: false, answerIds: [] }, requests: [],
  }} />);
  const form = screen.getByRole("form", { name: "Production settings" });
  fireEvent.click(within(form).getByRole("button", { name: "Apply configuration" }));
  expect(onCommand).toHaveBeenCalledWith({ kind: "configure", itemId: fixture.binding.instanceId, settings: initial });
  expect(form).toHaveTextContent("Later stages use the actual checks");
  fireEvent.click(within(form).getByRole("button", { name: "Reset configuration" }));
  expect(onCommand).toHaveBeenLastCalledWith({ kind: "reset-configuration", itemId: fixture.binding.instanceId });
});

it("renders existing table text, action and link cells without changing command identities", () => {
  const fixture = instanceFixture(), onCommand = vi.fn();
  render(<PublisherSection registries={fixture.registries} onCommand={onCommand} data={{
    id: "P2", section: "sections.data-table", label: "Admin delivery items",
    columns: [{ id: "item", label: "item" }, { id: "path", label: "path" }, { id: "state", label: "state" }],
    rows: [{ id: "app.tools", cells: { item: { kind: "action", label: "Tools", command: { kind: "select-item", itemId: "app.tools" } }, path: { kind: "link", label: "Open item", href: "/tools" }, state: { kind: "text", text: "needs input" } } }],
  }} />);
  fireEvent.click(screen.getByRole("button", { name: "Tools" }));
  expect(onCommand).toHaveBeenCalledWith({ kind: "select-item", itemId: "app.tools" });
  expect(screen.getByRole("link", { name: "Open item" })).toHaveAttribute("href", "/tools");
  expect(screen.getByRole("grid")).toHaveTextContent("needs input");
});
