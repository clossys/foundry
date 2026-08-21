import { describe, expect, it } from "vitest";
import { cx } from "./cx.js";

describe("cx", () => {
  it("joins multiple class-name fragments", () => {
    expect(cx("a", "b", "c")).toBe("a b c");
  });

  it("drops falsy fragments", () => {
    expect(cx("a", false, undefined, null, "b")).toBe("a b");
  });

  it("resolves a conflicting standard Tailwind utility in favor of the LAST occurrence", () => {
    expect(cx("p-4", "p-8")).toBe("p-8");
  });

  it("resolves a conflicting token-named spacing utility (regression: unextended tailwind-merge does not recognize px-md/px-lg as conflicting at all)", () => {
    expect(cx("px-md", "px-lg")).toBe("px-lg");
    expect(cx("gap-sm", "gap-lg")).toBe("gap-lg");
  });

  it("resolves a conflicting token-named radius utility (regression: unextended tailwind-merge does not recognize rounded-control/rounded-pill as conflicting)", () => {
    expect(cx("rounded-control", "rounded-pill")).toBe("rounded-pill");
  });

  it("keeps a font-size class and a color class together instead of dropping the font-size one (regression: without a font-size scale of its own, unextended tailwind-merge misclassifies text-body as a text-COLOR class — same `text-` prefix, color accepts any suffix — and drops it as a false conflict with text-ink-on-accent)", () => {
    const classes = cx("text-body", "text-ink-on-accent").split(" ");
    expect(classes).toContain("text-body");
    expect(classes).toContain("text-ink-on-accent");
  });

  it("still resolves two conflicting font-size classes against each other", () => {
    expect(cx("text-body", "text-h1")).toBe("text-h1");
  });

  it("lets a consumer's className win a real conflict, in the exact shape every atom uses: cx(builtIn, className)", () => {
    const builtIn = "bg-accent text-ink-on-accent px-md py-sm rounded-control";
    const consumerClassName = "bg-status-danger px-lg rounded-pill";
    const classes = cx(builtIn, consumerClassName).split(" ");

    expect(classes).toContain("bg-status-danger");
    expect(classes).not.toContain("bg-accent");
    expect(classes).toContain("px-lg");
    expect(classes).not.toContain("px-md");
    expect(classes).toContain("rounded-pill");
    expect(classes).not.toContain("rounded-control");
    // Untouched (non-conflicting) built-in classes survive.
    expect(classes).toContain("text-ink-on-accent");
    expect(classes).toContain("py-sm");
  });
});
