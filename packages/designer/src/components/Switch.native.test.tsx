import { readFileSync } from "node:fs";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "./preview-runtime/components/switch/switch.js";

it("retains the exact pinned native Switch body and classes", () => {
  const fixture = JSON.parse(readFileSync("packages/designer/src/importers/__fixtures__/shadcn-aria/switch.json", "utf8"));
  expect(fixture.commit).toBe("daaf156ee00ed91cc7e6bdd937c1b4973152d141");
  expect(readFileSync("packages/designer/src/components/preview-runtime/components/switch/switch.tsx", "utf8"))
    .toBe(fixture.files[0].content.replace('from "cn"', 'from "../_parts/utils/index.js"'));
});

it.each(["default", "sm"] as const)("keeps native %s size, accessible naming and render-prop children", size => {
  render(<Switch size={size} defaultSelected>{({ isSelected }) => `Notifications ${isSelected ? "on" : "off"}`}</Switch>);
  const control = screen.getByRole("switch", { name: "Notifications on" });
  expect(control).toBeChecked();
  expect(control.closest("[data-slot=switch]")).toHaveAttribute("data-size", size);
});

it("keeps controlled selection synchronized for pointer and Space activation", async () => {
  const changed = vi.fn(), user = userEvent.setup();
  function Controlled() {
    const [selected, setSelected] = useState(false);
    return <Switch isSelected={selected} onChange={value => { setSelected(value); changed(value); }}>Weekly summary</Switch>;
  }
  render(<Controlled />);
  const control = screen.getByRole("switch", { name: "Weekly summary" });
  await user.click(control);
  expect(control).toBeChecked();
  await user.keyboard(" ");
  expect(control).not.toBeChecked();
  expect(changed.mock.calls).toEqual([[true], [false]]);
});

it("keeps disabled state inert and forwards an explicit accessible name", async () => {
  const changed = vi.fn();
  render(<Switch aria-label="Product updates" isDisabled onChange={changed} />);
  const control = screen.getByRole("switch", { name: "Product updates" });
  await userEvent.click(control);
  expect(control).toBeDisabled();
  expect(changed).not.toHaveBeenCalled();
});
