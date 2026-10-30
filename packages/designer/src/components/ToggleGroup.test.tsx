import { createRef, type CSSProperties } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cva } from "class-variance-authority";
import { describe, expect, it } from "vitest";
import { ToggleGroup, ToggleGroupItem } from "./ToggleGroup.js";
import { ToggleButton } from "./ToggleButton.js";
import { toggleExecutableSource } from "../importers/toggle-executable-profile.js";
import { rewriteShadcnAria } from "../importers/rewrite.js";
import { normalizeSelectedSource } from "../importers/normalize-selected-source.js";
import { generateCompiledCss } from "../compiled-css/generate.js";

const sourceRoot = resolve(import.meta.dirname, "..");
const fixtureRoot = resolve(sourceRoot, "importers/__fixtures__/shadcn-aria");
const readItem = (name: string) => JSON.parse(readFileSync(resolve(fixtureRoot, `${name}.json`), "utf8"));
const styles = readFileSync(resolve(fixtureRoot, "style-nova.css"), "utf8");
function selected(item: "toggle" | "toggle-group", adapt = true) {
  const original = readItem(item).files[0];
  const result = rewriteShadcnAria({ item, leaf: item === "toggle" ? "toggle-button" : item,
    files: [adapt ? toggleExecutableSource(item, original) : original], styles,
    leafByItem: { toggle: "toggle-button", "toggle-group": "toggle-group" } });
  expect(result.issues).toEqual([]);
  return normalizeSelectedSource(result.files[0]!);
}

describe("adopted shadcn@aria ToggleGroup", () => {
  it("uses the exact authenticated rewritten fill closure in the public component", () => {
    for (const item of ["toggle", "toggle-group"] as const) {
      const file = selected(item);
      expect(readFileSync(resolve(sourceRoot, file.path), "utf8")).toBe(file.content);
      expect(() => toggleExecutableSource(item, { ...readItem(item).files[0], content: readItem(item).files[0].content + " " })).toThrow(/pinned source receipt differs/);
    }
  });

  it("preserves CVA output for default, undefined, null and every supported variant/size", () => {
    const variantFunction = (content: string) => {
      const start = content.indexOf("const toggleVariants = ") + "const toggleVariants = ".length;
      const end = content.indexOf("\n\nfunction Toggle", start);
      return new Function("cva", `return ${content.slice(start, end)}`)(cva);
    };
    const original = variantFunction(selected("toggle", false).content);
    const adopted = variantFunction(selected("toggle").content);
    for (const variant of [undefined, null, "default", "outline"]) for (const size of [undefined, null, "default", "sm", "lg"]) {
      const props = { variant, size, className: "host-class" };
      expect(adopted(props)).toBe(original(props));
    }
    expect(adopted()).toBe(original());
  });

  it("forwards refs, render props and caller styles while retaining the token-bound gap", async () => {
    const user = userEvent.setup();
    const group = createRef<HTMLDivElement>(), option = createRef<HTMLButtonElement>();
    render(<ToggleGroup ref={group} aria-label="Appearance" selectionMode="single" defaultSelectedKeys={["system"]}
      style={{ color: "red", "--gap": "unbound" } as CSSProperties}
      className={({ state }) => state.selectedKeys.has("dark") ? "host-dark" : "host-system"}>
      {({ state }) => <>
        <ToggleGroupItem id="system">System</ToggleGroupItem>
        <ToggleGroupItem ref={option} id="dark" className={({ isSelected }) => isSelected ? "host-selected" : "host-unselected"}>
          {({ isSelected }) => isSelected ? "Dark selected" : `Dark (${state.selectedKeys.size})`}
        </ToggleGroupItem>
      </>}
    </ToggleGroup>);
    expect(group.current).toBe(screen.getByRole("radiogroup", { name: "Appearance" }));
    expect(option.current).toBe(screen.getByRole("radio", { name: "Dark (1)" }));
    expect(group.current).toHaveClass("host-system");
    expect(group.current).toHaveStyle({ color: "rgb(255, 0, 0)" });
    expect(group.current!.style.getPropertyValue("--gap")).toBe("calc(var(--spacing-xs) * 2)");
    await user.click(option.current!);
    expect(option.current).toBeChecked();
    expect(option.current).toHaveClass("host-selected");
    expect(option.current).toHaveTextContent("Dark selected");
    expect(group.current).toHaveClass("host-dark");
  });

  it("retains multiple selection, disabled items and vertical orientation on the actual peer", async () => {
    const user = userEvent.setup();
    render(<ToggleGroup aria-label="Formatting" selectionMode="multiple" orientation="vertical" defaultSelectedKeys={["bold"]}>
      <ToggleGroupItem id="bold">Bold</ToggleGroupItem><ToggleGroupItem id="italic">Italic</ToggleGroupItem>
      <ToggleGroupItem id="locked" isDisabled>Locked</ToggleGroupItem>
    </ToggleGroup>);
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toHaveAttribute("data-orientation", "vertical");
    const bold = screen.getByRole("button", { name: "Bold" }), italic = screen.getByRole("button", { name: "Italic" });
    await user.click(italic);
    expect(bold).toHaveAttribute("aria-pressed", "true");
    expect(italic).toHaveAttribute("aria-pressed", "true");
    const locked = screen.getByRole("button", { name: "Locked" });
    expect(locked).toBeDisabled();
    await user.click(locked);
    expect(locked).toHaveAttribute("aria-pressed", "false");
  });

  it("forwards a standalone toggle's ref and selected-state render prop", async () => {
    const user = userEvent.setup(), ref = createRef<HTMLButtonElement>();
    render(<ToggleButton ref={ref} className={({ isSelected }) => isSelected ? "selected" : "rest"}>
      {({ isSelected }) => isSelected ? "Enabled" : "Enable"}
    </ToggleButton>);
    expect(ref.current).toBe(screen.getByRole("button", { name: "Enable" }));
    await user.click(ref.current!);
    expect(ref.current).toHaveAttribute("aria-pressed", "true");
    expect(ref.current).toHaveClass("selected");
    expect(ref.current).toHaveTextContent("Enabled");
  });

  it("compiles orientation rules against the exact data-orientation emitted by the peer", async () => {
    const group = selected("toggle-group").content;
    expect(group).toContain("data-[orientation=vertical]:flex-col");
    expect(group).not.toMatch(/(?:group-)?data-(?:horizontal|vertical)(?=[:/])/);
    const css = await generateCompiledCss({ stylesDir: resolve(sourceRoot, "../styles"), candidates: [
      "data-[orientation=vertical]:flex-col",
      "group-data-[orientation=horizontal]/toggle-group:data-[spacing=0]:first:rounded-l-(--radius-control)",
    ] });
    expect(css.css).toContain('data-orientation="vertical"');
    expect(css.css).toContain('data-orientation="horizontal"');
    expect(css.css).toContain("flex-direction: column");
    expect(css.css).toContain("border-top-left-radius: var(--radius-control)");
  });
});
