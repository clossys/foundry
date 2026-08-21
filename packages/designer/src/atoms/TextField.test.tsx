import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TextField } from "./TextField.js";

describe("TextField", () => {
  it("renders a labeled input, associated via the real label-association APIs (not just visual proximity)", () => {
    render(<TextField label="Email" />);
    const input = screen.getByLabelText("Email");
    expect(input.tagName).toBe("INPUT");
  });

  it("accepts keyboard text input", async () => {
    const user = userEvent.setup();
    render(<TextField label="Email" />);
    const input = screen.getByLabelText("Email");
    await user.type(input, "hello@example.com");
    expect(input).toHaveValue("hello@example.com");
  });

  it("renders a description and links it to the input via aria-describedby", () => {
    render(<TextField label="Email" description="We'll never share this." />);
    const input = screen.getByLabelText("Email");
    const description = screen.getByText("We'll never share this.");
    expect(input.getAttribute("aria-describedby")).toContain(description.id);
  });

  it("announces a validation error: renders it, marks the field invalid, and links it via aria-describedby", () => {
    render(<TextField label="Email" isInvalid errorMessage="Enter a valid email." />);
    const input = screen.getByLabelText("Email");
    const error = screen.getByText("Enter a valid email.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain(error.id);
  });

  it("forwards className onto the field wrapper, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(<TextField label="Email" className="gap-lg" />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("gap-lg");
    expect(wrapper.className).not.toContain("gap-xs");
  });

  it("forwards inputClassName onto the <input>, and the consumer's conflicting class wins the merge", () => {
    render(<TextField label="Email" inputClassName="border-status-danger" />);
    const input = screen.getByLabelText("Email");
    expect(input.className).toContain("border-status-danger");
    expect(input.className).not.toContain("border-line-base");
  });

  it("disabled: the input is disabled and not editable", async () => {
    const user = userEvent.setup();
    render(<TextField label="Email" isDisabled />);
    const input = screen.getByLabelText("Email");
    expect(input).toBeDisabled();
    await user.type(input, "x");
    expect(input).toHaveValue("");
  });
});
