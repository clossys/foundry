import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Kbd } from "./Kbd.js";

it("uses native keyboard text without introducing a focus target or changing its supplied presentation", () => {
  render(<Kbd className="text-caption text-ink-muted">Ctrl K</Kbd>);
  const hint = screen.getByText("Ctrl K");
  expect(hint.tagName).toBe("KBD");
  expect(hint).not.toHaveAttribute("tabindex");
  expect(hint).toHaveClass("text-caption", "text-ink-muted");
});
