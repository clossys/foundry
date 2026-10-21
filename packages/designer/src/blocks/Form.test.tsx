import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TextField } from "../atoms/TextField.js";
import { Form, type FormError } from "./Form.js";

// Every summary heading is consumer copy — `Form` ships none of its own.
const summaryHeading = (count: number) => `${count} problems`;

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

  it("renders no error summary without errorSummaryMessage, even with errors — there is no built-in heading text", () => {
    const one: FormError[] = [{ fieldId: "email", message: "Enter a valid email" }];
    render(
      <Form errors={one}>
        <input id="email" aria-label="Email" />
      </Form>,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Enter a valid email" })).not.toBeInTheDocument();
  });

  it("renders the caller-supplied error-summary heading, called with the entry count", () => {
    const two: FormError[] = [
      { fieldId: "email", message: "Enter a valid email" },
      { fieldId: "name", message: "Enter your name" },
    ];
    render(
      <Form errors={two} errorSummaryMessage={(count) => `${count} problemas`}>
        <input id="email" aria-label="Email" />
        <input id="name" aria-label="Name" />
      </Form>,
    );
    expect(screen.getByRole("heading", { name: "2 problemas" })).toBeInTheDocument();
  });

  it("renders one linked entry per error, each pointing at its field via a real href", () => {
    const errors: FormError[] = [
      { fieldId: "email", message: "Enter a valid email" },
      { fieldId: "name", message: "Enter your name" },
    ];
    render(
      <Form errors={errors} errorSummaryMessage={summaryHeading}>
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
          errorSummaryMessage={summaryHeading}
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
      <Form errors={errors} errorSummaryMessage={summaryHeading}>
        <input id="email" aria-label="Email" />
      </Form>,
    );
    await user.click(screen.getByRole("link", { name: "Enter a valid email" }));
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveFocus();
  });

  it("renders submitError as one alert region above the actions, and nothing when it is omitted", () => {
    const { rerender } = render(
      <Form actions={<button type="submit">Save</button>}>
        <input aria-label="Name" />
      </Form>,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    rerender(
      <Form submitError="Could not reach the server" actions={<button type="submit">Save</button>}>
        <input aria-label="Name" />
      </Form>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Could not reach the server");
    const button = screen.getByRole("button", { name: "Save" });
    expect(alert.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("does not set noValidate or aria-busy without `validation`", () => {
    const { container } = render(
      <Form>
        <input aria-label="Name" />
      </Form>,
    );
    const form = container.querySelector("form") as HTMLFormElement;
    expect(form.noValidate).toBe(false);
    expect(form).not.toHaveAttribute("aria-busy");
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

  it("shows every field error inline at once with one banner", () => {
    const errors: FormError[] = [
      { fieldId: "name", message: "Enter your name" },
      { fieldId: "email", message: "Enter an email address" },
    ];
    render(
      <Form errors={errors} submitError="Try again in a few minutes">
        <TextField id="name" label="Name" isInvalid errorMessage="Enter your name" />
        <TextField id="email" label="Email" isInvalid errorMessage="Enter an email address" />
      </Form>,
    );
    expect(screen.getByText("Enter your name")).toBeInTheDocument();
    expect(screen.getByText("Enter an email address")).toBeInTheDocument();
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("Try again in a few minutes");
    expect(alerts[0]).not.toHaveTextContent("Enter your name");
    expect(alerts[0]).not.toHaveTextContent("Enter an email address");
  });

  it("keeps submitError to one region", () => {
    render(
      <Form
        submitError={
          <>
            <p>We could not send your message.</p>
            <p>Check your connection and try again.</p>
          </>
        }
      >
        <input aria-label="Name" />
      </Form>,
    );
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("We could not send your message.");
    expect(alerts[0]).toHaveTextContent("Check your connection and try again.");
  });
});

describe("Form actions layout", () => {
  const compiled = readFileSync(resolve(import.meta.dirname, "../../styles/compiled.css"), "utf8");
  function compiledRule(name: string) {
    const selector = `.${name} {`;
    const start = compiled.indexOf(selector);
    expect(start, selector).toBeGreaterThan(-1);
    return compiled.slice(start, compiled.indexOf("}", start) + 1);
  }
  const actions = [<button key="cancel" type="button">Cancel</button>, <button key="save" type="submit">Save</button>];

  it("ships the single-column and logical-end CSS rules at the existing tablet breakpoint", () => {
    expect(compiledRule("grid")).toContain("display: grid;");
    expect(compiledRule("grid-cols-1")).toContain("grid-template-columns: repeat(1, minmax(0, 1fr));");
    expect(compiledRule("gap-sm")).toContain("gap: var(--spacing-sm, 8px);");
    expect(compiledRule("tablet\\:flex")).toContain("display: flex;");
    expect(compiledRule("tablet\\:items-center")).toContain("align-items: center;");
    expect(compiledRule("tablet\\:justify-end")).toContain("justify-content: flex-end;");
    const start = compiled.indexOf(".tablet\\:flex {");
    const media = compiled.slice(compiled.lastIndexOf("@media", start), start);
    expect(media).toMatch(/^@media \(width >= 768px\) \{/);
  });

  it("defaults to end and keeps the layout prop off the native form", () => {
    const { container } = render(<Form actions={actions}><input aria-label="Name" /></Form>);
    const region = screen.getByRole("button", { name: "Save" }).parentElement!;
    expect(region).toHaveAttribute("data-actions-layout", "end");
    expect(region).toHaveClass("grid", "grid-cols-1", "gap-sm", "tablet:flex", "tablet:items-center", "tablet:justify-end");
    expect(container.querySelector("form")).not.toHaveAttribute("actionsLayout");
  });

  it.each([
    ["end", "ltr"], ["end", "rtl"], ["stretch", "ltr"], ["stretch", "rtl"],
  ] as const)("keeps %s actions in DOM and keyboard order in %s", async (layout, direction) => {
    const user = userEvent.setup();
    const { container } = render(<Form dir={direction} actionsLayout={layout} actions={actions}><input aria-label="Name" /></Form>);
    const region = screen.getByRole("button", { name: "Save" }).parentElement!;
    expect(region).toHaveAttribute("data-actions-layout", layout);
    expect(region).toHaveClass("grid", "grid-cols-1", "gap-sm");
    expect([...region.children].map(child => child.textContent)).toEqual(["Cancel", "Save"]);
    expect(region.className).not.toMatch(/reverse|order-/);
    expect(container.querySelector("form")).not.toHaveAttribute("actionsLayout");
    expect(container.querySelector("form")).toHaveAttribute("dir", direction);
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
  });

  it("keeps end actions natural width and aligned to the end at and above tablet", () => {
    render(<Form actionsLayout="end" actions={actions}><input aria-label="Name" /></Form>);
    const region = screen.getByRole("button", { name: "Save" }).parentElement!;
    expect(region).toHaveClass("tablet:flex", "tablet:items-center", "tablet:justify-end");
    expect(region.className).not.toMatch(/flex-1|w-full|tablet:grid/);
  });

  it("keeps stretch actions in a full-width single column at every size", () => {
    render(<Form actionsLayout="stretch" actions={actions}><input aria-label="Name" /></Form>);
    const region = screen.getByRole("button", { name: "Save" }).parentElement!;
    expect(region).toHaveClass("grid", "grid-cols-1");
    expect(region.className).not.toMatch(/tablet:|justify-items-(start|end|center)|items-(start|end|center)/);
  });

  it.each([undefined, null, false])("renders no actions wrapper when actions is %s", (value) => {
    const { container } = render(<Form actions={value}><input aria-label="Name" /></Form>);
    expect(container.querySelector("[data-actions-layout]")).toBeNull();
    expect(container.querySelector("form")?.children).toHaveLength(1);
  });

  it.each(["unknown", "split", "", null, 0, false, {}])("refuses invalid untyped actionsLayout %s with a stable TypeError", (value) => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<Form actionsLayout={value as "end"} actions={actions}><input aria-label="Name" /></Form>))
        .toThrow(new TypeError('Form actionsLayout must be "end" or "stretch".'));
    } finally {
      quiet.mockRestore();
    }
  });
});
