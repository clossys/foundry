// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createHash } from "node:crypto";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppFrame } from "./AppFrame.js";
import type { AppFrameProps } from "./app-frame-types.js";

function fixture(): AppFrameProps {
  return {
    brand: { markSrc: "/mark.svg", wordmark: "Example", label: "Example home", href: "#home" },
    navigation: { tree: [{ id: "home", label: "Home", href: "#home" }], activeId: "home", label: "Workspace navigation" },
    account: { signedOutLabel: "Account", sections: [] },
    commands: { heading: "Commands", triggerLabel: "Find commands", searchLabel: "Search commands", closeLabel: "Close commands", emptyMessage: "No commands", groups: [] },
    mainId: "example-content", children: <button>Canvas action</button>,
  };
}

let wide = true;
beforeEach(() => {
  wide = true;
  localStorage.clear();
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: media === "(min-width: 56.25rem)" ? wide : media === "all", media, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("data-theme"); });

it("preserves exact default server markup and the scrolling padded contained stage", () => {
  const html = renderToString(<AppFrame {...fixture()} />);
  expect(createHash("sha256").update(html).digest("hex")).toBe("02b0aea7760330137fc4e4431bb6400267732147e8eb7ef6482364f5e3863718");
  const view = render(<AppFrame {...fixture()} />);
  const frame = view.container.querySelector("[data-application-frame]")!;
  const stage = view.container.querySelector<HTMLElement>('[data-application-frame-region="stage"]')!;
  expect(frame).toHaveClass("h-dvh");
  expect(screen.getByRole("main")).toHaveClass("p-md");
  expect(stage.style.overflowY).toBe("auto");
  expect(stage.style.maxInlineSize).not.toBe("none");
});

it("places arbitrary header content inside the one PageBar before route content without replacing brand or controls", async () => {
  render(<AppFrame {...fixture()} headerContent={<><span>Workspace status</span><button>Header action</button></>} />);
  const banner = screen.getByRole("banner");
  expect(screen.getAllByRole("banner")).toHaveLength(1);
  expect(within(banner).getByText("Workspace status")).toBeInTheDocument();
  expect(within(banner).getByRole("link", { name: "Example home" })).toBeInTheDocument();
  const headerAction = within(banner).getByRole("button", { name: "Header action" });
  headerAction.focus();
  await userEvent.tab();
  expect(screen.getByRole("button", { name: "Use full width" })).toHaveFocus();
  await userEvent.tab();
  expect(screen.getByRole("button", { name: "Canvas action" })).toHaveFocus();
  await userEvent.click(screen.getByRole("link", { name: "Skip to content" }));
  expect(screen.getByRole("main")).toHaveFocus();
});

it("exposes the measured PageBar height to descendants and updates it on resize", () => {
  let height = 72;
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    return this.matches('[data-application-frame-region="bar"]') ? { ...original.call(this), height, width: 800 } : original.call(this);
  });
  const view = render(<AppFrame {...fixture()} headerContent={<span>Header</span>} />);
  const frame = view.container.querySelector<HTMLElement>("[data-application-frame]")!;
  expect(frame.style.getPropertyValue("--app-frame-header-height")).toBe("72px");
  act(() => { height = 108; window.dispatchEvent(new Event("resize")); });
  expect(frame.style.getPropertyValue("--app-frame-header-height")).toBe("108px");
});

it("hydrates immersive header content with a stable skip target before measuring the header", async () => {
  wide = false;
  const tree = <AppFrame {...fixture()} contentLayout="immersive" headerContent={<button>Header action</button>} />;
  const host = document.createElement("div");
  host.innerHTML = renderToString(tree);
  document.body.append(host);
  expect(host.querySelector<HTMLElement>("[data-application-frame]")!.style.getPropertyValue("--app-frame-header-height")).toBe("");
  const recoverable = vi.fn();
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => { root = hydrateRoot(host, tree, { onRecoverableError: recoverable }); });
    expect(recoverable).not.toHaveBeenCalled();
    expect(within(host).getByRole("banner")).toContainElement(within(host).getByRole("button", { name: "Header action" }));
    await userEvent.click(within(host).getByRole("link", { name: "Skip to content" }));
    expect(within(host).getByRole("main")).toHaveFocus();
    expect(within(host).getByRole("main")).toHaveAttribute("id", "example-content");
  } finally { await act(async () => root?.unmount()); host.remove(); }
});

it("retains the in-memory stage width when switching between standard and immersive", async () => {
  const view = render(<AppFrame {...fixture()} />);
  await userEvent.click(screen.getByRole("button", { name: "Use full width" }));
  view.rerender(<AppFrame {...fixture()} contentLayout="immersive" />);
  expect(view.container.querySelector('[data-application-frame-region="stage"]')).toHaveAttribute("data-stage-width", "full");
  view.rerender(<AppFrame {...fixture()} contentLayout="standard" />);
  expect(view.container.querySelector('[data-application-frame-region="stage"]')).toHaveAttribute("data-stage-width", "full");
  expect(screen.getByRole("main")).toHaveClass("p-md");
  expect(screen.getByRole("button", { name: "Use contained width" })).toBeInTheDocument();
});

it.each([
  [true, "ltr", "light"], [true, "rtl", "dark"], [false, "ltr", "dark"], [false, "rtl", "light"],
] as const)("provides a full container canvas under overlay chrome (wide=%s, dir=%s, theme=%s)", async (matches, dir, preference) => {
  wide = matches;
  const view = render(<div style={{ width: 640, height: 480 }}><AppFrame {...fixture()} contentLayout="immersive" dir={dir}
    headerContent={<button>Header action</button>} theme={{ defaultPreference: preference }}
    rightPanel={{ children: <button>Panel action</button>, label: "Details", handleLabel: "Resize details", min: 200, max: 400, defaultValue: 240 }} /></div>);
  const frame = view.container.querySelector<HTMLElement>("[data-application-frame]")!;
  const stage = view.container.querySelector<HTMLElement>('[data-application-frame-region="stage"]')!;
  const navigation = view.container.querySelector<HTMLElement>('[data-application-frame-region="navigation"]')!;
  const main = screen.getByRole("main");
  expect(frame).not.toHaveClass("h-dvh");
  expect(frame).toHaveClass("h-full", "w-full");
  expect(frame).toHaveAttribute("dir", dir);
  expect(document.documentElement).toHaveAttribute("data-theme", preference);
  expect(stage.style.maxInlineSize).toBe("none");
  expect(stage.style.overflowY).toBe("hidden");
  expect(stage.style.blockSize).toBe("100%");
  expect(navigation.style.position).toBe("absolute");
  expect(screen.getByRole("banner").parentElement!.style.position).toBe("absolute");
  expect(main).toHaveClass("h-full", "w-full", "overflow-hidden");
  expect(main).not.toHaveClass("p-md");
  const pane = view.container.querySelector<HTMLElement>('[data-application-frame-panel="pane"]');
  if (pane) expect(pane.style.position).toBe("absolute");
  await userEvent.click(screen.getByRole("link", { name: "Skip to content" }));
  expect(main).toHaveFocus();
  if (!matches) {
    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(await screen.findByRole("dialog", { name: "Workspace navigation" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByRole("button", { name: "Open navigation" })).toHaveFocus());
  }
});
