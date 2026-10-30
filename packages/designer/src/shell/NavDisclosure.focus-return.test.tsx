import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { NavDisclosure } from "./NavDisclosure.js";
import { SiteHeader } from "./SiteHeader.js";

describe("NavDisclosure link focus return", () => {
  it.each(["label", "icon"] as const)("returns keyboard activation to the %s toggle before making the panel inert", async trigger => {
    const user = userEvent.setup();
    render(<SiteHeader brand="Example" nav={
      <NavDisclosure trigger={trigger} triggerLabel="Sections" aria-label="Sections navigation">
        <a href="#details" onClick={event => event.preventDefault()}>Details</a>
      </NavDisclosure>
    } />);
    const toggle = screen.getByRole("button", { name: "Sections" });
    act(() => toggle.focus());
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.tab();
    const link = screen.getByRole("link", { name: "Details" });
    expect(link).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toHaveAttribute("inert");
  });

  it("returns nested pointer activation to the owning toggle", () => {
    render(<NavDisclosure triggerLabel="Sections"><a href="#details" onClick={event => event.preventDefault()}><span>Details</span></a></NavDisclosure>);
    const toggle = screen.getByRole("button", { name: "Sections" });
    fireEvent.click(toggle);
    act(() => screen.getByRole("link", { name: "Details" }).focus());
    fireEvent.click(screen.getByText("Details"));
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
