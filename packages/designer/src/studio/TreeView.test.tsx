import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TreeView } from "./TreeView.js";

afterEach(cleanup);
const nodes = [{ id: "group", label: "Group", children: [{ id: "one", label: "One" }, { id: "two", label: "Two" }] }];
it("uses the Foundry tree for expansion, selection and keyboard navigation", async () => {
  const navigate = vi.fn(), expanded = vi.fn(), user = userEvent.setup();
  render(<TreeView nodes={nodes} aria-label="Catalog" currentId="one" defaultExpandedIds={["group"]} onNavigate={navigate} onExpandedChange={expanded} />);
  expect(screen.getByRole("treegrid", {name:"Catalog"})).toBeInTheDocument();
  expect(screen.getByRole("row", {name:"One"})).toHaveAttribute("aria-selected", "true");
  await user.click(screen.getByRole("row", {name:"Two"}));
  expect(navigate).toHaveBeenCalledWith("two");
  await user.click(screen.getByRole("row", {name:"One"}));
  await user.keyboard("{ArrowDown}{Enter}");
  expect(navigate).toHaveBeenLastCalledWith("two");
  await user.click(screen.getByRole("button", {name:"Group"}));
  expect(expanded).toHaveBeenCalledWith(new Set());
  expect(screen.queryByRole("row", {name:"Two"})).not.toBeInTheDocument();
});
it("retains the required host label", () => {
  expect(() => render(<TreeView nodes={[]} aria-label="" />)).toThrow("TreeView requires aria-label");
});
