// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SiteNavDisclosure as ClientNavigation } from "./NavDisclosure.client.js";
import { resolveShell } from "./internal/resolveShell.js";
import { SiteNavDisclosure as ServerNavigation } from "./NavDisclosure.server.js";
import type { SiteShellInput } from "./types.js";
import type { CopyResolver } from "@clossys/writer";

const shell: SiteShellInput = {
  brand: { assetId: "mark", label: { id: "Home" }, size: "md", variant: "mark" },
  skipLink: { id: "Skip" },
  nav: { label: { id: "Primary" }, triggerLabel: { id: "Menu" }, links: [{ href: "#help", label: { id: "Help" } }] },
};
const resolveCopy: CopyResolver = ref => ({ ref, text: ref.id, recordId: ref.id, revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryId: ref.id });
const resolveAsset = () => ({ type: "image", src: "/mark.svg", width: 48, height: 48, alt: "Mark" });
afterEach(() => { vi.doUnmock("#designer-frame-navigation"); vi.restoreAllMocks(); });

it("hydrates server navigation through the real default frame boundary with pointer and keyboard interaction", async () => {
  // Model the private binding's server condition while retaining the complete frame tree.
  vi.resetModules();
  vi.doMock("#designer-frame-navigation", () => ({ SiteNavDisclosure: ServerNavigation }));
  const { SiteFrame: ServerFrame } = await import("./SiteFrame.js");
  const server = renderToString(<ServerFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}><p>content</p></ServerFrame>);
  vi.doUnmock("#designer-frame-navigation");
  vi.resetModules();
  const { SiteFrame: ClientFrame } = await import("./SiteFrame.js");
  const tree = <ClientFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}><p>content</p></ClientFrame>;
  expect(server).toBe(renderToString(tree));
  const container = document.createElement("div");
  container.innerHTML = server;
  const panelId = container.querySelector("header button")!.getAttribute("aria-controls")!;
  document.body.append(container);
  const recoverable = vi.fn();
  const consoleError = vi.spyOn(console, "error");
  const root = await act(async () => hydrateRoot(container, tree, { onRecoverableError: recoverable }));
  try {
    const navigation = within(container).getByRole("navigation", { name: "Primary" });
    const toggle = within(navigation).getByRole("button", { name: "Menu" });
    const panel = navigation.querySelector(".nav-disclosure-panel")!;
    expect(toggle).toHaveAttribute("aria-controls", `${panel.id}-sheet`);
    expect(`${panel.id}-sheet`).toBe(panelId);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const user = userEvent.setup();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(panel).toHaveAttribute("inert");
    const dialog = within(document.body).getByRole("dialog", { name: "Primary" });
    expect(dialog).toHaveAttribute("id", panelId);
    await user.keyboard("{Escape}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(within(within(document.body).getByRole("dialog")).getByRole("link", { name: "Help" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(recoverable).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});


it("keeps generated panel IDs distinct and matching across server and client disclosures", () => {
  const nav = resolveShell(shell, resolveCopy, resolveAsset).nav!;
  const server = renderToString(<><ServerNavigation nav={nav} /><ServerNavigation nav={nav} /></>);
  expect(server).toBe(renderToString(<><ClientNavigation nav={nav} /><ClientNavigation nav={nav} /></>));
  const container = document.createElement("div");
  container.innerHTML = server;
  const toggles = [...container.querySelectorAll("button")];
  const ids = toggles.map(toggle => toggle.getAttribute("aria-controls"));
  expect(new Set(ids).size).toBe(2);
  for (const id of ids) expect([...container.querySelectorAll(".nav-disclosure-panel")].filter(panel => `${panel.id}-sheet` === id)).toHaveLength(1);
});

it("hydrates footer links and the default home without changing names or tab order", async () => {
  const { SiteFrame } = await import("./SiteFrame.js");
  const footerShell: SiteShellInput = { ...shell, footer: { legal: { entity: { id: "Example" }, links: [{ href: "/privacy", label: { id: "Privacy" } }] } } };
  const tree = <SiteFrame shell={footerShell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}><p>content</p></SiteFrame>;
  const container = document.createElement("div");
  container.innerHTML = renderToString(tree);
  const before = container.querySelector("footer")!.outerHTML;
  document.body.append(container);
  const recoverable = vi.fn();
  const root = await act(async () => hydrateRoot(container, tree, { onRecoverableError: recoverable }));
  try {
    const footer = container.querySelector("footer")!;
    expect(footer.outerHTML).toBe(before);
    const privacy = within(footer).getByRole("link", { name: "Privacy" });
    privacy.focus();
    await userEvent.setup().tab();
    expect(within(footer).getByRole("link", { name: "Home" })).toHaveFocus();
    expect(recoverable).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); container.remove(); }
});
