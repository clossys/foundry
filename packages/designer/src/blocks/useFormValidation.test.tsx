import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "../atoms/Button.js";
import { TextField } from "../atoms/TextField.js";
import { Form, type FormError } from "./Form.js";
import { useFormValidation, type FormValidation } from "./useFormValidation.js";

/**
 * The invariant `useFormValidation` exists to hold (the "Form validation
 * pattern" issue), stated once here and then proven case by case below:
 *
 *   1. Before the first submit, typing in a field that shows no error
 *      never shows one — the user is not scolded mid-word. Leaving the
 *      field (blur) is what validates it.
 *   2. A field that already shows an error re-validates on every change,
 *      so the error clears the moment the value becomes valid (and changes
 *      text if the value is still invalid for a different reason).
 *   3. After the first submit, every change re-validates immediately.
 *   4. Submit validates every field. On failure it never calls `onSubmit`
 *      and moves focus to the FIRST invalid field in DOM order (not the
 *      order validators were declared in). On success it calls `onSubmit`
 *      exactly once, and a second submit while that one is pending is
 *      ignored.
 *   5. While pending, the submit button is never `disabled` — it keeps
 *      focus and gets react-aria-components' pending state instead.
 *   6. Every string a user can see comes from the consumer; the error
 *      summary renders only when the consumer supplies its heading.
 *
 * Every field here is a real designer atom (`TextField`, `Button`) or a
 * plain native `<input>`, so the ARIA wiring asserted is the wiring a
 * consumer actually gets, not a mock's.
 */

type Values = { name: string; email: string; code: string };

const INITIAL: Values = { name: "", email: "", code: "" };

// Deliberately declared in the REVERSE of DOM order (DOM order is name,
// email, code), so a test that sees the first DOM field focused proves the
// hook sorted by document position rather than by object-key order.
const VALIDATORS = {
  code: (value: string) => (/^\d{4}$/.test(value) ? undefined : "Enter a four-digit code"),
  email: (value: string) => (value.includes("@") ? undefined : "Enter a valid email"),
  name: (value: string) => {
    if (value === "") return "Enter your name";
    if (value.length < 3) return "Name is too short";
    return undefined;
  },
};

interface HarnessProps {
  onSubmit?: (values: Values) => void | Promise<void>;
  errorSummaryMessage?: (count: number) => ReactNode;
  submitError?: ReactNode;
  formOnSubmit?: () => void;
  capture?: (validation: FormValidation<Values>) => void;
}

function Harness({ onSubmit = () => {}, errorSummaryMessage, submitError, formOnSubmit, capture }: HarnessProps) {
  const v = useFormValidation<Values>({ initialValues: INITIAL, validators: VALIDATORS, onSubmit });
  capture?.(v);
  return (
    <Form
      validation={v}
      errorSummaryMessage={errorSummaryMessage}
      submitError={submitError}
      onSubmit={formOnSubmit}
      actions={
        <>
          <Button {...v.getSubmitButtonProps()}>Send</Button>
          <Button type="button" onPress={v.reset}>
            Start over
          </Button>
        </>
      }
    >
      <TextField label="Name" {...v.getFieldProps("name")} />
      <TextField label="Email" {...v.getFieldProps("email")} />
      <label htmlFor={v.fieldId("code")}>Code</label>
      <input {...v.getNativeInputProps("code")} />
      {v.errors.code ? <p id={v.errorId("code")}>{v.errors.code}</p> : null}
    </Form>
  );
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function describedByText(input: HTMLElement): string {
  const ids = (input.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
}

describe("useFormValidation — timing before the first submit", () => {
  it("shows no error while typing into an untouched field", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const email = screen.getByLabelText("Email");
    await user.type(email, "not-an-email");
    expect(email).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Enter a valid email")).not.toBeInTheDocument();
  });

  it("validates on blur: a designer TextField gets aria-invalid and aria-describedby pointing at the error text", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const email = screen.getByLabelText("Email");
    await user.type(email, "nope");
    await user.tab();
    expect(email).toHaveAttribute("aria-invalid", "true");
    const error = screen.getByText("Enter a valid email");
    expect(email.getAttribute("aria-describedby")?.split(/\s+/)).toContain(error.id);
  });

  it("validates on blur: a native <input> gets aria-invalid and aria-describedby = errorId, and only while invalid", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const code = screen.getByLabelText("Code");
    expect(code).not.toHaveAttribute("aria-invalid");
    expect(code).not.toHaveAttribute("aria-describedby");

    await user.type(code, "12");
    await user.tab();
    expect(code).toHaveAttribute("aria-invalid", "true");
    expect(describedByText(code)).toBe("Enter a four-digit code");

    await user.type(code, "34");
    expect(code).not.toHaveAttribute("aria-invalid");
    expect(code).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText("Enter a four-digit code")).not.toBeInTheDocument();
  });

  it("re-validates a field that shows an error on every change: the message updates, then clears once valid", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const name = screen.getByLabelText("Name");
    await user.click(name);
    await user.tab();
    expect(screen.getByText("Enter your name")).toBeInTheDocument();

    await user.type(name, "A");
    expect(screen.queryByText("Enter your name")).not.toBeInTheDocument();
    expect(describedByText(name)).toContain("Name is too short");

    await user.type(name, "da");
    expect(name).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Name is too short")).not.toBeInTheDocument();
  });

  it("does not re-show an error while typing into a touched field that currently shows none", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const email = screen.getByLabelText("Email");
    await user.type(email, "a@b");
    await user.tab();
    expect(email).not.toHaveAttribute("aria-invalid");

    await user.clear(email);
    await user.type(email, "x");
    expect(email).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Enter a valid email")).not.toBeInTheDocument();
  });
});

