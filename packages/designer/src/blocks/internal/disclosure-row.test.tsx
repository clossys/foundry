import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toolbar } from "../../components/Toolbar.js";
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

describe("Toolbar bare variant (the block's action bar)", () => {
  it("drops the framed chrome and keeps the wrapping action-bar layout", () => {
    render(<><Toolbar aria-label="Framed"><button>a</button></Toolbar><Toolbar aria-label="Bare" variant="bare"><button>b</button></Toolbar></>);
    expect(screen.getByRole("toolbar", { name: "Framed" }).className).toContain("border-line-base");
    const bare = screen.getByRole("toolbar", { name: "Bare" });
    expect(bare.className).toBe("flex flex-wrap items-center gap-md");
  });
  it("the Toolbar block renders through the Foundry Toolbar with its consumer class merged last", () => {
    render(<ToolbarBlock aria-label="Rows" className="mt-sm" leading={<button>Bulk</button>} />);
    const bar = screen.getByRole("toolbar", { name: "Rows" });
    expect(bar.className).toBe("flex flex-wrap items-center gap-md mt-sm");
  });
});
