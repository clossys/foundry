// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeJson, RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";
import { signInFormInputs, signInFormRenderer as entry } from "./sign-in-form.js";

afterEach(cleanup);
const sample = () => entry.sample(specimenDataset);
function input(content = sample(), sectionHost?: object): RuntimeRenderInput<ReactNode> {
  return {
    fill: { leaf: entry.leaf, slots: signInFormInputs.slots, members: [] },
    selection: { leaf: entry.leaf, members: [] },
    content: Object.fromEntries(Object.entries(content).map(([key, value]) => [key, { value }])),
    ...(sectionHost ? { sectionHost } : {}),
  } as unknown as RuntimeRenderInput<ReactNode>;
}
function host(overrides: Record<string, unknown> = {}) {
  return { phase: "credentials", values: { identifier: "", password: "", code: "" }, pending: false,
    onValueChange: vi.fn(), onSubmit: vi.fn(), onProvider: vi.fn(), onBack: vi.fn(), onResend: vi.fn(), ...overrides };
}

describe("private sign-in Section", () => {
  it("renders labelled credentials and SSO with a disabled hostless specimen and no account-creation flows", () => {
    const { container } = render(<>{entry.render(input())}</>);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Email or username" })).toBeDisabled();
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("button", { name: "Continue with work SSO" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
    expect(screen.queryByText(/sign up|invite|reset|forgot|create account/i)).toBeNull();
    expect(container.querySelectorAll('[data-ds-leaf="sections.sign-in-form"]').length).toBeGreaterThan(0);
    expect(container.querySelector("a")).toBeNull();
  });

  it("delegates controlled edits, credential submission and provider actions without advancing the phase", async () => {
    const callbacks = host();
    function Controlled() {
      const [values, setValues] = useState({ identifier: "", password: "", code: "" });
      return <>{entry.render(input(sample(), { ...callbacks, values, onValueChange: (key: string, value: string) => {
        callbacks.onValueChange(key, value); setValues(current => ({ ...current, [key]: value }));
      } }))}</>;
    }
    render(<Controlled />);
    await userEvent.type(screen.getByRole("textbox", { name: "Email or username" }), "owner");
    await userEvent.type(screen.getByLabelText("Password"), "example-password");
    expect(screen.getByLabelText("Password")).toHaveValue("example-password");
    expect(callbacks.onValueChange).toHaveBeenLastCalledWith("password", "example-password");
    await userEvent.click(screen.getByRole("button", { name: "Continue with work SSO" }));
    expect(callbacks.onProvider).toHaveBeenCalledExactlyOnceWith("work-sso");
    expect(callbacks.onSubmit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(callbacks.onSubmit).toHaveBeenCalledExactlyOnceWith("credentials");
    expect(screen.queryByLabelText("Verification code")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows only code verification controls when the host selects that phase", async () => {
    const callbacks = host({ phase: "code", values: { identifier: "owner", password: "", code: "123" } });
    render(<>{entry.render(input(sample(), callbacks))}</>);
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue with work SSO" })).toBeNull();
    const code = screen.getByRole("textbox", { name: "Verification code" });
    expect(code).toHaveValue("123");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(code).toHaveAccessibleDescription("Enter the code from your sign-in method.");
    fireEvent.change(code, { target: { value: "1234" } });
    expect(callbacks.onValueChange).toHaveBeenCalledWith("code", "1234");
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await userEvent.click(screen.getByRole("button", { name: "Resend code" }));
    expect(callbacks.onBack).toHaveBeenCalledOnce();
    expect(callbacks.onResend).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Verify code" }));
    expect(callbacks.onSubmit).toHaveBeenCalledExactlyOnceWith("code");
    expect(code).toBeInTheDocument();
  });

  it("renders host-authored errors and blocks duplicate actions while pending", async () => {
    const callbacks = host({ pending: true });
    const content = { ...sample(), error: { message: "Unable to continue.", identifier: "Check your identifier." } };
    render(<>{entry.render(input(content, callbacks))}</>);
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to continue.");
    expect(screen.getByRole("textbox", { name: "Email or username" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("textbox", { name: "Email or username" })).toHaveAccessibleDescription("Check your identifier.");
    expect(screen.getByRole("textbox", { name: "Email or username" })).toHaveAttribute("readonly");
    expect(screen.getByRole("form", { name: "Sign in" })).toHaveAttribute("aria-busy", "true");
    await userEvent.click(screen.getByRole("button", { name: "Please wait" }));
    fireEvent.submit(screen.getByRole("form", { name: "Sign in" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Email or username" }), { target: { value: "changed" } });
    expect(callbacks.onSubmit).not.toHaveBeenCalled();
    expect(callbacks.onValueChange).not.toHaveBeenCalled();
  });

  it("refuses unmapped content, unsupported fields, duplicate providers and partial host ports", () => {
    expect(() => entry.render(input({ ...sample(), signup: "Create account" }))).toThrow(/signup/);
    expect(() => entry.render(input({ ...sample(), credentials: { identifierLabel: "Email", passwordLabel: "Password", extra: "Ignored?" } }))).toThrow(/extra/);
    expect(() => entry.render(input({ ...sample(), actions: { submit: "Sign in" } }))).toThrow(/verify/);
    expect(() => entry.render(input({ ...sample(), providers: [{ id: "same", label: "First" }, { id: "same", label: "Second" }] }))).toThrow(/unique/);
    expect(() => entry.render(input(sample(), { phase: "credentials" }))).toThrow(/sectionHost/);
    expect(() => entry.render(input(sample(), host({ phase: "complete" })))).toThrow(/sectionHost/);
    expect(() => entry.render(input(sample(), host({ phase: "code", onResend: undefined })))).toThrow(/sectionHost/);
    const missing: Record<string, RuntimeJson> = { ...sample() }; delete missing.verification;
    expect(() => entry.render(input(missing))).toThrow(/verification/);
  });
});
