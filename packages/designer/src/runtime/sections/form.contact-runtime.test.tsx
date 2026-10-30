import type { FormEvent, ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeJson, RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { TextField } from "../../components/TextField.js";
import { Checkbox } from "../../components/Checkbox.js";
import { formInputs, renderForm } from "./form.js";
import { bindContactFormSpecimen, contactFormSpecimenContent, contactFormSpecimenIdentity } from "../../studio/contact-form-section-specimen.js";

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
  it("names the missing checkbox error presentation instead of dropping supplied copy", () => {
    expect(() => renderForm(input({ fields: [
      { id: "contact-checkbox", kind: "checkbox", label: "Checkbox field", error: "Checkbox error" },
    ] }, { onSubmit: async () => {} }))).toThrow(/NEED.*checkbox error presentation/);
  });

  it("renders the descriptor-bound contact specimen port and refuses stale or undeclared cases", async () => {
    const descriptorHash = "contact-fixture-descriptor";
    const runtime = input(contactFormSpecimenContent, { onSubmit: async () => {} });
    const boundInput = {
      ...runtime,
      fill: { ...runtime.fill, surface: { descriptorHash } },
      profile: { surfaces: { fills: { "sections.form": { descriptorHash } } } },
    } as unknown as RuntimeRenderInput<ReactNode>;
    const binding = bindContactFormSpecimen(boundInput);
    expect(contactFormSpecimenIdentity.specimenLeaf).toBe("sections.specimen-section-viewports");
    expect(binding.descriptorHash).toBe(descriptorHash);
    const { container } = render(<>{binding.render({ width: 375, state: "default" })}</>);
    expect(container.querySelector("form")).toHaveAttribute("data-ds-leaf", "sections.form");
    expect(screen.getByRole("textbox", { name: "Email field" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message field" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Submit action" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Success message");
    expect(() => binding.render({ width: 375, state: "unknown" })).toThrow(/NEED/);
    expect(() => bindContactFormSpecimen({ ...boundInput, fill: runtime.fill })).toThrow(/NEED/);
    expect(() => bindContactFormSpecimen({ ...boundInput, sectionHost: {} })).toThrow(/NEED/);
  });

  it("preserves registered inline error copy and summary-to-control focus", async () => {
    render(<>{renderForm(input({
      fields: [
        { id: "contact-email", kind: "email", label: "Email", error: "Check the email address" },
        { id: "contact-message", kind: "textarea", label: "Message", error: "Add a message" },
      ],
      "error-summary": { heading: "Check these fields", items: [
        { fieldId: "contact-email", message: "Check the email address" },
        { fieldId: "contact-message", message: "Add a message" },
      ] },
    }, { onSubmit: async () => {} }))}</>);
    const email = screen.getByRole("textbox", { name: "Email" });
    const message = screen.getByRole("textbox", { name: "Message" });
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("Check the email address");
    expect(message).toHaveAttribute("aria-invalid", "true");
    expect(message).toHaveAccessibleDescription("Add a message");
    await userEvent.click(within(screen.getByRole("alert")).getByRole("link", { name: "Add a message" }));
    expect(message).toHaveFocus();
  });

  it("passes the consumer's live consent control inside the named submission", async () => {
    let submitted: FormData | undefined;
    const { container } = render(<>{renderForm(input({}, {
      onSubmit: async (event: FormEvent<HTMLFormElement>) => { submitted = new FormData(event.currentTarget); },
      consent: <Checkbox name="contact-consent" value="accepted">Consent supplied by the host</Checkbox>,
    }))}</>);
    const consent = screen.getByRole("checkbox", { name: "Consent supplied by the host" });
    expect(container.querySelector("form")).toContainElement(consent);
    await userEvent.click(consent);
    await act(async () => { fireEvent.submit(container.querySelector("form")!); });
    expect(submitted?.get("contact-consent")).toBe("accepted");
    expect(await screen.findByRole("status")).toHaveTextContent("The enquiry was received");
  });

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
