import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { RuntimeRenderInput, RuntimeJson } from "../../catalog-core/runtime-ports.js";
import { siteShellProps } from "../../runtime/frames/site-shell.js";
import { SiteFrame } from "./SiteFrame.js";
import { resolveShell } from "./internal/resolveShell.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function input(): RuntimeRenderInput<ReactNode> {
  const value: Record<string, RuntimeJson> = {
    "skip-link": "Skip content",
    header: {
      brand: { label: "Example Co.", mark: { src: "/mark.svg", width: 48, height: 48 } },
      nav: { label: "Navigation", triggerLabel: "Open navigation", links: [], mega: [{ id: "explore", label: "Explore", columns: [{ heading: "Guides", links: [{ label: "Overview", href: "/overview" }] }], featured: { label: "Featured", href: "/featured", description: "The latest guide" } }] },
      locale: { label: "Language", links: [{ label: "English", locale: "en", href: "/", isCurrent: true }, { label: "Français", locale: "fr", href: "/fr" }] },
    },
    footer: {
      locale: { label: "Footer language", links: [{ label: "English", locale: "en", href: "/", isCurrent: true }, { label: "Français", locale: "fr", href: "/fr" }] },
      newsletter: { action: "/subscribe", emailLabel: "Email", submitLabel: "Subscribe", pendingLabel: "Sending", sentMessage: "Subscribed", failedMessage: "Try again" },
      legal: { entity: "Example Co.", links: [] },
    },
    announcement: { message: "A new guide", dismissLabel: "Dismiss announcement", dismissAction: "dismiss-announcement" },
  };
  return {
    content: Object.fromEntries(Object.entries(value).map(([key, value]) => [key, { reference: { kind: "region", ref: key }, value, hash: "sha256:0" }])),
    selection: { leaf: "frames.site-shell", fill: "foundry/frames.site-shell", members: [], config: null, content: {} },
    slots: { main: [<h1 key="page">Page</h1>] },
    host: { navigate: vi.fn(), onCommand: vi.fn() },
  } as unknown as RuntimeRenderInput<ReactNode>;
}

it("maps real shell slots to banner, header/footer alternate links and the native newsletter binding", async () => {
  const value = input();
  const props = siteShellProps(value);
  render(<SiteFrame {...props} />);
  const header = screen.getByRole("banner"), footer = screen.getByRole("contentinfo");
  expect(within(header).getByRole("navigation", { name: "Language" })).toBeInTheDocument();
  expect(within(footer).getByRole("navigation", { name: "Footer language" })).toBeInTheDocument();
  expect(within(footer).getByRole("textbox", { name: "Email" }).closest("form")).toHaveAttribute("action", "/subscribe");
  const announcement = screen.getByText("A new guide").closest("[data-site-announcement]")!;
  expect(announcement.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("button", { name: "Dismiss announcement" }));
  expect(value.host!.onCommand).toHaveBeenCalledWith("dismiss-announcement");
  expect(screen.getByText("A new guide")).toBeInTheDocument();
  const resolved = resolveShell(props.shell, props.resolveCopy, props.resolveAsset);
  expect(resolved.nav?.mega?.[0]?.featured?.href).toBe("/featured");
  expect(resolved.header.locale?.links[0]?.isCurrent).toBe(true);
});

it("keeps shell validation strict for unknown fields and unsafe newsletter submit routes", () => {
  const props = siteShellProps(input());
  expect(() => resolveShell({ ...props.shell, unknown: true } as never, props.resolveCopy, props.resolveAsset)).toThrow("unsupported field");
  const shell = { ...props.shell, footer: { ...props.shell.footer!, newsletter: { ...props.shell.footer!.newsletter!, action: "//example.test/submit" } } };
  expect(() => resolveShell(shell, props.resolveCopy, props.resolveAsset)).toThrow("same-origin");
  expect(() => resolveShell({ ...props.shell, announcement: { ...props.shell.announcement!, dismissed: "yes" } } as never, props.resolveCopy, props.resolveAsset)).toThrow("boolean");
});

it("requires the real host dismiss command and resolved dismiss copy", () => {
  const value = input();
  expect(() => siteShellProps({ ...value, host: undefined })).toThrow("host onCommand");
});
