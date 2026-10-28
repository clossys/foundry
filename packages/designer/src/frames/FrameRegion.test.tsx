import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FrameRegion } from "./FrameRegion.js";

it.each([
  ["header", "banner"], ["nav", "navigation"], ["main", "main"], ["aside", "complementary"],
] as const)("preserves the native %s landmark, frame attributes, ref and events", (as, role) => {
  const ref = createRef<HTMLElement>();
  const click = vi.fn();
  render(<FrameRegion as={as} ref={ref} aria-label="Frame region" data-application-frame-region="test" onClick={click}>Content</FrameRegion>);
  const region = screen.getByRole(role, { name: "Frame region" });
  expect(region.tagName).toBe(as.toUpperCase());
  expect(region).toHaveAttribute("data-application-frame-region", "test");
  expect(ref.current).toBe(region);
  fireEvent.click(region);
  expect(click).toHaveBeenCalledOnce();
});
