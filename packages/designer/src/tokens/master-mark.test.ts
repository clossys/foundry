import { describe, expect, it } from "vitest";
import {
  iconMarkSvg,
  MASTER_MARK_ICON_SHELL_STYLE,
  MasterMarkValidationError,
  type MasterMark,
  validateMasterMark,
} from "./master-mark.js";

const GLYPH = '<rect x="3" y="3" width="18" height="18" rx="2" />';

const markOnly = iconMarkSvg(GLYPH);

const lockup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 32" fill="none" aria-hidden="true">
  <g transform="translate(0 4)" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="${MASTER_MARK_ICON_SHELL_STYLE}">${GLYPH}</g>
  <text x="40" y="22" fill="var(--color-ink-primary, currentColor)" font-family="var(--font-display, sans-serif)">Fixture</text>
</svg>`;

const inverse = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 32" aria-hidden="true">
  <rect width="120" height="32" fill="var(--color-surface-inverse, oklch(0.2 0 0))" rx="var(--radius-default, 4px)" />
  <g transform="translate(8 4)" stroke="var(--color-ink-on-inverse, oklch(0.95 0 0))" stroke-linecap="round" stroke-linejoin="round" style="${MASTER_MARK_ICON_SHELL_STYLE}">${GLYPH}</g>
  <text x="40" y="22" fill="var(--color-ink-on-inverse, oklch(0.95 0 0))" font-family="var(--font-display, sans-serif)">Fixture</text>
</svg>`;

/** Passing fixture — all three SVG variants present. */
export const MASTER_MARK_COMPLETE_FIXTURE: MasterMark = {
  lockup,
  mark: markOnly,
  inverse,
};

describe("validateMasterMark", () => {
  it("passes the complete fixture with lockup, mark-only, and inverse SVG documents", () => {
    const mark: Partial<MasterMark> = { ...MASTER_MARK_COMPLETE_FIXTURE };
    expect(() => validateMasterMark(mark)).not.toThrow();
    expect(mark.lockup).toBeDefined();
  });

  it("fails when the inverse variant is omitted", () => {
    const mark: Partial<MasterMark> = {
      lockup: MASTER_MARK_COMPLETE_FIXTURE.lockup,
      mark: MASTER_MARK_COMPLETE_FIXTURE.mark,
    };
    expect(() => validateMasterMark(mark)).toThrow(MasterMarkValidationError);
    try {
      validateMasterMark(mark);
    } catch (error) {
      expect(error).toBeInstanceOf(MasterMarkValidationError);
      expect((error as MasterMarkValidationError).reasons.some((r) => r.includes("inverse"))).toBe(true);
    }
  });

  it("fails when a variant is not an svg document", () => {
    expect(() =>
      validateMasterMark({
        lockup: "<span>not svg</span>",
        mark: markOnly,
        inverse,
      }),
    ).toThrow(MasterMarkValidationError);
  });
});
