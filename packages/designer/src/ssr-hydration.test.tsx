import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./atoms/Button.js";
import { PageHeader } from "./blocks/PageHeader.js";
import { Shell } from "./shell/Shell.js";
import { DEFAULT_STORAGE_KEY, ThemeProvider } from "./theme/ThemeProvider.js";
import { ThemeToggle } from "./theme/ThemeToggle.js";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("SSR and hydration", () => {
  it("renders and hydrates reusable components without a recoverable mismatch", async () => {
    const tree = (
      <Shell>
        <Shell.Header>Shared chrome</Shell.Header>
        <Shell.Main>
          <PageHeader title="Resolved title" actions={<Button>Continue</Button>} />
        </Shell.Main>
      </Shell>
    );
    const serverHtml = renderToString(tree);
    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);
    const onRecoverableError = vi.fn();

    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, tree, { onRecoverableError });
      await Promise.resolve();
    });

    expect(container.querySelector("main")?.id).toBe("ui-shell-main");
    expect(container.querySelector("button")?.textContent).toBe("Continue");
    expect(onRecoverableError).not.toHaveBeenCalled();

    await act(async () => root?.unmount());
    container.remove();
  });

  it("renders and hydrates ThemeProvider + ThemeToggle without a recoverable mismatch", async () => {
    // localStorage genuinely differs between "server" (none) and this
    // client render — the exact case ThemeProvider's own doc comment
    // documents as safe: both the server and React's first client render
    // use `defaultPreference` ("system"), so there is nothing for React to
    // disagree with itself about during hydration.
    window.localStorage.setItem(DEFAULT_STORAGE_KEY, "dark");
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        media: "(prefers-color-scheme: dark)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );

    const tree = (
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );
    const serverHtml = renderToString(tree);
    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);
    const onRecoverableError = vi.fn();

    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, tree, { onRecoverableError });
      await Promise.resolve();
    });

    expect(container.querySelector("button")).toBeInTheDocument();
    expect(onRecoverableError).not.toHaveBeenCalled();

    // The one-tick correction (see ThemeProvider's own doc comment) has
    // now run, so the toggle reflects the stored "dark" preference even
    // though the server render — which has no localStorage — could not
    // have known about it.
    expect(container.querySelector("button")?.getAttribute("aria-label")).toContain("Theme: Dark.");

    await act(async () => root?.unmount());
    container.remove();
  });
});
