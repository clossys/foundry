import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Skeleton } from "./preview-runtime/components/skeleton/skeleton.js";

describe("pinned native Skeleton", () => {
  it("preserves the pinned source except its relocated utility import", () => {
    const fixture = JSON.parse(readFileSync("packages/designer/src/importers/__fixtures__/shadcn-aria/skeleton.json", "utf8"));
    const source = readFileSync("packages/designer/src/components/preview-runtime/components/skeleton/skeleton.tsx", "utf8");
    expect(fixture.commit).toBe("daaf156ee00ed91cc7e6bdd937c1b4973152d141");
    expect(source).toBe(fixture.files[0].content.replace('from "cn"', 'from "../_parts/utils/index.js"'));
  });

  it("forwards native div semantics and caller-owned loading announcements", () => {
    render(<Skeleton role="status" aria-label="Loading prompt title" aria-busy="true" className="min-h-0 flex-1" />);
    const skeleton = screen.getByRole("status", { name: "Loading prompt title" });
    expect(skeleton).toHaveAttribute("data-slot", "skeleton");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(skeleton).toHaveClass("cn-skeleton", "animate-pulse", "min-h-0", "flex-1");
    expect(skeleton).not.toHaveAttribute("shape");
  });
});
