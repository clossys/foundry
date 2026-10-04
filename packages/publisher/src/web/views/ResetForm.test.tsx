// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FRONT_DOOR_COPY_EN } from "@clossys/writer";
import { RenderError } from "../../internal/errors.js";
import { ResetForm } from "./ResetForm.js";
import { ResetForm as ServerResetForm } from "./ResetForm.server.js";
import type { ResetDetails, ResetFailure, ResetFormProps, ResetResult } from "./ResetForm.js";

afterEach(cleanup);

const OK: ResetResult = { status: "ok" };
const NOUNS = { surface: "Acme Console" };
const IDENTIFIER = "ana@example.test";

function defaultText(id: string, nouns: Record<string, string> = {}): string {
  const entry = FRONT_DOOR_COPY_EN.entries.find((candidate) => candidate.id === `front-door.${id}`);
  if (entry === undefined) throw new Error(`no shipped default for ${id}`);
  return entry.text.replace(/\{([^{}]+)\}/g, (_, noun: string) => nouns[noun] ?? `{${noun}}`);
}

interface Handlers {
  request: ReturnType<typeof vi.fn<(identifier: string) => Promise<ResetResult>>>;
  reset: ReturnType<typeof vi.fn<(details: ResetDetails) => Promise<ResetResult>>>;
  resendCode?: ReturnType<typeof vi.fn<() => Promise<ResetResult>>>;
  onReset: ReturnType<typeof vi.fn<() => void>>;
}

function setup(overrides: Partial<Handlers> & Partial<Pick<ResetFormProps, "unavailable">> = {}) {
  const handlers: Handlers = {
    request: overrides.request ?? vi.fn(async (_identifier: string) => OK),
    reset: overrides.reset ?? vi.fn(async (_details: ResetDetails) => OK),
    onReset: overrides.onReset ?? vi.fn(),
    ...(overrides.resendCode === undefined ? {} : { resendCode: overrides.resendCode }),
  };
  const view = render(<ResetForm {...handlers} unavailable={overrides.unavailable} nouns={NOUNS} />);
  return { handlers, user: userEvent.setup(), ...view };
}

type User = ReturnType<typeof userEvent.setup>;

const identifierField = () => screen.getByLabelText(defaultText("sign-in.label"));
const codeField = () => screen.getByLabelText(defaultText("code.label"));
const passwordField = () => screen.getByLabelText(defaultText("reset.label"));
const requestButton = () => screen.getByRole("button", { name: defaultText("reset.primary") });
const resetButton = () => screen.getByRole("button", { name: defaultText("reset-code.primary") });

async function reachResetStep(user: User) {
  await user.type(identifierField(), IDENTIFIER);
  await user.click(requestButton());
  await screen.findByLabelText(defaultText("code.label"));
}

async function fillAndReset(user: User, code = "123456", password = "a long new password") {
  await user.type(codeField(), code);
  await user.type(passwordField(), password);
  await user.click(resetButton());
}

const MODULE_SPECIFIER =
  /^\s*(?:import\b[^;]*?|export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*)["']([^"']+)["']/gm;
const ALLOWED_IMPORT = /^(react|@clossys\/designer\/.+|@clossys\/writer|\.{1,2}\/.+)$/;

