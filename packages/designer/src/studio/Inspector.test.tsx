import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { buildUsageGraph } from "../catalog-core/usage-graph.js";
import { catalog as DEMO_CATALOG, emptyLibrary } from "./__fixtures__/studio.js";
const DEMO_LIBRARY = emptyLibrary();
const DEMO_SELECTION = DEMO_LIBRARY;
import { buildCandidates } from "./model.js";
import { Inspector } from "./Inspector.js";
import type { StudioLabels } from "./types.js";

const labels = { resetToDefault: "Reset", inspector: { source: "Source", representedLeaf: "Represented leaf", trust: "Trust", usedBy: "Used by", none: "None", mode: "Mode", relation: "Relation", licence: "License", pin: "Pin", status: "Status", builtOn: "Built on", evidence: "Evidence", members: "Members", light: "Light", dark: "Dark", via: "Via", alias: "Alias", findings: "Findings" } } as StudioLabels;
afterEach(cleanup);
/** Used by is read from the usage graph (B5): one component reads the primary theme leaf. */
const graph = buildUsageGraph({
  inventory: { themes: ["themes.primary"], components: ["components.button"] },
  selection: { "themes.primary": "shadcn@aria/themes.primary", "components.button": "foundry/components.button" },
  components: { fills: [{ id: "foundry/components.button", slot: "components.button", scanStatus: "lower-bound", declaredReads: { themes: ["themes.primary"], assets: [] }, scannedReads: { themes: [], assets: [] } }], reverseComposes: {} },
});
it("shows plain definitions, actual metadata and only the graph's consumers for role members", async () => {
  const candidate = buildCandidates({ catalog: DEMO_CATALOG, library: DEMO_LIBRARY, working: DEMO_SELECTION, slotId: "themes.primary", scope: "slot", target: "themes.primary" }).find(candidate => candidate.source === "shadcn@aria")!;
  const view = render(<Inspector candidate={candidate} labels={labels} tier="role" graph={graph} />);
  expect(view.container.querySelector("table")).toBeNull();
  expect(screen.getByText("Represented leaf")).toBeInTheDocument();
  expect(screen.getByText("Trust")).toBeInTheDocument();
  expect(screen.getByText("Used by")).toBeInTheDocument();
  expect(await screen.findByText("components.button")).toBeInTheDocument();
  expect(screen.getByText(candidate.fill.slot)).toBeInTheDocument();
  expect(screen.getAllByText("Light").length).toBe(candidate.members.length);
  expect(screen.getAllByText("Dark").length).toBe(candidate.members.filter(entry => entry.member.css.dark !== undefined).length);
  // DESIGNER-RO (converted): Reset to default is gone (inventory rows 6-7), so the read-only inspector has no Reset at all.
  expect(screen.queryByRole("button", { name: "Reset", hidden: true })).toBeNull();
});

it("preserves distinct actual light and dark aliases instead of choosing one mode", () => {
  const original = buildCandidates({ catalog: DEMO_CATALOG, library: DEMO_LIBRARY, working: DEMO_SELECTION, slotId: "themes.primary", scope: "slot", target: "themes.primary" }).find(candidate => candidate.source === "shadcn@aria")!;
  const member = original.members[0]!;
  const candidate = { ...original, members: [{ ...member, member: { ...member.member, alias: { light: "themes.foreground.default", dark: "themes.background.default" } } }] };
  const view = render(<Inspector candidate={candidate} labels={labels} tier="role" />);
  const definitions = view.container.querySelectorAll("dt");
  const light = [...definitions].find(node => node.textContent === "Alias Light");
  const dark = [...definitions].find(node => node.textContent === "Alias Dark");
  expect(light?.nextElementSibling).toHaveTextContent("themes.foreground.default");
  expect(dark?.nextElementSibling).toHaveTextContent("themes.background.default");
});