describe("useFormValidation — submit", () => {
  it("with errors: does not call onSubmit, marks every field invalid, and focuses the first invalid field in DOM order", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Code")).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
  });

  it("focuses by DOM order, not validator order, when only later fields are invalid", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText("Name"), "Ada");
    await user.click(screen.getByRole("button", { name: "Send" }));
    // Validators list `code` before `email`; the DOM has email first.
    await waitFor(() => expect(screen.getByLabelText("Email")).toHaveFocus());
  });

  it("after the first submit, a change re-validates immediately — an error appears without a blur", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const name = screen.getByLabelText("Name");
    await user.type(name, "Ada");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(name).not.toHaveAttribute("aria-invalid");

    await user.clear(name);
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(describedByText(name)).toContain("Enter your name");
  });

  it("valid: calls onSubmit exactly once with the current values", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText("Name"), "Ada");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Code"), "1234");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ name: "Ada", email: "ada@example.com", code: "1234" });
  });

  it("pending: the submit button is never disabled, gets the pending state, and the form is aria-busy", async () => {
    const pending = deferred();
    const onSubmit = vi.fn(() => pending.promise);
    const user = userEvent.setup();
    const { container } = render(<Harness onSubmit={onSubmit} />);
    const form = container.querySelector("form") as HTMLFormElement;
    await user.type(screen.getByLabelText("Name"), "Ada");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Code"), "1234");
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).not.toHaveAttribute("disabled");
    expect(send).not.toHaveAttribute("data-pending");

    await user.click(send);
    expect(send).toHaveAttribute("data-pending", "true");
    expect(send).not.toHaveAttribute("disabled");
    expect(send).not.toBeDisabled();
    expect(form).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(send).not.toHaveAttribute("data-pending");
    expect(send).not.toHaveAttribute("disabled");
    expect(form).not.toHaveAttribute("aria-busy");
  });

  it("ignores a second submit while the first is pending — no double submit", async () => {
    const pending = deferred();
    const onSubmit = vi.fn(() => pending.promise);
    const user = userEvent.setup();
    const { container } = render(<Harness onSubmit={onSubmit} />);
    const form = container.querySelector("form") as HTMLFormElement;
    await user.type(screen.getByLabelText("Name"), "Ada");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Code"), "1234");

    // Two submits in the same tick, before React re-renders: only a
    // ref-backed guard (not `isSubmitting` state) can catch the second.
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("sets noValidate on the <form>, so native constraint bubbles never pre-empt the pattern", () => {
    const { container } = render(<Harness />);
    expect((container.querySelector("form") as HTMLFormElement).noValidate).toBe(true);
  });

  it("with `validation`, the hook owns submit: Form's own onSubmit prop is not called", async () => {
    const formOnSubmit = vi.fn();
    const user = userEvent.setup();
    render(<Harness formOnSubmit={formOnSubmit} />);
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(formOnSubmit).not.toHaveBeenCalled();
  });

  it("reset() restores the initial values and clears every error", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText("Name"), "A");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");

    await user.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("aria-invalid");
    // Back to pre-submit timing: typing alone shows nothing again.
    await user.type(screen.getByLabelText("Email"), "x");
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
  });
});

