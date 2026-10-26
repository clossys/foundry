// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { loadCatalog } from "../../catalog-core/index.js";
import { completedTokenLibrary } from "../../importers/__fixtures__/completed-token-library.js";
import { buildCandidates } from "../../studio/model.js";
import { CandidateCell } from "../../studio/CandidateCell.js";
import { CompactPreview } from "../../studio/previews.js";
import { labels } from "../../studio/__fixtures__/studio.js";
import tokensIa from "../../catalog/ia/tokens.json" with { type: "json" };
import { TokenValueText } from "./specimens.js";
import { displayTokenValue, orderTokenMembers } from "./member-order.js";

/**
 * VR2 r2 studio-01 (P0), studio-03 and studio-04 (P1), against the real signed-default token
 * library: Type board specimens stay inside a token-bounded box at every zoom tier, member values
 * read as resolved values (never a raw `var()` string), and scale members sort by ordinal or value.
 */
afterEach(cleanup);
const catalog = loadCatalog();
const library = completedTokenLibrary(catalog, { id: "vf12-consumer", kind: "consumer", author: "consumer", license: "UNLICENSED" }, "2026-10-25");
const selected = (leaf: string) => buildCandidates({ catalog, library, working: library, scope: "slot", target: leaf, slotId: leaf }).find(entry => entry.selected)!;
const typeLeaves = (tokensIa.nodes.find(node => node.id === "type")!.children ?? []).flatMap(child => child.leaves);
const keysOf = (leaf: string) => orderTokenMembers(selected(leaf).members).map(entry => entry.id.slice(leaf.length + 1));
const CONTAIN = "token-specimen-contain";

it("defines the containment utility from a size token, clipping its content", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "styles", "theme-keys.css"), "utf8");
  const rule = /@utility token-specimen-contain \{([^}]*)\}/.exec(css)?.[1] ?? "";
  expect(rule).toMatch(/max-inline-size:\s*var\(--ui-layout-sidebar-w\)/);
  expect(rule).toMatch(/overflow:\s*hidden/);
  expect(rule).toMatch(/overflow-wrap:\s*anywhere/);
});

it("contains every Type board specimen in the full and the compact zoom tier (studio-01)", () => {
  expect(typeLeaves.length).toBeGreaterThan(8);
  const problems: string[] = [];
  for (const leaf of typeLeaves) {
    const candidate = selected(leaf);
    const full = render(<CandidateCell candidate={candidate} labels={labels} />);
    const variants = [...full.container.querySelectorAll<HTMLElement>("[data-candidate-variant]")];
    if (variants.length !== candidate.members.length) problems.push(`${leaf}: ${variants.length} variants`);
    for (const variant of variants) if (!variant.classList.contains(CONTAIN)) problems.push(`${leaf}: variant ${variant.dataset.candidateVariant} not contained`);
    full.unmount();
    // The compact tier paints the specimen alone in a plate: each specimen root bounds itself.
    for (const entry of candidate.members) {
      const compact = render(<div data-plate=""><CompactPreview candidate={{ ...candidate, members: [entry] }} labels={labels} /></div>);
      for (const root of compact.container.querySelectorAll<HTMLElement>("[data-plate] > *")) {
        const bounded = root.classList.contains(CONTAIN) || (root.classList.contains("overflow-hidden") && [...root.classList].some(name => name.startsWith("max-w-")));
        if (!bounded) problems.push(`${entry.id}: <${root.tagName.toLowerCase()}> unbounded`);
      }
      compact.unmount();
    }
  }
  expect(problems).toEqual([]);
}, 120_000);

it("shows resolved values with the alias as a name, never a var() string (studio-03)", () => {
  expect(displayTokenValue("var(--color-surface-raised, oklch(1 0 0))")).toEqual({ text: "oklch(1 0 0)", alias: "--color-surface-raised" });
  expect(displayTokenValue("var(--a, var(--b, 120ms))")).toEqual({ text: "120ms", alias: "--a" });
  expect(displayTokenValue("0 1px 0 var(--color-line-base, oklch(0.8761 0 0))")).toEqual({ text: "0 1px 0 oklch(0.8761 0 0)" });
  expect(displayTokenValue("cubic-bezier(.2, 0, 0, 1)")).toEqual({ text: "cubic-bezier(0.2, 0, 0, 1)" });
  const problems: string[] = [];
  for (const slot of catalog.slots.filter(entry => entry.id.startsWith("tokens."))) {
    const candidate = selected(slot.id);
    if (!candidate) continue;
    for (const entry of candidate.members) {
      const view = render(<TokenValueText css={entry.member.css.light} />);
      const code = view.container.querySelector<HTMLElement>("[data-member-value]")!;
      const shown = code.textContent ?? "";
      if (shown.includes("var(")) problems.push(`${entry.id}: ${shown}`);
      if ((code.dataset.copyValue ?? shown) !== entry.member.css.light) problems.push(`${entry.id}: copy value lost`);
      view.unmount();
    }
  }
  expect(problems).toEqual([]);
  const alias = render(<TokenValueText css="var(--ui-duration-fast, 120ms)" />);
  expect(alias.container.querySelector("[data-token-alias]")).toHaveTextContent("--ui-duration-fast");
  expect(alias.container.querySelector("[data-member-value]")).toHaveTextContent("120ms");
}, 120_000);

it("sorts scale members by ordinal, then by value (studio-04)", () => {
  expect(keysOf("tokens.font-size")).toEqual(["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"]);
  expect(keysOf("tokens.display-size")).toEqual(["m", "l", "xl"]);
  expect(keysOf("tokens.heading-size")).toEqual(["h0", "h1", "h2", "h3"]);
  expect(keysOf("tokens.spacing")).toEqual(["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl"]);
  const ramp = keysOf("tokens.color-ramp");
  expect(ramp.slice(0, 11)).toEqual(["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"].map(step => `amber.${step}`));
  expect(ramp.indexOf("amber.950")).toBeLessThan(ramp.indexOf("blue.50"));
  expect(keysOf("tokens.duration")).toEqual(["instant", "fast", "default", "deliberate", "flash"]);
  expect(keysOf("tokens.font-weight")).toEqual(["thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black"]);
  expect(keysOf("tokens.line-height").slice(0, 3)).toEqual(["xs", "sm", "base"]);
});

it("renders the cell and its palette rows in the sorted order", () => {
  const candidate = selected("tokens.color-ramp");
  const view = render(<CandidateCell candidate={candidate} labels={labels} />);
  const ids = [...view.container.querySelectorAll<HTMLElement>("[data-candidate-variant]")].map(variant => variant.dataset.candidateVariant);
  expect(ids).toEqual(orderTokenMembers(candidate.members).map(entry => entry.id));
  expect(ids.indexOf("tokens.color-ramp.amber.50")).toBe(0);
  const rows = view.container.querySelectorAll("[data-candidate-family]");
  expect(rows.length).toBeGreaterThan(1);
  expect(rows[0]!.querySelectorAll("[data-candidate-variant]")).toHaveLength(11);
});
