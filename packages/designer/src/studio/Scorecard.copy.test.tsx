// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { check } from "../catalog-core/check.js";
import { Scorecard } from "./Scorecard.js";
import { createRouteStudioLabels } from "./route-labels.js";
import type { MatrixSummary } from "./matrix-model.js";
import { smallCatalog, emptyLibrary } from "./__fixtures__/studio.js";
import { expectOnlyResolvedCopy, pseudoStudioCopy } from "./__fixtures__/copy-hand-roll.js";

afterEach(cleanup);
it("hand-rolls the actual resolved count, all check names and real structured findings without inline copy", () => {
  const { copy, requests } = pseudoStudioCopy();
  const findings = check({ catalog: smallCatalog, library: emptyLibrary() }).findings.filter(finding => finding.copy);
  expect(findings.length).toBeGreaterThan(0);
  const summary: MatrixSummary = { total: 5, resolved: 2, errors: findings.length, notices: 0,
    categories: [{ id: "contract", supported: true, codes: Array.from({ length: 10 }, (_, index) => `C${index + 1}`), errors: findings.length, notices: 0 }],
    issues: findings.slice(0, 3).map(finding => ({ finding, slotId: "themes.background" })) };
  const { container } = render(<Scorecard copy={copy} labels={createRouteStudioLabels(copy)} summary={summary} onClose={() => {}} onIssue={() => {}} />);
  expect(container).toHaveTextContent("[[st.aqdaz871km]]");
  expect(requests).toContainEqual({ id: "st.aqdaz871km", locale: "en", values: { resolved: 2, total: 5 } });
  for (const issue of summary.issues) expect(requests).toContainEqual({ ...issue.finding.copy, locale: "en" });
  expect(container.querySelector('[data-studio-data-value]')).toHaveTextContent("C1");
  expectOnlyResolvedCopy(container);
});
