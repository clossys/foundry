// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FRONT_DOOR_COPY_EN } from "@clossys/writer";
import { RenderError } from "../../internal/errors.js";
import { ActivateForm } from "./ActivateForm.js";
import { ActivateForm as ServerActivateForm } from "./ActivateForm.server.js";
import type { ActivateDetails, ActivateFailure, ActivateFormProps, ActivateResult } from "./ActivateForm.js";

afterEach(cleanup);

const OK: ActivateResult = { status: "ok" };
const NOUNS = { surface: "Acme Console" };

function defaultText(id: string, nouns: Record<string, string> = {}): string {
  const entry = FRONT_DOOR_COPY_EN.entries.find((candidate) => candidate.id === `front-door.${id}`);
  if (entry === undefined) throw new Error(`no shipped default for ${id}`);
  return entry.text.replace(/\{([^{}]+)\}/g, (_, noun: string) => nouns[noun] ?? `{${noun}}`);
}

interface Handlers {
  activate: ReturnType<typeof vi.fn<(details: ActivateDetails) => Promise<ActivateResult>>>;
  onActivated: ReturnType<typeof vi.fn<() => void>>;
}

function setup(overrides: Partial<Handlers> & Partial<Pick<ActivateFormProps, "collectName" | "unavailable">> = {}) {
  const handlers: Handlers = {
    activate: overrides.activate ?? vi.fn(async (_details: ActivateDetails) => OK),
    onActivated: overrides.onActivated ?? vi.fn(),
  };
  const view = render(<ActivateForm {...handlers} collectName={overrides.collectName} unavailable={overrides.unavailable} nouns={NOUNS} />);
  return { handlers, user: userEvent.setup(), ...view };
}

const passwordField = () => screen.getByLabelText(defaultText("activation.label"));
const submitButton = () => screen.getByRole("button", { name: defaultText("activation.primary") });

const MODULE_SPECIFIER =
  /^\s*(?:import\b[^;]*?|export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*)["']([^"']+)["']/gm;
const ALLOWED_IMPORT = /^(react|@clossys\/designer\/.+|@clossys\/writer|\.{1,2}\/.+)$/;

