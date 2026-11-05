import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StudioProvider } from "./StudioProvider.js";
import { StudioActions, type StudioActionsProps } from "./StudioActions.js";
import { StudioTitle } from "./StudioTitle.js";
import { studioOpenHrefs } from "./open-targets.js";
import { labels, smallCatalog, emptyLibrary } from "./__fixtures__/studio.js";
const adapter = { load: async () => ({ library: emptyLibrary() }), save: async () => ({ ok: false as const, reason: "unavailable" as const }) };
const targets = [ { id: "claude", label: "Claude Code", href: studioOpenHrefs.claude }, { id: "codex", label: "Codex", href: studioOpenHrefs.codex }, { id: "cursor", label: "Cursor", href: studioOpenHrefs.cursor } ];
const copyLabels = { openIn: "Open in", chooseTarget: "Choose target", copyPrompt: "Copy as prompt", copyLink: "Copy link to this view" };
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
function mount(props: Partial<StudioActionsProps> = {}) {
  const notice = vi.fn(); const launch = vi.fn<NonNullable<StudioActionsProps["launch"]>>(() => "dispatched" as const);
  render(<StudioProvider catalog={smallCatalog} adapter={adapter} labels={labels} initialSlotId="themes.background"><StudioTitle title="Designer" /><StudioActions projectPath="/workspace/example" taskPrompt="Explain this item" viewHref="https://example.test/designer#studio-layer=themes" openWithTargets={targets} labels={copyLabels} onNotice={notice} launch={launch} {...props} /></StudioProvider>);
  return { notice, launch };
}
it("renders a title and split action with no launch or copy before activation", () => {
  const { launch, notice } = mount(); expect(screen.getByRole("heading", { level: 1, name: "Designer" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Open in Claude Code" })).toBeVisible(); expect(launch).not.toHaveBeenCalled(); expect(notice).not.toHaveBeenCalled();
});
it("launches only on activation using the latest selected context and remembers the chosen target ID", async () => {
  const user = userEvent.setup(), { launch } = mount(); await user.click(screen.getByRole("button", { name: "Choose target" }));
  await user.click(screen.getByRole("menuitem", { name: "Codex" }));
  expect(launch).toHaveBeenCalledTimes(1); const url = new URL(launch.mock.calls[0]![0]);
  expect(url.protocol).toBe("codex:"); expect(url.searchParams.get("path")).toBe("/workspace/example"); expect(url.searchParams.get("prompt")).toContain("Selected item: themes.background");
  expect(localStorage.getItem("foundry.studio.open-target")).toBe("codex"); expect(screen.getByRole("button", { name: "Open in Codex" })).toBeVisible();
});
it.each(["unavailable", "failed"] as const)("copies and submits a frame notice only when the configured launcher reports %s", async result => {
  const user = userEvent.setup(); const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const { notice } = mount({ launch: () => result }); await user.click(screen.getByRole("button", { name: "Open in Claude Code" }));
  await waitFor(() => expect(notice).toHaveBeenCalledWith({ kind: "copied", target: "Claude Code" })); expect(copy).toHaveBeenCalledTimes(1); expect(copy.mock.calls[0]![0]).toContain("Layer: tokens");
});
it("does not claim an unknown browser dispatch opened the app, and keeps explicit copy actions available", async () => {
  const user = userEvent.setup(), copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(); const { notice } = mount();
  await user.click(screen.getByRole("button", { name: "Open in Claude Code" })); expect(notice).not.toHaveBeenCalled(); expect(copy).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Choose target" })); await user.click(screen.getByRole("menuitem", { name: "Copy link to this view" }));
  expect(copy).toHaveBeenCalledWith("https://example.test/designer#studio-layer=themes"); await waitFor(() => expect(notice).toHaveBeenCalledWith({ kind: "link-copied" }));
});
it("supports the compact keyboard menu and reports clipboard rejection honestly", async () => {
  const user = userEvent.setup(); vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied")); const { notice } = mount({ compact: true });
  const trigger = screen.getByRole("button", { name: "Open in" }); trigger.focus(); await user.keyboard("{ArrowDown}");
  expect(await screen.findByRole("menuitem", { name: "Cursor" })).toBeVisible(); await user.click(screen.getByRole("menuitem", { name: "Copy as prompt" }));
  await waitFor(() => expect(notice).toHaveBeenCalledWith({ kind: "copy-failed" }));
});
it("handles unavailable localStorage, unknown saved IDs and copy-only targets", async () => {
  const user = userEvent.setup(); const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(); localStorage.setItem("foundry.studio.open-target", "removed");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("unavailable"); });
  const { notice, launch } = mount({ openWithTargets: [{ id: "copy", label: "Cursor", href: () => undefined }] });
  await user.click(screen.getByRole("button", { name: "Open in Cursor" })); expect(launch).not.toHaveBeenCalled(); expect(copy).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(notice).toHaveBeenCalledWith({ kind: "copied", target: "Cursor" }));
});
it("uses an exact candidate prompt override for target dispatch and fallback copy without routing text", async () => {
  const user = userEvent.setup(); const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const prompt = 'Create a candidate\n{"consumer":"sample","slot":"themes.background"}';
  const context = { projectPath: "/workspace/private-route", taskPrompt: prompt, prompt, layer: "themes" as const, selectedId: "themes.background" };
  const href = vi.fn(() => "editor:open");
  mount({ promptContext: context, openWithTargets: [{ id: "editor", label: "Editor", href }], launch: () => "unavailable" });
  await user.click(screen.getByRole("button", { name: "Open in Editor" }));
  expect(href).toHaveBeenCalledWith(context);
  await waitFor(() => expect(copy).toHaveBeenCalledWith(prompt));
  expect(copy.mock.calls[0]![0]).not.toContain(context.projectPath);
});
