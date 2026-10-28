import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToggleGroup, ToggleGroupItem } from "../components/ToggleGroup.js";
import { DEFAULT_STORAGE_KEY, ThemeProvider } from "./ThemeProvider.js";
import { ThemeToggle as ShellFixtureThemeToggle, type ThemeToggleProps } from "./ThemeToggle.js";
import { withShellCopy } from "../frames/__fixtures__/shell-copy.js";
const ThemeToggle = withShellCopy(ShellFixtureThemeToggle);



function installMatchMediaMock(initialMatches = false) {
  const mql = {
    matches: initialMatches,
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
}

function renderToggle(children: ReactNode = <ThemeToggle />) {
  return render(<ThemeProvider>{children}</ThemeProvider>);
}

beforeEach(() => {
  installMatchMediaMock(false);
});

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ThemeToggle", () => {
  it("shows three explicit icon-only radio options and the selected preference", () => {
    renderToggle();
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
    for (const name of ["Light", "Dark"]) expect(screen.getByRole("radio", { name })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "System" })).toHaveAttribute("data-selected");
    for (const radio of screen.getAllByRole("radio")) expect(radio.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("selects Dark directly in one activation and keeps System directly available", async () => {
    const user = userEvent.setup();
    renderToggle();
    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "System" }));
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
  });

  it("uses Appearance Toolbar arrows for focus and Space/Enter for selection", async () => {
    const user = userEvent.setup();
    renderToggle();
    expect(screen.getByRole("toolbar", {name:"Appearance"})).toContainElement(screen.getByRole("radiogroup",{name:"Theme"}));
    await user.tab();
    expect(screen.getByRole("radio", { name: "System" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Light" })).toHaveFocus();
    expect(screen.getByRole("radio", { name: "Light" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
    await user.keyboard(" ");
    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveFocus();
    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
  });

  it("standalone ToggleGroup APG probe: ArrowRight checks the newly focused radio", async () => {
    const user = userEvent.setup();
    render(<ToggleGroup aria-label="Standalone appearance" selectionMode="single" defaultSelectedKeys={["system"]}>
      <ToggleGroupItem id="system">System</ToggleGroupItem><ToggleGroupItem id="light">Light</ToggleGroupItem><ToggleGroupItem id="dark">Dark</ToggleGroupItem>
    </ToggleGroup>);
    await user.tab();
    expect(screen.getByRole("radio", {name:"System"})).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", {name:"Light"})).toHaveFocus();
    expect(screen.getByRole("radio", {name:"Light"})).toBeChecked();
  });

  it("persists direct selection and announces the change", async () => {
    const user = userEvent.setup();
    renderToggle();
    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(window.localStorage.getItem(DEFAULT_STORAGE_KEY)).toBe("dark");
    expect(screen.getByRole("status")).toHaveTextContent("Theme set to Dark");
  });

  it("does not empty the selection when the selected option is pressed", async () => {
    const user = userEvent.setup();
    renderToggle();
    await user.click(screen.getByRole("radio", { name: "System" }));
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("forwards the fill's appearance, class, style and disabled group props", async () => {
    const user = userEvent.setup();
    renderToggle(<ThemeToggle variant="outline" size="sm" className="my-toggle" style={{ marginInlineStart: 12 }} isDisabled />);
    const group = screen.getByRole("radiogroup");
    expect(group).toHaveClass("my-toggle");
    expect(group).toHaveAttribute("data-variant", "outline");
    expect(group).toHaveAttribute("data-size", "sm");
    expect(group).toHaveStyle({ marginInlineStart: "12px" });
    expect(group.style.getPropertyValue("--gap")).toBe("calc(var(--spacing-xs) * 2)");
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
  });

  it("reads option, tooltip and announcement copy from host messages", async () => {
    const user = userEvent.setup();
    const tooltip = vi.fn<NonNullable<ThemeToggleProps["toggleLabel"]>>((current, target, labels) => `Tema: ${labels[current]}. Elegir ${labels[target]}.`);
    renderToggle(<ThemeToggle aria-label="Tema" preferenceLabels={{ system: "Sistema", light: "Claro", dark: "Oscuro" }}
      toggleLabel={tooltip} preferenceAnnouncement={(next, labels) => `Tema en ${labels[next]}`} />);
    expect(screen.getByRole("radiogroup", { name: "Tema" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Sistema" })).toBeChecked();
    expect(tooltip).toHaveBeenCalledWith("system", "dark", { system: "Sistema", light: "Claro", dark: "Oscuro" });
    await user.click(screen.getByRole("radio", { name: "Oscuro" }));
    expect(screen.getByRole("status")).toHaveTextContent("Tema en Oscuro");
  });

  it("provides the named option tooltip on hover", async () => {
    const user = userEvent.setup();
    renderToggle();
    await user.hover(screen.getByRole("radio", { name: "Dark" }));
    expect(await screen.findByRole("tooltip", {}, { timeout: 2500 })).toHaveTextContent("Dark");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});

describe("ThemeToggle controlled by its host", () => {
  it("selects the supplied preference and reports a choice without a ThemeProvider", async () => {
    const onPreferenceChange = vi.fn();
    render(<ThemeToggle preference="dark" onPreferenceChange={onPreferenceChange} />);
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(onPreferenceChange).toHaveBeenCalledExactlyOnceWith("light");
  });
});
