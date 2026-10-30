import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { FlowCanvas } from "./FlowCanvas.js";

it("keeps forced-colors selection distinct from keyboard focus as focus moves", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<FlowCanvas nodes={[{ id: "a", label: "Draft" }, { id: "b", label: "Review" }]}
    edges={[{ from: "a", to: "b" }]} selectedId="a" label="Flow" emptyMessage="Empty" outgoingLabel="Next" />);
  const draft = screen.getByRole("button", { name: "Draft" });
  const review = screen.getByRole("button", { name: "Review" });
  await user.tab();
  expect(draft).toHaveFocus();
  expect(draft).toHaveClass("forced-colors:border-dashed", "forced-colors:border-current", "focus-visible:outline-solid");
  await user.keyboard("{ArrowRight}");
  expect(review).toHaveFocus();
  expect(draft).toHaveAttribute("aria-current", "true");
  expect(review).not.toHaveClass("forced-colors:border-dashed");
  for (const button of [draft, review]) expect(button).toHaveClass("border-solid", "focus-visible:outline-2", "focus-visible:outline-accent");
  rerender(<FlowCanvas nodes={[{ id: "a", label: "Draft" }, { id: "b", label: "Review" }]}
    edges={[]} selectedId="b" label="Flow" emptyMessage="Empty" outgoingLabel="Next" />);
  expect(review).toHaveClass("forced-colors:border-dashed");
  expect(draft).not.toHaveClass("forced-colors:border-dashed");
});

it("ships a forced-colors dashed border separately from the solid focus outline", () => {
  // Shipped CSS contract proof; jsdom does not measure Windows forced-colors painting.
  const css = readFileSync(resolve(import.meta.dirname, "../../styles/compiled.css"), "utf8");
  expect(css).toMatch(/@media\s*\(forced-colors:\s*active\)\s*\{\s*\.forced-colors\\:border-dashed\s*\{[^}]*border-style:\s*dashed/);
  expect(css).toMatch(/\.forced-colors\\:border-current\s*\{[^}]*border-color:\s*currentcolor/);
  expect(css).toMatch(/\.focus-visible\\:outline-solid:focus-visible\s*\{[^}]*outline-style:\s*solid/);
});
