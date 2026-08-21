import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Form, type FormError } from "./Form.js";

describe("Form", () => {
  it("renders the heading, fields, and actions regions", () => {
    render(
      <Form heading="Contact details" actions={<button type="submit">Save</button>}>
        <input aria-label="Name" />
      </Form>,
    );
    expect(screen.getByRole("heading", { name: "Contact details" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("renders no heading region when heading is omitted", () => {
    render(
      <Form>
        <input aria-label="Name" />
      </Form>,
    );
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("renders a native <form>, passing onSubmit straight through", async () => {
    const onSubmit = vi.fn((e) => e.preventDefault());
    const user = userEvent.setup();
    render(
      <Form onSubmit={onSubmit} actions={<button type="submit">Save</button>}>
        <input aria-label="Name" />
      </Form>,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("renders no error-summary region when errors is empty or omitted", () => {
    render(
      <Form>
        <input aria-label="Name" />
      </Form>,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    render(
      <Form errors={[]}>
        <input aria-label="Name" />
      </Form>,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders one linked entry per error, each pointing at its field via a real href", () => {
    const errors: FormError[] = [
      { fieldId: "email", message: "Enter a valid email" },
      { fieldId: "name", message: "Enter your name" },
    ];
    render(
      <Form errors={errors}>
        <input id="email" aria-label="Email" />
        <input id="name" aria-label="Name" />
      </Form>,
    );
    const summary = screen.getByRole("alert");
    const emailLink = screen.getByRole("link", { name: "Enter a valid email" });
    const nameLink = screen.getByRole("link", { name: "Enter your name" });
    expect(summary).toContainElement(emailLink);
    expect(summary).toContainElement(nameLink);
    expect(emailLink).toHaveAttribute("href", "#email");
    expect(nameLink).toHaveAttribute("href", "#name");
  });

  it("moves focus to the error summary when a new, non-empty errors array is passed (a submit failure)", async () => {
    function Harness() {
      const [errors, setErrors] = useState<FormError[]>([]);
      return (
        <Form
          errors={errors}
          actions={
            <button
              type="button"
              onClick={() => setErrors([{ fieldId: "email", message: "Enter a valid email" }])}
            >
              Submit
            </button>
          }
        >
          <input id="email" aria-label="Email" />
        </Form>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Submit" }));
    const summary = await screen.findByRole("alert");
    await waitFor(() => expect(summary).toHaveFocus());
  });

  it("does not steal focus on mount when errors starts empty", () => {
    render(
      <Form>
        <input id="email" aria-label="Email" />
      </Form>,
    );
    expect(screen.getByRole("textbox", { name: "Email" })).not.toHaveFocus();
  });

  it("moves focus to the field itself when its error-summary entry is activated", async () => {
    const errors: FormError[] = [{ fieldId: "email", message: "Enter a valid email" }];
    const user = userEvent.setup();
    render(
      <Form errors={errors}>
        <input id="email" aria-label="Email" />
      </Form>,
    );
    await user.click(screen.getByRole("link", { name: "Enter a valid email" }));
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveFocus();
  });

  it("forwards className onto the <form>, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(
      <Form className="gap-2xl">
        <input aria-label="Name" />
      </Form>,
    );
    const form = container.querySelector("form") as HTMLFormElement;
    expect(form.className).toContain("gap-2xl");
    expect(form.className).not.toContain("gap-lg");
  });

  it("forwards a consumer style prop onto the <form>", () => {
    const { container } = render(
      <Form style={{ marginTop: "8px" }}>
        <input aria-label="Name" />
      </Form>,
    );
    const form = container.querySelector("form") as HTMLFormElement;
    expect(form.style.marginTop).toBe("8px");
  });
});
