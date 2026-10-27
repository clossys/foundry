import { afterEach, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { render } from "./__fixtures__/frame.js";
import userEvent from "@testing-library/user-event";
import { Studio } from "./index.js";
import { smallCatalog, labels, emptyLibrary } from "./__fixtures__/studio.js";
import { findLayerSelect, chooseLayer } from "./__fixtures__/rail.js";
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });
const mount = async () => { render(<Studio catalog={smallCatalog} adapter={{load:async () => ({library:emptyLibrary()}), save:async () => ({ok:false,reason:"unavailable"})}} labels={labels}/>); await findLayerSelect(); };
it("preserves the immersive world, keyboard pan, zoom controls and minimap", async () => {
  await mount(); const viewport=screen.getByRole("region", {name:"L-canvas"}); const world=document.querySelector<HTMLElement>("[data-studio-world]")!;
  await act(async () => {viewport.focus();}); const before=world.style.transform; fireEvent.keyDown(viewport,{key:"ArrowRight"}); expect(world.style.transform).not.toBe(before);
  expect(screen.getByRole("button",{name:"L-zoom-in"})).toBeInTheDocument(); expect(screen.getByRole("button",{name:"L-fit"})).toBeInTheDocument(); expect(document.querySelector('[data-studio-panel="minimap"]')).not.toBeNull();
});
it("keeps the explorer keyboard tree and layer-specific boards", async () => {
  const user=userEvent.setup(); await mount(); expect(screen.getByRole("treegrid",{name:"L-tree"})).toBeInTheDocument();
  await chooseLayer(labels, "Assets", user); expect(document.querySelector('[data-studio-canvas-board="assets/icons-navigation"]')).toBeNull(); expect(document.querySelector('[data-studio-canvas-board="assets/icons-actions"]')).not.toBeNull();
});
