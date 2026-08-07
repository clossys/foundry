import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field } from "./Field.js";

describe("Field", () => {
  it("renders a labeled arbitrary control, associated via the generated id (not just visual proximity)", () => {
    render(
      <Field label="Signature">
        {(fieldProps) => <input {...fieldProps} type="text" />}
      </Field>,
    );
    const input = screen.getByLabelText("Signature");
    expect(input.tagName).toBe("INPUT");
  });

  it("renders a description and links it to the control via aria-describedby", () => {
    render(
      <Field label="Signature" description="Draw your signature below.">
        {(fieldProps) => <input {...fieldProps} type="text" />}
      </Field>,
    );
    const input = screen.getByLabelText("Signature");
    const description = screen.getByText("Draw your signature below.");
    expect(input.getAttribute("aria-describedby")).toContain(description.id);
  });

  it("announces a validation error: renders it, marks the control invalid, and links it via aria-describedby", () => {
    render(
      <Field label="Signature" isInvalid errorMessage="A signature is required.">
        {(fieldProps) => <input {...fieldProps} type="text" />}
      </Field>,
    );
    const input = screen.getByLabelText("Signature");
    const error = screen.getByText("A signature is required.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain(error.id);
  });

  it("does not render or link an errorMessage while isInvalid is false", () => {
    render(
      <Field label="Signature" errorMessage="A signature is required.">
        {(fieldProps) => <input {...fieldProps} type="text" />}
      </Field>,
    );
    expect(screen.queryByText("A signature is required.")).not.toBeInTheDocument();
    const input = screen.getByLabelText("Signature");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("combines description and error ids in aria-describedby when both are present", () => {
    render(
      <Field
        label="Signature"
        description="Draw your signature below."
        isInvalid
        errorMessage="A signature is required."
      >
        {(fieldProps) => <input {...fieldProps} type="text" />}
      </Field>,
    );
    const input = screen.getByLabelText("Signature");
    const description = screen.getByText("Draw your signature below.");
    const error = screen.getByText("A signature is required.");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toContain(description.id);
    expect(describedBy).toContain(error.id);
  });

  it("passes aria-required through the render prop while isRequired, and omits it otherwise", () => {
    const { rerender } = render(
      <Field label="Signature">{(fieldProps) => <input {...fieldProps} type="text" />}</Field>,
    );
    expect(screen.getByLabelText("Signature")).not.toHaveAttribute("aria-required");

    rerender(
      <Field label="Signature" isRequired>
        {(fieldProps) => <input {...fieldProps} type="text" />}
      </Field>,
    );
    expect(screen.getByLabelText("Signature")).toHaveAttribute("aria-required", "true");
  });

  it("wraps a non-native, non-input control just as well — the whole point of the render prop", () => {
    function FakeSignaturePad(props: { id: string; "aria-describedby"?: string }) {
      return (
        <div role="img" aria-label="Signature pad" {...props}>
          drawing surface
        </div>
      );
    }
    render(
      <Field label="Signature" description="Draw below.">
        {(fieldProps) => <FakeSignaturePad {...fieldProps} />}
      </Field>,
    );
    const pad = screen.getByRole("img", { name: "Signature pad" });
    const description = screen.getByText("Draw below.");
    expect(pad.getAttribute("aria-describedby")).toBe(description.id);
  });

  it("forwards className onto the field wrapper, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(
      <Field label="Signature" className="gap-lg">
        {(fieldProps) => <input {...fieldProps} type="text" />}
      </Field>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("gap-lg");
    expect(wrapper.className).not.toContain("gap-xs");
  });

  it("forwards a consumer style prop onto the field wrapper", () => {
    const { container } = render(
      <Field label="Signature" style={{ marginTop: "8px" }}>
        {(fieldProps) => <input {...fieldProps} type="text" />}
      </Field>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.marginTop).toBe("8px");
  });
});
