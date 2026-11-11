import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toolbar } from "../../components/intent/toolbar.js";
import { Toolbar as ToolbarBlock } from "../Toolbar.js";
import { disclosureRow } from "./disclosure-row.js";

const recipe = { item: "row-item", trigger: "row-trigger", details: "", panel: "row-panel", chevron: "row-chevron", chevronOpen: "row-chevron-open", chevronNative: "", answer: "row-answer" };
const colors = { border: "row-border", primary: "row-primary", secondary: "row-secondary" };

describe("disclosureRow (FAQ/reveal rows render through the stock accordion parts)", () => {
  it("names the trigger, keeps the answer in the DOM behind aria-controls and toggles it open", async () => {
    const user = userEvent.setup();
    render(<div>{disclosureRow({ id: "q1", question: "Is it free?", answer: "Yes.", recipe, colors, answerStyle: {} })}</div>);
    const trigger = screen.getByRole("button", { name: "Is it free?" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    const panel = document.getElementById(trigger.getAttribute("aria-controls")!)!;
    expect(panel.textContent).toBe("Yes.");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(panel).not.toHaveAttribute("hidden");
  });
});

// R2F-51: the strip is the Intent UI Toolbar (no `variant`); the block strips its framed chrome by class instead.
describe("Toolbar block chrome (the block's action bar)", () => {
  it("the Intent Toolbar keeps its framed chrome; the block drops it and keeps the wrapping action-bar layout", () => {
    render(<><Toolbar aria-label="Framed"><button>a</button></Toolbar><ToolbarBlock aria-label="Bare" /></>);
    const framed = screen.getByRole("toolbar", { name: "Framed" }).className.split(/\s+/);
    expect(framed).toEqual(expect.arrayContaining(["inset-ring", "inset-ring-border", "bg-popover"]));
    const bare = screen.getByRole("toolbar", { name: "Bare" }).className.split(/\s+/);
    expect(bare).toEqual(expect.arrayContaining(["inset-ring-0", "bg-transparent", "p-0", "rounded-none", "flex-wrap", "items-center", "gap-md"]));
    expect(bare).not.toContain("bg-popover");
    expect(bare).not.toContain("inset-ring-border");
  });
  it("the Toolbar block renders through the Intent Toolbar with its consumer class merged last", () => {
    render(<ToolbarBlock aria-label="Rows" className="mt-sm" leading={<button>Bulk</button>} />);
    const bar = screen.getByRole("toolbar", { name: "Rows" });
    expect(bar.className.split(/\s+/).at(-1)).toBe("mt-sm");
    expect(bar.className.split(/\s+/)).toEqual(expect.arrayContaining(["flex-wrap", "items-center", "gap-md"]));
  });
});
