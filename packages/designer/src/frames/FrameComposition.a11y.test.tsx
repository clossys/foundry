import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppFrame as Frame } from "./AppFrame.js";
import { CommandMenu as Commands } from "../blocks/CommandMenu.js";
import { Button } from "../components/Button.js";
import { withShellCopy } from "./__fixtures__/shell-copy.js";
import { APP_FRAME_WIDE_QUERY } from "./app-frame-layout.js";

const AppFrame = withShellCopy(Frame, true);
const CommandMenu = withShellCopy(Commands);

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({ media, matches: media === APP_FRAME_WIDE_QUERY || media === "all", addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("preserves frame landmarks and current destinations", () => {
  const view = render(<AppFrame
    brand={{ markSrc: "/mark.svg", wordmark: "Example", label: "Example application", href: "#home" }}
    navigation={{ tree: [{ id: "home", label: "Home", href: "#home" }], activeId: "home", label: "Primary navigation" }}
    account={{ signedOutLabel: "Signed out", sections: [] }}
    commands={{ heading: "Commands", searchLabel: "Search commands", closeLabel: "Close commands", emptyMessage: "No commands", triggerLabel: "Find commands", groups: [] }}
    page={{ title: "Overview" }}
    rightPanel={{ label: "Inspector", handleLabel: "Resize inspector", min: 200, max: 500, defaultValue: 300, children: <Button>Inspector action</Button> }}
  ><Button>Main action</Button></AppFrame>);
  expect({
    banner: screen.getAllByRole("banner").length,
    main: screen.getAllByRole("main").length,
    navigation: screen.getAllByRole("navigation").map(node => node.getAttribute("aria-label")),
    complementary: screen.getAllByRole("complementary").map(node => node.getAttribute("aria-label")),
    current: [...view.container.querySelectorAll('[aria-current="page"]')].map(node => node.textContent),
  }).toMatchInlineSnapshot(`
    {
      "banner": 1,
      "complementary": [
        "Inspector",
      ],
      "current": [
        "Home",
        "Overview",
      ],
      "main": 1,
      "navigation": [
        "Primary navigation",
        "Breadcrumb",
      ],
    }
  `);
});

it("preserves the command listbox and option semantics", async () => {
  render(<CommandMenu heading="Commands" searchLabel="Search commands" closeLabel="Close commands" emptyMessage="No commands"
    isOpen onOpenChange={vi.fn()} query="" onQueryChange={vi.fn()} groups={[{ id: "actions", label: "Actions", items: [
      { id: "open", label: "Open document", onAction: vi.fn() }, { id: "unavailable", label: "Unavailable", disabled: true, onAction: vi.fn() },
    ] }]} />);
  await screen.findByRole("combobox", { name: "Search commands" });
  expect({
    listboxes: screen.getAllByRole("listbox").map(node => node.getAttribute("aria-label")),
    groups: screen.getAllByRole("group").filter(node => node.closest('[role="listbox"]')).map(node => document.getElementById(node.getAttribute("aria-labelledby")!)?.textContent),
    options: screen.getAllByRole("option").map(node => ({ name: node.getAttribute("aria-label"), disabled: node.getAttribute("aria-disabled") })),
  }).toMatchInlineSnapshot(`
    {
      "groups": [
        "Actions",
      ],
      "listboxes": [
        "Search commands",
      ],
      "options": [
        {
          "disabled": null,
          "name": "Open document",
        },
        {
          "disabled": "true",
          "name": "Unavailable",
        },
      ],
    }
  `);
});
