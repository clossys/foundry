import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SiteHeader } from "../../shell/SiteHeader.js";
import { Link } from "../../components/Link.js";
import { FrameNavDisclosure } from "./FrameNavDisclosure.client.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([false, true])("keeps token-driven disclosure motion and closes inert (reduced=%s)", async reduced => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("prefers-reduced-motion") && reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const finishes: (() => void)[] = [];
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel, finished: new Promise<void>(resolve => finishes.push(resolve)) } as unknown as Animation));
  const prior = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  try {
    render(<SiteHeader surface="glass" brand={<Link href="#home">Home</Link>} nav={<FrameNavDisclosure trigger="icon" aria-label="Primary" triggerLabel="Menu"><Link href="#help">Help</Link></FrameNavDisclosure>} />);
    const toggle = screen.getByRole("button", { name: "Menu" });
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    panel.style.setProperty("--site-header-panel-duration", "240ms");
    panel.style.setProperty("--site-header-panel-shift", "var(--spacing-sm)");
    panel.style.setProperty("--site-header-panel-ease", "var(--ease-default)");
    expect(toggle).toHaveClass("bg-transparent");
    expect(toggle).not.toHaveClass("bg-action");
    expect(panel).toHaveAttribute("inert");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(panel).not.toHaveAttribute("inert");
    if (reduced) expect(animate).not.toHaveBeenCalled();
    else {
      expect(animate).toHaveBeenCalledWith([
        { opacity: "0", transform: "translateY(var(--spacing-sm))" }, { opacity: "1", transform: "none" },
      ], { duration: 240, easing: "var(--ease-default)", fill: "both" });
      expect(panel).toHaveAttribute("data-present");
      await act(async () => finishes[0]!());
      expect(panel).not.toHaveAttribute("data-present");
    }
    act(() => screen.getByRole("link", { name: "Help" }).focus());
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
    expect(panel).toHaveAttribute("inert");
    if (reduced) expect(panel).not.toHaveAttribute("data-present");
    else {
      expect(panel).toHaveAttribute("data-present");
      await act(async () => finishes[1]!());
      expect(panel).not.toHaveAttribute("data-present");
    }
  } finally {
    if (prior) Object.defineProperty(HTMLElement.prototype, "animate", prior);
    else delete (HTMLElement.prototype as { animate?: unknown }).animate;
  }
});
