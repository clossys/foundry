import { useEffect, useRef, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "react-aria-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountMenu, type AccountMenuProps } from "./AccountMenu.js";

const actor = { name: "Jordan Vale", secondaryText: "jordan@example.test" };
function props(): AccountMenuProps {
  return {
    actor, contextLabel: "Workspace",
    sections: [
      { id: "account", label: "Account", entries: [
        { id: "profile", kind: "link", label: "Profile", href: "/profile" },
        { id: "settings", kind: "action", label: "Settings", onAction: vi.fn() },
        { id: "disabled", kind: "action", label: "Unavailable", isDisabled: true, onAction: vi.fn() },
        { id: "sign-out", kind: "destructive", label: "Sign out", onAction: vi.fn() },
      ] },
      { id: "preferences", kind: "preferences", label: "Preferences", entries: [
        { id: "compact", kind: "preference", label: "Compact view", checked: true, onCheckedChange: vi.fn() },
      ] },
    ],
  };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const trigger = () => screen.getByRole("button", { name: actor.name });
const open = async () => {
  const user = userEvent.setup();
  trigger().focus();
  await user.keyboard("{ArrowDown}");
  await screen.findByRole("menu", { name: actor.name });
  return user;
};

it("renders the expanded actor and context with one truthful menu trigger", () => {
  render(<AccountMenu {...props()} />);
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(trigger()).toHaveAccessibleName(actor.name);
  expect(trigger()).toHaveAttribute("aria-haspopup", "true");
  expect(trigger()).toHaveAttribute("aria-expanded", "false");
  expect(trigger()).toHaveTextContent(actor.name);
  expect(trigger()).toHaveTextContent("Workspace");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("keeps the collapsed avatar trigger named and described on keyboard focus", async () => {
  render(<AccountMenu {...props()} collapsed />);
  expect(trigger()).toHaveAccessibleName(actor.name);
  // Actor initials are decorative inside the explicitly named button.
  expect(trigger()).not.toHaveTextContent(actor.name);
  const user = userEvent.setup();
  await user.tab();
  const tooltip = await screen.findByRole("tooltip");
  expect(tooltip).toHaveTextContent(actor.name);
  expect(trigger()).toHaveAttribute("aria-describedby", tooltip.id);
  await user.keyboard("{ArrowDown}");
  expect(await screen.findByRole("menu", { name: actor.name })).toBeInTheDocument();
});

it("uses native menu navigation, skips disabled commands, and restores Escape focus", async () => {
  render(<AccountMenu {...props()} />);
  const button = trigger();
  const user = await open();
  expect(screen.getByRole("menuitem", { name: "Profile" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "Settings" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "Sign out" })).toHaveFocus();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  await waitFor(() => expect(button).toHaveFocus());
  await act(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(button).toHaveFocus();
  expect(button).toHaveAttribute("aria-expanded", "false");
});

it("renders real labelled groups and links, with distinct destructive emphasis", async () => {
  render(<AccountMenu {...props()} />);
  await open();
  expect(screen.getByRole("group", { name: /Account/ })).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Preferences" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Profile" })).toHaveAttribute("href", "/profile");
  const ordinary = screen.getByRole("menuitem", { name: "Settings" });
  const destructive = screen.getByRole("menuitem", { name: "Sign out" });
  expect(destructive).toHaveClass("text-status-danger-text");
  expect(ordinary).not.toHaveClass("text-status-danger-text");
  destructive.focus();
  await waitFor(() => expect(destructive).toHaveClass("bg-status-danger-tint"));
  expect(screen.getByRole("menuitemcheckbox", { name: "Compact view" })).toHaveAttribute("aria-checked", "true");
});

it("reports preference changes and command activation through host callbacks", async () => {
  const onCheckedChange = vi.fn();
  const onAction = vi.fn();
  const configured = props();
  configured.sections = [
    { id: "commands", entries: [{ id: "settings", kind: "action", label: "Settings", onAction }] },
    { id: "preferences", kind: "preferences", label: "Preferences", entries: [
      { id: "compact", kind: "preference", label: "Compact view", checked: true, onCheckedChange },
    ] },
  ];
  const tree = render(<AccountMenu {...configured} />);
  const user = await open();
  await user.click(screen.getByRole("menuitemcheckbox", { name: "Compact view" }));
  expect(onCheckedChange).toHaveBeenCalledExactlyOnceWith(false);
  // Preferences stay controlled by checked; no persistence is inferred.
  expect(screen.getByRole("menu", { name: actor.name })).toBeInTheDocument();
  expect(screen.getByRole("menuitemcheckbox", { name: "Compact view" })).toHaveAttribute("aria-checked", "true");
  const preferences = configured.sections[1]!;
  if (preferences.kind !== "preferences") throw new Error("Expected the preference fixture");
  tree.rerender(<AccountMenu {...configured} sections={[configured.sections[0]!, {
    ...preferences, entries: preferences.entries.map(entry => ({ ...entry, checked: false })),
  }]} />);
  expect(screen.getByRole("menuitemcheckbox", { name: "Compact view" })).toHaveAttribute("aria-checked", "false");
  await user.click(screen.getByRole("menuitemcheckbox", { name: "Compact view" }));
  expect(onCheckedChange).toHaveBeenNthCalledWith(2, true);
  await user.click(screen.getByRole("menuitem", { name: "Settings" }));
  expect(onAction).toHaveBeenCalledTimes(1);
});

it("honors triggerLabel, displays an image, and retains the name-derived initials fallback", () => {
  const configured = props();
  const { rerender } = render(<AccountMenu {...configured} collapsed triggerLabel="Manage account" />);
  expect(screen.getByRole("button", { name: "Manage account" })).toHaveTextContent("JV");
  rerender(<AccountMenu {...configured} actor={{ ...actor, image: "/portrait.png" }} collapsed triggerLabel="Manage account" />);
  const button = screen.getByRole("button", { name: "Manage account" });
  const image = button.querySelector("img")!;
  expect(image).toHaveAttribute("src", "/portrait.png");
  fireEvent.error(image);
  expect(button).toHaveTextContent("JV");
  expect(button).toHaveAccessibleName("Manage account");
});

it("keeps equal entry ids in different sections independent", async () => {
  const first = vi.fn(), second = vi.fn();
  render(<AccountMenu actor={actor} sections={[
    { id: "first", label: "First group", entries: [{ id: "shared", kind: "action", label: "First action", onAction: first }] },
    { id: "second", label: "Second group", entries: [{ id: "shared", kind: "action", label: "Second action", onAction: second }] },
  ]} />);
  const user = await open();
  await user.click(screen.getByRole("menuitem", { name: "First action" }));
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).not.toHaveBeenCalled();
  await user.click(trigger());
  await user.click(await screen.findByRole("menuitem", { name: "Second action" }));
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
});

it.each([{ sections: [] }, { sections: [{ id: "empty", label: "Empty", entries: [] }] }])("omits an empty account control without placeholders", ({ sections }) => {
  const { container } = render(<AccountMenu actor={actor} sections={sections} />);
  expect(container).toBeEmptyDOMElement();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  expect(container.querySelector("a, [tabindex], [role=menu]")).toBeNull();
});

it("omits empty sections alongside populated sections", async () => {
  const configured = props();
  render(<AccountMenu {...configured} sections={[{ id: "empty", label: "Empty", entries: [] }, ...configured.sections]} />);
  await open();
  expect(screen.queryByText("Empty")).not.toBeInTheDocument();
  expect(screen.getAllByRole("menuitem")).toHaveLength(4);
  expect(screen.getAllByRole("menuitemcheckbox")).toHaveLength(1);
});

function ClosingHost({ route = false }: { route?: boolean }) {
  const [visible, setVisible] = useState(true);
  const destination = useRef<HTMLButtonElement>(null);
  const handoff = () => setVisible(false);
  useEffect(() => {
    if (!visible) {
      const frame = requestAnimationFrame(() => destination.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [visible]);
  return <>
    <button ref={destination}>Destination</button>
    {visible && <nav aria-label="Host navigation" onClickCapture={event => { if ((event.target as Element).closest("a")) event.preventDefault(); }}>
      <AccountMenu {...props()} onClose={route ? undefined : handoff} onRoute={route ? handoff : undefined} />
    </nav>}
  </>;
}
it.each([false, true])("lets the host remove navigation and hand off focus (route=%s)", async route => {
  render(<ClosingHost route={route} />);
  const oldTrigger = trigger();
  const user = await open();
  if (route) await user.click(screen.getByRole("menuitem", { name: "Profile" }));
  else await user.keyboard("{Escape}");
  await waitFor(() => expect(oldTrigger).not.toBeInTheDocument());
  // Wait through React Aria's deferred restoration, not only synchronous callback execution.
  await act(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(screen.getByRole("button", { name: "Destination" })).toHaveFocus();
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
});

it.each(["en-US", "ar"])("flips above a bottom trigger and respects logical alignment (%s, mocked geometry)", async locale => {
  const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON() {} });
  const overlay = (element: Element) => element !== document.body && element !== document.documentElement &&
    (element.getAttribute("role") === "menu" || element.hasAttribute("data-placement") || Boolean(element.querySelector('[role="menu"]')));
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1024);
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(768);
  // The untransformed portal is positioned against the document viewport.
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(document.documentElement);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    if (this.tagName === "BUTTON") return box(400, 720, 48, 40);
    if (overlay(this)) return box(0, 0, 240, 200);
    return box(0, 0, 1024, 768);
  });
  for (const property of ["offsetWidth", "scrollWidth", "offsetHeight", "scrollHeight"] as const) {
    vi.spyOn(HTMLElement.prototype, property, "get").mockImplementation(function () {
      return overlay(this) ? (property.endsWith("Width") ? 240 : 200) : this.tagName === "BUTTON" ? (property.endsWith("Width") ? 48 : 40) : (property.endsWith("Width") ? 1024 : 768);
    });
  }
  render(<I18nProvider locale={locale}><AccountMenu {...props()} /></I18nProvider>);
  await open();
  const panel = screen.getByRole("menu").closest<HTMLElement>("[data-placement]")!;
  await waitFor(() => expect(panel).toHaveAttribute("data-placement", "top"));
  const top = panel.style.bottom ? 768 - parseFloat(panel.style.bottom) - 200 : parseFloat(panel.style.top);
  const left = panel.style.right ? 1024 - parseFloat(panel.style.right) - 240 : parseFloat(panel.style.left);
  expect(top, panel.style.cssText).toBeGreaterThanOrEqual(0); expect(top + 200, panel.style.cssText).toBeLessThanOrEqual(768);
  expect(left).toBe(locale === "ar" ? 208 : 400);
  expect(left + 240).toBeLessThanOrEqual(1024);
});
