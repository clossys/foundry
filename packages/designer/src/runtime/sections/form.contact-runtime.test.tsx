import type { FormEvent, ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeJson, RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { TextField } from "../../components/TextField.js";
import { formInputs, renderForm } from "./form.js";

const content: Record<string, RuntimeJson> = {
  fields: [
    { id: "contact-email", kind: "email", label: "Email" },
    { id: "contact-message", kind: "textarea", label: "Message" },
  ],
  submit: { label: "Send enquiry" },
  success: { message: "The enquiry was received" },
  error: { message: "The enquiry could not be sent" },
};
function input(overrides: Record<string, RuntimeJson> = {}, sectionHost?: object, contact = true): RuntimeRenderInput<ReactNode> {
  return {
    fill: { leaf: "sections.form", slots: formInputs.slots, members: contact ? ["form.contact"] : [] },
    selection: { leaf: "sections.form", members: contact ? ["form.contact"] : [] },
    content: Object.fromEntries(Object.entries({ ...content, ...overrides }).map(([key, value]) => [key, { value }])),
    ...(sectionHost ? { sectionHost } : {}),
  } as unknown as RuntimeRenderInput<ReactNode>;
}

describe("registered contact form runtime", () => {
  it("refuses a selected contact composition without the consumer submit port", () => {
    const fields = [{ id: "contact-email", kind: "email", label: "Email" }];
    expect(() => renderForm(input({ fields }))).toThrow(/sectionHost.*onSubmit|onSubmit.*sectionHost/);
    expect(() => renderForm(input({ fields }, { onSubmit: "not a function" }))).toThrow(/sectionHost.*onSubmit|onSubmit.*sectionHost/);
  });

  it("submits named native fields through the consumer port and retains values after rejection", async () => {
    const failure = new Error("consumer endpoint refused");
    const onSubmitError = vi.fn();
    const submitted: FormData[] = [];
    const onSubmit = vi.fn(async (event: FormEvent<HTMLFormElement>) => {
      submitted.push(new FormData(event.currentTarget));
      throw failure;
    });
    const { container } = render(<>{renderForm(input({}, {
      onSubmit, onSubmitError,
      honeypot: <TextField label="Leave empty" name="website" />,
      turnstile: <TextField label="Challenge response" name="challenge-response" defaultValue="consumer-token" />,
    }))}</>);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Email" }), "person@example.test");
    await user.type(screen.getByRole("textbox", { name: "Message" }), "A generic enquiry");
    await act(async () => { fireEvent.submit(container.querySelector("form")!); });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(await screen.findByRole("alert")).toHaveTextContent("The enquiry could not be sent");
    expect(onSubmitError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(submitted).toHaveLength(1);
    expect(submitted[0]!.get("contact-email")).toBe("person@example.test");
    expect(submitted[0]!.get("contact-message")).toBe("A generic enquiry");
    expect(submitted[0]!.get("challenge-response")).toBe("consumer-token");
    const values = new FormData(container.querySelector("form")!);
    expect(values.get("contact-email")).toBe("person@example.test");
    expect(values.get("contact-message")).toBe("A generic enquiry");
    expect(values.get("website")).toBe("");
    expect(values.get("challenge-response")).toBe("consumer-token");
  });

  it("shows the supplied success content when the consumer submit resolves", async () => {
    const onSubmit = vi.fn(async () => {});
    const { container } = render(<>{renderForm(input({}, { onSubmit }))}</>);
    await act(async () => { fireEvent.submit(container.querySelector("form")!); });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(await screen.findByRole("status")).toHaveTextContent("The enquiry was received");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders every Writer error-summary item as a focusable summary and field link", async () => {
    render(<>{renderForm(input({
      "error-summary": { heading: "Check these fields", items: [
        { fieldId: "contact-email", message: "Check the email" },
        { fieldId: "contact-message", message: "Check the message" },
      ] },
    }, { onSubmit: async () => {} }))}</>);
    const summary = screen.getByRole("alert");
    expect(summary).toHaveTextContent("Check these fields");
    expect(summary).toHaveAttribute("tabindex", "-1");
    await waitFor(() => expect(summary).toHaveFocus());
    expect(within(summary).getAllByRole("link")).toHaveLength(2);
    expect(within(summary).getByRole("link", { name: "Check the email" })).toHaveAttribute("href", "#contact-email");
    expect(within(summary).getByRole("link", { name: "Check the message" })).toHaveAttribute("href", "#contact-message");
  });

  it("keeps the existing non-contact form available without a submit port", () => {
    const { container } = render(<>{renderForm(input({ fields: [{ id: "name", label: "Name" }] }, undefined, false))}</>);
    expect(screen.getByRole("textbox", { name: "Name" })).toBeInTheDocument();
    expect(container.querySelector("form")).not.toBeNull();
  });
});
