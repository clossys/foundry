import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StudioRail } from "./StudioRail.js";
import { labels } from "../__fixtures__/studio.js";

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

it("keeps native Card containers and existing disclosure and rail controls functional", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })));
  const action = vi.fn();
  const props = { labels, explorer: "Explorer content", explorerHeader: <button onClick={action}>Explorer action</button>, inspector: "Inspector content", map: "Map content", zoom: "Zoom content" };
  const { container } = render(<StudioRail {...props} />);
  const cards = [...container.querySelectorAll<HTMLElement>("[data-studio-rail-card]")];
  expect(cards.map(card => card.dataset.studioRailCard)).toEqual(["explorer", "inspector", "map", "zoom", "checks"]);
  for (const card of cards) {
    expect(card).toHaveAttribute("data-slot", "card");
    expect(card).not.toHaveAttribute("variant");
    expect(card.querySelector(":scope > [data-slot=card-content]")).not.toBeNull();
  }
  const user = userEvent.setup();
  const trigger = within(cards[0]!).getAllByRole("button").find(button => button.hasAttribute("aria-expanded"))!;
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  await user.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  await user.click(screen.getByRole("button", { name: "Explorer action" }));
  expect(action).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: labels.rail.hide }));
  expect(container.querySelectorAll("[data-studio-rail-card]")).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: labels.rail.show }));
  expect(container.querySelectorAll("[data-studio-rail-card]")).toHaveLength(5);
});
