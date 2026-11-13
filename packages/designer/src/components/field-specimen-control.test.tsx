import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field, FieldDescription, FieldError, FieldLabel } from "./preview-runtime/components/field/field.js";
import { TextField } from "./preview-runtime/components/text-field/text-field.js";

/** The composed stock field parts around a control, independent of Studio's specimen wiring. */
describe("field-specimen-control", () => {
  it("names a native control with the stock label and shows the stock error only while invalid", () => {
    const { rerender } = render(<Field><FieldLabel htmlFor="dataset">Dataset field</FieldLabel><input id="dataset" />
      <FieldDescription>Choose a field name</FieldDescription><FieldError>A field is required</FieldError></Field>);
    expect(screen.getByRole("textbox", { name: "Dataset field" })).toBeInTheDocument();
    expect(screen.getByRole("group")).toHaveAttribute("data-slot", "field");
    expect(screen.queryByRole("alert")).toBeNull();
    rerender(<Field isInvalid><FieldLabel htmlFor="dataset">Dataset field</FieldLabel><input id="dataset" />
      <FieldError>A field is required</FieldError></Field>);
    expect(screen.getByRole("alert")).toHaveTextContent("A field is required");
    expect(screen.getByRole("group")).toHaveAttribute("data-invalid", "true");
  });

  it("supports an explicit external aria-labelledby through the existing TextField API", () => {
    render(<><span id="external-field-label">External field</span>
      <TextField label={null} aria-labelledby="external-field-label" />
    </>);
    expect(screen.getByRole("textbox", { name: "External field" })).toHaveAttribute("aria-labelledby", "external-field-label");
  });
});
