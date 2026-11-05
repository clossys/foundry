import { useState, type FormEvent } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Banner } from "../components/Banner.js";
import { Button } from "../components/Button.js";
import { TextField } from "../components/TextField.js";
import { Form, type FormError } from "./Form.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  // The RED baseline lacks a native-promise catcher. Keep its expected failure
  // an assertion failure, rather than an unrelated unhandled-rejection error.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

describe("contact Form", () => {
  it("focuses a summary containing every invalid field and links each entry to its control", async () => {
    function Contact() {
      const [errors, setErrors] = useState<FormError[]>([]);
      return <Form errors={errors} errorSummaryMessage={count => `${count} fields need attention`}
        actions={<Button type="button" onPress={() => setErrors([
          { fieldId: "contact-name", message: "Add a name" },
          { fieldId: "contact-email", message: "Add an email" },
          { fieldId: "contact-message", message: "Add a message" },
        ])}>Check details</Button>}>
        <TextField id="contact-name" label="Name" />
        <TextField id="contact-email" label="Email" />
        <TextField id="contact-message" label="Message" />
      </Form>;
    }
    render(<Contact />);
    await userEvent.click(screen.getByRole("button", { name: "Check details" }));
    const summary = screen.getByRole("alert");
    expect(summary).toHaveAttribute("tabindex", "-1");
    await waitFor(() => expect(summary).toHaveFocus());
    expect(within(summary).getAllByRole("link")).toHaveLength(3);
    for (const [message, fieldId, label] of [
      ["Add a name", "contact-name", "Name"],
      ["Add an email", "contact-email", "Email"],
      ["Add a message", "contact-message", "Message"],
    ]) {
      const link = within(summary).getByRole("link", { name: message });
      expect(link).toHaveAttribute("href", `#${fieldId}`);
      await userEvent.click(link);
      expect(screen.getByRole("textbox", { name: label })).toHaveFocus();
    }
  });

  it("catches a rejected consumer promise, renders its error banner and retains every entered value", async () => {
    const attempt = deferred();
    const failed = new Error("consumer transport refused");
    const onSubmitError = vi.fn();
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      return attempt.promise;
    });
    const { container } = render(<Form composition="contact" onSubmit={onSubmit} onSubmitError={onSubmitError}
      submitError={<Banner variant="danger">The message could not be sent</Banner>} actions={<Button type="submit">Send message</Button>}>
      <TextField label="Name" name="name" />
      <TextField label="Email" name="email" />
    </Form>);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Example Person");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "person@example.test");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.submit(container.querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(container.querySelector("form")).toHaveAttribute("aria-busy", "true");
    await act(async () => { attempt.reject(failed); await attempt.promise.catch(() => {}); });
    expect(await screen.findByRole("alert")).toHaveTextContent("The message could not be sent");
    expect(onSubmitError).toHaveBeenCalledExactlyOnceWith(failed);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Example Person");
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("person@example.test");
    const values = new FormData(container.querySelector("form")!);
    expect([...values.entries()]).toEqual([["name", "Example Person"], ["email", "person@example.test"]]);
    expect(container.querySelector("form")).not.toHaveAttribute("aria-busy", "true");
  });

  it("shows only the supplied success banner after the consumer promise resolves", async () => {
    const attempt = deferred();
    const { container } = render(<Form composition="contact" onSubmit={event => { event.preventDefault(); return attempt.promise; }}
      submitSuccess={<Banner variant="success">The message was received</Banner>}
      submitError={<Banner variant="danger">The message could not be sent</Banner>}>
      <TextField label="Message" name="message" defaultValue="A generic enquiry" />
    </Form>);
    expect(screen.queryByText("The message was received")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.submit(container.querySelector("form")!);
    await act(async () => { attempt.resolve(); await attempt.promise; });
    expect(await screen.findByRole("status")).toHaveTextContent("The message was received");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("A generic enquiry");
  });

  it("passes consumer-owned honeypot and challenge controls through inside the submitted form", () => {
    const { container } = render(<Form composition="contact" onSubmit={async event => event.preventDefault()}
      honeypot={<TextField label="Leave empty" name="website" defaultValue="" />}
      turnstile={<TextField label="Challenge response" name="challenge-response" defaultValue="consumer-token" />}>
      <TextField label="Email" name="email" defaultValue="person@example.test" />
    </Form>);
    const form = container.querySelector("form")!;
    expect(form).toContainElement(screen.getByRole("textbox", { name: "Leave empty" }));
    expect(form).toContainElement(screen.getByRole("textbox", { name: "Challenge response" }));
    expect(new FormData(form).get("website")).toBe("");
    expect(new FormData(form).get("challenge-response")).toBe("consumer-token");
    expect(form).not.toHaveAttribute("honeypot");
    expect(form).not.toHaveAttribute("turnstile");
  });
});
