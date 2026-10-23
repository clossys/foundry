import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { matrixSummary } from "./matrix-model.js";
import { DEMO_CATALOG, DEMO_LIBRARY, DEMO_SELECTION } from "./demo-data.js";
import { Scorecard } from "./Scorecard.js";
import type { StudioLabels } from "./types.js";

const labels = { scorecard: { title: "Score", close: "Close", decided: "Decided", resolved: "Resolved", checks: "Checks", issues: "Issues", noIssues: "No issues", target: "Target: needs the check engine", counts: (e: number, n: number) => `${e} errors ${n} warnings`, supported: (codes: readonly string[]) => `Only ${codes.join("/")}`, categories: { contract: "Contract", accessibility: "Accessibility", coherence: "Coherence", modes: "Modes", provenance: "Provenance", coverage: "Coverage" } } } as StudioLabels;
afterEach(cleanup);
it("shows measured counts separately from targets, with no invented provenance checks", () => {
  const summary = matrixSummary({ catalog: DEMO_CATALOG, library: DEMO_LIBRARY, working: DEMO_SELECTION });
  render(<Scorecard summary={summary} labels={labels} onClose={() => undefined} onIssue={() => undefined} />);
  expect(screen.getByRole("region", { name: "Score" })).toBeInTheDocument();
  expect(screen.getByText("0/10")).toBeInTheDocument();
  expect(screen.getAllByText("Target: needs the check engine")).toHaveLength(4);
  expect(screen.getByText("Only C1")).toBeInTheDocument();
  expect(screen.getByText("Only C7")).toBeInTheDocument();
});
it("uses actual issue buttons to navigate their leaf and supports Close", async () => {
  const user = userEvent.setup(); const onIssue = vi.fn(); const onClose = vi.fn();
  const summary = matrixSummary({ catalog: DEMO_CATALOG, library: DEMO_LIBRARY, working: { ...DEMO_SELECTION, picks: [{ scope: "slot", target: "tokens.accent-color", source: "reference-kit" }] } });
  render(<Scorecard summary={summary} labels={labels} onClose={onClose} onIssue={onIssue} />);
  await user.click(screen.getByRole("button", { name: /reference cell/ }));
  expect(onIssue).toHaveBeenCalledWith("tokens.accent-color");
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
