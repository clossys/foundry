import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Scorecard } from "./Scorecard.js";
import type { MatrixSummary } from "./matrix-model.js";
import type { StudioLabels } from "./types.js";

const labels = {
  scorecard: {
    title: "Scorecard", close: "Close scorecard", resolved: "Resolved", checks: "Checks",
    issues: "Issues", noIssues: "No issues", target: "Not assessed",
    categories: {
      contract: "Contract", accessibility: "Accessibility", coherence: "Coherence",
      modes: "Modes", provenance: "Provenance", coverage: "Coverage",
    },
    counts: (errors: number, notices: number) => `${errors} errors, ${notices} notices`,
    supported: (codes: readonly string[]) => `Supported: ${codes.join(", ")}`,
  },
} as StudioLabels;

function measuredSummary(): MatrixSummary {
  return {
    total: 8, resolved: 5, errors: 1, notices: 2,
    categories: [
      { id: "contract", supported: true, codes: ["C1"], errors: 1, notices: 2 },
      { id: "accessibility", supported: false, codes: [] },
      { id: "coherence", supported: false, codes: [] },
      { id: "modes", supported: false, codes: [] },
      { id: "provenance", supported: true, codes: ["C6", "C8", "C10"] },
      { id: "coverage", supported: false, codes: [] },
    ],
    issues: [
      { finding: { code: "C1", severity: "error", subject: "tokens.surface-color", message: "Choose a surface" }, slotId: "tokens.surface-color" },
      { finding: { code: "C1", severity: "notice", subject: "library", message: "Inspect library evidence" } },
      { finding: { code: "C1", severity: "notice", subject: "tokens.spacing", message: "Inspect spacing" }, slotId: "tokens.spacing" },
    ],
  };
}

afterEach(cleanup);

it("presents the measured categories as a named grid with row headers and no invented target counts", () => {
  const summary = measuredSummary();
  render(<Scorecard summary={summary} labels={labels} onClose={() => {}} onIssue={() => {}} />);
  const region = screen.getByRole("region", { name: labels.scorecard.title });
  const grid = within(region).getByRole("grid", { name: labels.scorecard.title });
  expect(within(region).getByText("5/8")).toBeInTheDocument();
  expect(within(grid).getByRole("columnheader", { name: labels.scorecard.title })).toBeInTheDocument();
  expect(within(grid).getByRole("columnheader", { name: labels.scorecard.checks })).toBeInTheDocument();
  expect(within(grid).getAllByRole("rowheader").map(header => header.textContent)).toEqual(
    summary.categories.map(category => labels.scorecard.categories[category.id]));

  for (const category of summary.categories) {
    const row = within(grid).getByRole("row", { name: labels.scorecard.categories[category.id] });
    const result = within(row).getByRole("gridcell");
    if (category.supported) {
      expect(result).toHaveTextContent(labels.scorecard.counts(category.errors ?? 0, category.notices ?? 0));
      expect(result).toHaveTextContent(labels.scorecard.supported(category.codes));
    } else {
      expect(result).toHaveTextContent(labels.scorecard.target);
      expect(result.textContent).toBe(labels.scorecard.target);
    }
  }
  expect(within(region).getAllByText(labels.scorecard.counts(summary.errors, summary.notices))).toHaveLength(2);
});

it("uses the public table keyboard navigation without activating an issue", async () => {
  const onIssue = vi.fn();
  render(<Scorecard summary={measuredSummary()} labels={labels} onClose={() => {}} onIssue={onIssue} />);
  const grid = screen.getByRole("grid", { name: labels.scorecard.title });
  await act(async () => { grid.focus(); });
  expect(screen.getByRole("row", { name: labels.scorecard.categories.contract })).toHaveFocus();
  await userEvent.setup().keyboard("{ArrowDown}");
  expect(screen.getByRole("row", { name: labels.scorecard.categories.accessibility })).toHaveFocus();
  expect(onIssue).not.toHaveBeenCalled();
});

it("reveals only actual mapped issue slots and keeps unmapped issues disabled", async () => {
  const onIssue = vi.fn();
  render(<Scorecard summary={measuredSummary()} labels={labels} onClose={() => {}} onIssue={onIssue} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Choose a surface" }));
  expect(onIssue).toHaveBeenLastCalledWith("tokens.surface-color");
  const unmapped = screen.getByRole("button", { name: "Inspect library evidence" });
  expect(unmapped).toBeDisabled();
  await user.click(unmapped);
  expect(onIssue).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Inspect spacing" }));
  expect(onIssue.mock.calls).toEqual([["tokens.surface-color"], ["tokens.spacing"]]);
});

it("closes from a keyboard-focused category or the close action without leaking Escape", async () => {
  const onClose = vi.fn();
  const parentKey = vi.fn();
  render(<div onKeyDown={parentKey}><Scorecard summary={measuredSummary()} labels={labels} onClose={onClose} onIssue={() => {}} /></div>);
  await act(async () => { screen.getByRole("grid", { name: labels.scorecard.title }).focus(); });
  const user = userEvent.setup();
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledOnce();
  expect(parentKey).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: labels.scorecard.close }));
  expect(onClose).toHaveBeenCalledTimes(2);
});

it("retains the empty issue state", () => {
  render(<Scorecard summary={{ ...measuredSummary(), issues: [] }} labels={labels} onClose={() => {}} onIssue={() => {}} />);
  expect(screen.getByText(labels.scorecard.noIssues)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Choose a surface" })).toBeNull();
});
