import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Label, Text, FieldError } from "react-aria-components";
import { RadioGroup, RadioGroupItem } from "./preview-runtime/components/radio-group/radio-group.js";

it("preserves the pinned native RadioGroup body and both concrete exports", () => {
  const fixture = JSON.parse(readFileSync("packages/designer/src/importers/__fixtures__/shadcn-aria/radio-group.json", "utf8"));
  const source = readFileSync("packages/designer/src/components/preview-runtime/components/radio-group/radio-group.tsx", "utf8");
  expect(fixture.commit).toBe("daaf156ee00ed91cc7e6bdd937c1b4973152d141");
  expect(source).toBe(fixture.files[0].content.replace('from "cn"', 'from "../_parts/utils/index.js"'));
});

it("keeps caller-owned naming and React Aria pointer and arrow selection", async () => {
  const change = vi.fn(), user = userEvent.setup();
  render(<RadioGroup defaultValue="standard" orientation="horizontal" onChange={change}><Label>Delivery</Label><RadioGroupItem value="standard">Standard</RadioGroupItem><RadioGroupItem value="express">Express</RadioGroupItem></RadioGroup>);
  expect(screen.getByRole("radiogroup", { name: "Delivery" })).toHaveAttribute("data-slot", "radio-group");
  const express = screen.getByRole("radio", { name: "Express" });
  await user.click(express);
  expect(express).toBeChecked();
  expect(change).toHaveBeenLastCalledWith("express");
  await user.keyboard("{ArrowLeft}");
  expect(screen.getByRole("radio", { name: "Standard" })).toBeChecked();
  expect(change).toHaveBeenLastCalledWith("standard");
});

it("keeps caller-owned description, validation, and disabled option semantics", () => {
  render(<RadioGroup isInvalid validationBehavior="aria"><Label>Delivery</Label><Text slot="description">Choose delivery.</Text><RadioGroupItem value="standard" isDisabled>Standard</RadioGroupItem><FieldError>Choose an available option.</FieldError></RadioGroup>);
  expect(screen.getByRole("radiogroup", { name: "Delivery" })).toHaveAccessibleDescription(/Choose delivery.*Choose an available option/);
  expect(screen.getByRole("radio", { name: "Standard" })).toBeDisabled();
});
