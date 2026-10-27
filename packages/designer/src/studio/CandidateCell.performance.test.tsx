import { expect, it, vi } from "vitest";
import { render, fireEvent, screen, within, waitFor } from "@testing-library/react";
import { boardRow } from "./__fixtures__/library-board-dom.js";
import userEvent from "@testing-library/user-event";
import { render as renderFrame, findLayerSelect } from "./__fixtures__/frame.js";
import { StudioProvider } from "./StudioProvider.js";
import { Studio } from "./Studio.js";
import { CandidateCell } from "./CandidateCell.js";
import { CompactPreview } from "./previews.js";
import { buildCandidates } from "./model.js";
import { orderTokenMembers } from "../tokens/preview/member-order.js";
import { adopt, emptyLibrary, labels, smallCatalog } from "./__fixtures__/studio.js";
import { applyLibraryChange, libraryHash } from "../catalog-core/index.js";

vi.mock("./previews.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./previews.js")>();
  return { ...actual, CompactPreview: vi.fn(actual.CompactPreview) };
});

it("reuses the actual selected preview across matrix reprojection and updates every rendered input", () => {
  const library = adopt();
  const candidate = buildCandidates({ catalog: smallCatalog, library, working: library, scope: "slot", target: "tokens.surface-color", slotId: "tokens.surface-color" }).find(entry => entry.selected)!;
  const preview = vi.mocked(CompactPreview);
  preview.mockClear();
  const view = render(<CandidateCell candidate={candidate} labels={labels} />);
  const initial = preview.mock.calls.length;
  expect(initial).toBe(candidate.members.length);
  expect(view.container.querySelectorAll("[data-candidate-variant]")).toHaveLength(candidate.members.length);
  // Projection produces fresh arrays/entries while the checked member objects
  // still belong to the same immutable selection. No specimen needs repainting.
  const projected = { ...candidate, members: candidate.members.map(entry => ({ ...entry })) };
  view.rerender(<CandidateCell candidate={projected} labels={labels} />);
  expect(preview).toHaveBeenCalledTimes(initial);

  const changed = { ...projected, members: projected.members.map((entry, index) => index ? entry : { ...entry, member: { ...entry.member, css: { ...entry.member.css, light: "#123456" } } }) };
  view.rerender(<CandidateCell candidate={changed} labels={labels} />);
  expect(preview).toHaveBeenCalledTimes(initial * 2);
  expect(preview.mock.calls.at(-changed.members.length)?.[0].candidate.members[0]?.member.css.light).toBe("#123456");

  // Member input order never decides display order: token members always display in `orderTokenMembers` order.
  const reordered = { ...changed, members: [...changed.members].reverse() };
  view.rerender(<CandidateCell candidate={reordered} labels={labels} />);
  expect([...view.container.querySelectorAll("[data-candidate-variant]")].map(node => node.getAttribute("data-candidate-variant"))).toEqual(orderTokenMembers(reordered.members).map(entry => entry.id));
  const reindexed = { ...reordered, index: reordered.index + 1 };
  view.rerender(<CandidateCell candidate={reindexed} labels={labels} />);
  expect(view.container.querySelector("[data-studio-candidate]")?.getAttribute("data-studio-candidate")).toBe(String(reindexed.index));

  const hidden = { ...reindexed, previewable: false };
  view.rerender(<CandidateCell candidate={hidden} labels={labels} />);
  expect(view.container.querySelector("[data-candidate-variant]")).toBeNull();
  expect(view.container.textContent).toBe(labels.previewUnavailable);
  const replacementLabels = { ...labels, previewUnavailable: "Unavailable fixture" };
  view.rerender(<CandidateCell candidate={hidden} labels={replacementLabels} />);
  expect(view.container.textContent).toBe("Unavailable fixture");
  view.rerender(<CandidateCell labels={labels} preview={<span>Host preview one</span>} />);
  expect(view.container.textContent).toBe("Host preview one");
  view.rerender(<CandidateCell labels={labels} preview={<span>Host preview two</span>} />);
  expect(view.container.textContent).toBe("Host preview two");
});

/**
 * DESIGNER-RO (converted): the working selection no longer changes from the UI (no apply), so the token context is the
 * loaded library's own authored value. The prompt now opens from the read-only inspector's Create, and the
 * host-callback refresh on rerender is unchanged.
 */
it("carries the loaded token context into the inspector prompt and refreshes host callbacks on rerender", async () => {
  const base = emptyLibrary();
  const library = applyLibraryChange(smallCatalog, base, { baseHash: libraryHash(base), changes: [{ op: "author", slot: "tokens.surface-color", tokens: { base: { $type: "color", $value: "#123456", $extensions: { "com.clossys.css": { raw: "#123456" } } } } }] });
  const firstCheck = vi.fn(async () => ({ status: "checked" as const, candidates: [] }));
  const nextCheck = vi.fn(async () => ({ status: "checked" as const, candidates: [] }));
  const save = vi.fn(async () => ({ ok: false as const, reason: "unavailable" as const }));
  const adapter = { load: async () => ({ library }), save };
  function Surface({ check }: { check: typeof firstCheck }) {
    return <StudioProvider adapter={adapter} catalog={smallCatalog} labels={labels}><Studio candidateWorkflow={{ checkCandidates: check }} /></StudioProvider>;
  }
  const view = renderFrame(<Surface check={firstCheck} />);
  await findLayerSelect();
  view.rerender(<Surface check={nextCheck} />);
  const current = await waitFor(() => boardRow("tokens.surface-color", view.container)!);
  await userEvent.click(within(current).getByText("tokens.surface-color"));
  const inspector = await waitFor(() => document.querySelector<HTMLElement>('[data-studio-panel="inspector"]')!);
  fireEvent.click(within(inspector).getByRole("button", { name: labels.board.create }));
  const dialog = await screen.findByRole("dialog");
  const prompt = JSON.parse(dialog.querySelector("code")!.textContent!.split("\n\n").slice(1).join("\n\n"));
  expect(prompt.tokens).toContainEqual({ id: "tokens.surface-color.base", value: "#123456" });
  const contract = smallCatalog.slots.find(slot => slot.id === "tokens.surface-color")!.contract;
  expect(contract.members.mode).toBe("closed");
  if (contract.members.mode === "closed") expect(prompt.variants).toEqual(contract.members.names.map(name => `tokens.surface-color.${name}`));
  fireEvent.click(within(dialog).getByRole("button", { name: labels.board.checkCandidates }));
  await waitFor(() => expect(nextCheck).toHaveBeenCalledWith("tokens.surface-color"));
  expect(firstCheck).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
});
