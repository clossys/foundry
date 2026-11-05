import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as blocks from "./index.js";
import type { FormWizardProps } from "./FormWizard.js";
import { formWizardSample } from "./form-wizard/sample.js";

const FormWizard = (blocks as Record<string, unknown>).FormWizard as (props: FormWizardProps) => JSX.Element;
const props = (): FormWizardProps => ({ ...formWizardSample, onNext: vi.fn(), onBack: vi.fn() });

describe("FormWizard", () => {
  it("is a public blocks export: an ordered step list with the current step marked and only its content shown", () => {
    render(<FormWizard {...props()} />);
    const list = screen.getByRole("list", { name: "Setup steps" });
    expect(list.tagName).toBe("OL");
    const items = screen.getAllByRole("listitem");
    expect(items.map(item => item.getAttribute("aria-current"))).toEqual([null, "step", null]);
    expect(screen.getByRole("textbox", { name: "Team name" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Workspace name" })).toBeNull();
  });

  it("shows a labelled progress bar for the current position", () => {
    render(<FormWizard {...props()} />);
    const bar = screen.getByRole("progressbar", { name: "Step 2 of 3" });
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(bar).toHaveAttribute("aria-valuemax", "3");
  });

  it("calls back and next, hides back on the first step and finishes on the last", async () => {
    const user = userEvent.setup(), original = props();
    const { rerender } = render(<FormWizard {...original} />);
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(original.onBack).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(original.onNext).toHaveBeenCalledTimes(1);
    rerender(<FormWizard {...original} currentStep="workspace" />);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    rerender(<FormWizard {...original} currentStep="review" />);
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Review" })).toHaveTextContent("Northwind");
  });

  it("shows the review region only on the last step", () => {
    render(<FormWizard {...props()} />);
    expect(screen.queryByRole("region", { name: "Review" })).toBeNull();
  });

  it("refuses an unknown current step", () => {
    expect(() => render(<FormWizard {...props()} currentStep="missing" />)).toThrow(/FormWizard: unknown step missing/);
  });
});
