import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { checkBackdropElement } from "./contract.js";
import { DotField, DOT_FIELD_TILE } from "./DotField.js";
import { fieldHash, generateDotFieldPath } from "./dot-field-tile.js";

describe("DotField static backdrop", () => {
  it("renders one hidden inline pattern with no focusable descendants or pointer events", () => {
    const { container } = render(<DotField className="fixture-field" />);
    const layer = container.querySelector<HTMLElement>("[data-dot-field]")!;
    expect(container.querySelectorAll("[data-dot-field]")).toHaveLength(1);
    expect(layer).toHaveAttribute("aria-hidden", "true");
    expect(layer).toHaveClass("dot-field", "fixture-field");
    expect(layer.querySelectorAll("pattern")).toHaveLength(1);
    expect(layer.querySelector("svg")).toHaveAttribute("focusable", "false");
    expect(layer.querySelector("pattern")).toHaveAttribute("width", "576");
    expect(layer.querySelector("pattern")).toHaveAttribute("height", "576");
    expect(checkBackdropElement(layer)).toEqual({ ok: true, findings: [], unchecked: [] });
    expect(layer.querySelector("a,button,input,[tabindex]")).toBeNull();
  });

  it("is server-renderable and admits a decorative island child without any script", () => {
    const html = renderToStaticMarkup(<DotField><canvas aria-hidden="true" /></DotField>);
    expect(html).toContain("<svg");
    expect(html).toContain("<canvas");
    expect(html).not.toMatch(/<script|data:|onpointer/i);
  });

  it("rejects interactive content in the decorative child slot through the rendered contract", () => {
    const { container } = render(<DotField><button>Open example</button></DotField>);
    expect(checkBackdropElement(container.querySelector<HTMLElement>("[data-dot-field]")!).findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "element-focusable-descendant" })]));
  });
  it("keeps each local SVG reference bound to its own pattern when rendered twice", () => {
    const { container } = render(<><DotField patternId="first-field" /><DotField patternId="second-field" /></>);
    const patterns = [...container.querySelectorAll("pattern")];
    expect(new Set(patterns.map((p) => p.id)).size).toBe(2);
    for (const layer of container.querySelectorAll("[data-dot-field]")) {
      expect(layer.querySelector("rect")).toHaveAttribute("fill", `url(#${layer.querySelector("pattern")!.id})`);
    }
  });

  it("supports caller-owned IDs across separate server render roots without hooks or counters", () => {
    const first = renderToStaticMarkup(<DotField patternId="first-root-tile" />);
    const second = renderToStaticMarkup(<DotField patternId="second-root-tile" />);
    expect(first).toContain('id="first-root-tile"');
    expect(first).toContain('fill="url(#first-root-tile)"');
    expect(second).toContain('id="second-root-tile"');
    expect(second).not.toContain("first-root-tile");
  });
});

describe("dot-field tile golden (M-DF4)", () => {
  it("preserves the seeded hash samples independently of the generated path", () => {
    expect(fieldHash(7000021)).toBeCloseTo(0.954221, 6);
    expect(fieldHash(7000022)).toBeCloseTo(0.244620, 6);
    expect(fieldHash(123)).toBeCloseTo(0.787252, 6);
  });

  it("matches the committed golden and the build-time generator output", () => {
    const golden = readFileSync(resolve(import.meta.dirname, "dot-field-path.golden.txt"), "utf8").trim();
    expect(DOT_FIELD_TILE).toMatchObject({ seed: 7, cells: 18, pitch: 32, radius: 1.5 });
    expect(DOT_FIELD_TILE.path).toBe(golden);
    expect(generateDotFieldPath()).toBe(golden);
    expect(golden).toMatch(/^M/);
    expect(golden).not.toMatch(/NaN|Infinity/);
  });
});
