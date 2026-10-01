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

// Pass-through, except one id a test names reads as incomplete, so a test can prove an id is resolved on every render.
const incomplete = vi.hoisted(() => ({ id: null as string | null }));
vi.mock("@clossys/writer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clossys/writer")>();
  return {
    ...actual,
    resolveFrontDoorCopy: (...args: Parameters<typeof actual.resolveFrontDoorCopy>) =>
      args[0] === incomplete.id ? { complete: false, issues: [] } : actual.resolveFrontDoorCopy(...args),
  };
});

afterEach(() => {
  incomplete.id = null;
  cleanup();
});

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

interface CodeHandlers {
  verifyCode?: ReturnType<typeof vi.fn<(code: string) => Promise<SignInResult>>>;
  resendCode?: ReturnType<typeof vi.fn<() => Promise<SignInResult>>>;
  unavailable?: boolean;
}

function setup(overrides: Partial<Handlers> & CodeHandlers = {}) {
  const handlers = {
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

const NEEDS_CODE: SignInResult = { status: "needsCode" };

/** Handlers whose `verify` asks for the code step, plus a `verifyCode` and `resendCode` that answer ok. */
function setupCodeStep(overrides: Partial<Handlers> & CodeHandlers = {}) {
  return setup({
    verify: vi.fn(async (_secret: string) => NEEDS_CODE),
    verifyCode: vi.fn(async (_code: string) => OK),
    resendCode: vi.fn(async () => OK),
    ...overrides,
  });
}

async function reachCodeStep(user: ReturnType<typeof userEvent.setup>) {
  await reachPasswordStep(user);
  await user.type(screen.getByLabelText(defaultText("password.label")), "correct horse");
  await user.click(screen.getByRole("button", { name: defaultText("password.primary") }));
  return screen.findByLabelText(defaultText("code.label"));
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

describe("SignInForm :: code step", () => {
  const CODE = "123456";

  it("moves to a focused code step when verify answers needsCode", async () => {
    const { handlers, user } = setupCodeStep();
    const field = await reachCodeStep(user);

    expect(handlers.verify).toHaveBeenCalledExactlyOnceWith("correct horse");
    expect(screen.getByRole("form", { name: defaultText("code.title") })).toBeInTheDocument();
    expect(screen.getByText(defaultText("code.description", { identifier: IDENTIFIER }))).toBeInTheDocument();
    expect(field).toHaveAttribute("autocomplete", "one-time-code");
    expect(field).toHaveValue("");
    await waitFor(() => expect(field).toHaveFocus());
    expect(screen.queryByLabelText(defaultText("password.label"))).toBeNull();
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
    expect(handlers.onSignedIn).not.toHaveBeenCalled();
  });

  it("calls onSignedIn once after verifyCode answers ok and keeps the submit pending", async () => {
    const { handlers, user, container } = setupCodeStep();
    await user.type(await reachCodeStep(user), ` ${CODE} `);
    await user.click(screen.getByRole("button", { name: defaultText("code.primary") }));

    await waitFor(() => expect(handlers.onSignedIn).toHaveBeenCalledTimes(1));
    expect(handlers.verifyCode).toHaveBeenCalledExactlyOnceWith(CODE);
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await Promise.resolve();
    expect(handlers.verifyCode).toHaveBeenCalledTimes(1);
    expect(handlers.onSignedIn).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: defaultText("code.primary") })).toHaveAttribute("aria-disabled", "true");
  });

  it("shows a wrong code inline on the code field with the code notice, and clears it on change", async () => {
    const { user } = setupCodeStep({ verifyCode: vi.fn(async () => ({ status: "credential" }) as SignInResult) });
    const field = await reachCodeStep(user);
    await user.type(field, "000000");
    await user.click(screen.getByRole("button", { name: defaultText("code.primary") }));

    expect(await screen.findAllByText(defaultText("code.notice"))).toHaveLength(1);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryAllByRole("alert")).toHaveLength(0);

    await user.type(field, "1");
    expect(screen.queryByText(defaultText("code.notice"))).toBeNull();
    expect(field).not.toHaveAttribute("aria-invalid", "true");
  });

  it("shows an empty code submit inline and calls no handler", async () => {
    const { handlers, user } = setupCodeStep();
    const field = await reachCodeStep(user);
    await user.click(screen.getByRole("button", { name: defaultText("code.primary") }));

    expect(screen.getAllByText(defaultText("code-required.notice"))).toHaveLength(1);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(handlers.verifyCode).not.toHaveBeenCalled();
  });

  it("reads needsCode as unavailable when no verifyCode is given, and stays on the password step", async () => {
    const { handlers, user } = setup({ verify: vi.fn(async () => NEEDS_CODE) });
    await reachPasswordStep(user);
    await user.type(screen.getByLabelText(defaultText("password.label")), "correct horse");
    await user.click(screen.getByRole("button", { name: defaultText("password.primary") }));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(defaultText("unavailable.notice"));
    expect(screen.getByLabelText(defaultText("password.label"))).toBeInTheDocument();
    expect(screen.queryByLabelText(defaultText("code.label"))).toBeNull();
    expect(handlers.onSignedIn).not.toHaveBeenCalled();
  });

  it("reads needsCode from identify as unavailable and stays on the identifier step", async () => {
    const { handlers, user } = setupCodeStep({ identify: vi.fn(async () => NEEDS_CODE) });
    await user.type(screen.getByLabelText(defaultText("sign-in.label")), IDENTIFIER);
    await user.click(screen.getByRole("button", { name: defaultText("sign-in.primary") }));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(defaultText("unavailable.notice"));
    expect(screen.getByLabelText(defaultText("sign-in.label"))).toHaveValue(IDENTIFIER);
    expect(screen.queryByLabelText(defaultText("password.label"))).toBeNull();
    expect(screen.queryByLabelText(defaultText("code.label"))).toBeNull();
    expect(handlers.verify).not.toHaveBeenCalled();
  });

  it.each<[string, () => Promise<SignInResult>]>([
    ["answers needsCode", async () => NEEDS_CODE],
    [
      "throws",
      async () => {
        throw new Error("boom");
      },
    ],
    ["answers outside the union", async () => ({ status: "expired" }) as unknown as SignInResult],
  ])("reads a verifyCode that %s as unavailable and keeps the code step", async (_label, answer) => {
    const { handlers, user } = setupCodeStep({ verifyCode: vi.fn(answer) });
    const field = await reachCodeStep(user);
    await user.type(field, CODE);
    await user.click(screen.getByRole("button", { name: defaultText("code.primary") }));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(defaultText("unavailable.notice"));
    expect(field).toHaveValue(CODE);
    expect(field).not.toHaveAttribute("aria-invalid", "true");
    expect(handlers.onSignedIn).not.toHaveBeenCalled();
  });

  it("ignores a second submit while verifyCode is in flight and keeps the submit enabled-but-pending", async () => {
    let finish: (result: SignInResult) => void = () => {};
    const verifyCode = vi.fn(
      () =>
        new Promise<SignInResult>((resolve) => {
          finish = resolve;
        }),
    );
    const { handlers, user, container } = setupCodeStep({ verifyCode });
    await user.type(await reachCodeStep(user), CODE);
    const submit = screen.getByRole("button", { name: defaultText("code.primary") });
    await user.click(submit);

    await waitFor(() => expect(submit).toHaveAttribute("aria-disabled", "true"));
    expect(submit).not.toHaveAttribute("disabled");
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await user.click(submit);
    await user.click(screen.getByRole("button", { name: defaultText("code.secondary") }));
    expect(verifyCode).toHaveBeenCalledTimes(1);
    expect(handlers.resendCode).not.toHaveBeenCalled();

    finish({ status: "credential" });
    await screen.findByText(defaultText("code.notice"));
    expect(submit).not.toHaveAttribute("aria-disabled", "true");
  });

  it("shows the resend control only when resendCode is given", async () => {
    const { user } = setupCodeStep({ resendCode: undefined });
    await reachCodeStep(user);
    expect(screen.queryByRole("button", { name: defaultText("code.secondary") })).toBeNull();
    expect(screen.getByRole("button", { name: defaultText("password.secondary") })).toBeInTheDocument();
  });

  it("keeps resend pending while it is in flight, ignores a second press, and clears the code and its error on ok", async () => {
    let finish: (result: SignInResult) => void = () => {};
    const resendCode = vi.fn(
      () =>
        new Promise<SignInResult>((resolve) => {
          finish = resolve;
        }),
    );
    const { handlers, user } = setupCodeStep({ resendCode, verifyCode: vi.fn(async () => ({ status: "credential" }) as SignInResult) });
    const field = await reachCodeStep(user);
    await user.type(field, "000000");
    await user.click(screen.getByRole("button", { name: defaultText("code.primary") }));
    await screen.findByText(defaultText("code.notice"));

    const resend = screen.getByRole("button", { name: defaultText("code.secondary") });
    await user.click(resend);
    await waitFor(() => expect(resend).toHaveAttribute("aria-disabled", "true"));
    expect(resend).not.toHaveAttribute("disabled");
    await user.click(resend);
    await user.click(screen.getByRole("button", { name: defaultText("code.primary") }));
    expect(resendCode).toHaveBeenCalledTimes(1);
    expect(handlers.verifyCode).toHaveBeenCalledTimes(1);

    finish(OK);
    await waitFor(() => expect(resend).not.toHaveAttribute("aria-disabled", "true"));
    expect(field).toHaveValue("");
    expect(screen.queryByText(defaultText("code.notice"))).toBeNull();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(screen.getByRole("form", { name: defaultText("code.title") })).toBeInTheDocument();
  });

  it.each<[string, () => Promise<SignInResult>, string]>([
    ["network", async () => ({ status: "network" }) as SignInResult, "network.notice"],
    ["rateLimited", async () => ({ status: "rateLimited" }) as SignInResult, "rate-limited.notice"],
    [
      "a throw",
      async () => {
        throw new Error("boom");
      },
      "unavailable.notice",
    ],
    ["needsCode", async () => NEEDS_CODE, "unavailable.notice"],
  ])("shows a failed resend (%s) in the one alert and keeps the code step and the typed code", async (_label, answer, id) => {
    const { handlers, user } = setupCodeStep({ resendCode: vi.fn(answer) });
    const field = await reachCodeStep(user);
    await user.type(field, CODE);
    await user.click(screen.getByRole("button", { name: defaultText("code.secondary") }));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(defaultText(id, NOUNS));
    expect(screen.getByRole("form", { name: defaultText("code.title") })).toBeInTheDocument();
    expect(field).toHaveValue(CODE);
    expect(handlers.verifyCode).not.toHaveBeenCalled();
  });

  it("goes back from the code step to the identifier step with the identifier kept and the password and code cleared", async () => {
    const { handlers, user } = setupCodeStep();
    await user.type(await reachCodeStep(user), CODE);
    await user.click(screen.getByRole("button", { name: defaultText("password.secondary") }));

    const identifierField = screen.getByLabelText(defaultText("sign-in.label"));
    expect(screen.getByRole("form", { name: defaultText("sign-in.title") })).toBeInTheDocument();
    expect(identifierField).toHaveValue(IDENTIFIER);
    await waitFor(() => expect(identifierField).toHaveFocus());
    expect(handlers.verifyCode).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: defaultText("sign-in.primary") }));
    expect(await screen.findByLabelText(defaultText("password.label"))).toHaveValue("");
    await user.type(screen.getByLabelText(defaultText("password.label")), "correct horse");
    await user.click(screen.getByRole("button", { name: defaultText("password.primary") }));
    expect(await screen.findByLabelText(defaultText("code.label"))).toHaveValue("");
  });

  it.each([
    "front-door.code.title",
    "front-door.code.label",
    "front-door.code.primary",
    "front-door.code.secondary",
    "front-door.code.notice",
    "front-door.code-required.notice",
  ])("resolves %s on the first render, so an incomplete resolution throws RenderError naming the id", (id) => {
    incomplete.id = id;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<SignInForm identify={async () => OK} verify={async () => OK} onSignedIn={() => {}} nouns={NOUNS} />)).toThrow(
        new RenderError("resolution-failed", `SignInForm could not resolve front-door copy "${id}".`),
      );
    } finally {
      spy.mockRestore();
    }
  });
});

