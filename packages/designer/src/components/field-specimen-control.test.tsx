import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field } from "./Field.js";
import { TextField } from "./TextField.js";

/** The registered Field/TextField composition, independent of Studio's specimen wiring. */
describe("field-specimen-control", () => {
  it("keeps the visible external label and description on the nested registered control", () => {
    const { container } = render(<Field label="Dataset field" description="Choose a field name">
      {field => <TextField label={null} id={field.id} aria-describedby={field["aria-describedby"]} />}
    </Field>);
    const input = screen.getByRole("textbox", { name: "Dataset field" });
    expect(input).toHaveAccessibleDescription("Choose a field name");
    expect(container.querySelectorAll("label")).toHaveLength(1);
    expect(container.querySelector("label")).toHaveAttribute("for", input.id);
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toBeDisabled();
  });

  it("retains external naming, description, error, required and disabled state", () => {
    render(<Field label="Dataset field" description="Choose a field name" errorMessage="A field is required"
      isInvalid isRequired isDisabled>
      {field => <TextField label={null} id={field.id} aria-describedby={field["aria-describedby"]}
        isInvalid={field["aria-invalid"]} isRequired={field["aria-required"]} isDisabled={field.disabled}
        validationBehavior="aria" />}
    </Field>);
    const input = screen.getByRole("textbox", { name: "Dataset field" });
    expect(input).toHaveAccessibleDescription("Choose a field name A field is required");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-required", "true");
    expect(input).toBeDisabled();
  });

  it("supports an explicit external aria-labelledby through the existing TextField API", () => {
    render(<><span id="external-field-label">External field</span>
      <TextField label={null} aria-labelledby="external-field-label" />
    </>);
    expect(screen.getByRole("textbox", { name: "External field" })).toHaveAttribute("aria-labelledby", "external-field-label");
  });
});
