import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Disclosure } from "./Disclosure.js";
import { Toolbar } from "./Toolbar.js";
import { Toolbar as ToolbarBlock } from "../blocks/Toolbar.js";
import { disclosureRow } from "../blocks/internal/disclosure-row.js";

const recipe = { item: "row-item", trigger: "row-trigger", details: "", panel: "row-panel", chevron: "row-chevron", chevronOpen: "row-chevron-open", chevronNative: "", answer: "row-answer" };
const colors = { border: "row-border", primary: "row-primary", secondary: "row-secondary" };

describe("Disclosure.Row (FAQ/reveal rows render through the Foundry component)", () => {
  it("keeps the trigger semantics, heading level, trailing chevron state and in-DOM panel", async () => {
    const user = userEvent.setup();
    const { container } = render(<div>{disclosureRow({ id: "q1", question: "Is it free?", answer: "Yes.", recipe, colors, answerStyle: {}, headingLevel: 4 })}</div>);
    const trigger = screen.getByRole("button", { name: "Is it free?" });
    expect(trigger.closest("h4")).not.toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger.className).toBe("row-trigger row-primary");
    expect(container.querySelector(".row-item.row-border")).not.toBeNull();
    const chevron = trigger.querySelector("svg")!;
    expect(chevron.getAttribute("class")).toContain("row-chevron");
    expect(chevron.getAttribute("class")).not.toContain("row-chevron-open");
    expect(container.querySelector(".row-panel .row-answer.row-secondary")?.textContent).toBe("Yes.");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger.querySelector("svg")!.getAttribute("class")).toContain("row-chevron-open");
    expect(trigger.getAttribute("aria-controls")).toBe(container.querySelector(".row-panel")!.id);
  });
  it("renders the bare trigger without a heading when no level is given", () => {
    render(<Disclosure.Row title="Plain" triggerClassName="t">Body</Disclosure.Row>);
    expect(screen.getByRole("button", { name: "Plain" }).closest("h3, h4")).toBeNull();
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
