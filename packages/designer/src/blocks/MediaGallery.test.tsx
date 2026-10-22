import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { I18nProvider } from "react-aria-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChevronLeft } from "../icons/ChevronLeft.js";
import { ChevronRight } from "../icons/ChevronRight.js";
import { MediaGallery, type MediaGalleryItem, type MediaGalleryProps } from "./MediaGallery.js";

function items(count = 3): MediaGalleryItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `panel-${index}`,
    alt: `Panel ${index + 1}`,
    thumbnail: <svg role="img" aria-label={`Thumbnail ${index + 1}`} viewBox="0 0 40 30"><path d="M0 0h40v30H0z" /></svg>,
    full: <svg role="img" aria-label={`Full panel ${index + 1}`} viewBox="0 0 40 30"><path d="M0 0h40v30H0z" /></svg>,
    caption: index === 1 ? "A view of the courtyard." : undefined,
  }));
}

function props(overrides: Partial<MediaGalleryProps> = {}): MediaGalleryProps {
  return {
    items: items(),
    openLabel: alt => `Inspect ${alt}`,
    closeLabel: "Dismiss image",
    previousLabel: "Earlier panel",
    nextLabel: "Later panel",
    positionLabel: (index, total) => `Panel ${index} out of ${total}`,
    ...overrides,
  };
}

