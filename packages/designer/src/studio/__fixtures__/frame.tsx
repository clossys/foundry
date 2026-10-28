import type { ReactNode } from "react";
import { render as renderView, screen, waitFor, within } from "@testing-library/react";
import type { StudioLabels } from "../types.js";
import { labels as fixtureLabels } from "./studio.js";
import { FrameSlotProvider, FrameSlotOutlet } from "../../shell/FrameSlots.js";
import { FrameNoticeProvider } from "../../frames/frame-notices.js";

/** Real frame registration and portal hosts, without testing frame geometry here. */
function TestFrame({ children }: { children: ReactNode }) {
  return <FrameSlotProvider><FrameNoticeProvider>{children}</FrameNoticeProvider><FrameSlotOutlet slot="dock-tab" /><FrameSlotOutlet slot="dock-strip" /><FrameSlotOutlet slot="right-panel" /></FrameSlotProvider>;
}
export function render(children: ReactNode) { return renderView(children, { wrapper: TestFrame }); }
/**
 * DESIGNER-RO: the removed save status ("saved") used to be the loaded signal. A value canvas mounts its candidate
 * style sheet, and a contract canvas its library boards, only once the library has loaded, so either marks the same
 * moment without any save state.
 */
export const studioReady = (timeout = 15_000) => waitFor(() => { if (!document.querySelector("[data-designer-page][data-designer-ready]")) throw new Error("Studio library not loaded"); }, { timeout });

/** The rail's cards, in rendered order. */
export const railCards = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>("[data-studio-rail-card]")];
/** The rail card with this id. */
export const railCard = (id: "explorer" | "inspector" | "map" | "zoom"): HTMLElement | null => document.querySelector<HTMLElement>(`[data-studio-rail-card="${id}"]`);
/** The explorer tree's top-level (layer) rows, by label. */
export const layerRows = (label: string): HTMLElement[] => within(screen.getByRole("treegrid", { name: label })).getAllByRole("row").filter(row => row.getAttribute("aria-level") === "1");

/** The pointer a test drives: a user-event session's `click`. */
export interface ClickUser { click(target: Element): Promise<void> }
/** Choose a layer with the explorer's layer select; the page has no layer tabs. Shows a hidden rail first. */
export async function chooseLayer(labels: Pick<StudioLabels, "layers" | "rail">, name: string, user: ClickUser): Promise<void> {
  const show = screen.queryAllByRole("button", { name: labels.rail.show })[0];
  if (show) await user.click(show);
  // Re-query each time: a layer change can swap the canvas (and its rail) for another layer kind.
  const trigger = () => screen.getByRole("button", { name: new RegExp(`${labels.layers.label}$`) });
  const current = await waitFor(trigger);
  if (current.textContent?.trim() === name) return;
  await user.click(current);
  await user.click(await screen.findByRole("option", { name }));
  await waitFor(() => { const shown = trigger().textContent?.trim(); if (shown !== name) throw new Error(`layer select shows ${shown}, not ${name}`); });
}

/** The explorer card's layer select: present from the first paint, as the layer tabs were. */
export const findLayerSelect = (labels: Pick<StudioLabels, "layers"> = fixtureLabels): Promise<HTMLElement> => screen.findByRole("button", { name: new RegExp(`${labels.layers.label}$`) });
