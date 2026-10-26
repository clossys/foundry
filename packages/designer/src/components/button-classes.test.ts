import { describe, expect, it } from "vitest";
import type { ButtonSize, ButtonVariant } from "./Button.js";
import {
  buttonClassName,
  buttonLinkClassName,
  iconButtonClassName,
  iconButtonLinkClassName,
  type ControlGround,
  type IconButtonShape,
  type IconButtonSize,
} from "./button-classes.js";

const VARIANTS: readonly ButtonVariant[] = ["primary", "secondary", "ghost", "danger", "outline", "tonal", "quiet"];
const SIZES: readonly ButtonSize[] = ["sm", "md", "lg"];
const GROUNDS: readonly ControlGround[] = ["base", "sunken", "inverse"];

const classesOf = (value: string): string[] => value.split(" ");

/** The ground-dependent classes each ladder variant must carry, per ground. */
const LADDER_GROUND_CLASSES: Record<"tonal" | "quiet", Record<ControlGround, readonly string[]>> = {
  tonal: {
    base: ["bg-control-tonal", "text-ink-primary", "hover:bg-control-tonal-hover"],
    sunken: ["bg-control-tonal", "text-ink-primary", "hover:bg-control-tonal-hover"],
    inverse: ["bg-control-tonal-inverse", "text-ink-on-inverse", "hover:bg-control-tonal-inverse-hover"],
  },
  quiet: {
    base: ["text-control-quiet"],
    sunken: ["text-control-quiet"],
    inverse: ["text-ink-on-inverse"],
  },
};

const BOX_SIZE_CLASSES: Record<ButtonSize, readonly string[]> = {
  sm: ["px-sm", "py-xs", "text-body-s"],
  md: ["px-md", "py-sm", "text-body"],
  lg: ["px-lg", "py-md", "text-body-l"],
};

const TEXT_SIZE_CLASSES: Record<ButtonSize, string> = { sm: "text-body-s", md: "text-body", lg: "text-body-l" };

describe("buttonClassName: variant x size x ground", () => {
  for (const variant of VARIANTS) {
    for (const size of SIZES) {
      for (const ground of GROUNDS) {
        it(`${variant} / ${size} / ${ground}`, () => {
          const classes = classesOf(buttonClassName(variant, size, ground));
          // Every boxed look (tonal too) repeats `text-body` at md: the shared
          // base and the md size both carry it, as before the ladder. The
          // quiet look is built apart and repeats nothing.
          if (variant === "quiet") {
            expect(new Set(classes).size, "no duplicate classes").toBe(classes.length);
          }
          expect(classes).toContain("outline-none");
          expect(classes).toContain("motion-reduce:transition-none");

          if (variant === "quiet") {
            // No box: no fill, no edge, no padding; the tap block and nudge come from the utility.
            expect(classes).toEqual(expect.arrayContaining(["quiet-action", "hover:underline", TEXT_SIZE_CLASSES[size]]));
            expect(classes.some((c) => /^(px|py|p|bg|ring|border)-/.test(c))).toBe(false);
          } else {
            expect(classes).toEqual(expect.arrayContaining([...BOX_SIZE_CLASSES[size], "rounded-control"]));
          }

          if (variant === "tonal" || variant === "quiet") {
            expect(classes).toEqual(expect.arrayContaining([...LADDER_GROUND_CLASSES[variant][ground]]));
            const otherGround = ground === "inverse" ? "base" : "inverse";
            for (const foreign of LADDER_GROUND_CLASSES[variant][otherGround]) {
              expect(classes).not.toContain(foreign);
            }
          } else if (variant === "primary" && ground === "inverse") {
            expect(classes).toEqual(expect.arrayContaining(["bg-action-on-inverse", "text-ink-primary", "hover:bg-action-on-inverse-hover"]));
            expect(classes).not.toContain("bg-action");
          } else {
            // Remaining variants read the same on every ground.
            expect(buttonClassName(variant, size, ground)).toBe(buttonClassName(variant, size));
          }
        });
      }
    }
  }

  it("tonal never draws an edge", () => {
    for (const ground of GROUNDS) {
      const classes = classesOf(buttonClassName("tonal", "md", ground));
      expect(classes.some((c) => /^(hover:)?(ring|border)/.test(c))).toBe(false);
    }
  });

  it("defaults the ground to base", () => {
    expect(buttonClassName("tonal", "md")).toBe(buttonClassName("tonal", "md", "base"));
    expect(buttonClassName("quiet", "md")).toBe(buttonClassName("quiet", "md", "base"));
  });
});