describe("ResetForm :: steps", () => {
  it("supplies the entered identifier when a legacy custom description declares it", async () => {
    const entry = FRONT_DOOR_COPY_EN.entries.find(candidate => candidate.id === "front-door.code.description")!;
    const saved = { ...entry };
    try {
      entry.text = "Use the verification code for {identifier}.";
      entry.placeholders = ["identifier"];
      const { user } = setup();
      await reachResetStep(user);
      expect(await screen.findByText(`Use the verification code for ${IDENTIFIER}.`)).toBeInTheDocument();
    } finally {
      Object.assign(entry, saved);
      if (!Object.hasOwn(saved, "placeholders")) delete entry.placeholders;
      cleanup();
    }
    expect(entry).toEqual(saved);
  });

  it("request ok shows the code step and focuses the code; reset ok calls onReset once and stays pending", async () => {
    const { handlers, user, container } = setup();

    expect(screen.getByRole("form", { name: defaultText("reset.title") })).toBeInTheDocument();
    expect(identifierField()).toHaveAttribute("autocomplete", "username");
    await user.type(identifierField(), `  ${IDENTIFIER} `);
    await user.click(requestButton());

    expect(handlers.request).toHaveBeenCalledExactlyOnceWith(IDENTIFIER);
    expect(await screen.findByText(defaultText("code.description"))).toBeInTheDocument();
    expect(screen.getByRole("form", { name: defaultText("code.title") })).toBeInTheDocument();
    expect(codeField()).toHaveAttribute("autocomplete", "one-time-code");
    expect(passwordField()).toHaveAttribute("type", "password");
    expect(passwordField()).toHaveAttribute("autocomplete", "new-password");
    await waitFor(() => expect(codeField()).toHaveFocus());
    expect(handlers.reset).not.toHaveBeenCalled();

    await user.type(codeField(), " 123456 ");
    await user.type(passwordField(), " a long new password");
    await user.click(resetButton());

    await waitFor(() => expect(handlers.onReset).toHaveBeenCalledTimes(1));
    expect(handlers.reset).toHaveBeenCalledExactlyOnceWith({ code: "123456", password: " a long new password" });

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await Promise.resolve();
    expect(handlers.reset).toHaveBeenCalledTimes(1);
    expect(handlers.onReset).toHaveBeenCalledTimes(1);
    expect(resetButton()).toHaveAttribute("aria-disabled", "true");
  });

  it("the back control returns to the identifier step with it kept, the code and password cleared, and focus on it", async () => {
    const { handlers, user } = setup();
    await reachResetStep(user);
    await user.type(codeField(), "123456");
    await user.type(passwordField(), "typed");

    await user.click(screen.getByRole("button", { name: defaultText("password.secondary") }));
    expect(screen.getByRole("form", { name: defaultText("reset.title") })).toBeInTheDocument();
    expect(identifierField()).toHaveValue(IDENTIFIER);
    await waitFor(() => expect(identifierField()).toHaveFocus());
    expect(handlers.reset).not.toHaveBeenCalled();

    await user.click(requestButton());
    await screen.findByLabelText(defaultText("code.label"));
    expect(codeField()).toHaveValue("");
    expect(passwordField()).toHaveValue("");
    expect(handlers.request).toHaveBeenCalledTimes(2);
  });

  it("renders no heading, no in-card back control and no sign-in link", async () => {
    const { user } = setup();
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
    expect(screen.queryByText(defaultText("reset.secondary"))).toBeNull();
    await reachResetStep(user);
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /^back$/i })).toBeNull();
    expect(screen.queryByText(defaultText("reset.secondary"))).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("keeps the submit enabled-but-pending while a call is in flight and ignores a second submit", async () => {
    let finish: (result: ResetResult) => void = () => {};
    const reset = vi.fn(
      () =>
        new Promise<ResetResult>((resolve) => {
          finish = resolve;
        }),
    );
    const { user, container } = setup({ reset });
    await reachResetStep(user);
    await fillAndReset(user);

    await waitFor(() => expect(resetButton()).toHaveAttribute("aria-disabled", "true"));
    expect(resetButton()).not.toBeDisabled();
    expect(resetButton()).not.toHaveAttribute("disabled");

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await user.click(resetButton());
    expect(reset).toHaveBeenCalledTimes(1);

    finish({ status: "credential" });
    await screen.findByText(defaultText("code.notice"));
    expect(resetButton()).not.toHaveAttribute("aria-disabled", "true");
  });

  it("keeps the request button pending while request is in flight and ignores a second submit", async () => {
    let finish: (result: ResetResult) => void = () => {};
    const request = vi.fn(
      () =>
        new Promise<ResetResult>((resolve) => {
          finish = resolve;
        }),
    );
    const { user, container } = setup({ request });
    await user.type(identifierField(), IDENTIFIER);
    await user.click(requestButton());
    await waitFor(() => expect(requestButton()).toHaveAttribute("aria-disabled", "true"));
    expect(requestButton()).not.toHaveAttribute("disabled");
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(request).toHaveBeenCalledTimes(1);
    finish(OK);
    await screen.findByLabelText(defaultText("code.label"));
  });
});

