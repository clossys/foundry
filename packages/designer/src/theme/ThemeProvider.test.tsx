import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_STORAGE_KEY, ThemeProvider, useTheme } from "./ThemeProvider.js";

interface MatchMediaMock {
  setMatches: (matches: boolean) => void;
  removeEventListenerSpy: ReturnType<typeof vi.fn>;
}

function installMatchMediaMock(initialMatches: boolean): MatchMediaMock {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  let matches = initialMatches;
  const removeEventListenerSpy = vi.fn((_: string, cb: (event: { matches: boolean }) => void) => {
    listeners.delete(cb);
  });
  const mql = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn((_: string, cb: (event: { matches: boolean }) => void) => {
      listeners.add(cb);
    }),
    removeEventListener: removeEventListenerSpy,
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue(mql),
  );
  return {
    setMatches(next: boolean) {
      matches = next;
      for (const cb of listeners) cb({ matches: next });
    },
    removeEventListenerSpy,
  };
}

function Probe() {
  const { preference, resolvedTheme, setPreference } = useTheme();
  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button onClick={() => setPreference("dark")}>dark</button>
      <button onClick={() => setPreference("light")}>light</button>
      <button onClick={() => setPreference("system")}>system</button>
    </div>
  );
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

describe("useTheme outside a provider", () => {
  it("throws a clear error instead of returning a fabricated default", () => {
    const Bare = () => {
      useTheme();
      return null;
    };
    expect(() => render(<Bare />)).toThrow(/ThemeProvider/);
  });
});

describe("ThemeProvider", () => {
  it("renders its children", () => {
    render(
      <ThemeProvider>
        <p>content</p>
      </ThemeProvider>,
    );
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("starts at the default preference (\"system\") and corrects from storage after mount", async () => {
    window.localStorage.setItem(DEFAULT_STORAGE_KEY, "dark");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("preference")).toHaveTextContent("dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("falls back to \"system\" for a malformed stored value", async () => {
    window.localStorage.setItem(DEFAULT_STORAGE_KEY, "midnight");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("preference")).toHaveTextContent("system"));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light dark");
  });

  it("stamps data-theme, sets color-scheme, and persists on setPreference", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("button", { name: "dark" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(window.localStorage.getItem(DEFAULT_STORAGE_KEY)).toBe("dark");
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
  });

  it("removes data-theme and sets color-scheme to \"light dark\" for \"system\"", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("button", { name: "dark" }));
    await user.click(screen.getByRole("button", { name: "system" }));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light dark");
  });

  it("resolves \"system\" against the live OS signal, and updates when the OS changes", async () => {
    const mock = installMatchMediaMock(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("resolved")).toHaveTextContent("light"));

    act(() => mock.setMatches(true));
    await waitFor(() => expect(screen.getByTestId("resolved")).toHaveTextContent("dark"));
  });

  it("does not change resolvedTheme when the OS flips under an explicit preference", async () => {
    const mock = installMatchMediaMock(false);
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("button", { name: "light" }));
    act(() => mock.setMatches(true));
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
  });

  it("removes its media-query listener on unmount", () => {
    const mock = installMatchMediaMock(false);
    const { unmount } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    unmount();
    expect(mock.removeEventListenerSpy).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("uses a consumer-supplied storageKey instead of the default", async () => {
    window.localStorage.setItem("consumer-theme", "dark");
    render(
      <ThemeProvider storageKey="consumer-theme">
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("preference")).toHaveTextContent("dark"));
    expect(window.localStorage.getItem(DEFAULT_STORAGE_KEY)).toBeNull();
  });

  it("never throws when storage itself throws, and falls back to system", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(() =>
      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      ),
    ).not.toThrow();
    await waitFor(() => expect(screen.getByTestId("preference")).toHaveTextContent("system"));
  });
});
