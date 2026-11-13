import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NativeAction } from "./NativeAction.js";
import { buttonClassName } from "./button-classes.js";

describe("NativeAction native contract", () => {
  it("renders one named native button with original primary/md/base appearance and authored style precedence", () => {
    const label = "Caller action", ref = createRef<HTMLButtonElement>();
    const style = { opacity: 0.8, outline: "3px solid red", outlineOffset: 7, padding: 19 };
    const { container } = render(<NativeAction type="button" ref={ref} id="action" title="Caller title" name="intent" value="save" form="host" aria-label={label} aria-describedby="description" data-owner="host" style={style}>{label}</NativeAction>);
    const button = screen.getByRole("button", { name: label });
    expect(container.children).toHaveLength(1);
    expect(button.tagName).toBe("BUTTON"); expect(ref.current).toBe(button);
    for (const token of buttonClassName("primary", "md", "base").split(" ")) expect(button).toHaveClass(token);
    expect(button).toHaveStyle({ opacity: 0.8, outline: "3px solid red", "outline-offset": "7px", padding: "19px" });
    expect(button).toHaveAttribute("type", "button"); expect(button).toHaveAttribute("name", "intent");
    expect(button).toHaveAttribute("value", "save"); expect(button).toHaveAttribute("form", "host");
    expect(button).toHaveAttribute("aria-describedby", "description"); expect(button).toHaveAttribute("data-owner", "host");
    ref.current!.focus(); expect(document.activeElement).toBe(button);
  });
  it("forwards one native click and keyboard activation, without rendering-time activation", async () => {
    const user = userEvent.setup(), click = vi.fn();
    render(<NativeAction type="button" onClick={click}>Caller action</NativeAction>);
    expect(click).not.toHaveBeenCalled();
    const button = screen.getByRole("button"); await user.click(button); expect(click).toHaveBeenCalledTimes(1);
    expect(click.mock.calls[0]![0].target).toBe(button);
    await user.keyboard("{Enter}"); expect(click).toHaveBeenCalledTimes(2);
    await user.keyboard(" "); expect(click).toHaveBeenCalledTimes(3);
  });
  it("retains native disabled focus/activation, while aria-disabled alone remains an annotation", async () => {
    const user = userEvent.setup(), click = vi.fn(), ref = createRef<HTMLButtonElement>();
    const { rerender } = render(<NativeAction type="button" disabled ref={ref} onClick={click}>Caller action</NativeAction>);
    ref.current!.focus(); expect(document.activeElement).not.toBe(ref.current);
    await user.tab(); expect(document.activeElement).not.toBe(ref.current);
    await user.click(ref.current!); expect(click).not.toHaveBeenCalled();
    rerender(<NativeAction type="button" aria-disabled="true" ref={ref} onClick={click}>Caller action</NativeAction>);
    await user.click(ref.current!); expect(click).toHaveBeenCalledTimes(1);
  });
  it("preserves explicit submit/reset, preventDefault and caller key handlers", async () => {
    const user = userEvent.setup(), submit = vi.fn(event => event.preventDefault()), reset = vi.fn(), key = vi.fn();
    render(<form onSubmit={submit} onReset={reset}><input aria-label="Value" defaultValue="original" />
      <NativeAction type="button" onKeyDown={key}>Plain</NativeAction>
      <NativeAction type="submit">Submit</NativeAction>
      <NativeAction type="submit" onClick={event => event.preventDefault()}>Prevented</NativeAction>
      <NativeAction type="reset">Reset</NativeAction></form>);
    await user.click(screen.getByRole("button", { name: "Plain" })); expect(submit).not.toHaveBeenCalled();
    await user.keyboard("{Enter}"); expect(key).toHaveBeenCalledTimes(1); expect(submit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Submit" })); expect(submit).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Prevented" })); expect(submit).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "changed" } });
    await user.click(screen.getByRole("button", { name: "Reset" })); expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox")).toHaveValue("original");
  });
  it("keeps string class merging, native ARIA labelling and callback ref lifecycle", () => {
    const ref = vi.fn();
    const { unmount } = render(<><span id="label">Caller name</span><NativeAction type="button" ref={ref} aria-labelledby="label" className="px-lg">Action</NativeAction></>);
    const button = screen.getByRole("button", { name: "Caller name" });
    expect(button).toHaveClass("px-lg"); expect(button).not.toHaveClass("px-md"); expect(ref).toHaveBeenCalledWith(button);
    unmount(); expect(ref.mock.lastCall?.[0]).toBe(null);
  });
  for (const type of [undefined, null, "", "link", "BUTTON"]) it(`refuses a missing or non-native explicit type ${String(type)}`, () => {
    expect(() => render(<NativeAction {...({ type } as never)}>Action</NativeAction>)).toThrow("NativeAction requires an explicit native button type");
  });
  for (const props of [{ role: "link" }, { dangerouslySetInnerHTML: { __html: "text" } }, { as: "a" }, { href: "/" }, { onPress: () => {} }, { isDisabled: true }, { isPending: true }, { variant: "primary" }, { size: "md" }, { ground: "base" }, { children: () => "text" }, { className: () => "class" }, { style: () => ({}) }]) it(`refuses unsupported render/alias input ${Object.keys(props)[0]}`, () => {
    expect(() => render(<NativeAction type="button" {...props as never} />)).toThrow(/NativeAction/);
  });
});
