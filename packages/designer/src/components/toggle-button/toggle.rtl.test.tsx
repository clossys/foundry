import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Toggle } from "./toggle.js";

it.each(["default", "sm", "lg"] as const)("uses inline icon padding in an RTL %s toggle", size => {
  render(<div dir="rtl"><Toggle size={size} aria-label="Emphasis"><span data-icon="inline-end">End</span></Toggle></div>);
  const toggle = screen.getByRole("button", { name: "Emphasis" });
  expect(toggle.closest('[dir="rtl"]')).not.toBeNull();
  expect(toggle.className).toContain("has-data-[icon=inline-end]:pe-(--spacing-sm)");
  expect(toggle.className).toContain("has-data-[icon=inline-start]:ps-(--spacing-sm)");
  expect(toggle.className).not.toMatch(/:(?:pr|pl)-/);
});
