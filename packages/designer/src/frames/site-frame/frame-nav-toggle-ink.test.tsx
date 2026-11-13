// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { INVERSE_CONTROL_INK } from "../../components/button-classes.js";
import { NavDisclosure } from "../../shell/NavDisclosure.js";
import { FrameNavDisclosure } from "./FrameNavDisclosure.client.js";

afterEach(cleanup);

/** Both navigation toggles take the stock ghost Button; the inverse plate adds the inverse control ink. */
const toggles: Record<string, (tone?: "inverse") => ReactElement> = {
  frame: tone => <FrameNavDisclosure aria-label="Primary" triggerLabel="Menu" closeLabel="Close" tone={tone}><a href="/a">A</a></FrameNavDisclosure>,
  shell: tone => <NavDisclosure aria-label="Primary" triggerLabel="Menu" tone={tone}><a href="/a">A</a></NavDisclosure>,
};
const ink = INVERSE_CONTROL_INK.split(" ");

it.each(["frame", "shell"])("draws an inverse %s navigation toggle in the inverse ink and keeps the stock ghost look on the base ground", name => {
  render(toggles[name]!());
  const base = screen.getByRole("button", { name: "Menu" });
  for (const token of ink) expect(base).not.toHaveClass(token);
  cleanup();
  render(toggles[name]!("inverse"));
  const inverse = screen.getByRole("button", { name: "Menu" });
  expect(inverse).toHaveAttribute("data-tone", "inverse");
  for (const token of ink) expect(inverse).toHaveClass(token);
});
