import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { boardOf } from "./__fixtures__/library-board-dom.js";
import { render } from "./__fixtures__/frame.js";
import userEvent from "@testing-library/user-event";
import { Studio as StudioSurface, StudioProvider, StudioRightPanel, type StudioProps } from "./index.js";
function Studio(props: StudioProps) { return <StudioProvider {...props}><StudioSurface /><StudioRightPanel /></StudioProvider>; }
import { studioEngine } from "./engine.js";
import { applyLibraryChange, libraryHash } from "../catalog-core/index.js";
import { labels, smallCatalog, adopt, emptyLibrary } from "./__fixtures__/studio.js";

// Keep the real engine, with a mutable seam so calls from the provider and canvas can be counted together.
vi.mock("./engine.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./engine.js")>();
  return { ...actual, studioEngine: { ...actual.studioEngine } };
});

it("preserves actual Designer errors and unavailable candidates independently of browser form validation", async () => {
  const base = emptyLibrary();
  const library = applyLibraryChange(smallCatalog, base, { baseHash: libraryHash(base), changes: [
    { op: "author", slot: "tokens.surface-color", tokens: { base: { $type: "color", $value: "red; color: blue" } } },
  ] });
  const expected = studioEngine.check({ catalog: smallCatalog, library, resolved: studioEngine.resolve({ catalog: smallCatalog, library }) });
  const errors = expected.findings.filter(finding => finding.code === "C1" && finding.severity === "error");
  expect(errors.length).toBeGreaterThan(0);
  render(<Studio catalog={smallCatalog} adapter={{ load: async () => ({ library }), save: async () => ({ ok: false, reason: "unavailable" }) }}
    labels={labels} initialSlotId="tokens.surface-color" />);
  await screen.findByRole("link", { name: "Tokens" });
  fireEvent.click(within((await waitFor(() => boardOf("tokens.surface-color")!))).getByRole("button", { name: labels.board.changeSelection }));
  fireEvent.focus(screen.getByRole("radio", { name: labels.useSource(library.source.id, "tokens.surface-color") }));
  expect(screen.getByRole("radio", { name: labels.useSource(library.source.id, "tokens.surface-color") })).toBeDisabled();
  expect(document.querySelector("[data-studio-preview]")).toBeNull();
  await userEvent.setup().click(screen.getByRole("button", { name: labels.scorecard.title }));
  const score = screen.getByRole("region", { name: labels.scorecard.title });
  for (const finding of errors) expect(score.textContent).toContain(finding.message);
  expect(score.textContent).toContain(labels.scorecard.counts(expected.findings.filter(finding => finding.severity === "error").length,
    expected.findings.filter(finding => finding.severity === "notice").length));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });

it("does no additional adoption, resolution, checking or emission on focus, score, search and filter rerenders", async () => {
  const apply = vi.spyOn(studioEngine, "applyLibraryChange");
  const resolve = vi.spyOn(studioEngine, "resolve");
  const check = vi.spyOn(studioEngine, "check");
  const emit = vi.spyOn(studioEngine, "emit");
  // An asset board: token boards offer presets (Custom only), so a source radio cell is an asset or component one.
  const library = adopt(adopt(), "assets.icon-search", "lucide");
  const adapter = { load: async () => ({ library }), save: async () => ({ ok: false as const, reason: "unavailable" as const }) };
  render(<Studio catalog={smallCatalog} adapter={adapter} labels={labels} initialSlotId="assets.icon-search" />);
  await screen.findByRole("link", { name: "Tokens" });
  fireEvent.click(within((await waitFor(() => boardOf("assets.icon-search")!))).getByRole("button", { name: labels.board.changeSelection }));
  // Request this row once; subsequent focus and display changes must reuse its checked candidates.
  fireEvent.focus(screen.getByRole("radio", { name: labels.useSource("lucide", "assets.icon-search") }));
  const count = () => [apply.mock.calls.length, resolve.mock.calls.length, check.mock.calls.length, emit.mock.calls.length];
  const before = count();
  expect(before.every(value => value > 0)).toBe(true);
  const css = document.querySelector("[data-studio-candidates]")?.textContent;
  const live = document.querySelector("[data-studio-preview]")?.textContent;
  const user = userEvent.setup();
  fireEvent.focus(screen.getByRole("radio", { name: labels.useSource("lucide", "assets.icon-search") }));
  expect(document.querySelector('[data-studio-panel="inspector"]')).not.toBeNull();
  await user.click(screen.getByRole("button", { name: labels.scorecard.title }));
  expect(screen.getByRole("region", { name: labels.scorecard.title })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: labels.scorecard.close }));
  const search = screen.getByRole("searchbox", { name: labels.canvas.search });
  fireEvent.change(search, { target: { value: "surface" } });
  expect(search).toHaveValue("surface");
  await user.click(screen.getByRole("button", { name: labels.canvas.filters.all }));
  await user.click(screen.getByRole("menuitem", { name: labels.canvas.filters.warnings }));
  expect(screen.getByRole("button", { name: labels.canvas.filters.warnings })).toBeInTheDocument();
  expect(count()).toEqual(before);
  expect(document.querySelector("[data-studio-candidates]")?.textContent).toBe(css);
  expect(document.querySelector("[data-studio-preview]")?.textContent).toBe(live);
});
