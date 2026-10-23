import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DEMO_CATALOG, DEMO_LIBRARY, DEMO_SELECTION } from "./demo-data.js";
import { buildCandidates } from "./model.js";
import { Inspector } from "./Inspector.js";
import type { StudioLabels } from "./types.js";

const labels = { resetToDefault: "Reset", inspector: { source: "Source", representedLeaf: "Represented leaf", trust: "Trust", usedBy: "Used by", none: "None", mode: "Mode", relation: "Relation", licence: "License", pin: "Pin", status: "Status", builtOn: "Built on", evidence: "Evidence", members: "Members", light: "Light", dark: "Dark", via: "Via", alias: "Alias", findings: "Findings" } } as StudioLabels;
afterEach(cleanup);
it("shows plain definitions, actual metadata and only actual alias consumers for role members", () => {
  const candidate = buildCandidates({ catalog: DEMO_CATALOG, library: DEMO_LIBRARY, working: DEMO_SELECTION, slotId: "tokens.accent-color", scope: "slot", target: "tokens.accent-color" }).find(candidate => candidate.source === "foundry")!;
  const member = candidate.members[0]!;
  const resolved = { ...candidate.resolved, members: { ...candidate.resolved.members, "tokens.surface-color.base": { ...member.member, slot: "tokens.surface-color", alias: { light: member.id } } } };
  const view = render(<Inspector candidate={candidate} labels={labels} canReset={false} onReset={() => undefined} tier="role" resolved={resolved} />);
  expect(view.container.querySelector("table")).toBeNull();
  expect(screen.getByText("Represented leaf")).toBeInTheDocument();
  expect(screen.getByText("Trust")).toBeInTheDocument();
  expect(screen.getByText("Used by")).toBeInTheDocument();
  expect(screen.getByText("tokens.surface-color.base")).toBeInTheDocument();
  expect(screen.getByText(candidate.fill.slot)).toBeInTheDocument();
  expect(screen.getAllByText("Light").length).toBe(candidate.members.length);
  expect(screen.getAllByText("Dark").length).toBe(candidate.members.filter(entry => entry.member.css.dark !== undefined).length);
  expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();
});

it("preserves distinct actual light and dark aliases instead of choosing one mode", () => {
  const original = buildCandidates({ catalog: DEMO_CATALOG, library: DEMO_LIBRARY, working: DEMO_SELECTION, slotId: "tokens.accent-color", scope: "slot", target: "tokens.accent-color" }).find(candidate => candidate.source === "foundry")!;
  const member = original.members[0]!;
  const candidate = { ...original, members: [{ ...member, member: { ...member.member, alias: { light: "tokens.color-ramp.slate.500", dark: "tokens.color-ramp.violet.400" } } }] };
  const view = render(<Inspector candidate={candidate} labels={labels} canReset={false} onReset={() => undefined} tier="role" />);
  const definitions = view.container.querySelectorAll("dt");
  const light = [...definitions].find(node => node.textContent === "Alias Light");
  const dark = [...definitions].find(node => node.textContent === "Alias Dark");
  expect(light?.nextElementSibling).toHaveTextContent("tokens.color-ramp.slate.500");
  expect(dark?.nextElementSibling).toHaveTextContent("tokens.color-ramp.violet.400");
});