describe("ActivateForm :: submit", () => {
  it("calls activate with the password only, once, then onActivated once, and the button stays pending", async () => {
    const { handlers, user, container } = setup();

    expect(screen.getByRole("form", { name: defaultText("activation.title") })).toBeInTheDocument();
    expect(handlers.activate).not.toHaveBeenCalled();
    await user.type(passwordField(), "correct horse battery");
    await user.click(submitButton());

    await waitFor(() => expect(handlers.onActivated).toHaveBeenCalledTimes(1));
    expect(handlers.activate).toHaveBeenCalledExactlyOnceWith({ password: "correct horse battery" });
    expect(Object.keys(handlers.activate.mock.calls[0]![0])).toEqual(["password"]);

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await Promise.resolve();
    expect(handlers.activate).toHaveBeenCalledTimes(1);
    expect(handlers.onActivated).toHaveBeenCalledTimes(1);
    expect(submitButton()).toHaveAttribute("aria-disabled", "true");
  });

  it("asks for a password once, with no confirmation field, no identifier field and no name fields by default", () => {
    setup();
    expect(screen.getAllByLabelText(/password/i)).toHaveLength(1);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(passwordField()).toHaveAttribute("type", "password");
    expect(passwordField()).toHaveAttribute("autocomplete", "new-password");
  });

  it("with collectName asks for both names and passes them trimmed; the password is passed exactly as typed", async () => {
    const { handlers, user } = setup({ collectName: true });
    await user.type(screen.getByLabelText(defaultText("activation-first-name.label")), "  Ana ");
    await user.type(screen.getByLabelText(defaultText("activation-last-name.label")), " Diaz  ");
    await user.type(passwordField(), " spaced pass ");
    await user.click(submitButton());

    await waitFor(() => expect(handlers.onActivated).toHaveBeenCalledTimes(1));
    expect(handlers.activate).toHaveBeenCalledExactlyOnceWith({ password: " spaced pass ", firstName: "Ana", lastName: "Diaz" });
    expect(screen.getByLabelText(defaultText("activation-first-name.label"))).toHaveAttribute("autocomplete", "given-name");
    expect(screen.getByLabelText(defaultText("activation-last-name.label"))).toHaveAttribute("autocomplete", "family-name");
  });

  it("renders no heading and no in-card back control", () => {
    setup({ collectName: true });
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("keeps the submit enabled-but-pending while a call is in flight and ignores a second submit", async () => {
    let finish: (result: ActivateResult) => void = () => {};
    const activate = vi.fn(
      () =>
        new Promise<ActivateResult>((resolve) => {
          finish = resolve;
        }),
    );
    const { user, container } = setup({ activate });
    await user.type(passwordField(), "secret words");
    await user.click(submitButton());

    await waitFor(() => expect(submitButton()).toHaveAttribute("aria-disabled", "true"));
    expect(submitButton()).not.toBeDisabled();
    expect(submitButton()).not.toHaveAttribute("disabled");

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await user.click(submitButton());
    expect(activate).toHaveBeenCalledTimes(1);

    finish({ status: "weakPassword" });
    await screen.findByText(defaultText("password-weak.notice"));
    expect(submitButton()).not.toHaveAttribute("aria-disabled", "true");
  });
});

describe("ActivateForm :: empty and blur", () => {
  it("shows an empty password inline, focuses it, and calls no handler", async () => {
    const { handlers, user } = setup();
    await user.click(submitButton());

    expect(screen.getAllByText(defaultText("password-required.notice"))).toHaveLength(1);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(passwordField()).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(passwordField()).toHaveFocus());
    expect(handlers.activate).not.toHaveBeenCalled();

    await user.type(passwordField(), "x");
    expect(screen.queryByText(defaultText("password-required.notice"))).toBeNull();
    expect(passwordField()).not.toHaveAttribute("aria-invalid", "true");
  });

  it("with collectName shows the name notice once, on the first empty name field, and focuses it", async () => {
    const { handlers, user } = setup({ collectName: true });
    const first = screen.getByLabelText(defaultText("activation-first-name.label"));
    const last = screen.getByLabelText(defaultText("activation-last-name.label"));
    await user.click(submitButton());

    expect(screen.getAllByText(defaultText("name-required.notice"))).toHaveLength(1);
    expect(screen.getAllByText(defaultText("password-required.notice"))).toHaveLength(1);
    expect(first).toHaveAttribute("aria-invalid", "true");
    expect(last).not.toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(first).toHaveFocus());

    await user.type(first, "Ana");
    expect(screen.queryByText(defaultText("name-required.notice"))).toBeNull();
    await user.type(passwordField(), "long enough words");
    await user.click(submitButton());
    expect(screen.getAllByText(defaultText("name-required.notice"))).toHaveLength(1);
    expect(last).toHaveAttribute("aria-invalid", "true");
    expect(first).not.toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(last).toHaveFocus());
    expect(handlers.activate).not.toHaveBeenCalled();
  });

  it("treats a blank name as empty", async () => {
    const { handlers, user } = setup({ collectName: true });
    await user.type(screen.getByLabelText(defaultText("activation-first-name.label")), "   ");
    await user.type(screen.getByLabelText(defaultText("activation-last-name.label")), "Diaz");
    await user.type(passwordField(), "long enough words");
    await user.click(submitButton());
    expect(await screen.findAllByText(defaultText("name-required.notice"))).toHaveLength(1);
    expect(handlers.activate).not.toHaveBeenCalled();
  });

  it("does not ask for names when collectName is not set, even though they are empty", async () => {
    const { handlers, user } = setup();
    await user.type(passwordField(), "long enough words");
    await user.click(submitButton());
    await waitFor(() => expect(handlers.activate).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(defaultText("name-required.notice"))).toBeNull();
  });

  it("shows no error on blur", async () => {
    const { handlers, user } = setup({ collectName: true });
    for (const label of ["activation-first-name.label", "activation-last-name.label", "activation.label"]) {
      const field = screen.getByLabelText(defaultText(label));
      await user.click(field);
      await user.tab();
      expect(field).not.toHaveAttribute("aria-invalid", "true");
    }
    expect(screen.queryByText(defaultText("name-required.notice"))).toBeNull();
    expect(screen.queryByText(defaultText("password-required.notice"))).toBeNull();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(handlers.activate).not.toHaveBeenCalled();
  });
});