describe("MediaGallery", () => {
  afterEach(() => document.documentElement.removeAttribute("dir"));

  it("opens the chosen image and restores that thumbnail on Escape (mutant: restore the first thumbnail)", async () => {
    const user = userEvent.setup();
    render(<MediaGallery {...props()} />);
    const thumbnail = screen.getByRole("button", { name: "Inspect Panel 2" });
    await user.click(thumbnail);
    const dialog = await screen.findByRole("dialog", { name: "Panel 2" });
    expect(within(dialog).getByRole("img", { name: "Full panel 2" })).toBeInTheDocument();
    expect(within(dialog).getByText("A view of the courtyard.")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(thumbnail).toHaveFocus());
  });

  // The lightbox is portalled outside the host's DOM subtree, so a provider's
  // direction never reaches it through inheritance (mutant: read the direction
  // from the portal only, or ignore the provider).
  const DIRECTION_CASES: Array<[string, "ltr" | "rtl", (gallery: ReactElement) => ReactElement, string | undefined]> = [
    ["I18nProvider ar on an ltr document", "rtl", gallery => <I18nProvider locale="ar">{gallery}</I18nProvider>, undefined],
    ["I18nProvider en on an ltr document", "ltr", gallery => <I18nProvider locale="en">{gallery}</I18nProvider>, undefined],
    ["document dir ltr", "ltr", gallery => gallery, "ltr"],
    ["document dir rtl", "rtl", gallery => gallery, "rtl"],
    ["host dir rtl wrapper", "rtl", gallery => <div dir="rtl">{gallery}</div>, undefined],
  ];

  it.each(DIRECTION_CASES)("mirrors arrow keys and chevrons for %s (mutant: no RTL mirroring)", async (_name, direction, wrap, documentDir) => {
    const user = userEvent.setup();
    if (documentDir) document.documentElement.setAttribute("dir", documentDir);
    render(wrap(<MediaGallery {...props()} />));
    const [previousKey, nextKey] = direction === "rtl" ? ["ArrowRight", "ArrowLeft"] : ["ArrowLeft", "ArrowRight"];
    await user.click(screen.getByRole("button", { name: "Inspect Panel 2" }));
    await screen.findByRole("dialog", { name: "Panel 2" });
    const previousButton = screen.getByRole("button", { name: "Earlier panel" });
    const nextButton = screen.getByRole("button", { name: "Later panel" });
    expect(previousButton.querySelector("path")).toHaveAttribute("d", ChevronLeft[0]![1].d);
    expect(nextButton.querySelector("path")).toHaveAttribute("d", ChevronRight[0]![1].d);
    // The chevrons turn through the rtl variant, which needs the resolved
    // direction on the portalled content itself (mutant: drop the class or the dir).
    expect(previousButton).toHaveClass("rtl:rotate-180");
    expect(nextButton).toHaveClass("rtl:rotate-180");
    const directionRoot = previousButton.closest("[dir]");
    expect(directionRoot).toHaveAttribute("dir", direction);
    expect(screen.getByRole("dialog")).toContainElement(directionRoot as HTMLElement);
    await user.keyboard(`{${previousKey}}`);
    expect(screen.getByRole("dialog", { name: "Panel 1" })).toBeInTheDocument();
    await user.keyboard(`{${nextKey}}`);
    expect(screen.getByRole("dialog", { name: "Panel 2" })).toBeInTheDocument();
    await user.keyboard(`{${nextKey}}`);
    expect(screen.getByRole("dialog", { name: "Panel 3" })).toBeInTheDocument();
  });

  it("disables boundary controls without wrapping and retains focus inside (mutant: wrap)", async () => {
    const user = userEvent.setup();
    render(<MediaGallery {...props()} />);
    await user.click(screen.getByRole("button", { name: "Inspect Panel 2" }));
    await screen.findByRole("dialog");
    const next = screen.getByRole("button", { name: "Later panel" });
    next.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("dialog", { name: "Panel 3" })).toBeInTheDocument();
    expect(next).toBeDisabled();
    expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).not.toBe(next);
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("dialog", { name: "Panel 3" })).toBeInTheDocument();
    const previous = screen.getByRole("button", { name: "Earlier panel" });
    await user.click(previous);
    await user.click(previous);
    expect(screen.getByRole("dialog", { name: "Panel 1" })).toBeInTheDocument();
    expect(previous).toBeDisabled();
    expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).not.toBe(previous);
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("dialog", { name: "Panel 1" })).toBeInTheDocument();
  });

  it("jumps with Home and End (mutant: omit Home or End)", async () => {
    const user = userEvent.setup();
    render(<MediaGallery {...props()} />);
    await user.click(screen.getByRole("button", { name: "Inspect Panel 2" }));
    await screen.findByRole("dialog");
    await user.keyboard("{End}");
    expect(screen.getByRole("dialog", { name: "Panel 3" })).toBeInTheDocument();
    await user.keyboard("{Home}");
    expect(screen.getByRole("dialog", { name: "Panel 1" })).toBeInTheDocument();
  });

  it.each(["click", "keyboard"])("transfers focus to newly enabled arrows across two-item boundaries using %s", async interaction => {
    const user = userEvent.setup();
    render(<MediaGallery {...props({ items: items(2) })} />);
    await user.click(screen.getByRole("button", { name: "Inspect Panel 1" }));
    await screen.findByRole("dialog", { name: "Panel 1" });
    const previous = screen.getByRole("button", { name: "Earlier panel" });
    const next = screen.getByRole("button", { name: "Later panel" });
    expect(previous).toBeDisabled();
    if (interaction === "click") await user.click(next);
    else {
      next.focus();
      await user.keyboard("{ArrowRight}");
    }
    expect(screen.getByRole("dialog", { name: "Panel 2" })).toBeInTheDocument();
    expect(next).toBeDisabled();
    expect(previous).toBeEnabled();
    expect(previous).toHaveFocus();
    if (interaction === "click") await user.click(previous);
    else await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("dialog", { name: "Panel 1" })).toBeInTheDocument();
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();
    expect(next).toHaveFocus();
  });

  it("retains focus on newly enabled arrows after End and Home in a two-item gallery", async () => {
    const user = userEvent.setup();
    render(<MediaGallery {...props({ items: items(2) })} />);
    await user.click(screen.getByRole("button", { name: "Inspect Panel 1" }));
    await screen.findByRole("dialog", { name: "Panel 1" });
    const previous = screen.getByRole("button", { name: "Earlier panel" });
    const next = screen.getByRole("button", { name: "Later panel" });
    expect(previous).toBeDisabled();
    next.focus();
    await user.keyboard("{End}");
    expect(screen.getByRole("dialog", { name: "Panel 2" })).toBeInTheDocument();
    expect(next).toBeDisabled();
    expect(previous).toBeEnabled();
    expect(previous).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("dialog", { name: "Panel 1" })).toBeInTheDocument();
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();
    expect(next).toHaveFocus();
  });

  it("keeps focus on an arrow that remains enabled after navigation", async () => {
    const user = userEvent.setup();
    render(<MediaGallery {...props()} />);
    await user.click(screen.getByRole("button", { name: "Inspect Panel 1" }));
    await screen.findByRole("dialog");
    const next = screen.getByRole("button", { name: "Later panel" });
    const previous = screen.getByRole("button", { name: "Earlier panel" });
    await user.click(next);
    expect(screen.getByRole("dialog", { name: "Panel 2" })).toBeInTheDocument();
    expect(next).toBeEnabled();
    expect(next).toHaveFocus();
    await user.click(next);
    expect(previous).toHaveFocus();
    await user.click(previous);
    expect(screen.getByRole("dialog", { name: "Panel 2" })).toBeInTheDocument();
    expect(previous).toBeEnabled();
    expect(previous).toHaveFocus();
  });

  it("keeps the shown item after sixty seconds (mutant: interval autoplay)", async () => {
    // Leave user-event and React Aria scheduling real; the planted autoplay
    // mutant uses an interval, which is the clock this assertion exercises.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const user = userEvent.setup();
      render(<MediaGallery {...props()} />);
      await user.click(screen.getByRole("button", { name: "Inspect Panel 2" }));
      expect(screen.getByRole("dialog", { name: "Panel 2" })).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(screen.getByRole("dialog", { name: "Panel 2" })).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Panel 2 out of 3");
    } finally {
      cleanup();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it.each([1, 25])("rejects %i items (mutant: allow twenty-five)", count => {
    expect(() => render(<MediaGallery {...props({ items: items(count) })} />)).toThrow(/^MediaGallery:/);
  });

  it.each([2, 24])("renders the supported boundary of %i items", count => {
    render(<MediaGallery {...props({ items: items(count) })} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(count);
  });

  it("uses host thumbnail names and live position text (mutant: ignore positionLabel)", async () => {
    const user = userEvent.setup();
    const data = props({ positionLabel: (index, total) => `${index} / ${total} selected` });
    render(<MediaGallery {...data} />);
    expect(screen.getAllByRole("button").map(button => button.getAttribute("aria-label"))).toEqual(data.items.map(item => data.openLabel(item.alt)));
    await user.click(screen.getByRole("button", { name: "Inspect Panel 2" }));
    await screen.findByRole("dialog");
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("2 / 3 selected");
    await user.click(screen.getByRole("button", { name: "Dismiss image" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("uses the four-column desktop square layout and root attributes (mutant: ignore columns)", () => {
    render(<MediaGallery {...props({ columns: 4, aspect: "1:1", "aria-label": "Courtyard images", className: "gap-lg", style: { marginBlockStart: 0 } })} />);
    const list = screen.getByRole("list", { name: "Courtyard images" });
    expect(list.tagName).toBe("UL");
    expect(list).toHaveClass("grid-cols-2", "tablet:grid-cols-3", "desktop:grid-cols-4", "gap-lg");
    expect(list).toHaveStyle({ marginBlockStart: 0 });
    for (const button of screen.getAllByRole("button")) expect(button).toHaveClass("aspect-square");
  });

  it.each([
    ["base", "text-ink-primary", "focus-visible:outline-accent"],
    ["sunken", "text-ink-primary", "focus-visible:outline-accent"],
    ["inverse", "text-ink-on-inverse", "focus-visible:outline-accent-on-inverse"],
  ] as const)("applies %s ground to the thumbnail list and focus indicators", (ground, ink, outline) => {
    render(<MediaGallery {...props({ ground })} />);
    expect(screen.getByRole("list")).toHaveClass(ink);
    if (ground !== "base") expect(screen.getByRole("list")).toHaveClass(`bg-surface-${ground}`);
    for (const button of screen.getAllByRole("button")) expect(button).toHaveClass(outline);
  });

  it("bounds owned media viewports while preserving opaque host nodes", async () => {
    const user = userEvent.setup();
    const data = items();
    data[0]!.thumbnail = <span data-testid="host-thumbnail" style={{ inlineSize: "200%" }}>Courtyard detail</span>;
    data[0]!.full = <span data-testid="host-full" style={{ blockSize: "200%" }}>Courtyard panorama</span>;
    render(<MediaGallery {...props({ items: data })} />);
    const thumbnail = screen.getByTestId("host-thumbnail");
    expect(thumbnail).toHaveStyle({ inlineSize: "200%" });
    expect(thumbnail.parentElement).toHaveClass("absolute", "inset-0", "overflow-hidden");
    await user.click(screen.getByRole("button", { name: "Inspect Panel 1" }));
    await screen.findByRole("dialog", { name: "Panel 1" });
    const full = screen.getByTestId("host-full");
    expect(full).toHaveStyle({ blockSize: "200%" });
    expect(full.parentElement).toHaveClass("max-h-[60vh]", "max-w-full", "overflow-auto");
  });

  it("focuses boundary arrows only after their disabled state commits", async () => {
    const attempts: Array<{ name: string; disabled: boolean }> = [];
    const nativeFocus = HTMLButtonElement.prototype.focus;
    const focusSpy = vi.spyOn(HTMLButtonElement.prototype, "focus").mockImplementation(function (this: HTMLButtonElement, options?: FocusOptions) {
      const name = this.getAttribute("aria-label");
      if (name === "Earlier panel" || name === "Later panel") attempts.push({ name, disabled: this.disabled });
      nativeFocus.call(this, options);
    });
    try {
      const user = userEvent.setup();
      render(<MediaGallery {...props({ items: items(2) })} />);
      await user.click(screen.getByRole("button", { name: "Inspect Panel 1" }));
      await screen.findByRole("dialog", { name: "Panel 1" });
      attempts.length = 0;
      const previous = screen.getByRole("button", { name: "Earlier panel" });
      const next = screen.getByRole("button", { name: "Later panel" });
      await user.click(next);
      expect(previous).toHaveFocus();
      await user.click(previous);
      expect(next).toHaveFocus();
      expect(attempts.map(attempt => attempt.name)).toContain("Earlier panel");
      expect(attempts.map(attempt => attempt.name)).toContain("Later panel");
      expect(attempts.every(attempt => !attempt.disabled)).toBe(true);

      const close = screen.getByRole("button", { name: "Dismiss image" });
      close.focus();
      attempts.length = 0;
      await user.keyboard("{End}{Home}");
      expect(close).toHaveFocus();
      expect(attempts).toHaveLength(0);
    } finally {
      focusSpy.mockRestore();
    }
  });
});