describe("buttonLinkClassName: the same looks on a link", () => {
  for (const variant of VARIANTS) {
    for (const ground of GROUNDS) {
      it(`${variant} / ${ground} drops outline-none and the disabled cursor, adds the focus outline`, () => {
        const classes = classesOf(buttonLinkClassName(variant, "md", ground));
        expect(classes).not.toContain("outline-none");
        expect(classes).not.toContain("disabled:cursor-not-allowed");
        expect(classes).toEqual(expect.arrayContaining(["focus-visible:outline-2", "focus-visible:outline-offset-2", "focus-visible:outline-focus-ring"]));
        const look = classesOf(buttonClassName(variant, "md", ground)).filter((c) => c !== "outline-none" && c !== "disabled:cursor-not-allowed");
        expect(classes).toEqual(expect.arrayContaining(look));
      });
    }
  }
});

describe("iconButtonClassName: size x shape x ground", () => {
  const ICON_SIZES: readonly IconButtonSize[] = ["sm", "md"];
  const SHAPES: readonly IconButtonShape[] = ["circle", "square"];
  const REST: Record<ControlGround, readonly string[]> = {
    base: ["bg-surface-raised", "text-ink-primary", "border-line-base", "hover:bg-surface-sunken", "focus-visible:ring-surface-raised"],
    sunken: ["bg-surface-raised", "text-ink-primary", "border-line-base", "hover:bg-surface-base", "focus-visible:ring-surface-raised"],
    inverse: ["bg-surface-inverse-raised", "text-ink-on-inverse", "border-line-on-inverse", "hover:bg-surface-inverse", "focus-visible:ring-surface-inverse-raised"],
  };

  for (const size of ICON_SIZES) {
    for (const shape of SHAPES) {
      for (const ground of GROUNDS) {
        it(`${size} / ${shape} / ${ground}`, () => {
          const classes = classesOf(iconButtonClassName({ size, shape, ground }));
          expect(new Set(classes).size, "no duplicate classes").toBe(classes.length);
          expect(classes).toContain(size === "md" ? "icon-control-md" : "icon-control-sm");
          expect(classes).not.toContain(size === "md" ? "icon-control-sm" : "icon-control-md");
          expect(classes).toContain(shape === "circle" ? "rounded-pill" : "rounded-control");
          expect(classes).toEqual(expect.arrayContaining(["border", ...REST[ground]]));
          expect(classes).toEqual(expect.arrayContaining(["aria-pressed:bg-surface-" + (ground === "inverse" ? "raised" : "inverse")]));
          expect(classes).toEqual(expect.arrayContaining(["focus-visible:outline-2", "focus-visible:outline-offset-2", "focus-visible:outline-focus-ring", "motion-reduce:transition-none"]));
          expect(classes).not.toContain("outline-none");
        });
      }
    }
  }

  it("defaults to a md circle on base, and iconButtonLinkClassName is that same look per ground", () => {
    expect(iconButtonClassName()).toBe(iconButtonClassName({ size: "md", shape: "circle", ground: "base" }));
    expect(iconButtonLinkClassName()).toBe(iconButtonClassName());
    for (const ground of GROUNDS) {
      expect(iconButtonLinkClassName(ground)).toBe(iconButtonClassName({ size: "md", shape: "circle", ground }));
    }
  });

  it("uses no var() arbitrary class, so every class compiles into compiled.css", () => {
    for (const size of ICON_SIZES) {
      for (const shape of SHAPES) {
        for (const ground of GROUNDS) {
          expect(iconButtonClassName({ size, shape, ground })).not.toContain("var(");
        }
      }
    }
    for (const variant of VARIANTS) {
      for (const ground of GROUNDS) expect(buttonClassName(variant, "md", ground)).not.toContain("var(");
    }
  });
});
