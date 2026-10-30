import { createRef } from "react";
import { Form as PeerForm, TextField, Input, Label, Button } from "react-aria-components";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Form } from "./Form.js";

describe("selected Form primitive", () => {
  it("keeps the exact peer identity and forwards the native form ref", () => {
    expect(Form).toBe(PeerForm);
    const ref = createRef<HTMLFormElement>();
    render(<Form ref={ref} aria-label="Profile" className="host-form"><Button type="submit">Save</Button></Form>);
    expect(ref.current).toBe(screen.getByRole("form", { name: "Profile" }));
    expect(ref.current).toHaveClass("host-form");
  });
  it.each(["native", "aria"] as const)("preserves %s validation and host submit semantics", async validationBehavior => {
    const user=userEvent.setup(), submit=vi.fn((event: React.FormEvent<HTMLFormElement>)=>event.preventDefault());
    render(<Form aria-label="Profile" validationBehavior={validationBehavior} onSubmit={submit}><TextField name="name" isRequired><Label>Name</Label><Input /></TextField><Button type="submit">Save</Button></Form>);
    const input=screen.getByRole("textbox",{name:/Name/});
    expect(input).toHaveProperty("required",validationBehavior==="native");
    if(validationBehavior==="aria") expect(input).toHaveAttribute("aria-required","true");
    await user.click(screen.getByRole("button",{name:"Save"}));
    expect(submit).toHaveBeenCalledTimes(validationBehavior==="aria"?1:0);
    await user.type(input,"Ada");
    await user.click(screen.getByRole("button",{name:"Save"}));
    expect(submit).toHaveBeenCalledTimes(validationBehavior==="aria"?2:1);
  });
});
