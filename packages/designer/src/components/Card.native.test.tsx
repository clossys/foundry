import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./preview-runtime/components/card/card.js";

describe("pinned native Card", () => {
  it("preserves the pinned source except its relocated utility import", () => {
    const fixture = JSON.parse(readFileSync("packages/designer/src/importers/__fixtures__/shadcn-aria/card.json", "utf8"));
    const source = readFileSync("packages/designer/src/components/preview-runtime/components/card/card.tsx", "utf8");
    expect(fixture.commit).toBe("daaf156ee00ed91cc7e6bdd937c1b4973152d141");
    expect(source).toBe(fixture.files[0].content.replace('from "cn"', 'from "../_parts/utils/index.js"'));
  });

  it.each(["default", "sm"] as const)("preserves native %s size and caller-owned semantic content", size => {
    render(<Card size={size} role="group" aria-labelledby="native-card-title">
      <CardHeader><CardTitle><h2 id="native-card-title">Account</h2></CardTitle><CardDescription>Account details</CardDescription><CardAction><button>Manage</button></CardAction></CardHeader>
      <CardContent>Balance</CardContent><CardFooter>Updated today</CardFooter>
    </Card>);
    const card = screen.getByRole("group", { name: "Account" });
    expect(card).toHaveAttribute("data-size", size);
    expect(card).toHaveClass("cn-card", "group/card");
    expect(screen.getByRole("heading", { name: "Account" })).toHaveAttribute("id", "native-card-title");
    expect(screen.getByText("Account details")).toHaveAttribute("data-slot", "card-description");
    expect(screen.getByRole("button", { name: "Manage" })).toBeInTheDocument();
  });
});
