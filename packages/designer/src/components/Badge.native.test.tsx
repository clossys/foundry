import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./preview-runtime/components/badge/badge.js";

describe("pinned native Badge", () => {
  it("preserves the pinned source except its relocated utility import", () => {
    const fixture = JSON.parse(readFileSync("packages/designer/src/importers/__fixtures__/shadcn-aria/badge.json", "utf8"));
    const source = readFileSync("packages/designer/src/components/preview-runtime/components/badge/badge.tsx", "utf8");
    expect(fixture.commit).toBe("daaf156ee00ed91cc7e6bdd937c1b4973152d141");
    expect(source).toBe(fixture.files[0].content.replace('from "cn"', 'from "../_parts/utils/index.js"'));
  });

  it("renders the native variant and exposes the upstream render API", () => {
    render(<Badge variant="destructive" render={props => <a {...props} href="#details" />}>Details</Badge>);
    const badge = screen.getByRole("link", { name: "Details" });
    expect(badge).toHaveAttribute("data-slot", "badge");
    expect(badge).toHaveAttribute("data-variant", "destructive");
    expect(badge).toHaveClass("cn-badge", "cn-badge-variant-destructive");
    expect(badge).toHaveClass("focus-visible:ring-[3px]");
  });
});
