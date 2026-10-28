// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Scorecard } from "./Scorecard.js";
import { createRouteStudioLabels } from "./route-labels.js";
import { StudioCopyNeedsError, type StudioCopyBinding } from "./copy-binding.js";
import type { MatrixSummary } from "./matrix-model.js";

afterEach(cleanup);
it("hand-roll reports the exact missing resolved-count record instead of rendering inline copy", () => {
  const copy: StudioCopyBinding = { locale: "en", resolver: ref => ({ ref, text: `[[${ref.id}]]`, servedLocale: "en", chain: ["en"] }) };
  const labels = createRouteStudioLabels(copy);
  const summary: MatrixSummary = { total: 0, resolved: 0, errors: 0, notices: 0, categories: [], issues: [] };
  let observed: unknown;
  try { render(<Scorecard copy={copy} labels={labels} summary={summary} onClose={() => {}} onIssue={() => {}} />); }
  catch (error) { observed = error; }
  expect(observed).toBeInstanceOf(StudioCopyNeedsError);
  expect((observed as StudioCopyNeedsError).cellId).toBe("designer.scorecard.resolved-count");
});
