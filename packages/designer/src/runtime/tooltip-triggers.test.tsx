// @vitest-environment jsdom
/**
 * Class-wide check (T17): every Tooltip caller renders its trigger element.
 *
 * The selected `components.tooltip` fill is the stock shadcn content-only `Tooltip`; it has no `trigger`
 * prop. A `trigger` handed to the leaf is therefore dropped and the control it carried never renders. So:
 * no source file may pass `trigger` to a `components.tooltip` leaf binding (the probe below proves the drop,
 * and fails the day a fill starts rendering triggers), and a Tooltip caller wraps its control and the
 * `Tooltip` in the stock `TooltipTrigger`, which takes its delays from `behaviorTiming`.
 */
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { CanvasZoom } from "../components/CanvasZoom.js";
import { componentLeaf } from "./component-leaf.js";

afterEach(cleanup);

const src = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Vendored stock source composes its own tooltip anatomy and binds no leaf. */
const STOCK = /^components\/(preview-runtime|sidebar)\//;
const LEAF = /const\s+(\w+)\s*=\s*componentLeaf\s*(?:<[^;]*?>)?\s*\(\s*"components\.tooltip"/g;

function sources(): string[] {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__fixtures__" || name === "node_modules" ? [] : walk(path);
    return /\.tsx$/.test(name) && !/\.(test|stories)\.tsx$/.test(name) ? [path] : [];
  });
  return walk(src).filter(path => !STOCK.test(relative(src, path)));
}

/** Files whose `components.tooltip` leaf binding is used with a `trigger` attribute. */
export function droppedTriggers(files: readonly { file: string; text: string }[]): string[] {
  return files.flatMap(({ file, text }) => [...text.matchAll(LEAF)]
    .filter(([, name]) => new RegExp(`<${name}\\b[^>]*?\\btrigger\\s*=`, "s").test(text))
    .map(([, name]) => `${file}: <${name} trigger=...>`));
}

// The mistaken call shape: the stock Tooltip has no trigger prop, so the leaf drops it.
const LeafTooltip = componentLeaf<(props: { readonly trigger: ReactElement; readonly children: string }) => ReactElement | null>("components.tooltip");

describe("Tooltip callers render their trigger", () => {
  it("the selected tooltip fill drops a trigger handed to the leaf (why the scan exists)", () => {
    render(<LeafTooltip trigger={<button type="button">Probe</button>}>Described</LeafTooltip>);
    expect(screen.queryByRole("button", { name: "Probe" })).not.toBeInTheDocument();
  });

  it("no source passes trigger to a components.tooltip leaf", () => {
    const files = sources().map(path => ({ file: relative(src, path), text: readFileSync(path, "utf8") }));
    expect(files.length).toBeGreaterThan(50);
    expect(droppedTriggers(files)).toEqual([]);
  });

  it("the scan catches a caller that hands its trigger to the leaf (mutation)", () => {
    const text = 'const Tooltip = componentLeaf<typeof import("./Tooltip.js").Tooltip>("components.tooltip");\n'
      + "export const A = () => <Tooltip trigger={<Button>Go</Button>}>Go</Tooltip>;";
    expect(droppedTriggers([{ file: "mutant.tsx", text }])).toEqual(["mutant.tsx: <Tooltip trigger=...>"]);
  });

  it("CanvasZoom renders every zoom control", () => {
    render(<CanvasZoom value={0.5} min={0.12} max={2} labels={{ group: "Zoom", out: "Zoom out", in: "Zoom in", fit: "Fit", percent: "Zoom level" }}
      formatValue={value => `${Math.round(value)}%`} onChange={() => undefined} onFit={() => undefined} />);
    for (const control of ["zoom-out", "zoom-in", "zoom-fit", "zoom-reset"]) {
      expect(document.querySelector(`[data-studio-control="${control}"]`), control).not.toBeNull();
    }
  });
});
