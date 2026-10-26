// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppFrame } from "../frames/AppFrame.js";
import { StudioProvider } from "./StudioProvider.js";
import { Studio } from "./Studio.js";
import type { StudioAdapter } from "./types.js";
import { labels, smallCatalog } from "./__fixtures__/studio.js";

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media !== "not all", addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("submits a failed library load to the frame notice region instead of rendering its own Banner", async () => {
  const adapter: StudioAdapter = { load: vi.fn(async () => { throw new Error("offline"); }), save: vi.fn() };
  render(<AppFrame brand={{ markSrc: "/mark.svg" }} navigation={{ tree: [{ id: "home", label: "Home", href: "#home" }], label: "Workspace navigation", navigationKey: "home" }}
    account={{ signedOutLabel: "Account", sections: [] }} commands={{ heading: "Commands", triggerLabel: "Find commands", searchLabel: "Search commands", closeLabel: "Close commands", emptyMessage: "No commands", groups: [] }}>
    <StudioProvider catalog={smallCatalog} initialSlotId="tokens.surface-color" adapter={adapter} labels={labels}><Studio header="external" /></StudioProvider>
  </AppFrame>);
  const message = await screen.findByText(labels.loadFailed);
  expect(document.querySelector('[data-application-frame-region="dock"] [data-frame-notices]')).toContainElement(message);
  expect(message.closest('[role="alert"]')).not.toBeNull();
  const canvas = document.querySelector<HTMLElement>("[data-studio-canvas]")!;
  expect(canvas).not.toContainElement(message);
  expect(canvas.querySelector('[role="alert"]')).toBeNull();
});
