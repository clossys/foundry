import { expect, it, vi } from "vitest";
import { render, fireEvent, screen, within, waitFor } from "@testing-library/react";
import { boardOf, boardRow } from "./__fixtures__/library-board-dom.js";
import { render as renderFrame } from "./__fixtures__/frame.js";
import { StudioProvider, useStudioSession } from "./StudioProvider.js";
import { Studio } from "./Studio.js";
import { CandidateCell } from "./CandidateCell.js";
import { CompactPreview } from "./previews.js";
import { buildCandidates } from "./model.js";
import { orderTokenMembers } from "../tokens/preview/member-order.js";
import { adopt, labels, smallCatalog } from "./__fixtures__/studio.js";

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

it("refreshes prompt token context and host callbacks after the working selection changes", async () => {
  const library = adopt();
  const firstCheck = vi.fn(async () => ({ status: "checked" as const, candidates: [] }));
  const nextCheck = vi.fn(async () => ({ status: "checked" as const, candidates: [] }));
  const adapter = { load: async () => ({ library }), save: async () => ({ ok: false as const, reason: "unavailable" as const }) };
  function EditContext() {
    const state = useStudioSession();
    return <button onClick={() => state.apply([{ op: "author", slot: "tokens.surface-color", tokens: { base: { $type: "color", $value: "#123456", $extensions: { "com.clossys.css": { raw: "#123456" } } } } }])}>Change context fixture</button>;
  }
  function Surface({ check }: { check: typeof firstCheck }) {
    return <StudioProvider adapter={adapter} catalog={smallCatalog} labels={labels}>
      <EditContext /><Studio candidateWorkflow={{ checkCandidates: check }} />
    </StudioProvider>;
  }
  const view = renderFrame(<Surface check={firstCheck} />);
  await screen.findByRole("link", { name: "Tokens" });
  fireEvent.click(screen.getByText("Change context fixture"));
  view.rerender(<Surface check={nextCheck} />);
  const board = await waitFor(() => boardOf("tokens.surface-color", view.container)!);
  fireEvent.click(within(board).getByRole("button", { name: labels.board.changeSelection }));
  const current = await waitFor(() => boardRow("tokens.surface-color", view.container)!);
  fireEvent.click(within(current as HTMLElement).getByRole("button", { name: labels.board.create }));
  const dialog = await screen.findByRole("dialog");
  const prompt = JSON.parse(dialog.querySelector("code")!.textContent!.split("\n\n").slice(1).join("\n\n"));
  expect(prompt.tokens).toContainEqual({ id: "tokens.surface-color.base", value: "#123456" });
  const contract = smallCatalog.slots.find(slot => slot.id === "tokens.surface-color")!.contract;
  expect(contract.members.mode).toBe("closed");
  if (contract.members.mode === "closed") expect(prompt.variants).toEqual(contract.members.names.map(name => `tokens.surface-color.${name}`));
  fireEvent.click(within(dialog).getByRole("button", { name: labels.board.checkCandidates }));
  await waitFor(() => expect(nextCheck).toHaveBeenCalledWith("tokens.surface-color"));
  expect(firstCheck).not.toHaveBeenCalled();
});
