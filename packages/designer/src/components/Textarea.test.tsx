import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Textarea } from "./Textarea.js";

describe("Textarea", () => {
  it("renders a labeled textarea, associated via the real label-association APIs (not just visual proximity)", () => {
    render(<Textarea label="Description" />);
    const textarea = screen.getByLabelText("Description");
    expect(textarea.tagName).toBe("TEXTAREA");
  });

  it("accepts multi-line keyboard text input", async () => {
    const user = userEvent.setup();
    render(<Textarea label="Description" />);
    const textarea = screen.getByLabelText("Description");
    await user.type(textarea, "Line one{Enter}Line two");
    expect(textarea).toHaveValue("Line one\nLine two");
  });

  it("renders the given number of rows", () => {
    render(<Textarea label="Description" rows={6} />);
    const textarea = screen.getByLabelText("Description");
    expect(textarea).toHaveAttribute("rows", "6");
  });

  it("renders a description and links it to the textarea via aria-describedby", () => {
    render(<Textarea label="Description" description="Markdown supported." />);
    const textarea = screen.getByLabelText("Description");
    const description = screen.getByText("Markdown supported.");
    expect(textarea.getAttribute("aria-describedby")).toContain(description.id);
  });

  it("announces a validation error: renders it, marks the field invalid, and links it via aria-describedby", () => {
    render(<Textarea label="Description" isInvalid errorMessage="Description is required." />);
    const textarea = screen.getByLabelText("Description");
    const error = screen.getByText("Description is required.");
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(textarea.getAttribute("aria-describedby")).toContain(error.id);
  });

  it("forwards className onto the field wrapper, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(<Textarea label="Description" className="gap-lg" />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("gap-lg");
    expect(wrapper.className).not.toContain("gap-xs");
  });

  it("forwards textareaClassName onto the <textarea>, and the consumer's conflicting class wins the merge", () => {
    render(<Textarea label="Description" textareaClassName="border-status-danger" />);
    const textarea = screen.getByLabelText("Description");
    expect(textarea.className).toContain("border-status-danger");
    expect(textarea.className).not.toContain("border-line-base");
  });

  it("disabled: the textarea is disabled and not editable", async () => {
    const user = userEvent.setup();
    render(<Textarea label="Description" isDisabled />);
    const textarea = screen.getByLabelText("Description");
    expect(textarea).toBeDisabled();
    await user.type(textarea, "x");
    expect(textarea).toHaveValue("");
  });
});
