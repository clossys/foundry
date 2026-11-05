import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "react-aria-components";
import { describe, expect, it } from "vitest";
import { Toolbar } from "./Toolbar.js";
describe("Toolbar candidate", () => {
  it.each([['horizontal', '{ArrowRight}'], ['vertical', '{ArrowDown}']] as const)("moves focus in %s orientation and skips disabled controls", async (orientation, key) => {
    const user = userEvent.setup();
    render(<Toolbar aria-label="Edit" orientation={orientation}><Button>First</Button><Button isDisabled>Unavailable</Button><Button>Last</Button></Toolbar>);
    expect(screen.getByRole("toolbar", { name: "Edit" })).toHaveAttribute("aria-orientation", orientation);
    act(() => screen.getByRole("button", { name: "First" }).focus());
    await user.keyboard(key);
    expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
  });
  it("preserves a render prop and host label references", () => {
    render(<><h2 id="edit-title">Edit tools</h2><Toolbar aria-labelledby="edit-title">{({ orientation }) => <Button>{orientation}</Button>}</Toolbar></>);
    expect(screen.getByRole("toolbar", { name: "Edit tools" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "horizontal" })).toBeInTheDocument();
  });
});