describe("useFormValidation with Form's error summary", () => {
  it("renders no summary by default, even when a submit fails", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the summary when errorSummaryMessage is supplied, linking each entry to its field in DOM order", async () => {
    const user = userEvent.setup();
    render(<Harness errorSummaryMessage={(count) => `${count} problems`} />);
    await user.click(screen.getByRole("button", { name: "Send" }));
    const summary = screen.getByRole("alert");
    expect(summary).toContainElement(screen.getByRole("heading", { name: "3 problems" }));
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Enter your name",
      "Enter a valid email",
      "Enter a four-digit code",
    ]);
    expect(links[0]).toHaveAttribute("href", `#${screen.getByLabelText("Name").id}`);
    expect(links[2]).toHaveAttribute("href", `#${screen.getByLabelText("Code").id}`);
  });

  it("does not steal focus from the first invalid field — focus stays on the field, not the summary", async () => {
    const user = userEvent.setup();
    render(<Harness errorSummaryMessage={(count) => `${count} problems`} />);
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
    expect(screen.getByRole("alert")).not.toHaveFocus();
  });

  it("keeps summaryErrors' identity stable while typing; it changes only when a submit fails", async () => {
    const seen: (readonly FormError[])[] = [];
    const user = userEvent.setup();
    render(<Harness capture={(v) => seen.push(v.summaryErrors)} />);
    await user.click(screen.getByRole("button", { name: "Send" }));
    const afterSubmit = seen[seen.length - 1];
    expect(afterSubmit).toHaveLength(3);

    await user.type(screen.getByLabelText("Name"), "Ada");
    expect(seen[seen.length - 1]).toBe(afterSubmit);

    await user.click(screen.getByRole("button", { name: "Send" }));
    const second = seen[seen.length - 1]!;
    expect(second).not.toBe(afterSubmit);
    expect(second.map((error) => error.message)).toEqual(["Enter a valid email", "Enter a four-digit code"]);
  });

  it("renders submitError as its own alert region", () => {
    render(<Harness submitError="The message could not be sent" />);
    expect(screen.getByRole("alert")).toHaveTextContent("The message could not be sent");
  });
});

describe("useFormValidation — ids and field props", () => {
  it("gives each field a stable id that its control carries, and a distinct error id", () => {
    let captured: FormValidation<Values> | undefined;
    const { rerender } = render(<Harness capture={(v) => (captured = v)} />);
    const first = captured!;
    expect(screen.getByLabelText("Email").id).toBe(first.fieldId("email"));
    expect(screen.getByLabelText("Code").id).toBe(first.fieldId("code"));
    expect(first.errorId("code")).not.toBe(first.fieldId("code"));
    rerender(<Harness capture={(v) => (captured = v)} />);
    expect(captured!.fieldId("email")).toBe(first.fieldId("email"));
  });

  it("honors idPrefix", () => {
    function Prefixed() {
      const v = useFormValidation({
        initialValues: { email: "" },
        validators: {},
        onSubmit: () => {},
        idPrefix: "signup",
      });
      return <TextField label="Email" {...v.getFieldProps("email")} />;
    }
    render(<Prefixed />);
    expect(screen.getByLabelText("Email").id).toBe("signup-email");
  });

  it("works without Form: handleSubmit on a plain <form> with formRef attached", async () => {
    const onSubmit = vi.fn();
    function Plain() {
      const v = useFormValidation({
        initialValues: { a: "", b: "" },
        validators: { b: (value: string) => (value ? undefined : "B"), a: (value: string) => (value ? undefined : "A") },
        onSubmit,
      });
      return (
        <form ref={v.formRef} onSubmit={v.handleSubmit} noValidate>
          <label htmlFor={v.fieldId("a")}>A</label>
          <input {...v.getNativeInputProps("a")} />
          <label htmlFor={v.fieldId("b")}>B</label>
          <input {...v.getNativeInputProps("b")} />
          <button type="submit">Go</button>
        </form>
      );
    }
    const user = userEvent.setup();
    render(<Plain />);
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText("A")).toHaveFocus());
  });
});
