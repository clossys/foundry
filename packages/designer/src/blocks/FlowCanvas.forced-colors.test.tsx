import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { generate, parse, walk, type CssNode } from "css-tree";
import { FlowCanvas } from "./FlowCanvas.js";

it("ships the selected perimeter's dashed border rule inside forced-colors media", () => {
  const css = readFileSync(resolve(import.meta.dirname, "../../styles/compiled.css"), "utf8");
  const ancestors: CssNode[] = [];
  const declarations = new Set<string>();
  walk(parse(css), {
    enter(node) {
      ancestors.push(node);
      if (node.type !== "Declaration" || generate(node.value).trim() !== "dashed") return;
      const selected = ancestors.some(parent => parent.type === "Rule" && generate(parent.prelude) === ".forced-colors\\:border-dashed");
      const forced = ancestors.some(parent => parent.type === "Atrule" && parent.name === "media" && parent.prelude && /\(forced-colors:\s*active\)/.test(generate(parent.prelude)));
      if (selected && forced) declarations.add(node.property);
    },
    leave() { ancestors.pop(); },
  });
  expect(declarations).toEqual(new Set(["--tw-border-style", "border-style"]));
});

it("keeps the selected forced-colors perimeter dashed while keyboard focus stays solid", async () => {
  const user = userEvent.setup();
  const props = {
    nodes: [{ id: "draft", label: "Draft" }, { id: "review", label: "Review" }],
    edges: [{ from: "draft", to: "review" }],
    label: "Release flow", emptyMessage: "No steps", outgoingLabel: "Leads to",
  };
  const { rerender } = render(<FlowCanvas {...props} selectedId="draft" />);
  const draft = screen.getByRole("button", { name: "Draft" });
  const review = screen.getByRole("button", { name: "Review" });
  await user.tab();
  expect(draft).toHaveFocus();
  expect(draft).toHaveClass("forced-colors:border-dashed", "focus-visible:outline-solid");
  expect(review).not.toHaveClass("forced-colors:border-dashed");

  await user.keyboard("{ArrowRight}");
  expect(review).toHaveFocus();
  expect(review).toHaveClass("focus-visible:outline-solid");
  expect(review).not.toHaveClass("forced-colors:border-dashed");
  expect(draft).toHaveAttribute("aria-current", "true");
  expect(draft).toHaveClass("forced-colors:border-dashed");

  rerender(<FlowCanvas {...props} selectedId="review" />);
  expect(review).toHaveFocus();
  expect(review).toHaveClass("forced-colors:border-dashed", "focus-visible:outline-solid");
  expect(draft).not.toHaveClass("forced-colors:border-dashed");
  rerender(<FlowCanvas {...props} selectedId={null} />);
  for (const node of [draft, review]) expect(node).not.toHaveClass("forced-colors:border-dashed");
});
