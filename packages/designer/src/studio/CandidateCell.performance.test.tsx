import { expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { CandidateCell } from "./CandidateCell.js";
import { CompactPreview } from "./previews.js";
import { buildCandidates } from "./model.js";
import { orderTokenMembers } from "../tokens/preview/member-order.js";
import { adopt, emptyLibrary, labels, smallCatalog } from "./__fixtures__/studio.js";

vi.mock("./previews.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./previews.js")>();
  return { ...actual, CompactPreview: vi.fn(actual.CompactPreview) };
});

it("reuses the actual selected preview across matrix reprojection and updates every rendered input", () => {
  const library = adopt();
  const candidate = buildCandidates({ catalog: smallCatalog, library, working: library, scope: "slot", target: "themes.background", slotId: "themes.background" }).find(entry => entry.selected)!;
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
