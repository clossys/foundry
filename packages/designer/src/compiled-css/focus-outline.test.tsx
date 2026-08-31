import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Banner } from "../atoms/Banner.js";
import { Faq } from "../blocks/Faq.server.js";

const compiledCss = readFileSync(resolve(import.meta.dirname, "../../styles/compiled.css"), "utf8");

function ruleBody(selector: string): string {
  const marker = `${selector} {`;
  const start = compiledCss.indexOf(marker);
  if (start < 0) throw new Error(`compiled.css has no rule for ${selector}`);
  const bodyStart = start + marker.length;
  const end = compiledCss.indexOf("}", bodyStart);
  if (end < 0) throw new Error(`compiled.css has an unterminated rule for ${selector}`);
  return compiledCss.slice(bodyStart, end);
}

const outlineNoneRule = ruleBody(".outline-none");
const focusWidthRule = ruleBody(".focus-visible\\:outline-2:focus-visible");
const focusOffsetRule = ruleBody(".focus-visible\\:outline-offset-2:focus-visible");
const focusColorRule = ruleBody(".focus-visible\\:outline-accent:focus-visible");

function resolvedFocusOutlineStyle(className: string): string {
  const poisonedStyle = /--tw-outline-style:\s*([^;]+);/.exec(outlineNoneRule)?.[1]?.trim();
  const declaration = /outline-style:\s*var\(--tw-outline-style,\s*([^\)]+)\);/.exec(focusWidthRule);
  if (!declaration?.[1]) throw new Error("compiled focus outline has no solid fallback");
  return className.split(/\s+/).includes("outline-none") ? (poisonedStyle ?? "") : declaration[1].trim();
}

describe("compiled focus-outline cascade", () => {
  it("resolves a paintable outline for Banner dismiss and server-native FAQ controls", () => {
    const { container } = render(
      <>
        <Banner onDismiss={() => {}}>Notice</Banner>
        <Faq items={[{ id: "one", question: "Question", answer: "Answer" }]} />
      </>,
    );
    const controls = [
      screen.getByRole("button", { name: "Dismiss" }),
      container.querySelector("details > summary"),
    ];

    expect(outlineNoneRule).toMatch(/--tw-outline-style:\s*none/);
    expect(focusWidthRule).toMatch(/outline-width:\s*2px/);
    expect(focusOffsetRule).toMatch(/outline-offset:\s*2px/);
    expect(focusColorRule).toMatch(/outline-color:\s*var\(--color-accent/);
    for (const control of controls) {
      expect(control).toBeInstanceOf(HTMLElement);
      expect(resolvedFocusOutlineStyle((control as HTMLElement).className)).toBe("solid");
    }
  });
});
