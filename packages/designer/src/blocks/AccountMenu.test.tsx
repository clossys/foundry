import { useEffect, useRef, useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "react-aria-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Menu } from "../components/Menu.js";
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
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
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
  for (const text of [actor.name, actor.secondaryText, "Workspace"]) expect(within(screen.getByRole("menu")).getByText(text)).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Profile" })).toHaveAttribute("href", "/profile");
  const ordinary = screen.getByRole("menuitem", { name: "Settings" });
  const destructive = screen.getByRole("menuitem", { name: "Sign out" });
  expect(destructive).toHaveClass("text-status-danger-text");
  expect(ordinary).not.toHaveClass("text-status-danger-text");
  expect(screen.getByRole("menuitem", { name: "Profile" })).not.toHaveClass("text-status-danger-text");
  const preference = screen.getByRole("menuitemcheckbox", { name: "Compact view" });
  expect(preference).not.toHaveClass("text-status-danger-text");
  expect(preference.querySelector("svg[aria-hidden=true] path")).toHaveAttribute("d", "M20 6 9 17l-5-5");
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
  const { rerender } = render(<AccountMenu {...configured} triggerLabel="Manage account" />);
  expect(trigger()).toHaveAccessibleName(actor.name);
  rerender(<AccountMenu {...configured} collapsed triggerLabel="Manage account" />);
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

it.each(["populated", "empty", "all-empty"])("rejects duplicate section ids (%s)", state => {
  const entry = { id: "first", kind: "action" as const, label: "First action", onAction: vi.fn() };
  expect(() => render(<AccountMenu actor={actor} sections={[
    { id: "duplicate", entries: state === "all-empty" ? [] : [entry] },
    { id: "duplicate", entries: state === "populated" ? [{ ...entry, id: "second" }] : [] },
  ]} />)).toThrow(TypeError);
});

it("rejects duplicate entry ids within one section", () => {
  expect(() => render(<AccountMenu actor={actor} sections={[{ id: "commands", entries: [
    { id: "duplicate", kind: "action", label: "First action", onAction: vi.fn() },
    { id: "duplicate", kind: "action", label: "Second action", onAction: vi.fn() },
  ] }]} />)).toThrow(TypeError);
});

it("rejects duplicate preference keys before either callback can run", async () => {
  const first = vi.fn(), second = vi.fn();
  let rejected: unknown;
  try {
    render(<AccountMenu actor={actor} sections={[{ id: "preferences", kind: "preferences", label: "Preferences", entries: [
      { id: "duplicate", kind: "preference", label: "First preference", checked: false, onCheckedChange: first },
      { id: "duplicate", kind: "preference", label: "Second preference", checked: false, onCheckedChange: second },
    ] }]} />);
  } catch (error) { rejected = error; }
  if (!rejected) {
    const user = await open();
    await user.click(screen.getAllByRole("menuitemcheckbox")[0]!);
  }
  expect({ first: first.mock.calls, second: second.mock.calls }).toEqual({ first: [], second: [] });
  expect(rejected).toBeInstanceOf(TypeError);
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

function ClosingHost({ route = false, hide = false }: { route?: boolean; hide?: boolean }) {
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
    {(visible || hide) && <nav hidden={!visible} aria-label="Host navigation" onClickCapture={event => { if ((event.target as Element).closest("a")) event.preventDefault(); }}>
      <AccountMenu {...props()} onClose={route ? undefined : handoff} onRoute={route ? handoff : undefined} />
    </nav>}
  </>;
}
it.each([{ route: false, hide: false }, { route: true, hide: false }, { route: false, hide: true }, { route: true, hide: true }])("lets the host remove or hide navigation and hand off focus (%j)", async ({ route, hide }) => {
  render(<ClosingHost route={route} hide={hide} />);
  const oldTrigger = trigger();
  const user = await open();
  if (route) await user.click(screen.getByRole("menuitem", { name: "Profile" }));
  else await user.keyboard("{Escape}");
  await waitFor(() => hide ? expect(oldTrigger).not.toBeVisible() : expect(oldTrigger).not.toBeInTheDocument());
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


it("leaves later unnamed commands ungrouped instead of repeating the actor", async () => {
  render(<AccountMenu actor={actor} sections={[
    { id: "first", entries: [{ id: "one", kind: "action", label: "First", onAction() {} }] },
    { id: "later", entries: [{ id: "two", kind: "action", label: "Later", onAction() {} }] },
  ]} />);
  await open();
  expect(screen.getAllByRole("group")).toHaveLength(1);
  expect(screen.getByRole("menuitem", { name: "Later" }).closest("[role=group]")).toBeNull();
});

it("reports only changed preferences, including the peer select-all callback, with visible check marks", async () => {
  const unchanged = vi.fn(), changed = vi.fn(), all = vi.fn();
  const section = Menu.Section;
  let selectAll: ((keys: "all") => void) | undefined;
  vi.spyOn(Menu, "Section").mockImplementation(props => {
    if (props.selectionMode === "multiple") selectAll = props.onSelectionChange;
    return section(props);
  });
  render(<AccountMenu actor={actor} sections={[{ id: "prefs", kind: "preferences", label: "Preferences", entries: [
    { id: "on", kind: "preference", label: "Already enabled", checked: true, onCheckedChange: unchanged },
    { id: "off", kind: "preference", label: "Enable this", checked: false, onCheckedChange: changed },
    { id: "other", kind: "preference", label: "Another", checked: false, onCheckedChange: all },
  ] }]} />);
  const user = await open();
  expect(screen.getByRole("menuitemcheckbox", { name: "Already enabled" }).querySelector("svg path")).toHaveAttribute("d", "M20 6 9 17l-5-5");
  const off = screen.getByRole("menuitemcheckbox", { name: "Enable this" });
  expect(off.querySelector("svg")).toBeNull();
  await user.click(off);
  expect(changed).toHaveBeenCalledExactlyOnceWith(true);
  expect(unchanged).not.toHaveBeenCalled(); expect(all).not.toHaveBeenCalled();
  // Exercise the typed peer callback; native section selection has no select-all key binding.
  await act(() => selectAll!("all"));
  expect(all).toHaveBeenCalledExactlyOnceWith(true);
  expect(unchanged).not.toHaveBeenCalled();
});

it("passes the activated link entry to its host route observer", async () => {
  const onRoute = vi.fn(), entry = { id: "profile", kind: "link" as const, label: "Profile", href: "#profile" };
  render(<AccountMenu actor={actor} sections={[{ id: "account", entries: [entry] }]} onRoute={onRoute} />);
  const user = await open();
  await user.click(screen.getByRole("menuitem", { name: "Profile" }));
  expect(onRoute).toHaveBeenCalledExactlyOnceWith(entry);
});

it.each(["", " ", "javascript:alert(1)", "data:text/plain,value", "//example.test", "/path\\file", "https://name:pass@example.test", "https://example.test\n"])("rejects unsafe account href %j", href => {
  expect(() => render(<AccountMenu actor={actor} sections={[{ id: "links", entries: [{ id: "bad", kind: "link", label: "Destination", href }] }]} />)).toThrow(TypeError);
});
it.each(["#profile", "/profile", "https://example.test", "http://example.test", "mailto:member@example.test"])("accepts the existing destination contract %s", href => {
  expect(() => render(<AccountMenu actor={actor} sections={[{ id: "links", entries: [{ id: "ok", kind: "link", label: "Destination", href }] }]} />)).not.toThrow();
});
it.each([{ name: "", label: "Settings" }, { name: " ", label: "Settings" }, { name: actor.name, label: "" }, { name: actor.name, label: " " }])("rejects unnamed actor or entry data %j", ({ name, label }) => {
  expect(() => render(<AccountMenu actor={{ name }} sections={[{ id: "account", entries: [{ id: "settings", kind: "action", label, onAction() {} }] }]} />)).toThrow(TypeError);
});

it.each(["", " "])("keeps an actor-derived collapsed name for blank triggerLabel %j", triggerLabel => {
  render(<AccountMenu {...props()} collapsed triggerLabel={triggerLabel} />);
  expect(trigger()).toHaveAccessibleName(actor.name);
});
