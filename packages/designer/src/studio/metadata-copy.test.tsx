// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { readStudioFinding, readStudioMessage } from "./copy-binding.js";
import { STUDIO_MESSAGE_REFS } from "./copy-records.js";
import { expectOnlyResolvedCopy, pseudoStudioCopy, draftEnvelopes } from "./__fixtures__/copy-hand-roll.js";

afterEach(cleanup);
it("binds every metadata, IA and item ref to its exact Writer draft without importing Writer at runtime", () => {
  const envelope = draftEnvelopes[1]!;
  const { copy, requests } = pseudoStudioCopy("ar");
  const bindings = envelope.bindings!.filter(binding => binding.kind !== "finding");
  for (const binding of bindings) expect(STUDIO_MESSAGE_REFS[binding.cellId]).toEqual({ id: binding.recordId });
  const { container } = render(<div>{bindings.map(binding => <span key={binding.cellId} aria-label={readStudioMessage(copy, binding.cellId)}>{readStudioMessage(copy, binding.cellId)}</span>)}</div>);
  expect(bindings).toHaveLength(372);
  expect(requests.every(ref => ref.locale === "ar")).toBe(true);
  expectOnlyResolvedCopy(container);
});
it("keeps unknown records and unstructured diagnostic producers as named Needs", () => {
  const { copy } = pseudoStudioCopy();
  expect(() => readStudioMessage(copy, "studio.ia.item.components.fixture-missing")).toThrow("studio.ia.item.components.fixture-missing");
  expect(() => readStudioFinding(copy, {}, "studio.inspector.finding.A5")).toThrow("studio.inspector.finding.A5");
  expect(() => readStudioMessage(copy, "studio.inspector.reason.components.button")).toThrow("studio.inspector.reason.components.button");
});
