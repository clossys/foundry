import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FieldGroup } from "./FieldGroup.js";

describe("FieldGroup", () => {
  it("renders a real <fieldset>/<legend> pair, exposed as a group with the legend as its accessible name", () => {
    render(
      <FieldGroup legend="Shipping address">
        <input aria-label="Street" />
      </FieldGroup>,
    );
    const group = screen.getByRole("group", { name: "Shipping address" });
    expect(group.tagName).toBe("FIELDSET");
    expect(screen.getByText("Shipping address").tagName).toBe("LEGEND");
  });

  it("renders the fields inside the group", () => {
    render(
      <FieldGroup legend="Shipping address">
        <input aria-label="Street" />
        <input aria-label="City" />
      </FieldGroup>,
    );
    const group = screen.getByRole("group", { name: "Shipping address" });
    expect(group).toContainElement(screen.getByRole("textbox", { name: "Street" }));
    expect(group).toContainElement(screen.getByRole("textbox", { name: "City" }));
  });

  it("renders no description region when description is omitted", () => {
    render(
      <FieldGroup legend="Shipping address">
        <input aria-label="Street" />
      </FieldGroup>,
    );
    const group = screen.getByRole("group", { name: "Shipping address" }) as HTMLFieldSetElement;
    expect(group).not.toHaveAttribute("aria-describedby");
  });

  it("renders and wires the description via aria-describedby when given", () => {
    render(
      <FieldGroup legend="Shipping address" description="Used for delivery only.">
        <input aria-label="Street" />
      </FieldGroup>,
    );
    const group = screen.getByRole("group", { name: "Shipping address" });
    const description = screen.getByText("Used for delivery only.");
    expect(group).toHaveAttribute("aria-describedby", description.id);
  });

  it("does not disturb a focused field's own legend context when a sibling field receives focus (native fieldset/legend association, not JS-managed)", () => {
    render(
      <FieldGroup legend="Shipping address">
        <input aria-label="Street" />
        <input aria-label="City" />
      </FieldGroup>,
    );
    // The native <fieldset>/<legend> association needs no id-based wiring at
    // all — the group's accessible name from the legend is available
    // regardless of which child currently has focus, unlike aria-labelledby
    // which would need to be set explicitly on each control.
    screen.getByRole("textbox", { name: "City" }).focus();
    expect(screen.getByRole("group", { name: "Shipping address" })).toBeInTheDocument();
  });

  it("defaults to a single-column fields layout", () => {
    const { container } = render(
      <FieldGroup legend="Shipping address">
        <input aria-label="Street" />
      </FieldGroup>,
    );
    const fieldsRegion = container.querySelector("fieldset > div:last-child") as HTMLElement;
    expect(fieldsRegion.className).toContain("grid-cols-1");
    expect(fieldsRegion.className).not.toContain("tablet:grid-cols-2");
  });

  it("renders a multi-column fields layout when layout=\"multi\"", () => {
    const { container } = render(
      <FieldGroup legend="Shipping address" layout="multi">
        <input aria-label="Street" />
        <input aria-label="City" />
      </FieldGroup>,
    );
    const fieldsRegion = container.querySelector("fieldset > div:last-child") as HTMLElement;
    expect(fieldsRegion.className).toContain("tablet:grid-cols-2");
  });

  it("forwards className onto the <fieldset>, and the consumer's conflicting class wins the merge", () => {
    render(
      <FieldGroup legend="Shipping address" className="gap-2xl">
        <input aria-label="Street" />
      </FieldGroup>,
    );
    const group = screen.getByRole("group", { name: "Shipping address" });
    expect(group.className).toContain("gap-2xl");
    expect(group.className).not.toContain("gap-sm");
  });

  it("forwards a consumer style prop onto the <fieldset>", () => {
    render(
      <FieldGroup legend="Shipping address" style={{ marginTop: "8px" }}>
        <input aria-label="Street" />
      </FieldGroup>,
    );
    const group = screen.getByRole("group", { name: "Shipping address" });
    expect(group.style.marginTop).toBe("8px");
  });
});
