// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { instanceFixture } from "../../core/__fixtures__/instance-binding/fixtures.js";
import { ProductionSettingsForm } from "./ProductionSettingsForm.js";
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
  expect(input).toHaveValue(initial.layout.config);
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
