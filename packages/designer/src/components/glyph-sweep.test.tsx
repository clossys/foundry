import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { GlyphProvider } from "./glyph-context.js";
import type { IconNode } from "../icons/types.js";
import { Button } from "./Button.js";
import { Checkbox } from "./Checkbox.js";
import { Switch } from "./Switch.js";
import { Select } from "./Select.js";
import { ComboBox } from "./ComboBox.js";
import { Disclosure } from "./Disclosure.js";
import { Banner } from "./Banner.js";
import { Chip } from "./Chip.js";
import { SearchField } from "./SearchField.js";
import { StatusMark } from "./StatusMark.js";

const consumers = ["Select", "ComboBox", "Disclosure", "Banner", "Chip", "SearchField", "Checkbox", "StatusMark", "Switch", "Button"];
const source = (name: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), `${name}.tsx`), "utf8");
// Consumer files may render Icon, but glyph artwork belongs in data bindings.
function inlineGlyphs(text: string) {
  return /<(?:svg|path|circle|rect|polygon)\b|[✓▾▸×]/.test(text);
}
const replacement: IconNode = [["path", { d: "M1 2h3", "data-test-glyph": "consumer" }]];
const bindings = Object.fromEntries(["check", "close", "chevron-down", "chevron-right"].map(key => [`assets.icon-${key}`, replacement]));

describe("control glyph bindings", () => {
  it.each(consumers)("keeps %s free of inline SVG and text artwork", name => {
    expect(inlineGlyphs(source(name))).toBe(false);
  });
  it("rejects a restored inline glyph mutant", () => {
    expect(inlineGlyphs(source("Select") + '<span aria-hidden="true">✓</span>')).toBe(true);
    expect(inlineGlyphs(source("Checkbox") + '<svg><path d="M0 0" /></svg>')).toBe(true);
  });
  it("replaces each interactive affordance through asset bindings", async () => {
    const user = userEvent.setup();
    const { container } = render(<GlyphProvider glyphs={bindings} indeterminateGlyph={replacement}>
      <Button variant="quiet">Continue</Button>
      <Checkbox defaultSelected>Selected</Checkbox>
      <Checkbox isIndeterminate>Mixed</Checkbox>
      <Disclosure title="Details">Content</Disclosure>
      <Banner onDismiss={() => {}}>Message</Banner>
      <Chip onRemove={() => {}} removeLabel="Remove tag">Tag</Chip>
      <SearchField label="Query" defaultValue="Find" />
      <Select label="Choice" options={[{ id: "a", label: "Alpha" }]} defaultSelectedKey="a" />
      <ComboBox label="Suggestion" options={[{ id: "a", label: "Alpha" }]} defaultSelectedKey="a" />
    </GlyphProvider>);
    expect(container.querySelectorAll('[data-test-glyph="consumer"]')).toHaveLength(9);
    await user.click(screen.getByRole("button", { name: /Choice/ }));
    expect(screen.getByRole("option", { name: "Alpha" }).querySelector('[data-test-glyph="consumer"]')).not.toBeNull();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: /Suggestion/ }));
    expect(screen.getByRole("option", { name: "Alpha" }).querySelector('[data-test-glyph="consumer"]')).not.toBeNull();
    for (const svg of document.querySelectorAll("svg")) expect(svg).toHaveAttribute("aria-hidden", "true");
  });
  it("inherits nested bindings, preserves explicit quiet-button overrides and null", () => {
    const explicit: IconNode = [["path", { d: "M9 9h1", "data-test-glyph": "explicit" }]];
    const { container } = render(<GlyphProvider glyphs={{ "assets.icon-chevron-right": replacement }}>
      <GlyphProvider glyphs={{ "assets.icon-close": explicit }}>
        <Button variant="quiet">Inherited</Button>
        <Button variant="quiet" trailingIcon={explicit}>Explicit</Button>
        <Button variant="quiet" trailingIcon={null}>None</Button>
      </GlyphProvider>
    </GlyphProvider>);
    expect(container.querySelectorAll('[data-test-glyph="consumer"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-test-glyph="explicit"]')).toHaveLength(1);
    expect(screen.getByRole("button", { name: "None" }).querySelector("svg")).toBeNull();
  });
  it("binds mark and switch geometry to existing control tokens in both states", async () => {
    const user = userEvent.setup();
    const { container } = render(<><Checkbox>Check</Checkbox><Switch>Toggle</Switch></>);
    const box = container.querySelector('[data-part="control-mark"]') as HTMLElement;
    expect(box.style.width).toBe("var(--ui-control-mark)");
    expect(box.style.height).toBe("var(--ui-control-mark)");
    const track = container.querySelector('[data-part="switch-track"]') as HTMLElement;
    const thumb = container.querySelector('[data-part="switch-thumb"]') as HTMLElement;
    expect(track.style.width).toBe("var(--ui-control-switch-w)");
    expect(track.style.height).toBe("var(--ui-control-switch-h)");
    expect(thumb.style.width).toBe("var(--ui-control-switch-thumb)");
    expect(thumb.style.height).toBe("var(--ui-control-switch-thumb)");
    expect(thumb.style.insetInlineStart).toBe("0px");
    await user.click(screen.getByRole("switch"));
    expect(thumb.style.insetInlineStart).toBe("calc(var(--ui-control-switch-w) - var(--ui-control-switch-thumb) - 6px)");
    expect(screen.getByRole("switch")).toBeChecked();
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox")).toBeChecked();
  });
  it("preserves exact default status artwork and accepts server-safe asset bindings", () => {
    const tones = ["success", "warning", "danger", "info", "neutral"] as const;
    const expected = ['<circle cx="5" cy="5" r="4.5"></circle>', 'd="M5 0.5 9.75 9.25H0.25Z"', 'd="M5 0 10 5 5 10 0 5Z"', 'd="M5 0.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9ZM5 2a3 3 0 1 1 0 6a3 3 0 1 1 0-6Z"', '<rect x="1" y="4" width="8" height="2" rx="1"></rect>'];
    tones.forEach((tone, index) => {
      const html = renderToStaticMarkup(<StatusMark tone={tone}>Label</StatusMark>);
      expect(html).toContain(expected[index]);
      expect(html).toContain('viewBox="0 0 10 10"');
    });
    const html = renderToStaticMarkup(<StatusMark tone="warning" glyphs={{ "assets.icon-warning": replacement }}>Careful</StatusMark>);
    expect(html).toContain('data-test-glyph="consumer"');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('stroke:none');
    expect(html).toContain('fill:none');
    const neutral = renderToStaticMarkup(<StatusMark tone="neutral" neutralGlyph={replacement}>Idle</StatusMark>);
    expect(neutral).toContain('data-test-glyph="consumer"');
    expect(neutral).toContain('viewBox="0 0 24 24"');
    expect(source("StatusMark")).not.toMatch(/\b(?:useContext|createContext|useState|useEffect)\b/);
  });
});
