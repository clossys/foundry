// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppFrame } from "./AppFrame.js";
import type { AppFrameProps } from "./app-frame-types.js";

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); document.documentElement.removeAttribute("data-theme"); });

it.each([true, false])("hydrates with stable IDs before correcting viewport and saved theme (wide=%s)", async wide => {
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: media === "(min-width: 768px)" ? wide : true, media, addEventListener() {}, removeEventListener() {} }));
  localStorage.setItem("hydration-theme", "dark");
  const props: AppFrameProps = {
    brand: { markSrc: "/mark.svg", wordmark: "Atlas", label: "Atlas" },
    account: { signedOutLabel: "Signed out", sections: [{ id: "access", entries: [{ id: "login", kind: "link", label: "Sign in", href: "#login" }] }] },
    navigation: { tree: [{ id: "home", label: "Home", href: "#home" }], activeId: "home" },
    commands: { heading: "Commands", triggerLabel: "Find commands", searchLabel: "Search commands", closeLabel: "Close commands", emptyMessage: "No commands", groups: [] },
    rightPanel: { children: <p>Details</p>, label: "Details", handleLabel: "Resize details", min: 200, max: 500, defaultValue: 300 },
    theme: { storageKey: "hydration-theme", defaultPreference: "system" }, children: <p>Route content</p>,
  };
  const tree = <AppFrame {...props} />;
  const host = document.createElement("div"); host.innerHTML = renderToString(tree); document.body.append(host);
  const mainId = host.querySelector("main")!.id;
  expect(host.querySelector('a[href^="#"]')).toHaveAttribute("href", "#" + mainId);
  expect(within(host).getByRole("button", { name: /Theme: System/ })).toBeInTheDocument();
  const recoverable = vi.fn();
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => { root = hydrateRoot(host, tree, { onRecoverableError: recoverable }); });
    expect(recoverable).not.toHaveBeenCalled();
    expect(host.querySelector("main")).toHaveAttribute("id", mainId);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(within(host).getByRole("button", { name: /Theme: Dark/ })).toBeInTheDocument();
    if (!wide) expect(within(host).getByRole("button", { name: "Open navigation" })).toBeInTheDocument();
    const user = userEvent.setup(); await user.click(within(host).getByRole("link", { name: "Skip to content" }));
    expect(within(host).getByRole("main")).toHaveFocus();
  } finally { await act(async () => root?.unmount()); host.remove(); }
});