describe("ResetForm :: empty and blur", () => {
  it("shows an empty identifier inline, focuses it and calls no handler", async () => {
    const { handlers, user } = setup();
    await user.click(requestButton());
    expect(screen.getAllByText(defaultText("identifier-required.notice"))).toHaveLength(1);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(identifierField()).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(identifierField()).toHaveFocus());
    expect(handlers.request).not.toHaveBeenCalled();

    await user.type(identifierField(), "a");
    expect(screen.queryByText(defaultText("identifier-required.notice"))).toBeNull();
  });

  it("shows an empty submit on the code step inline on each empty field, focuses the first, and calls no handler", async () => {
    const { handlers, user } = setup();
    await reachResetStep(user);
    await user.click(resetButton());

    expect(screen.getAllByText(defaultText("code-required.notice"))).toHaveLength(1);
    expect(screen.getAllByText(defaultText("password-required.notice"))).toHaveLength(1);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    await waitFor(() => expect(codeField()).toHaveFocus());

    await user.type(codeField(), "123456");
    expect(screen.queryByText(defaultText("code-required.notice"))).toBeNull();
    expect(screen.getAllByText(defaultText("password-required.notice"))).toHaveLength(1);
    await user.click(resetButton());
    expect(screen.queryByText(defaultText("code-required.notice"))).toBeNull();
    await waitFor(() => expect(passwordField()).toHaveFocus());
    expect(passwordField()).toHaveAttribute("aria-invalid", "true");
    expect(handlers.reset).not.toHaveBeenCalled();
  });

  it("treats a blank code as empty", async () => {
    const { handlers, user } = setup();
    await reachResetStep(user);
    await fillAndReset(user, "   ", "a long new password");
    expect(await screen.findAllByText(defaultText("code-required.notice"))).toHaveLength(1);
    expect(handlers.reset).not.toHaveBeenCalled();
  });

  it("shows no error on blur on either step", async () => {
    const { handlers, user } = setup();
    await user.click(identifierField());
    await user.tab();
    expect(screen.queryByText(defaultText("identifier-required.notice"))).toBeNull();
    expect(identifierField()).not.toHaveAttribute("aria-invalid", "true");

    await reachResetStep(user);
    for (const field of [codeField(), passwordField()]) {
      await user.click(field);
      await user.tab();
      expect(field).not.toHaveAttribute("aria-invalid", "true");
    }
    expect(screen.queryByText(defaultText("code-required.notice"))).toBeNull();
    expect(screen.queryByText(defaultText("password-required.notice"))).toBeNull();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(handlers.reset).not.toHaveBeenCalled();
  });
});

