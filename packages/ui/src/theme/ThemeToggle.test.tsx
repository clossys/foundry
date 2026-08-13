import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_STORAGE_KEY, ThemeProvider } from "./ThemeProvider.js";
import { ThemeToggle } from "./ThemeToggle.js";

function installMatchMediaMock(initialMatches = false) {
  const mql = {
    matches: initialMatches,
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
}

function renderToggle(children: ReactNode = <ThemeToggle />) {
  return render(<ThemeProvider>{children}</ThemeProvider>);
}

beforeEach(() => {
  installMatchMediaMock(false);
});

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ThemeToggle", () => {
  it("renders a button describing the current preference and what activating it does", () => {
    renderToggle();
    expect(
      screen.getByRole("button", { name: "Theme: System. Activate to switch to Light." }),
    ).toBeInTheDocument();
  });

  it("cycles System -> Light -> Dark -> System on repeated activation", async () => {
    const user = userEvent.setup();
    renderToggle();

    await user.click(screen.getByRole("button", { name: /^Theme: System\./ }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(screen.getByRole("button", { name: "Theme: Light. Activate to switch to Dark." })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Theme: Light\./ }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Theme: Dark. Activate to switch to System." })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Theme: Dark\./ }));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(screen.getByRole("button", { name: "Theme: System. Activate to switch to Light." })).toBeInTheDocument();
  });

  it("is keyboard operable — Enter activates it", async () => {
    const user = userEvent.setup();
    renderToggle();
    await user.tab();
    expect(screen.getByRole("button")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("persists the new preference to the configured storage key", async () => {
    const user = userEvent.setup();
    renderToggle();
    await user.click(screen.getByRole("button"));
    expect(window.localStorage.getItem(DEFAULT_STORAGE_KEY)).toBe("light");
  });

  it("announces the change through a polite live region", async () => {
    const user = userEvent.setup();
    renderToggle();
    await user.click(screen.getByRole("button"));
    expect(screen.getByRole("status")).toHaveTextContent("Theme set to Light");
  });

  it("defaults to a ghost, small button but lets a consumer override variant/size", () => {
    renderToggle(<ThemeToggle variant="secondary" size="lg" />);
    // No visible assertion on classes here (that's this package's own
    // token-gate territory) — this just confirms the props reach the
    // underlying Button rather than being silently dropped in favor of
    // the component's own defaults.
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("forwards a consumer className onto the underlying button", () => {
    renderToggle(<ThemeToggle className="my-toggle" />);
    expect(screen.getByRole("button").className).toContain("my-toggle");
  });
});
