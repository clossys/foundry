import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as components from "./index.js";
import * as root from "../index.js";
import { TextField, Textarea } from "./preview-runtime/components/text-field/text-field.js";

// R2F-33d1: the text-field leaf is stock shadcn@aria input and textarea in a RAC TextField over the composed field.
describe("components.text-field leaf source", () => {
  it("exports the composed TextField and Textarea and leaves no Foundry module behind", () => {
    expect([components.TextField, components.Textarea, root.TextField, root.Textarea]).toEqual([TextField, Textarea, TextField, Textarea]);
    for (const file of ["./TextField.tsx", "./Textarea.tsx"]) expect(existsSync(new URL(file, import.meta.url)), file).toBe(false);
  });
});

describe.each([
  ["TextField", "INPUT", (props: Record<string, unknown>) => <TextField label="Email" {...props} />],
  ["Textarea", "TEXTAREA", (props: Record<string, unknown>) => <Textarea label="Email" {...props} />],
] as const)("%s behaviour", (_name, tag, Control) => {
  it("names the control through its real label", () => {
    render(Control({}));
    expect(screen.getByLabelText("Email").tagName).toBe(tag);
  });

  it("accepts keyboard text input", async () => {
    const user = userEvent.setup();
    render(Control({}));
    await user.type(screen.getByLabelText("Email"), "hello@example.com");
    expect(screen.getByLabelText("Email")).toHaveValue("hello@example.com");
  });

  it("links the description through aria-describedby", () => {
    render(Control({ description: "We never share this." }));
    expect(screen.getByLabelText("Email").getAttribute("aria-describedby")).toContain(screen.getByText("We never share this.").id);
  });

  it("announces a validation error: invalid state, rendered text, aria-describedby", () => {
    render(Control({ isInvalid: true, errorMessage: "Enter a valid email." }));
    const control = screen.getByLabelText("Email");
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control.getAttribute("aria-describedby")).toContain(screen.getByText("Enter a valid email.").id);
  });

  it("renders no error text while valid", () => {
    render(Control({ errorMessage: "Enter a valid email." }));
    expect(screen.queryByText("Enter a valid email.")).toBeNull();
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
  });

  it("disabled: the control is disabled and not editable", async () => {
    const user = userEvent.setup();
    render(Control({ isDisabled: true }));
    const control = screen.getByLabelText("Email");
    expect(control).toBeDisabled();
    await user.type(control, "x");
    expect(control).toHaveValue("");
  });

  it("read-only: the value is kept and typing does not change it", async () => {
    const user = userEvent.setup();
    render(Control({ isReadOnly: true, defaultValue: "kept" }));
    const control = screen.getByLabelText("Email");
    expect(control).toHaveAttribute("readonly");
    await user.type(control, "x");
    expect(control).toHaveValue("kept");
  });

  it("renders the field root as the stock field and forwards className onto it", () => {
    const { container } = render(Control({ className: "custom-root" }));
    const field = container.querySelector("[data-slot=field]")!;
    expect(field).not.toBeNull();
    expect(field.className).toContain("custom-root");
    expect(field.contains(screen.getByLabelText("Email"))).toBe(true);
  });
});

describe("Textarea rows", () => {
  it("renders the given number of rows", () => {
    render(<Textarea label="Message" rows={6} />);
    expect(screen.getByLabelText("Message")).toHaveAttribute("rows", "6");
  });
});
