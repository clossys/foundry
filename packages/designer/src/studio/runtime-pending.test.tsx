import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { checkComponentProfile, OBSERVATIONS_UNAVAILABLE, type ComponentCheckFill } from "../catalog-core/check-components.js";
import { checkCounts, isRuntimePending, RUNTIME_PENDING_CODES } from "./runtime-pending.js";
import { RuntimePendingLine } from "./board-summary.js";
import componentSlots from "../catalog/slots/components.json" with { type: "json" };
import type { ComponentSlot } from "../catalog-core/types.js";

afterEach(cleanup);

const unobserved: ComponentCheckFill = {
  slot: "components.semantic-content", source: "foundry", root: "presentational", members: [], props: [], propMap: {},
  reads: { tokens: [], assets: [], components: [] }, composes: [], impl: { kind: "package", module: "x", export: "Button" },
  license: "MIT", pin: { package: "x", version: "1.0.0", export: "Button" }, deps: [],
};

it("classifies exactly the checker's unobserved-fill codes as runtime pending", () => {
  const { findings } = checkComponentProfile({ slots: componentSlots as unknown as ComponentSlot[], fills: [unobserved], tokens: {}, assets: [], observations: {}, installedRac: { version: "", instance: "" } });
  const unavailable = findings.filter(finding => finding.message === OBSERVATIONS_UNAVAILABLE);
  expect([...new Set(unavailable.map(finding => finding.code))].sort()).toEqual([...RUNTIME_PENDING_CODES].sort());
  expect(unavailable.every(isRuntimePending)).toBe(true);
  // Every other finding the checker raised for this fill (e.g. an unknown contract) stays a real error.
  const others = findings.filter(finding => finding.message !== OBSERVATIONS_UNAVAILABLE);
  expect(others.length).toBeGreaterThan(0);
  expect(others.some(isRuntimePending)).toBe(false);
});

it("keeps a pending code loud on a fill whose observations were supplied, and other codes loud", () => {
  const supplied = { code: "K5", severity: "error", message: "Accessibility evidence is stale for source or consumer tokens" };
  const memberPrefixed = { code: "K6", severity: "error", message: `label: ${OBSERVATIONS_UNAVAILABLE}` };
  const otherCode = { code: "K8", severity: "error", message: OBSERVATIONS_UNAVAILABLE };
  expect(isRuntimePending(supplied)).toBe(false);
  expect(isRuntimePending(memberPrefixed)).toBe(true);
  expect(isRuntimePending(otherCode)).toBe(false);
  expect(checkCounts([supplied, memberPrefixed, otherCode, { code: "A5", severity: "notice", message: "n" }])).toEqual({ errors: 2, notices: 1, pending: 1 });
});

it("renders the pending count as a quiet neutral line with its own words, nothing at zero", () => {
  const { container, rerender } = render(<RuntimePendingLine count={280} className="text-display-m" />);
  const line = container.querySelector<HTMLElement>("[data-studio-runtime-pending]")!;
  expect(line).toHaveTextContent("280 runtime pending");
  expect(line).toHaveClass("text-ink-secondary", "tabular-nums", "text-display-m");
  expect(line.className).not.toMatch(/danger|success|status-/);
  rerender(<RuntimePendingLine count={3} label={count => `${count} awaiting runtime`} />);
  expect(container).toHaveTextContent("3 awaiting runtime");
  rerender(<RuntimePendingLine count={0} />);
  expect(container).toBeEmptyDOMElement();
});
