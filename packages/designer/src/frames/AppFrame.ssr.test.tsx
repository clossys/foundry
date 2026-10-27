// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { APP_FRAME_WIDE_QUERY } from "./app-frame-layout.js";
import { AppFrame } from "./AppFrame.js";
import type { AppFrameProps } from "./app-frame-types.js";

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); document.documentElement.removeAttribute("data-theme"); });

it.each([true, false])("hydrates with stable IDs before correcting viewport and saved theme (wide=%s)", async wide => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: wide ? 1280 : 375 });
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: media === APP_FRAME_WIDE_QUERY ? wide : media === "all", media, addEventListener() {}, removeEventListener() {} }));
  localStorage.setItem("hydration-theme", "dark");
  const props: AppFrameProps = {
    brand: { markSrc: "/mark.svg", wordmark: "Atlas", label: "Atlas" },
    account: { signedOutLabel: "Signed out", sections: [{ id: "access", entries: [{ id: "login", kind: "link", label: "Sign in", href: "#login" }] }] },
    navigation: { tree: [{ id: "home", label: "Home", href: "#home" }], activeId: "home" },
    commands: { heading: "Commands", triggerLabel: "Find commands", searchLabel: "Search commands", closeLabel: "Close commands", emptyMessage: "No commands", groups: [] },
    rightPanel: { children: <p>Details</p>, label: "Details", handleLabel: "Resize details", min: 200, max: 500, defaultValue: 300 },
    theme: { storageKey: "hydration-theme", defaultPreference: "system" }, children: <p>Route content</p>,
    toasts: <section aria-label="Host notifications"><p role="status">Saved</p></section>,
  };
  const tree = <AppFrame {...props} />;
  const host = document.createElement("div"); host.innerHTML = renderToString(tree); document.body.append(host);
  const mainId = host.querySelector("main")!.id;
  expect(host.querySelector('a[href^="#"]')).toHaveAttribute("href", "#" + mainId);
  // The theme control is three explicit radios since 0d04b4c23 (sidebar spec D3); the server renders the default.
  expect(within(host).getByRole("radio", { name: "System" })).toBeChecked();
  const recoverable = vi.fn();
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => { root = hydrateRoot(host, tree, { onRecoverableError: recoverable }); });
    expect(recoverable).not.toHaveBeenCalled();
    expect(host.querySelector("main")).toHaveAttribute("id", mainId);
    // The default navigation brand mark (0e370345e) is an <img>, so React's server render hoists a preload
    // <link> ahead of the frame root; address the root by its stamp, not as the host's first child.
    expect(within(host).getByRole("region", { name: "Host notifications" })).toBe(host.querySelector("[data-application-frame]")!.lastElementChild);
    expect(within(within(host).getByRole("region", { name: "Host notifications" })).getByRole("status")).toHaveTextContent("Saved");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    if (!wide) await userEvent.click(within(host).getByRole("button", { name: "Open navigation" }));
    expect((wide ? within(host) : within(document.body)).getByRole("radio", { name: "Dark" })).toBeChecked();
    if (!wide) await userEvent.keyboard("{Escape}");
    if (!wide) expect(within(host).getByRole("button", { name: "Open navigation" })).toBeInTheDocument();
    const user = userEvent.setup(); await user.click(within(host).getByRole("link", { name: "Skip to content" }));
    expect(within(host).getByRole("main")).toHaveFocus();
  } finally { await act(async () => root?.unmount()); host.remove(); }
});
