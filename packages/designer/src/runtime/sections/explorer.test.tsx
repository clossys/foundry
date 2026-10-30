import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { runtimeHash } from "../../catalog-core/runtime-ports.js";
import { renderExplorer } from "./explorer.js";
import type { SectionRenderInput } from "./group-b-support.js";

afterEach(cleanup);

function fixture(): SectionRenderInput {
  const value = { label: "Files", nodes: [{ id: "leaf", label: "Leaf", href: "#selected", externalAction: { href: "#standalone", label: "Open Leaf in a new tab" } }] };
  return { cell: { theme: "light", state: "default", width: 1280 },
    content: { tree: { reference: { kind: "region", ref: "tree" }, value, hash: runtimeHash(value) } },
  } as SectionRenderInput;
}

it("projects host-owned tree action data and its selected icon into a sibling link", () => {
  render(<>{renderExplorer({ ...fixture(), sectionHost: { externalActionIcon: <span data-testid="selected-icon" /> } })}</>);
  const row = screen.getByRole("treeitem", { name: "Leaf" }), action = screen.getByRole("link", { name: "Open Leaf in a new tab" });
  expect(row).toHaveAttribute("href", "#selected");
  expect(action).toHaveAttribute("href", "#standalone");
  expect(action).toHaveAttribute("target", "_blank");
  expect(action).toHaveAttribute("rel", "noopener noreferrer");
  expect(action.contains(screen.getByTestId("selected-icon"))).toBe(true);
  expect(action.parentElement).toBe(row.parentElement);
});

it("refuses an action with no selected host icon instead of choosing a substitute", () => {
  expect(() => render(<>{renderExplorer(fixture())}</>)).toThrow(/requires the host's selected externalActionIcon/);
});
