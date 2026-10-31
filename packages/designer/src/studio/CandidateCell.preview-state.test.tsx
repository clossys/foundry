/** @vitest-environment jsdom */
/** vf35 capture hooks: a chosen cell names whether its preview is live, from the same decision that prints "preview unavailable". */
import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CandidateCell } from "./CandidateCell.js";
import { buildCandidates } from "./model.js";
import { adopt, labels, smallCatalog } from "./__fixtures__/studio.js";

afterEach(cleanup);
const cellOf = (view: ReturnType<typeof render>) => view.container.querySelector<HTMLElement>("[data-candidate-cell]")!;

function selected() {
  const library = adopt();
  return buildCandidates({ catalog: smallCatalog, library, working: library, scope: "slot", target: "themes.background", slotId: "themes.background" }).find(entry => entry.selected)!;
}

it("marks a previewable candidate live and an unpreviewable one unavailable", () => {
  const candidate = selected();
  expect(candidate.previewable).toBe(true);
  const live = render(<CandidateCell candidate={candidate} labels={labels} />);
  expect(cellOf(live)).toHaveAttribute("data-preview-state", "live");
  expect(cellOf(live)).not.toHaveTextContent(labels.previewUnavailable);
  live.unmount();
  const blocked = render(<CandidateCell candidate={{ ...candidate, previewable: false }} labels={labels} />);
  expect(cellOf(blocked)).toHaveTextContent(labels.previewUnavailable);
  expect(cellOf(blocked)).toHaveAttribute("data-preview-state", "unavailable");
});

it("marks a host preview live and a missing one unavailable", () => {
  const live = render(<CandidateCell labels={labels} preview={<p>host-preview</p>} />);
  expect(cellOf(live)).toHaveAttribute("data-preview-state", "live");
  live.unmount();
  const missing = render(<CandidateCell labels={labels} />);
  expect(cellOf(missing)).toHaveTextContent(labels.previewUnavailable);
  expect(cellOf(missing)).toHaveAttribute("data-preview-state", "unavailable");
});

it("names the sample state a host preview was rendered in, only when one was given", () => {
  const view = render(<CandidateCell labels={labels} preview={<p>host-preview</p>} sampleState="empty" />);
  expect(cellOf(view)).toHaveAttribute("data-sample-state", "empty");
  view.unmount();
  expect(cellOf(render(<CandidateCell labels={labels} preview={<p>host-preview</p>} />))).not.toHaveAttribute("data-sample-state");
});
