// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StudioTopBar } from "./StudioTopBar.js";
import { STUDIO_LAYERS } from "./layer-navigation.js";
import { labels } from "./__fixtures__/studio.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("renders plain host layer names with one visibly selected tab and no console-root link", () => {
  render(<StudioTopBar labels={labels} layer="assets" layers={["tokens", "assets"]} onLayer={vi.fn(async () => true)} />);
  const nav = screen.getByRole("navigation", { name: labels.layers.label });
  const links = within(nav).getAllByRole("link");
  expect(links).toHaveLength(STUDIO_LAYERS.length);
  expect(links.map(link => link.textContent)).toEqual(STUDIO_LAYERS.map(id => labels.layers[id]));
  for (const link of links) expect(link.textContent).not.toMatch(/·|Signed/);
  const selected = within(nav).getByRole("link", { name: "Assets" });
  expect(selected).toHaveAttribute("aria-current", "page");
  expect(selected).toHaveAttribute("data-selected", "true");
  const tokens = within(nav).getByRole("link", { name: "Tokens" });
  expect(tokens).not.toHaveAttribute("aria-current");
  expect(tokens).not.toHaveAttribute("data-selected");
  expect(selected.className).not.toBe(tokens.className);
  expect(nav.querySelectorAll("[data-selected]")).toHaveLength(1);
  for (const link of [tokens, selected]) expect(link.getAttribute("href")).toMatch(/^#studio-layer=/);
  expect(nav.querySelectorAll("a[href]:not([href*='studio-layer='])")).toHaveLength(0);
});
