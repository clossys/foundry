// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CopyResolver } from "@clossys/writer";
import { SiteNavDisclosure as ServerNavigation } from "./NavDisclosure.server.js";
import type { SiteShellInput } from "./types.js";

const resolveCopy: CopyResolver = ref => ({ ref, text: ref.id, recordId: ref.id, revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryId: ref.id });
const resolveAsset = () => ({ type: "image", src: "/mark.svg", width: 48, height: 48, alt: "Mark" });
afterEach(() => { vi.doUnmock("#publisher-frame-navigation"); vi.restoreAllMocks(); });

// Resolve the real server/default frame bindings once during module setup.
// Each test keeps its normal timeout for hydration and interaction itself.
vi.doMock("#publisher-frame-navigation", () => ({ SiteNavDisclosure: ServerNavigation }));
const { SiteFrame: ServerFrame } = await import("./SiteFrame.js");
vi.doUnmock("#publisher-frame-navigation");
vi.resetModules();
const { SiteFrame: ClientFrame } = await import("./SiteFrame.js");

it.each(["auto", "inverse", undefined] as const)("hydrates the real frame with %s navigation tone and preserves interaction", async tone => {
  const shell = {
    brand: { assetId: "mark", label: { id: "Home" }, size: "md", variant: "mark" },
    skipLink: { id: "Skip" },
    header: { placement: "overlay", tone: "inverse" },
    nav: { label: { id: "Primary" }, triggerLabel: { id: "Menu" }, links: [{ href: "#help", label: { id: "Help" } }], ...(tone === undefined ? {} : { tone }) },
  } as SiteShellInput;
  const server = renderToString(<ServerFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}><p>content</p></ServerFrame>);
  const tree = <ClientFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}><p>content</p></ClientFrame>;
  expect(renderToString(tree)).toBe(server);
  const container = document.createElement("div");
  container.innerHTML = server;
  document.body.append(container);
  const panelId = container.querySelector("button")!.getAttribute("aria-controls");
  const recoverable = vi.fn();
  const consoleError = vi.spyOn(console, "error");
  const root = await act(async () => hydrateRoot(container, tree, { onRecoverableError: recoverable }));
  try {
    const navigation = within(container).getByRole("navigation", { name: "Primary" });
    const toggle = within(navigation).getByRole("button", { name: "Menu" });
    expect(toggle.getAttribute("data-tone")).toBe(tone ?? null);
    if (tone === "inverse") expect(toggle).toHaveClass("text-ink-on-inverse", "focus-visible:outline-ink-on-inverse");
    if (tone === "auto") expect(toggle).toHaveClass("text-ink-primary", "focus-visible:outline-accent");
    expect(toggle).toHaveAttribute("aria-controls", panelId!);
    expect(navigation.querySelector(".nav-disclosure-panel")!.id).toBe(panelId);
    const user = userEvent.setup();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(navigation.querySelector(".nav-disclosure-panel")).toHaveAttribute("data-expanded", "");
    await user.keyboard("{Escape}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(within(navigation).getByRole("link", { name: "Help" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(recoverable).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