describe("ResetForm :: failures on the identifier step", () => {
  it("shows notFound inline on the identifier field, and a rate limit in the alert instead of it", async () => {
    const request = vi.fn(async (_identifier: string): Promise<ResetResult> => ({ status: "notFound" }));
    const { user } = setup({ request });
    await user.type(identifierField(), IDENTIFIER);
    await user.click(requestButton());

    expect(await screen.findAllByText(defaultText("identifier-not-found.notice"))).toHaveLength(1);
    expect(identifierField()).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryAllByRole("alert")).toHaveLength(0);

    request.mockResolvedValueOnce({ status: "rateLimited" });
    await user.click(requestButton());
    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(defaultText("rate-limited.notice"));
    expect(screen.queryByText(defaultText("identifier-not-found.notice"))).toBeNull();
  });

  const ALERT_FAILURES: ReadonlyArray<[ResetFailure, string]> = [
    ["rateLimited", "rate-limited.notice"],
    ["locked", "locked.notice"],
    ["network", "network.notice"],
    ["unavailable", "unavailable.notice"],
  ];

  it.each(ALERT_FAILURES)("shows %s from request in one alert, stays on the identifier step and keeps the value", async (status, id) => {
    const { user } = setup({ request: vi.fn(async () => ({ status }) as ResetResult) });
    await user.type(identifierField(), IDENTIFIER);
    await user.click(requestButton());

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(defaultText(id, NOUNS));
    expect(identifierField()).toHaveValue(IDENTIFIER);
    expect(identifierField()).not.toHaveAttribute("aria-invalid", "true");
  });

  it.each([{ status: "credential" }, { status: "weakPassword" }, { status: "constructor" }, undefined])(
    "reads %j from request as unavailable in one alert",
    async (answer) => {
      const { user } = setup({ request: vi.fn(async () => answer as unknown as ResetResult) });
      await user.type(identifierField(), IDENTIFIER);
      await user.click(requestButton());

      const alerts = await screen.findAllByRole("alert");
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toHaveTextContent(defaultText("unavailable.notice"));
      expect(screen.getByRole("form", { name: defaultText("reset.title") })).toBeInTheDocument();
    },
  );

  it("reads a throwing request as unavailable in one alert", async () => {
    const { user } = setup({
      request: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    await user.type(identifierField(), IDENTIFIER);
    await user.click(requestButton());
    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(defaultText("unavailable.notice"));
  });
});

describe("ResetForm :: failures on the code step", () => {
  const ALERT_FAILURES: ReadonlyArray<[ResetFailure, string]> = [
    ["rateLimited", "rate-limited.notice"],
    ["locked", "locked.notice"],
    ["network", "network.notice"],
    ["unavailable", "unavailable.notice"],
  ];

  it("shows credential inline on the code field only, focuses it, and clears it when the code changes", async () => {
    const { user } = setup({ reset: vi.fn(async () => ({ status: "credential" }) as ResetResult) });
    await reachResetStep(user);
    await fillAndReset(user, "000000");

    expect(await screen.findAllByText(defaultText("code.notice"))).toHaveLength(1);
    expect(codeField()).toHaveAttribute("aria-invalid", "true");
    expect(passwordField()).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    await waitFor(() => expect(codeField()).toHaveFocus());

    await user.type(codeField(), "1");
    expect(screen.queryByText(defaultText("code.notice"))).toBeNull();
    expect(codeField()).not.toHaveAttribute("aria-invalid", "true");
  });

  it("shows weakPassword inline on the new password field only, focuses it, and clears it when the password changes", async () => {
    const { user } = setup({ reset: vi.fn(async () => ({ status: "weakPassword" }) as ResetResult) });
    await reachResetStep(user);
    await fillAndReset(user, "123456", "password");

    expect(await screen.findAllByText(defaultText("password-weak.notice"))).toHaveLength(1);
    expect(passwordField()).toHaveAttribute("aria-invalid", "true");
    expect(codeField()).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    await waitFor(() => expect(passwordField()).toHaveFocus());

    await user.type(passwordField(), "x");
    expect(screen.queryByText(defaultText("password-weak.notice"))).toBeNull();
  });

  it.each(ALERT_FAILURES)("shows %s from reset in one alert and not on a field, keeping what was typed", async (status, id) => {
    const { user } = setup({ reset: vi.fn(async () => ({ status }) as ResetResult) });
    await reachResetStep(user);
    await fillAndReset(user, "123456", "a long new password");

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(defaultText(id, NOUNS));
    expect(codeField()).not.toHaveAttribute("aria-invalid", "true");
    expect(passwordField()).not.toHaveAttribute("aria-invalid", "true");
    expect(codeField()).toHaveValue("123456");
    expect(passwordField()).toHaveValue("a long new password");
  });

  it.each([{ status: "notFound" }, { status: "constructor" }, undefined])("reads %j from reset as unavailable in one alert", async (answer) => {
    const { user } = setup({ reset: vi.fn(async () => answer as unknown as ResetResult) });
    await reachResetStep(user);
    await fillAndReset(user);

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(defaultText("unavailable.notice"));
    expect(screen.queryByText(defaultText("identifier-not-found.notice"))).toBeNull();
  });

  it("reads a throwing reset as unavailable in one alert", async () => {
    const { user } = setup({
      reset: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    await reachResetStep(user);
    await fillAndReset(user);
    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(defaultText("unavailable.notice"));
  });
});

describe("ResetForm :: resend", () => {
  it("shows no resend control without resendCode", async () => {
    const { user } = setup();
    await reachResetStep(user);
    expect(screen.queryByRole("button", { name: defaultText("code.secondary") })).toBeNull();
  });

  it("calls resendCode, clears the code and any notice, and focuses the code field", async () => {
    const resendCode = vi.fn(async (): Promise<ResetResult> => OK);
    const reset = vi.fn(async (_details: ResetDetails): Promise<ResetResult> => ({ status: "credential" }));
    const { user } = setup({ resendCode, reset });
    await reachResetStep(user);
    await fillAndReset(user, "000000");
    await screen.findByText(defaultText("code.notice"));

    await user.click(screen.getByRole("button", { name: defaultText("code.secondary") }));
    await waitFor(() => expect(resendCode).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(defaultText("code.notice"))).toBeNull());
    expect(codeField()).toHaveValue("");
    expect(passwordField()).toHaveValue("a long new password");
    await waitFor(() => expect(codeField()).toHaveFocus());
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("shows a resend failure in one alert, and reads an answer that makes no sense for a resend as unavailable", async () => {
    const resendCode = vi.fn(async (): Promise<ResetResult> => ({ status: "rateLimited" }));
    const { user } = setup({ resendCode });
    await reachResetStep(user);
    await user.type(codeField(), "123456");
    await user.click(screen.getByRole("button", { name: defaultText("code.secondary") }));
    let alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(defaultText("rate-limited.notice"));
    expect(codeField()).toHaveValue("123456");

    for (const answer of [{ status: "credential" }, { status: "weakPassword" }, { status: "notFound" }]) {
      resendCode.mockResolvedValueOnce(answer as ResetResult);
      await user.click(screen.getByRole("button", { name: defaultText("code.secondary") }));
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(defaultText("unavailable.notice")));
      alerts = screen.getAllByRole("alert");
      expect(alerts).toHaveLength(1);
      expect(screen.queryByText(defaultText("code.notice"))).toBeNull();
      resendCode.mockResolvedValueOnce({ status: "rateLimited" });
      await user.click(screen.getByRole("button", { name: defaultText("code.secondary") }));
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(defaultText("rate-limited.notice")));
    }
  });

  it("reads a throwing resendCode as unavailable", async () => {
    const resendCode = vi.fn(async (): Promise<ResetResult> => {
      throw new Error("boom");
    });
    const { user } = setup({ resendCode });
    await reachResetStep(user);
    await user.click(screen.getByRole("button", { name: defaultText("code.secondary") }));
    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(defaultText("unavailable.notice"));
  });

  it("shows the resend button pending, never disabled, and ignores a second press and a submit while it is in flight", async () => {
    let finish: (result: ResetResult) => void = () => {};
    const resendCode = vi.fn(
      () =>
        new Promise<ResetResult>((resolve) => {
          finish = resolve;
        }),
    );
    const { handlers, user, container } = setup({ resendCode });
    await reachResetStep(user);
    await user.type(codeField(), "123456");
    await user.type(passwordField(), "a long new password");
    const resend = screen.getByRole("button", { name: defaultText("code.secondary") });
    await user.click(resend);

    await waitFor(() => expect(resend).toHaveAttribute("aria-disabled", "true"));
    expect(resend).not.toHaveAttribute("disabled");
    expect(resetButton()).not.toHaveAttribute("aria-disabled", "true");
    await user.click(resend);
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(resendCode).toHaveBeenCalledTimes(1);
    expect(handlers.reset).not.toHaveBeenCalled();

    finish(OK);
    await waitFor(() => expect(resend).not.toHaveAttribute("aria-disabled", "true"));
  });

  it("does not go back while a call is in flight", async () => {
    let finish: (result: ResetResult) => void = () => {};
    const resendCode = vi.fn(
      () =>
        new Promise<ResetResult>((resolve) => {
          finish = resolve;
        }),
    );
    const { user } = setup({ resendCode });
    await reachResetStep(user);
    await user.click(screen.getByRole("button", { name: defaultText("code.secondary") }));
    await user.click(screen.getByRole("button", { name: defaultText("password.secondary") }));
    expect(screen.getByRole("form", { name: defaultText("code.title") })).toBeInTheDocument();
    finish(OK);
    await waitFor(() => expect(screen.getByRole("button", { name: defaultText("code.secondary") })).not.toHaveAttribute("aria-disabled", "true"));
  });
});

describe("ResetForm :: unavailable", () => {
  it("keeps the form visible but disabled with the unavailable notice from the first render, and calls nothing", async () => {
    const resendCode = vi.fn(async (): Promise<ResetResult> => OK);
    const { handlers, user, container } = setup({ unavailable: true, resendCode });

    expect(screen.getByRole("form", { name: defaultText("reset.title") })).toBeInTheDocument();
    expect(identifierField()).toBeDisabled();
    expect(requestButton()).toBeDisabled();
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(defaultText("unavailable.notice"));

    await user.click(requestButton());
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await Promise.resolve();
    expect(handlers.request).not.toHaveBeenCalled();
    expect(handlers.reset).not.toHaveBeenCalled();
    expect(resendCode).not.toHaveBeenCalled();
    expect(screen.queryByText(defaultText("identifier-required.notice"))).toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("disables the code step too when it becomes unavailable, and calls no handler", async () => {
    const resendCode = vi.fn(async (): Promise<ResetResult> => OK);
    const handlers = { request: vi.fn(async () => OK), reset: vi.fn(async () => OK), resendCode, onReset: vi.fn() };
    const user = userEvent.setup();
    const { rerender, container } = render(<ResetForm {...handlers} nouns={NOUNS} />);
    await reachResetStep(user);
    await user.type(codeField(), "123456");
    await user.type(passwordField(), "a long new password");

    rerender(<ResetForm {...handlers} nouns={NOUNS} unavailable />);
    expect(codeField()).toBeDisabled();
    expect(passwordField()).toBeDisabled();
    expect(resetButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: defaultText("code.secondary") })).toBeDisabled();
    expect(screen.getByRole("button", { name: defaultText("password.secondary") })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(defaultText("unavailable.notice"));

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await Promise.resolve();
    expect(handlers.reset).not.toHaveBeenCalled();
    expect(resendCode).not.toHaveBeenCalled();
  });

  it("is not unavailable by default: fields and button are enabled and no alert shows", () => {
    setup();
    expect(identifierField()).toBeEnabled();
    expect(requestButton()).toBeEnabled();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });
});

describe("ResetForm :: copy and source", () => {
  it("resolves copy only through the shipped front-door defaults and throws when it is incomplete", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<ResetForm request={async () => OK} reset={async () => OK} onReset={() => {}} />)).toThrow(RenderError);
      let thrown: unknown;
      try {
        render(<ResetForm request={async () => OK} reset={async () => OK} onReset={() => {}} nouns={{ surface: "" }} />);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(RenderError);
      expect((thrown as RenderError).reason).toBe("resolution-failed");
      expect((thrown as RenderError).message).toContain("front-door.network.notice");
      expect((thrown as RenderError).message).not.toContain("surface");
    } finally {
      spy.mockRestore();
    }
  });

  it("imports only react, designer, writer and relative paths, and reads no browser global", () => {
    for (const file of ["ResetForm.tsx", "internal/createResetForm.tsx", "frontDoorFormSupport.ts"]) {
      const source = readFileSync(join(import.meta.dirname, file), "utf8");
      const specifiers = [...source.matchAll(MODULE_SPECIFIER)].map((match) => match[1] as string);
      expect(specifiers.length).toBeGreaterThan(0);
      for (const specifier of specifiers) expect(specifier).toMatch(ALLOWED_IMPORT);
      expect(source).not.toMatch(/\bwindow\b|\bfetch\s*\(|document\.cookie|location\./);
    }
  });

  it("has a react-server stub that throws a wrong-channel RenderError", () => {
    try {
      ServerResetForm({ request: async () => OK, reset: async () => OK, onReset: () => {} });
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("wrong-channel");
    }
  });
});