describe("SignInForm :: unavailable", () => {
  it("shows the unavailable notice from the first render, disables submission, keeps the form, and calls nothing", async () => {
    const { handlers, user, container } = setup({ unavailable: true });

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(defaultText("unavailable.notice"));
    expect(screen.getByRole("form", { name: defaultText("sign-in.title") })).toBeInTheDocument();
    const field = screen.getByLabelText(defaultText("sign-in.label"));
    const submit = screen.getByRole("button", { name: defaultText("sign-in.primary") });
    expect(submit).toBeDisabled();

    await user.type(field, IDENTIFIER);
    expect(field).toHaveValue(IDENTIFIER);
    await user.type(field, "{Enter}");
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await Promise.resolve();
    expect(handlers.identify).not.toHaveBeenCalled();
    expect(screen.queryByText(defaultText("identifier-required.notice"))).toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("disables the code step's submit and resend when unavailable turns on mid-flow", async () => {
    const handlers = {
      identify: vi.fn(async (_identifier: string) => OK),
      verify: vi.fn(async (_secret: string) => NEEDS_CODE),
      verifyCode: vi.fn(async (_code: string) => OK),
      resendCode: vi.fn(async () => OK),
      onSignedIn: vi.fn(),
    };
    const user = userEvent.setup();
    const { rerender, container } = render(<SignInForm {...handlers} nouns={NOUNS} />);
    await user.type(await reachCodeStep(user), "123456");
    rerender(<SignInForm {...handlers} nouns={NOUNS} unavailable />);

    expect(screen.getByRole("alert")).toHaveTextContent(defaultText("unavailable.notice"));
    expect(screen.getByRole("button", { name: defaultText("code.primary") })).toBeDisabled();
    expect(screen.getByRole("button", { name: defaultText("code.secondary") })).toBeDisabled();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await Promise.resolve();
    expect(handlers.verifyCode).not.toHaveBeenCalled();
    expect(handlers.resendCode).not.toHaveBeenCalled();
    expect(screen.getByLabelText(defaultText("code.label"))).toHaveValue("123456");
  });
});
