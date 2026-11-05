// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { buttonLinkClassName } from "../../components/button-classes.js";
import { NavDisclosure } from "../../shell/NavDisclosure.js";
import { FrameNavDisclosure } from "./FrameNavDisclosure.client.js";

afterEach(cleanup);

// The ink the ghost look adds over the colourless outline look: what an inverse toggle must not carry.
const outline = buttonLinkClassName("outline", "sm").split(" ");
const ghostInk = buttonLinkClassName("ghost", "sm").split(" ").filter(token => token.startsWith("text-") && !outline.includes(token));

const toggles = {
  frame: (tone?: "inverse") => <FrameNavDisclosure aria-label="Primary" triggerLabel="Menu" closeLabel="Close" tone={tone}><a href="/a">A</a></FrameNavDisclosure>,
  shell: (tone?: "inverse") => <NavDisclosure aria-label="Primary" triggerLabel="Menu" tone={tone}><a href="/a">A</a></NavDisclosure>,
};

it("reads a ghost ink from the component", () => {
  expect(ghostInk.length).toBeGreaterThan(0);
});

it.each(Object.entries(toggles))("drops the ghost ink from an inverse %s navigation toggle and keeps it on the base ground", (_name, toggle) => {
  render(toggle());
  for (const token of ghostInk) expect(screen.getByRole("button", { name: "Menu" })).toHaveClass(token);
  cleanup();
  render(toggle("inverse"));
  for (const token of ghostInk) expect(screen.getByRole("button", { name: "Menu" })).not.toHaveClass(token);
});
