// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FRONT_DOOR_COPY_EN } from "@clossys/writer";
import { RenderError } from "../../internal/errors.js";
import { SignInForm } from "./SignInForm.js";
import type { SignInFailure, SignInResult } from "./SignInForm.js";

afterEach(cleanup);

const OK: SignInResult = { status: "ok" };
const NOUNS = { surface: "Acme Console" };
const IDENTIFIER = "ana@example.test";

function defaultText(id: string, nouns: Record<string, string> = {}): string {
  const entry = FRONT_DOOR_COPY_EN.entries.find((candidate) => candidate.id === `front-door.${id}`);
  if (entry === undefined) throw new Error(`no shipped default for ${id}`);
  return entry.text.replace(/\{([^{}]+)\}/g, (_, noun: string) => nouns[noun] ?? `{${noun}}`);
}

interface Handlers {
  identify: ReturnType<typeof vi.fn<(identifier: string) => Promise<SignInResult>>>;
  verify: ReturnType<typeof vi.fn<(secret: string) => Promise<SignInResult>>>;
  onSignedIn: ReturnType<typeof vi.fn<() => void>>;
}

function setup(overrides: Partial<Handlers> = {}) {
  const handlers: Handlers = {
    identify: vi.fn(async (_identifier: string) => OK),
    verify: vi.fn(async (_secret: string) => OK),
    onSignedIn: vi.fn(),
    ...overrides,
  };
  const view = render(<SignInForm {...handlers} nouns={NOUNS} />);
  return { handlers, user: userEvent.setup(), ...view };
}

async function reachPasswordStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(defaultText("sign-in.label")), IDENTIFIER);
  await user.click(screen.getByRole("button", { name: defaultText("sign-in.primary") }));
  await screen.findByLabelText(defaultText("password.label"));
}

const MODULE_SPECIFIER =
  /^\s*(?:import\b[^;]*?|export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*)["']([^"']+)["']/gm;
const ALLOWED_IMPORT = /^(react|@clossys\/designer\/.+|@clossys\/writer|\.{1,2}\/.+)$/;

describe("SignInForm :: steps", () => {
  it("identify ok shows the signed-in-as line; change returns to identify with the value kept; verify ok calls onSignedIn once", async () => {
    const { handlers, user } = setup();

    expect(screen.getByRole("form", { name: defaultText("sign-in.title") })).toBeInTheDocument();
    await user.type(screen.getByLabelText(defaultText("sign-in.label")), IDENTIFIER);
    await user.click(screen.getByRole("button", { name: defaultText("sign-in.primary") }));

    expect(handlers.identify).toHaveBeenCalledExactlyOnceWith(IDENTIFIER);
    expect(await screen.findByText("Signing in as ana@example.test.")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: defaultText("password.title") })).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: defaultText("password.secondary") }));
    expect(screen.getByRole("form", { name: defaultText("sign-in.title") })).toBeInTheDocument();
    expect(screen.getByLabelText(defaultText("sign-in.label"))).toHaveValue(IDENTIFIER);
    expect(handlers.verify).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: defaultText("sign-in.primary") }));
    await user.type(await screen.findByLabelText(defaultText("password.label")), "correct horse");
    await user.click(screen.getByRole("button", { name: defaultText("password.primary") }));

    await waitFor(() => expect(handlers.onSignedIn).toHaveBeenCalledTimes(1));
    expect(handlers.verify).toHaveBeenCalledExactlyOnceWith("correct horse");
  });

  it("keeps the submit pending after a verified sign-in and ignores another submit", async () => {
    const { handlers, user, container } = setup();
    await reachPasswordStep(user);
    await user.type(screen.getByLabelText(defaultText("password.label")), "correct horse");
    await user.click(screen.getByRole("button", { name: defaultText("password.primary") }));
    await waitFor(() => expect(handlers.onSignedIn).toHaveBeenCalledTimes(1));

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await Promise.resolve();
    expect(handlers.verify).toHaveBeenCalledTimes(1);
    expect(handlers.onSignedIn).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: defaultText("password.primary") })).toHaveAttribute("aria-disabled", "true");
  });

  it("renders no heading and no in-card back control", async () => {
    const { user } = setup();
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
    await reachPasswordStep(user);
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /^back$/i })).toBeNull();
  });

  it("resolves copy only through the shipped front-door defaults and throws when it is incomplete", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<SignInForm identify={async () => OK} verify={async () => OK} onSignedIn={() => {}} />)).toThrow(RenderError);
    } finally {
      spy.mockRestore();
    }
  });

  it("imports only react, designer, writer and relative paths", () => {
    const source = readFileSync(join(import.meta.dirname, "SignInForm.tsx"), "utf8");
    const specifiers = [...source.matchAll(MODULE_SPECIFIER)].map((match) => match[1] as string);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) expect(specifier).toMatch(ALLOWED_IMPORT);
    expect(specifiers).toContain("@clossys/writer");
    expect(source).not.toMatch(/\bwindow\b|\bfetch\s*\(|document\.cookie|location\./);
  });
});

