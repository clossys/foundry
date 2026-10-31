import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

const css = (name: string) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../styles", name + ".css"), "utf8");
function block(text: string, marker: string): string {
  const start = text.indexOf(marker); expect(start).toBeGreaterThanOrEqual(0);
  const open = text.indexOf("{", start); let depth = 1, end = open + 1;
  for (; depth && end < text.length; end++) { if (text[end] === "{") depth++; else if (text[end] === "}") depth--; }
  return text.slice(open + 1, end - 1);
}
it("selects mirrored sheet motion in RTL and removes its transform under reduced motion", () => {
  render(<div dir="rtl"><aside aria-label="Sheet" data-drawer-placement="start" /></div>);
  expect(screen.getByRole("complementary")).toHaveAttribute("data-drawer-placement", "start");
  const theme = css("theme-keys");
  expect(block(theme, '@keyframes sheet-slide-rtl')).toContain('translateX(var(--ui-motion-shift, 4px))');
  expect(theme).toContain('[data-drawer-placement="start"]:dir(rtl)');
  expect(theme).toContain('[data-drawer-placement="end"]:dir(rtl)');
  expect(theme).toMatch(/:dir\(rtl\)[^{]*\{\s*animation-name: sheet-slide-rtl;/);
  const reduced = theme.indexOf('@keyframes sheet-slide-rtl', theme.indexOf('@keyframes sheet-slide-rtl') + 1);
  expect(reduced).toBeGreaterThan(0);
  const media = theme.lastIndexOf('@media (prefers-reduced-motion: reduce)', reduced);
  const overrides = block(theme.slice(media), '@media');
  expect(overrides).toContain('@keyframes sheet-slide-rtl'); expect(overrides).not.toContain('transform:');
});
it("anchors the development badge at inline end under an RTL document", () => {
  render(<div dir="rtl" aria-label="Development document" />);
  expect(screen.getByLabelText("Development document")).toHaveAttribute("dir", "rtl");
  const badge = block(css("tokens"), 'html:not([data-brand-bound]):not([data-suppress-brand-banner])::before');
  expect(badge).toContain('inset-inline-end: 0;'); expect(badge).not.toMatch(/\bright:/);
});
