// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { instanceFixture } from "../../core/__fixtures__/instance-binding/fixtures.js";
import { fixtureCompiler } from "./__fixtures__/compiler.js";
import { derivePackPipeline } from "./pipeline.js";
import { productionSettingsFromBinding } from "./production-settings.js";
import { PublisherCheckResults } from "./PublisherCheckResults.js";

afterEach(cleanup);
const item = () => {
  const f = instanceFixture();
  return derivePackPipeline([f.binding], f.library, f.registries, fixtureCompiler, { [f.binding.instanceId]: productionSettingsFromBinding(f.binding) }).items[0]!;
};

it("shows the pipeline's sixteen actual checks without claiming complete pack or rendered proof", () => {
  render(<PublisherCheckResults item={item()} id="item-checks" />);
  const table = screen.getByRole("grid", { name: "Instance checks" });
  expect(within(table).getAllByRole("row")).toHaveLength(17);
  expect(within(screen.getByRole("row", { name: "LK11" })).getByRole("gridcell", { name: "passed" })).toBeVisible();
  expect(within(screen.getByRole("row", { name: "LK12" })).getByRole("gridcell", { name: "pending" })).toBeVisible();
  expect(within(screen.getByRole("row", { name: "LK15" })).getByRole("gridcell", { name: "pending" })).toBeVisible();
  expect(screen.getByText(/Whole-instance LK12 pending/)).toBeVisible();
  expect(screen.getByRole("region", { name: "Instance checks" })).toHaveAttribute("id", "item-checks");
});

it("supports host message overrides while statuses remain derived", () => {
  render(<PublisherCheckResults item={item()} id="host-checks" messages={{ title: "Host evidence", tableLabel: "Host rules", summary: count => `Host count ${count}`, renderedPending: "Host awaits full runtime evidence", codeLabel: "Rule", statusLabel: "Outcome", findingsLabel: "Details" }} />);
  expect(screen.getByRole("region", { name: "Host evidence" })).toBeVisible();
  expect(screen.getByRole("grid", { name: "Host rules" })).toBeVisible();
  expect(screen.getByText(/Host count 0/)).toBeVisible();
  expect(screen.getByRole("columnheader", { name: "Outcome" })).toBeVisible();
  expect(within(screen.getByRole("row", { name: "LK12" })).getByRole("gridcell", { name: "pending" })).toBeVisible();
});