describe("SignInForm :: errors and pending", () => {
  const ALERT_FAILURES: ReadonlyArray<[SignInFailure, string]> = [
    ["rateLimited", "rate-limited.notice"],
    ["locked", "locked.notice"],
    ["network", "network.notice"],
    ["unavailable", "unavailable.notice"],
  ];

  it("shows credential inline on the password field and nowhere else", async () => {
    const { user } = setup({ verify: vi.fn(async () => ({ status: "credential" }) as SignInResult) });
    await reachPasswordStep(user);
    const field = screen.getByLabelText(defaultText("password.label"));
    await user.type(field, "wrong");
    await user.click(screen.getByRole("button", { name: defaultText("password.primary") }));

    expect(await screen.findAllByText(defaultText("password.notice"))).toHaveLength(1);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  it.each(ALERT_FAILURES)("shows %s in one alert and not on the field", async (status, id) => {
    const { user } = setup({ verify: vi.fn(async () => ({ status }) as SignInResult) });
    await reachPasswordStep(user);
    const field = screen.getByLabelText(defaultText("password.label"));
    await user.type(field, "secret");
    await user.click(screen.getByRole("button", { name: defaultText("password.primary") }));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(defaultText(id, NOUNS));
    expect(field).not.toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveValue("secret");
  });

  it("shows a throwing handler as unavailable in one alert", async () => {
    const { user } = setup({
      verify: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    await reachPasswordStep(user);
    await user.type(screen.getByLabelText(defaultText("password.label")), "secret");
    await user.click(screen.getByRole("button", { name: defaultText("password.primary") }));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(defaultText("unavailable.notice"));
  });

  it("shows notFound inline on the identifier field and a rate limit in the alert on the identify step", async () => {
    const identify = vi.fn(async (_identifier: string): Promise<SignInResult> => ({ status: "notFound" }));
    const { user } = setup({ identify });
    const field = screen.getByLabelText(defaultText("sign-in.label"));
    await user.type(field, IDENTIFIER);
    await user.click(screen.getByRole("button", { name: defaultText("sign-in.primary") }));

    expect(await screen.findAllByText(defaultText("identifier-not-found.notice"))).toHaveLength(1);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryAllByRole("alert")).toHaveLength(0);

    identify.mockResolvedValueOnce({ status: "rateLimited" });
    await user.click(screen.getByRole("button", { name: defaultText("sign-in.primary") }));
    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(defaultText("rate-limited.notice"));
    expect(screen.queryByText(defaultText("identifier-not-found.notice"))).toBeNull();
  });

  it("clears an inline error when its field changes", async () => {
    const { user } = setup({ verify: vi.fn(async () => ({ status: "credential" }) as SignInResult) });
    await reachPasswordStep(user);
    const field = screen.getByLabelText(defaultText("password.label"));
    await user.type(field, "wrong");
    await user.click(screen.getByRole("button", { name: defaultText("password.primary") }));
    await screen.findByText(defaultText("password.notice"));

    await user.type(field, "x");
    expect(screen.queryByText(defaultText("password.notice"))).toBeNull();
    expect(field).not.toHaveAttribute("aria-invalid", "true");
  });

  it("shows no error on blur", async () => {
    const { handlers, user } = setup();
    const field = screen.getByLabelText(defaultText("sign-in.label"));
    await user.click(field);
    await user.tab();
    expect(screen.queryByText(defaultText("identifier-required.notice"))).toBeNull();
    expect(field).not.toHaveAttribute("aria-invalid", "true");

    await user.type(field, IDENTIFIER);
    await user.click(screen.getByRole("button", { name: defaultText("sign-in.primary") }));
    const password = await screen.findByLabelText(defaultText("password.label"));
    await user.click(password);
    await user.tab();
    expect(screen.queryByText(defaultText("password-required.notice"))).toBeNull();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(handlers.verify).not.toHaveBeenCalled();
  });

  it("shows an empty submit inline on each step and calls no handler", async () => {
    const { handlers, user } = setup();
    await user.click(screen.getByRole("button", { name: defaultText("sign-in.primary") }));
    expect(screen.getAllByText(defaultText("identifier-required.notice"))).toHaveLength(1);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(handlers.identify).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(defaultText("sign-in.label")), IDENTIFIER);
    expect(screen.queryByText(defaultText("identifier-required.notice"))).toBeNull();
    await user.click(screen.getByRole("button", { name: defaultText("sign-in.primary") }));
    await screen.findByLabelText(defaultText("password.label"));

    await user.click(screen.getByRole("button", { name: defaultText("password.primary") }));
    expect(screen.getAllByText(defaultText("password-required.notice"))).toHaveLength(1);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(handlers.verify).not.toHaveBeenCalled();
  });

  it("keeps the submit enabled-but-pending while a call is in flight and ignores a second submit", async () => {
    let finish: (result: SignInResult) => void = () => {};
    const verify = vi.fn(
      () =>
        new Promise<SignInResult>((resolve) => {
          finish = resolve;
        }),
    );
    const { user, container } = setup({ verify });
    await reachPasswordStep(user);
    await user.type(screen.getByLabelText(defaultText("password.label")), "secret");
    const submit = screen.getByRole("button", { name: defaultText("password.primary") });
    await user.click(submit);

    await waitFor(() => expect(submit).toHaveAttribute("aria-disabled", "true"));
    expect(submit).not.toBeDisabled();
    expect(submit).not.toHaveAttribute("disabled");

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await user.click(submit);
    expect(verify).toHaveBeenCalledTimes(1);

    finish({ status: "credential" });
    await screen.findByText(defaultText("password.notice"));
    expect(submit).not.toHaveAttribute("aria-disabled", "true");
  });
});
