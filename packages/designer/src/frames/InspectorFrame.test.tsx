import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as frames from "./index.js";
import type { InspectorFrameProps } from "./InspectorFrame.js";

const InspectorFrame = (frames as Record<string, unknown>).InspectorFrame as (props: InspectorFrameProps) => JSX.Element;
const base: InspectorFrameProps = { label: "Details", handleLabel: "Resize details", closeLabel: "Close details", openLabel: "Show details", min: 220, max: 420, defaultValue: 280, step: 20, children: <p>Selected layer</p> };

describe("InspectorFrame", () => {
  it("is a public frames export: a named complementary aside with a resizable docked pane", () => {
    render(<InspectorFrame {...base} />);
    const aside = screen.getByRole("complementary", { name: "Details" });
    expect(aside.tagName).toBe("ASIDE");
    expect(aside).toHaveTextContent("Selected layer");
    const handle = screen.getByRole("separator", { name: "Resize details" });
    expect(handle).toHaveAttribute("aria-valuenow", "280");
    expect(handle).toHaveAttribute("aria-valuemin", "220");
    expect(handle).toHaveAttribute("aria-valuemax", "420");
  });

  it("reports width changes through the width port, clamped by min and max", async () => {
    const onChange = vi.fn(), user = userEvent.setup();
    render(<InspectorFrame {...base} value={410} onChange={onChange} />);
    screen.getByRole("separator").focus();
    await user.keyboard("{ArrowLeft}");
    const reported = onChange.mock.lastCall?.[0] as number;
    expect(reported).toBeLessThanOrEqual(420);
    expect(reported).toBeGreaterThanOrEqual(220);
    expect(reported).not.toBe(410);
  });

  it("hides the docked content while collapsed and reports the collapsed port", () => {
    const { rerender } = render(<InspectorFrame {...base} collapsed />);
    const aside = screen.getByRole("complementary", { hidden: true });
    expect(aside).toHaveAttribute("aria-label", "Details");
    expect(aside).toHaveAttribute("hidden");
    expect(screen.queryByRole("separator")).toBeNull();
    rerender(<InspectorFrame {...base} collapsed={false} />);
    expect(screen.getByRole("complementary", { name: "Details" })).not.toHaveAttribute("hidden");
  });

  it("presents as an overlay sheet that closes through the collapsed port", async () => {
    const onCollapsedChange = vi.fn(), user = userEvent.setup();
    render(<InspectorFrame {...base} presentation="overlay" collapsed={false} onCollapsedChange={onCollapsedChange} />);
    const dialog = await screen.findByRole("dialog", { name: "Details" });
    expect(dialog).toHaveTextContent("Selected layer");
    expect(screen.queryByRole("separator")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Close details" }));
    expect(onCollapsedChange).toHaveBeenLastCalledWith(true);
  });

  it("opens the overlay sheet from its open control through the collapsed port", async () => {
    const onCollapsedChange = vi.fn(), user = userEvent.setup();
    render(<InspectorFrame {...base} presentation="overlay" defaultCollapsed onCollapsedChange={onCollapsedChange} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show details" }));
    expect(onCollapsedChange).toHaveBeenLastCalledWith(false);
    expect(await screen.findByRole("dialog", { name: "Details" })).toHaveTextContent("Selected layer");
  });

  it("refuses inverted bounds", () => {
    expect(() => render(<InspectorFrame {...base} min={500} />)).toThrow(/InspectorFrame: min must not exceed max/);
  });
});

it("offers an initially closed sheet below the token-derived md breakpoint and restores opener focus", async () => {
  const user = userEvent.setup(), onCollapsedChange = vi.fn();
  const media = vi.fn((query: string) => ({ media: query, matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("matchMedia", media);
  try {
    render(<InspectorFrame {...base} onCollapsedChange={onCollapsedChange} />);
    expect(media).toHaveBeenCalledWith("(min-width: 768px)");
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    const opener = screen.getByRole("button", { name: "Show details" });
    await user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Details" });
    expect(dialog).toHaveTextContent("Selected layer");
    expect(dialog.querySelector('[data-drawer-placement="end"]')).not.toBeNull();
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
    await user.keyboard("{Escape}");
    await vi.waitFor(() => expect(opener).toHaveFocus());
  } finally { vi.unstubAllGlobals(); }
});
