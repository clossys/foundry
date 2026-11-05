import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { FeatureLayouts } from "./FeatureLayouts.js";
import type { FeatureLayoutItem } from "./types.js";
import { SemanticContent } from "../../components/SemanticContent.js";
import { Suspense } from "react";
import { MarketingComponentProvider } from "../../studio/marketing-component-selection.js";

const items: FeatureLayoutItem[] = [
  { id: "one", heading: "First feature", description: "First detail", visual: <SemanticContent as="div">First figure</SemanticContent>, span: "two-thirds" },
  { id: "two", heading: "Second feature", description: "Second detail", visual: <SemanticContent as="div">Second figure</SemanticContent>, span: "third" },
];
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("features members", () => {
  it("uses the canonical bento engine and its ordered twelve-unit spans", () => {
    const view = render(<FeatureLayouts ground="base" heading="Capabilities" items={items} layout="bento" />);
    expect(view.container.querySelector('[data-arrangement="bento"]')).not.toBeNull();
    expect(view.container.querySelector('[data-span="two-thirds"]')).not.toBeNull();
    expect(view.container.querySelector('[data-span="third"]')).not.toBeNull();
    expect(screen.getByText("First figure")).toBeInTheDocument();
    expect(() => renderToString(<FeatureLayouts ground="base" items={Array.from({ length: 7 }, (_, i) => ({ id: String(i), heading: String(i) }))} layout="bento" />)).toThrow(/2-6/);
    expect(() => renderToString(<FeatureLayouts ground="base" items={[{ ...items[0]!, span: "half" }, { ...items[1]!, span: "third" }]} layout="bento" />)).toThrow(/12-unit/);
  });

  it("delegates tab selection and arrow keys to the existing Tabs component", async () => {
    const user = userEvent.setup();
    const view = render(<MarketingComponentProvider><Suspense><FeatureLayouts ground="base" heading="Capabilities" items={items} layout="tabs" /></Suspense></MarketingComponentProvider>);
    expect(await screen.findByRole("tablist")).toHaveAccessibleName("Capabilities");
    expect(view.container.querySelector('[data-slot="tabs"]')).not.toBeNull();
    const first = screen.getByRole("tab", { name: "First feature" });
    await user.click(first);
    await user.keyboard("{ArrowRight}");
    const second = screen.getByRole("tab", { name: "Second feature" });
    await waitFor(() => expect(second).toHaveAttribute("aria-selected", "true"));
    expect(second).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Second feature");
    expect(screen.getByText("Second figure")).toBeInTheDocument();
    await user.keyboard("{ArrowLeft}");
    await waitFor(() => expect(first).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("First feature");
  });

  it("requires a caller-authored accessible tab name and unique item ids", () => {
    expect(() => renderToString(<FeatureLayouts ground="base" items={items} layout="tabs" />)).toThrow(/authored/);
    expect(() => renderToString(<FeatureLayouts ground="base" heading="Capabilities" items={[items[0]!, items[0]!]} layout="tabs" />)).toThrow(/unique/);
  });

  it("alternates the logical figure column, mirrors under RTL, and stacks before tablet", () => {
    const view = render(<FeatureLayouts ground="base" items={items} layout="alternating" dir="rtl" />);
    expect(view.container.firstElementChild).toHaveAttribute("dir", "rtl");
    const figures = view.container.querySelectorAll("[data-feature-figure]");
    expect(figures[0]).toHaveClass("tablet:col-start-1");
    expect(figures[1]).toHaveClass("tablet:col-start-2");
    for (const row of view.container.querySelectorAll("[data-feature-row]")) expect(row).toHaveClass("grid-cols-1", "tablet:grid-cols-2");
    expect(view.container.textContent).toContain("First detail");
    expect(view.container.textContent).toContain("Second detail");
  });

  it("renders the complete static stack on the server without JavaScript", () => {
    const html = renderToString(<FeatureLayouts ground="base" items={items} layout="scroll" />);
    expect(html).toContain('data-features-scroll="static"');
    expect(html).not.toContain('data-feature-sticky=""');
    expect(html).not.toContain('data-feature-motion=""');
    for (const value of ["First figure", "Second figure", "First detail", "Second detail"]) expect(html).toContain(value);
  });

  function environment(reduced: boolean, supported = true) {
    let listener: (() => void) | undefined;
    const preference = { matches: reduced, addEventListener: vi.fn((_name: string, callback: () => void) => { listener = callback; }), removeEventListener: vi.fn() };
    vi.stubGlobal("matchMedia", vi.fn(() => preference));
    vi.stubGlobal("CSS", { supports: () => supported });
    const disconnect = vi.fn();
    const observe = vi.fn();
    let entries: IntersectionObserverCallback | undefined;
    class Observer {
      constructor(callback: IntersectionObserverCallback) { entries = callback; }
      observe = observe;
      disconnect = disconnect;
    }
    vi.stubGlobal("IntersectionObserver", Observer);
    return { preference, disconnect, observe, change(value: boolean) { preference.matches = value; act(() => listener?.()); }, step(target: Element) { act(() => entries?.([{ isIntersecting: true, target } as IntersectionObserverEntry], {} as IntersectionObserver)); } };
  }

  it("provides an immediate CSS reduced-motion fallback for sticky media and revealed copy", () => {
    const html = renderToString(<FeatureLayouts ground="base" items={items} layout="scroll" />);
    const media = html.slice(html.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(media).toContain("[data-feature-sticky], [data-feature-motion] { animation: none !important; transform: none !important; opacity: 1 !important; }");
    expect(media).toContain("[data-feature-sticky] { position: static !important; }");
  });

  it("keeps reduced motion static even when scroll support exists", () => {
    const env = environment(true);
    const view = render(<FeatureLayouts ground="base" items={items} layout="scroll" />);
    expect(view.container.querySelector("[data-features-scroll]")).toHaveAttribute("data-features-scroll", "static");
    expect(view.container.querySelector("[data-feature-sticky]")).toBeNull();
    expect(view.container.querySelector("[data-feature-motion]")).toBeNull();
    expect(env.observe).not.toHaveBeenCalled();
    expect(screen.getByText("First figure")).toBeInTheDocument();
    expect(screen.getByText("Second figure")).toBeInTheDocument();
  });

  it("uses static content when the scroll-driven animation capability is unavailable", () => {
    environment(false, false);
    const view = render(<FeatureLayouts ground="base" items={items} layout="scroll" />);
    expect(view.container.querySelector("[data-features-scroll]")).toHaveAttribute("data-features-scroll", "static");
    expect(screen.getByText("Second figure")).toBeInTheDocument();
  });

  it("uses existing animation tokens, switches media by step, and reacts to reduced-motion changes", () => {
    const env = environment(false);
    const view = render(<FeatureLayouts ground="base" items={items} layout="scroll" />);
    const sticky = view.container.querySelector("[data-feature-sticky]") as HTMLElement;
    expect(sticky).toHaveClass("tablet:sticky");
    expect(sticky.style.animation).toBe("var(--animate-scroll-sticky)");
    expect((view.container.querySelector("[data-feature-motion]") as HTMLElement).style.animation).toBe("var(--animate-scroll-reveal)");
    expect(view.container.querySelector("[data-feature-motion]")).toHaveAttribute("data-designer-reveal", "");
    expect(view.container.textContent).not.toContain("@keyframes features-reveal");
    expect(view.container.textContent).toContain("@keyframes reveal");
    expect(env.observe).toHaveBeenCalledTimes(2);
    env.step(view.container.querySelectorAll("[data-feature-step]")[1]!);
    expect(sticky).toHaveTextContent("Second figure");
    env.change(true);
    expect(view.container.querySelector("[data-feature-sticky]")).toBeNull();
    expect(view.container.querySelector("[data-feature-motion]")).toBeNull();
    expect(screen.getByText("First figure")).toBeInTheDocument();
    expect(screen.getByText("Second figure")).toBeInTheDocument();
    expect(env.disconnect).toHaveBeenCalled();
  });
});