describe("ActivateForm :: failures", () => {
  const ALERT_FAILURES: ReadonlyArray<[ActivateFailure, string]> = [
    ["expired", "activation.notice"],
    ["rateLimited", "rate-limited.notice"],
    ["network", "network.notice"],
    ["unavailable", "unavailable.notice"],
  ];

  it("shows weakPassword inline on the password field, focuses it, and shows no alert", async () => {
    const { user } = setup({ activate: vi.fn(async () => ({ status: "weakPassword" }) as ActivateResult) });
    await user.type(passwordField(), "password");
    await user.click(submitButton());

    expect(await screen.findAllByText(defaultText("password-weak.notice"))).toHaveLength(1);
    expect(passwordField()).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    await waitFor(() => expect(passwordField()).toHaveFocus());

    await user.type(passwordField(), "x");
    expect(screen.queryByText(defaultText("password-weak.notice"))).toBeNull();
    expect(passwordField()).not.toHaveAttribute("aria-invalid", "true");
  });

  it.each(ALERT_FAILURES)("shows %s in one alert and not on the field, keeping what was typed", async (status, id) => {
    const { user } = setup({ activate: vi.fn(async () => ({ status }) as ActivateResult) });
    await user.type(passwordField(), "secret words");
    await user.click(submitButton());

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(defaultText(id, NOUNS));
    expect(passwordField()).not.toHaveAttribute("aria-invalid", "true");
    expect(passwordField()).toHaveValue("secret words");
    expect(screen.queryByText(defaultText("password-weak.notice"))).toBeNull();
  });

  it("clears the alert on the next submit and shows the new answer once", async () => {
    const activate = vi.fn(async (_details: ActivateDetails): Promise<ActivateResult> => ({ status: "rateLimited" }));
    const { user } = setup({ activate });
    await user.type(passwordField(), "secret words");
    await user.click(submitButton());
    expect(await screen.findAllByRole("alert")).toHaveLength(1);

    activate.mockResolvedValueOnce({ status: "network" });
    await user.click(submitButton());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(defaultText("network.notice", NOUNS)));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("reads a throwing handler, an undefined answer and a status outside the union as unavailable in one alert", async () => {
    const activate = vi.fn(async (_details: ActivateDetails): Promise<ActivateResult> => {
      throw new Error("boom");
    });
    const { user } = setup({ activate });
    await user.type(passwordField(), "secret words");
    await user.click(submitButton());
    expect(await screen.findAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(defaultText("unavailable.notice"));

    for (const answer of [undefined, { status: "locked" }, { status: "constructor" }, { status: "credential" }]) {
      activate.mockResolvedValueOnce(answer as unknown as ActivateResult);
      await user.click(submitButton());
      await waitFor(() => expect(activate.mock.calls.length).toBeGreaterThan(1));
      await waitFor(() => expect(submitButton()).not.toHaveAttribute("aria-disabled", "true"));
      const alerts = screen.getAllByRole("alert");
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toHaveTextContent(defaultText("unavailable.notice"));
    }
  });
});

describe("ActivateForm :: unavailable", () => {
  it("keeps the form visible but disabled with the unavailable notice from the first render, and calls nothing", async () => {
    const { handlers, user, container } = setup({ collectName: true, unavailable: true });

    expect(screen.getByRole("form", { name: defaultText("activation.title") })).toBeInTheDocument();
    expect(screen.getByLabelText(defaultText("activation-first-name.label"))).toBeDisabled();
    expect(screen.getByLabelText(defaultText("activation-last-name.label"))).toBeDisabled();
    expect(passwordField()).toBeDisabled();
    expect(submitButton()).toBeDisabled();
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(defaultText("unavailable.notice"));

    await user.click(submitButton());
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await Promise.resolve();
    expect(handlers.activate).not.toHaveBeenCalled();
    expect(handlers.onActivated).not.toHaveBeenCalled();
    expect(screen.queryByText(defaultText("password-required.notice"))).toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("is not unavailable by default: fields and button are enabled and no alert shows", () => {
    setup({ collectName: true });
    expect(passwordField()).toBeEnabled();
    expect(submitButton()).toBeEnabled();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  it("enables the form again when unavailable is turned off", () => {
    const handlers = { activate: vi.fn(async () => OK), onActivated: vi.fn() };
    const { rerender } = render(<ActivateForm {...handlers} nouns={NOUNS} unavailable />);
    expect(passwordField()).toBeDisabled();
    rerender(<ActivateForm {...handlers} nouns={NOUNS} unavailable={false} />);
    expect(passwordField()).toBeEnabled();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });
});

describe("ActivateForm :: copy and source", () => {
  it("resolves copy only through the shipped front-door defaults and throws when it is incomplete", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<ActivateForm activate={async () => OK} onActivated={() => {}} />)).toThrow(RenderError);
      let thrown: unknown;
      try {
        render(<ActivateForm activate={async () => OK} onActivated={() => {}} nouns={{ surface: "   " }} />);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(RenderError);
      expect((thrown as RenderError).reason).toBe("resolution-failed");
      expect((thrown as RenderError).message).toContain("front-door.network.notice");
    } finally {
      spy.mockRestore();
    }
  });

  it("imports only react, designer, writer and relative paths, and reads no browser global", () => {
    for (const file of ["ActivateForm.tsx", "frontDoorFormSupport.ts"]) {
      const source = readFileSync(join(import.meta.dirname, file), "utf8");
      const specifiers = [...source.matchAll(MODULE_SPECIFIER)].map((match) => match[1] as string);
      expect(specifiers.length).toBeGreaterThan(0);
      for (const specifier of specifiers) expect(specifier).toMatch(ALLOWED_IMPORT);
      expect(source).not.toMatch(/\bwindow\b|\bfetch\s*\(|document\.cookie|location\./);
    }
  });

  it("has a react-server stub that throws a wrong-channel RenderError", () => {
    try {
      ServerActivateForm({ activate: async () => OK, onActivated: () => {} });
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("wrong-channel");
    }
  });
});
