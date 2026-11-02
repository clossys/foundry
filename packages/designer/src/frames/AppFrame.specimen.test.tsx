// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_FRAME_WIDE_QUERY } from "./app-frame-layout.js";
import { AppFrameSpecimen as ShellFixtureAppFrameSpecimen } from "../studio/index.js";
import { withShellCopy } from "./__fixtures__/shell-copy.js";
const AppFrameSpecimen = withShellCopy(ShellFixtureAppFrameSpecimen);



beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({
    media, matches: media === APP_FRAME_WIDE_QUERY || media === "all", onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => true,
  })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.removeProperty("color-scheme");
});

describe("exported AppFrame specimen", () => {
  it("uses the frame page contract with one heading in its bar and header-free route content", () => {
    render(<AppFrameSpecimen />);
    const heading = screen.getByRole("heading", { level: 1, name: "Overview" });
    expect(screen.getAllByRole("heading", { level: 1 })).toEqual([heading]);
    expect(screen.getByRole("banner")).toContainElement(heading);
    expect(screen.getByRole("main")).not.toContainElement(heading);
    expect(screen.getByRole("button", { name: "Page information" })).toBeInTheDocument();
  });
  it("passes a host command index directly to the real menu", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(<AppFrameSpecimen commands={{
      triggerLabel: "Host launcher", heading: "Host commands", searchLabel: "Host query",
      closeLabel: "Dismiss launcher", emptyMessage: "No host commands",
      groups: [{ id: "host", label: "Host destinations", items: [{ id: "run", label: "Run host task", onAction: run }] }],
    }} />);
    await user.click(screen.getByRole("button", { name: "Host launcher" }));
    expect(await screen.findByRole("dialog", { name: "Host commands" })).toBeInTheDocument();
    await user.type(screen.getByRole("combobox", { name: "Host query" }), "Run host");
    await user.keyboard("{Enter}");
    expect(run).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("resolves changed host activity copy for the current route without losing task-button focus", async () => {
    const user = userEvent.setup();
    const view = render(<AppFrameSpecimen routeOpenedLabel="first" />);
    const main = within(screen.getByRole("main"));
    await user.click(screen.getByRole("link", { name: "Projects", exact: true }));
    expect(main.getByRole("status")).toHaveTextContent("Projects first");
    expect(main.getByRole("status").querySelectorAll("span")).toHaveLength(2);
    view.rerender(<AppFrameSpecimen routeOpenedLabel="updated" />);
    expect(main.getByRole("status")).toHaveTextContent("Projects updated");
    const task = screen.getByRole("button", { name: "Complete example task" });
    await user.click(task);
    expect(screen.getByRole("button", { name: "Reopen example task" })).toBe(task);
    expect(task).toHaveFocus();
  });

  it("retains the generic default copy when no host overrides are supplied", () => {
    render(<AppFrameSpecimen />);
    const main = within(screen.getByRole("main"));
    expect(within(screen.getByRole("banner")).getByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();
    expect(main.getByText("A shared place to review projects, open tasks and recent activity.")).toBeInTheDocument();
    expect(main.getByText("Example workspace opened.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Example context" })).toHaveTextContent("Current destination: Overview");
  });

  it("uses host copy in visible content, commands, account actions and activity messages", async () => {
    const user = userEvent.setup();
    render(<AppFrameSpecimen
      wordmark="HOST" workspaceLabel="HOST workspace" navigationLabel="HOST navigation"
      accountName="HOST member" guestLabel="HOST guest" signOutLabel="HOST leave"
      commandTriggerLabel="HOST search" commandHeading="HOST commands" commandSearchLabel="HOST query"
      openTasksLabel="HOST tasks command" contextHeading="HOST context" currentDestinationPrefix="HOST destination: "
      milestoneHeading="HOST milestone" milestoneDescription="HOST milestone detail"
      completeTaskLabel="HOST complete" reopenTaskLabel="HOST reopen"
      taskCompletedMessage="HOST task done" taskReadyMessage="HOST task ready" taskReopenedMessage="HOST task reopened"
      initialActivityMessage="HOST welcome" routeOpenedLabel="HOST opened"
      noAccountMessage="HOST account removed"
    />);
    const main = within(screen.getByRole("main"));
    expect(main.getByText("HOST workspace")).toBeInTheDocument();
    expect(main.getByRole("heading", { name: "HOST milestone" })).toBeInTheDocument();
    expect(main.getByText("HOST milestone detail")).toBeInTheDocument();
    expect(main.getByText("HOST welcome")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "HOST complete" }));
    expect(main.getByText("HOST task done")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "HOST reopen" }));
    expect(main.getByText("HOST task reopened")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Example context" })).toHaveTextContent("HOST task ready");
    await user.click(screen.getByRole("button", { name: "HOST search" }));
    expect(await screen.findByRole("dialog", { name: "HOST commands" })).toBeInTheDocument();
    await user.type(screen.getByRole("combobox", { name: "HOST query" }), "HOST tasks");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(main.getByRole("status")).toHaveTextContent("Tasks HOST opened");
    await user.click(screen.getByRole("button", { name: "HOST member" }));
    await user.click(await screen.findByRole("menuitem", { name: "HOST leave" }));
    expect(main.getByText("HOST account removed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "HOST guest" })).toBeInTheDocument();
    expect(screen.queryByText("Example workspace opened.")).not.toBeInTheDocument();
  });

  it("uses host page copy for navigation, route headings and descriptions", async () => {
    const user = userEvent.setup();
    render(<AppFrameSpecimen pages={{
      overview: { title: "HOST overview", description: "HOST overview detail" },
      projects: { title: "HOST projects", description: "HOST project detail" },
      tasks: { title: "HOST tasks", description: "HOST task detail" },
      profile: { title: "HOST profile", description: "HOST profile detail" },
      preferences: { title: "HOST preferences", description: "HOST preference detail" },
      "signed-out": { title: "HOST signed out", description: "HOST sign-out detail" },
    }} />);
    await user.click(screen.getByRole("link", { name: "HOST projects" }));
    const main = within(screen.getByRole("main"));
    expect(within(screen.getByRole("banner")).getByRole("heading", { level: 1, name: "HOST projects" })).toBeInTheDocument();
    expect(main.getByText("HOST project detail")).toBeInTheDocument();
    expect(main.getByRole("status")).toHaveTextContent("HOST projects opened");
  });

  it("renders a real whole frame and routes host links into its sole main", async () => {
    const user = userEvent.setup();
    const { container } = render(<AppFrameSpecimen />);
    expect(container.querySelectorAll("main")).toHaveLength(1);
    const navigation = screen.getByRole("navigation", { name: "Example navigation" });
    const projects = within(navigation).getByRole("link", { name: "Projects" });
    expect(projects).toHaveAttribute("href", "#example-projects");
    await user.click(projects);
    expect(within(screen.getByRole("banner")).getByRole("heading", { level: 1, name: "Projects" })).toBeInTheDocument();
    expect(projects).toHaveAttribute("aria-current", "page");
    await user.click(screen.getByRole("button", { name: "Expand Projects" }));
    await user.click(within(navigation).getByRole("link", { name: "Tasks" }));
    expect(within(screen.getByRole("banner")).getByRole("heading", { level: 1, name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Example context" })).toHaveTextContent("Tasks");
    await user.click(screen.getByRole("button", { name: "Complete example task" }));
    expect(screen.getByRole("region", { name: "Example context" })).toHaveTextContent("Example task completed.");
    await user.click(screen.getByRole("button", { name: "Reopen example task" }));
    expect(screen.getByRole("region", { name: "Example context" })).toHaveTextContent("One example task is ready for review.");
  });

  it("filters real commands, selects a host action, closes and restores the opener", async () => {
    const user = userEvent.setup();
    render(<AppFrameSpecimen />);
    const opener = screen.getByRole("button", { name: "Search Example commands" });
    await user.click(opener);
    const search = await screen.findByRole("combobox", { name: "Find a command" });
    await user.type(search, "task");
    expect(screen.queryByRole("option", { name: "Open overview" })).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(screen.getByRole("banner")).getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
    await user.click(opener);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("uses account links and local sign-out state without an identity service", async () => {
    const user = userEvent.setup();
    render(<AppFrameSpecimen />);
    await user.click(screen.getByRole("button", { name: "Example member" }));
    await user.click(await screen.findByRole("menuitem", { name: "Profile" }));
    expect(within(screen.getByRole("banner")).getByRole("heading", { name: "Profile" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Example member" }));
    await user.click(await screen.findByRole("menuitem", { name: "Preferences" }));
    expect(within(screen.getByRole("banner")).getByRole("heading", { name: "Preferences" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Example member" }));
    await user.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Signed out" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Example member" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guest account" }));
    await user.click(await screen.findByRole("menuitem", { name: "Use example account" }));
    expect(await screen.findByRole("button", { name: "Example member" })).toBeInTheDocument();
  });

  it("persists all three theme preferences for the whole frame", async () => {
    const user = userEvent.setup();
    render(<AppFrameSpecimen />);
    await user.click(screen.getByRole("button", { name: "Example member" }));
    expect(screen.getByRole("menuitemradio", { name: "System" })).toHaveAttribute("aria-checked", "true");
    for (const next of ["Light", "Dark", "System"] as const) {
      await user.click(screen.getByRole("menuitemradio", { name: next }));
      expect(screen.getByRole("menuitemradio", { name: next })).toHaveAttribute("aria-checked", "true");
      expect(localStorage.getItem("example-app-theme")).toBe(next.toLowerCase());
      if (next === "System") expect(document.documentElement).not.toHaveAttribute("data-theme");
      else expect(document.documentElement).toHaveAttribute("data-theme", next.toLowerCase());
    }
  });
});
