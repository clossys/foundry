import { expect } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StudioLabels } from "../types.js";

/** The rail's cards, in rendered order. */
export const railCards = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>("[data-studio-rail-card]")];
/** The rail card with this id. */
export const railCard = (id: "explorer" | "inspector" | "map" | "zoom"): HTMLElement | null => document.querySelector<HTMLElement>(`[data-studio-rail-card="${id}"]`);
/** The explorer tree's top-level (layer) rows, by label. */
export const layerRows = (label: string): HTMLElement[] => within(screen.getByRole("treegrid", { name: label })).getAllByRole("row").filter(row => row.getAttribute("aria-level") === "1");

/** Choose a layer with the explorer's layer select; the page has no layer tabs. Shows a hidden rail first. */
export async function chooseLayer(labels: Pick<StudioLabels, "layers" | "rail">, name: string, user = userEvent.setup()): Promise<void> {
  const show = screen.queryAllByRole("button", { name: labels.rail.show })[0];
  if (show) await user.click(show);
  const trigger = await waitFor(() => screen.getByRole("button", { name: new RegExp(`${labels.layers.label}$`) }));
  if (trigger.textContent?.trim() === name) return;
  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name }));
  await waitFor(() => expect(trigger.textContent?.trim()).toBe(name));
}
