import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group.js";

it("keeps horizontal inline edges logical and vertical block edges intact in RTL", () => {
  render(<div dir="rtl"><ToggleGroup aria-label="Emphasis" spacing={0} variant="outline"><ToggleGroupItem id="first">First</ToggleGroupItem><ToggleGroupItem id="last">Last</ToggleGroupItem></ToggleGroup></div>);
  const item = screen.getByText("First").closest("button")!;
  expect(item.closest('[dir="rtl"]')).not.toBeNull();
  for (const token of ["first:rounded-s-(--radius-control)", "last:rounded-e-(--radius-control)", "border-s-0", "first:border-s-(length:--ui-border-hairline)", "has-data-[icon=inline-end]:pe-(--spacing-sm)", "has-data-[icon=inline-start]:ps-(--spacing-sm)", "first:rounded-t-(--radius-control)", "last:rounded-b-(--radius-control)"]) expect(item.className).toContain(token);
  expect(item.className).not.toMatch(/:(?:rounded-[lr]|border-l|pr|pl)-/);
});
