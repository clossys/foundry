import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CallToAction } from "./CallToAction.js";
import { RecordCards } from "./RecordCards.js";
import { ErrorState } from "./ErrorState.js";
import { Gallery } from "./Gallery.js";
import { NoticeList } from "./NoticeList.js";
import { StatGroup } from "./StatGroup.js";
import { SECTION_BLOCK_SAMPLES } from "./section-samples.js";

describe("ErrorState", () => {
  it("is a section named by its title, carrying the kind and the code above the heading", () => {
    render(<ErrorState kind="not-found" code="404" title="Page not found" description="Check the address." />);
    const region = screen.getByRole("region", { name: "Page not found" });
    expect(region).toHaveAttribute("data-error-kind", "not-found");
    expect(within(region).getByRole("heading", { level: 2, name: "Page not found" })).toBeInTheDocument();
    expect(within(region).getByText("404")).toBeInTheDocument();
    expect(within(region).getByText("Check the address.")).toBeInTheDocument();
  });

  it("renders retry before report and no actions row when neither is given", () => {
    const { container, rerender } = render(<ErrorState kind="failure" title="Failed" retry={<button>Retry</button>} report={<a href="#r">Report</a>} />);
    const controls = [...container.querySelectorAll("button, a")].map(node => node.textContent);
    expect(controls).toEqual(["Retry", "Report"]);
    rerender(<ErrorState kind="offline" title="Offline" />);
    expect(container.querySelectorAll("button, a")).toHaveLength(0);
    expect(screen.getByRole("region", { name: "Offline" })).toHaveAttribute("data-error-kind", "offline");
  });
});

describe("StatGroup", () => {
  const items = [{ id: "a", label: "Users", value: "10" }, { id: "b", label: "Revenue", value: "$5" }];
  it("renders one list item per stat with its label and value", () => {
    render(<StatGroup items={items} />);
    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("Users")).toBeInTheDocument();
    expect(within(list).getByText("$5")).toBeInTheDocument();
  });

  it("switches between the grid and row layouts", () => {
    const { rerender } = render(<StatGroup items={items} />);
    expect(screen.getByRole("list")).toHaveAttribute("data-layout", "grid");
    expect(screen.getByRole("list").className).toContain("grid-cols-2");
    rerender(<StatGroup items={items} layout="row" />);
    expect(screen.getByRole("list")).toHaveAttribute("data-layout", "row");
    expect(screen.getByRole("list").className).toContain("flex-wrap");
    expect(screen.getByRole("list").className).not.toContain("grid-cols-2");
  });
});

describe("RecordCards", () => {
  const records = [
    { id: "a", title: "Alpha", href: "#a", description: "First", badge: { label: "Live", variant: "success" as const } },
    { id: "b", title: "Beta", meta: "Updated today" },
  ];
  it("renders each record as a card whose title is its only link, with badge and meta", () => {
    render(<RecordCards records={records} />);
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByRole("heading", { level: 3, name: "Alpha" })).toBeInTheDocument();
    expect(within(items[0]!).getAllByRole("link")).toHaveLength(1);
    expect(within(items[0]!).getByRole("link", { name: "Alpha" })).toHaveAttribute("href", "#a");
    expect(within(items[0]!).getByText("Live")).toBeInTheDocument();
    expect(within(items[1]!).queryByRole("link")).toBeNull();
    expect(within(items[1]!).getByText("Updated today")).toBeInTheDocument();
  });

  it("switches between grid and list layouts and honours the heading level", () => {
    const { rerender } = render(<RecordCards records={records} />);
    expect(screen.getByRole("list")).toHaveAttribute("data-layout", "grid");
    rerender(<RecordCards records={records} layout="list" headingLevel={2} />);
    expect(screen.getByRole("list")).toHaveAttribute("data-layout", "list");
    expect(screen.getByRole("list").className).toContain("flex-col");
    expect(screen.getByRole("heading", { level: 2, name: "Alpha" })).toBeInTheDocument();
  });
});

describe("CallToAction", () => {
  it("is a section named by its title with a primary and an optional secondary action", () => {
    const { rerender } = render(<CallToAction eyebrow="Start" title="Try it" description="Free." primaryAction={<a href="#p">Primary</a>} secondaryAction={<a href="#s">Secondary</a>} />);
    const region = screen.getByRole("region", { name: "Try it" });
    expect(within(region).getAllByRole("link").map(link => link.textContent)).toEqual(["Primary", "Secondary"]);
    expect(within(region).getByText("Start")).toBeInTheDocument();
    expect(region).toHaveAttribute("data-ground", "sunken");
    expect(region.className).toContain("bg-surface-sunken");
    rerender(<CallToAction title="Try it" ground="inverse" primaryAction={<a href="#p">Primary</a>} />);
    expect(within(screen.getByRole("region", { name: "Try it" })).getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Try it" })).toHaveAttribute("data-ground", "inverse");
  });
});

describe("NoticeList", () => {
  const notices = [
    { id: "w", tone: "danger" as const, title: "Payment failed.", message: "Update your card." },
    { id: "i", message: "Export ready." },
    { id: "k", tone: "warning" as const, message: "Pinned.", dismissible: false },
  ];
  it("is a labelled region with one Banner per notice whose tone sets its live role", () => {
    render(<NoticeList label="Account notices" notices={notices} />);
    const region = screen.getByRole("region", { name: "Account notices" });
    expect(within(region).getAllByRole("listitem")).toHaveLength(3);
    expect(within(region).getByRole("alert")).toHaveTextContent("Payment failed.Update your card.");
    expect(within(region).getAllByRole("status")).toHaveLength(2);
    expect(within(region).queryByRole("button")).toBeNull();
  });

  it("reports the dismissed notice id and omits dismiss on a pinned notice", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<NoticeList label="Account notices" notices={notices} onDismiss={onDismiss} dismissLabel="Dismiss notice" />);
    const buttons = screen.getAllByRole("button", { name: "Dismiss notice" });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[1]!);
    expect(onDismiss).toHaveBeenCalledWith("i");
  });
});

describe("Gallery", () => {
  const images = [
    { id: "a", label: "First screen", media: <svg role="img" aria-label="First screen" />, caption: "First caption" },
    { id: "b", label: "Second screen", media: <svg role="img" aria-label="Second screen" /> },
  ];
  it("opens an image in a modal lightbox named by its label and closes it again", async () => {
    const user = userEvent.setup();
    render(<Gallery label="Screens" images={images} />);
    const region = screen.getByRole("region", { name: "Screens" });
    expect(region).toHaveAttribute("data-lightbox", "enabled");
    await user.click(within(region).getByRole("button", { name: "Enlarge First screen" }));
    const dialog = await screen.findByRole("dialog", { name: "First screen" });
    expect(within(dialog).getByText("First caption")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders plain figures with captions when the lightbox is disabled", () => {
    render(<Gallery label="Screens" images={images} lightbox={false} />);
    const region = screen.getByRole("region", { name: "Screens" });
    expect(region).toHaveAttribute("data-lightbox", "disabled");
    expect(within(region).queryByRole("button")).toBeNull();
    expect(within(region).getAllByRole("figure")).toHaveLength(2);
    expect(within(region).getByText("First caption").tagName).toBe("FIGCAPTION");
  });
});

describe("section block samples", () => {
  it.each(Object.keys(SECTION_BLOCK_SAMPLES))("%s renders its sample content", name => {
    const { container } = render(<>{SECTION_BLOCK_SAMPLES[name]!()}</>);
    expect(container.textContent!.length).toBeGreaterThan(0);
  });
});
