import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TOKENS,
  BACKDROP_BUDGET_CEILING_BYTES,
  BACKDROP_KINDS,
  checkBackdropContract,
  checkBackdropElement,
  type BackdropContract,
  type BackdropKind,
} from "../tokens/index.js";

/** Fixture colors live in this file only; `contract.ts` carries none. */
const DARK_WORST_CASE = "#6b6b6b";
const LIGHT_WORST_CASE = "#ffffff";

const SCRIM = {
  token: "--color-overlay-scrim",
  textToken: "--color-ink-on-inverse",
  worstCaseBackdrop: DARK_WORST_CASE,
} as const;

const LOADING = { strategy: "lazy", budgetBytes: 500_000 } as const;
const FRAME = { fallbackFrame: "frames/still.webp" } as const;

const FIXTURES: Record<BackdropKind, BackdropContract> = {
  image: { kind: "image", scrim: SCRIM, ariaHidden: true, pointerEvents: "none", loading: LOADING },
  video: {
    kind: "video",
    scrim: SCRIM,
    ariaHidden: true,
    pointerEvents: "none",
    reducedMotion: FRAME,
    loading: { strategy: "idle", budgetBytes: 1_000_000 },
  },
  canvas: {
    kind: "canvas",
    scrim: SCRIM,
    ariaHidden: true,
    pointerEvents: "none",
    reducedMotion: FRAME,
    loading: LOADING,
  },
  chart: {
    kind: "chart",
    scrim: SCRIM,
    ariaHidden: true,
    pointerEvents: "none",
    reducedMotion: FRAME,
    loading: LOADING,
    illustrative: true,
  },
};

const TAGS: Record<BackdropKind, string> = { image: "img", video: "video", canvas: "canvas", chart: "div" };

function buildElement(kind: BackdropKind): HTMLElement {
  const element = document.createElement(TAGS[kind]);
  element.setAttribute("aria-hidden", "true");
  element.style.pointerEvents = "none";
  if (kind === "chart") element.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
  return element;
}

/** A copy of a fixture with some fields replaced. Fixtures are plain data. */
function variant(kind: BackdropKind, change: Record<string, unknown>): BackdropContract {
  return { ...FIXTURES[kind], ...change } as unknown as BackdropContract;
}

describe("fixtures", () => {
  it("covers every kind the contract names", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual([...BACKDROP_KINDS].sort());
  });

  for (const kind of BACKDROP_KINDS) {
    it(`passes Check A and Check B for the ${kind} fixture`, () => {
      const contract = checkBackdropContract(FIXTURES[kind]);
      expect(contract).toEqual({ ok: true, findings: [], unchecked: [] });

      const element = checkBackdropElement(buildElement(kind));
      expect(element).toEqual({ ok: true, findings: [], unchecked: [] });
    });
  }

  it("fails a video fixture that has no reduced-motion fallback", () => {
    const { reducedMotion: _omitted, ...withoutFallback } = FIXTURES.video as Extract<BackdropContract, { kind: "video" }>;
    const report = checkBackdropContract(withoutFallback as unknown as BackdropContract);
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.rule)).toEqual(["reduced-motion-fallback"]);
  });

  it("lets an image be its own frame", () => {
    expect(FIXTURES.image).not.toHaveProperty("reducedMotion");
    expect(checkBackdropContract(FIXTURES.image).ok).toBe(true);
  });
});

describe("rules", () => {
  it("scrim-contrast: text below AA over the composited scrim", () => {
    const report = checkBackdropContract(variant("image", { scrim: { ...SCRIM, worstCaseBackdrop: LIGHT_WORST_CASE } }));
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.rule)).toEqual(["scrim-contrast"]);
    expect(report.unchecked).toEqual([]);
  });

  it("scrim-contrast: composites the scrim over the backdrop before measuring", () => {
    // The scrim is translucent: against the same text, a mid backdrop passes only because the scrim darkens it.
    const withScrim = checkBackdropContract(variant("image", { scrim: { ...SCRIM, worstCaseBackdrop: "#808080" } }));
    expect(withScrim.ok).toBe(true);
    // An opaque stand-in for the scrim leaves the light backdrop in place and cannot pass.
    const opaque = checkBackdropContract(variant("image", { scrim: { ...SCRIM, token: "--color-surface-base" } }));
    expect(opaque.findings.map((f) => f.rule)).toEqual(["scrim-contrast"]);
  });

  it("aria-hidden: refuses a contract that does not hide the backdrop", () => {
    const report = checkBackdropContract(variant("video", { ariaHidden: false }));
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.rule)).toEqual(["aria-hidden"]);
  });

  it("aria-hidden: refuses a chart that is not marked illustrative", () => {
    const report = checkBackdropContract(variant("chart", { illustrative: false }));
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.rule)).toEqual(["aria-hidden"]);
  });

  it("pointer-events: refuses anything but none", () => {
    const report = checkBackdropContract(variant("canvas", { pointerEvents: "auto" }));
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.rule)).toEqual(["pointer-events"]);
  });

  for (const kind of ["video", "canvas", "chart"] as const) {
    it(`reduced-motion-fallback: ${kind} needs a non-empty fallbackFrame`, () => {
      for (const reducedMotion of [undefined, {}, { fallbackFrame: "" }, { fallbackFrame: "   " }]) {
        const report = checkBackdropContract(variant(kind, { reducedMotion }));
        expect(report.ok).toBe(false);
        expect(report.findings.map((f) => f.rule)).toEqual(["reduced-motion-fallback"]);
      }
    });
  }

  it("lazy-loading-budget: refuses an eager strategy", () => {
    const report = checkBackdropContract(variant("image", { loading: { strategy: "eager", budgetBytes: 1000 } }));
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.rule)).toEqual(["lazy-loading-budget"]);
  });

  it("lazy-loading-budget: refuses a budget that is not a positive integer at or under the ceiling", () => {
    for (const budgetBytes of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1000", BACKDROP_BUDGET_CEILING_BYTES + 1]) {
      const report = checkBackdropContract(variant("image", { loading: { strategy: "lazy", budgetBytes } }));
      expect(report.ok, String(budgetBytes)).toBe(false);
      expect(report.findings.map((f) => f.rule), String(budgetBytes)).toEqual(["lazy-loading-budget"]);
    }
    const atCeiling = checkBackdropContract(variant("image", { loading: { strategy: "idle", budgetBytes: BACKDROP_BUDGET_CEILING_BYTES } }));
    expect(atCeiling.ok).toBe(true);
  });

  it("reports every violated rule once, in rule order", () => {
    const report = checkBackdropContract(
      variant("video", {
        ariaHidden: false,
        pointerEvents: "auto",
        reducedMotion: undefined,
        loading: { strategy: "eager", budgetBytes: 0 },
        scrim: { ...SCRIM, worstCaseBackdrop: LIGHT_WORST_CASE },
      }),
    );
    expect([...new Set(report.findings.map((f) => f.rule))]).toEqual([
      "scrim-contrast",
      "aria-hidden",
      "pointer-events",
      "reduced-motion-fallback",
      "lazy-loading-budget",
    ]);
  });

  it("every finding carries a rule id and a developer message", () => {
    const report = checkBackdropContract(variant("video", { ariaHidden: false, pointerEvents: "auto" }));
    for (const finding of report.findings) {
      expect(finding.rule).toMatch(/^[a-z-]+$/);
      expect(finding.message.length).toBeGreaterThan(10);
    }
  });

  describe("fails closed", () => {
    it("a scrim token naming no registry entry is unchecked and not ok", () => {
      const report = checkBackdropContract(variant("image", { scrim: { ...SCRIM, token: "--color-overlay-nonexistent" } }));
      expect(report.ok).toBe(false);
      expect(report.findings).toEqual([]);
      expect(report.unchecked.map((u) => u.rule)).toEqual(["scrim-contrast"]);
      expect(report.unchecked[0]?.reason).toBe("unresolvable-token");
    });

    it("a text token naming no registry entry is unchecked and not ok", () => {
      const report = checkBackdropContract(variant("image", { scrim: { ...SCRIM, textToken: "--color-ink-nonexistent" } }));
      expect(report.ok).toBe(false);
      expect(report.unchecked.map((u) => u.reason)).toEqual(["unresolvable-token"]);
    });

    it("a token whose value is not a color is unchecked and not ok", () => {
      const report = checkBackdropContract(variant("image", { scrim: { ...SCRIM, token: "--ui-z-modal" } }));
      expect(report.ok).toBe(false);
      expect(report.unchecked.map((u) => u.reason)).toEqual(["unparseable-token"]);
    });

    it("an unparseable worst-case backdrop is unchecked and not ok", () => {
      for (const worstCaseBackdrop of ["not-a-color", "", "#fff", "oklch(0.5 0 0 / 0.5)"]) {
        const report = checkBackdropContract(variant("image", { scrim: { ...SCRIM, worstCaseBackdrop } }));
        expect(report.ok, worstCaseBackdrop).toBe(false);
        expect(report.unchecked.map((u) => u.reason), worstCaseBackdrop).toEqual(["unparseable-backdrop"]);
      }
    });

    it("a translucent text token is unchecked, not guessed at", () => {
      const tokens = {
        ...TOKENS,
        "--color-ink-on-inverse": { ...TOKENS["--color-ink-on-inverse"], value: "oklch(1 0 0 / 0.5)" },
      };
      const report = checkBackdropContract(FIXTURES.image, { tokens });
      expect(report.ok).toBe(false);
      expect(report.unchecked.map((u) => u.reason)).toEqual(["unparseable-token"]);
    });

    it("uses the registry it is given instead of TOKENS", () => {
      const tokens = {
        ...TOKENS,
        "--color-overlay-scrim": { ...TOKENS["--color-overlay-scrim"], value: "oklch(0 0 0 / 0)" },
        "--color-ink-on-inverse": { ...TOKENS["--color-ink-on-inverse"], value: "oklch(0.3 0 0)" },
      };
      const report = checkBackdropContract(FIXTURES.image, { tokens });
      expect(report.findings.map((f) => f.rule)).toEqual(["scrim-contrast"]);
    });

    it("an unknown kind leaves the reduced-motion rule unchecked", () => {
      const report = checkBackdropContract(variant("image", { kind: "gif" }));
      expect(report.ok).toBe(false);
      expect(report.unchecked.map((u) => [u.rule, u.reason])).toEqual([["reduced-motion-fallback", "unknown-kind"]]);
    });

    it("never throws on a malformed contract", () => {
      for (const value of [undefined, null, 0, "image", [], {}, { kind: "image" }, { kind: "image", scrim: null, loading: 3 }]) {
        const report = checkBackdropContract(value as unknown as BackdropContract);
        expect(report.ok, JSON.stringify(value)).toBe(false);
        expect(report.findings.length + report.unchecked.length, JSON.stringify(value)).toBeGreaterThan(0);
      }
    });
  });
});

describe("element", () => {
  it("fails an element that is not aria-hidden", () => {
    const element = buildElement("image");
    element.removeAttribute("aria-hidden");
    const report = checkBackdropElement(element);
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.rule)).toEqual(["element-aria-hidden"]);
  });

  it("fails an aria-hidden value other than true", () => {
    const element = buildElement("image");
    element.setAttribute("aria-hidden", "false");
    expect(checkBackdropElement(element).findings.map((f) => f.rule)).toEqual(["element-aria-hidden"]);
  });

  it("fails an element with pointer events auto", () => {
    const element = buildElement("canvas");
    element.style.pointerEvents = "auto";
    const report = checkBackdropElement(element);
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.rule)).toEqual(["element-pointer-events"]);
  });

  it("fails an element that sets no pointer-events at all", () => {
    const element = buildElement("canvas");
    element.style.removeProperty("pointer-events");
    expect(checkBackdropElement(element).findings.map((f) => f.rule)).toEqual(["element-pointer-events"]);
  });

  it("fails an aria-hidden element holding a button", () => {
    const element = buildElement("chart");
    element.appendChild(document.createElement("button"));
    const report = checkBackdropElement(element);
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.rule)).toEqual(["element-focusable-descendant"]);
  });

  it("fails each kind of focusable descendant", () => {
    const focusable: Array<[string, (host: HTMLElement) => void]> = [
      ["link", (host) => { const a = document.createElement("a"); a.setAttribute("href", "#x"); host.appendChild(a); }],
      ["button", (host) => host.appendChild(document.createElement("button"))],
      ["input", (host) => host.appendChild(document.createElement("input"))],
      ["select", (host) => host.appendChild(document.createElement("select"))],
      ["textarea", (host) => host.appendChild(document.createElement("textarea"))],
      ["tabindex 0", (host) => { const d = document.createElement("div"); d.setAttribute("tabindex", "0"); host.appendChild(d); }],
      ["tabindex 3", (host) => { const d = document.createElement("div"); d.setAttribute("tabindex", "3"); host.appendChild(d); }],
      ["video controls", (host) => { const v = document.createElement("video"); v.setAttribute("controls", ""); host.appendChild(v); }],
      ["nested", (host) => { const d = document.createElement("div"); d.appendChild(document.createElement("button")); host.appendChild(d); }],
    ];
    for (const [name, add] of focusable) {
      const element = buildElement("chart");
      add(element);
      expect(checkBackdropElement(element).findings.map((f) => f.rule), name).toEqual(["element-focusable-descendant"]);
    }
  });

  it("allows descendants that are not in the focus order", () => {
    const element = buildElement("chart");
    const anchorWithoutHref = document.createElement("a");
    const hidden = document.createElement("input");
    hidden.setAttribute("type", "hidden");
    const negative = document.createElement("div");
    negative.setAttribute("tabindex", "-1");
    const text = document.createElement("span");
    text.textContent = "label";
    element.append(anchorWithoutHref, hidden, negative, text);
    expect(checkBackdropElement(element)).toEqual({ ok: true, findings: [], unchecked: [] });
  });

  it("reports every violated element rule", () => {
    const element = document.createElement("div");
    element.appendChild(document.createElement("button"));
    expect(checkBackdropElement(element).findings.map((f) => f.rule)).toEqual([
      "element-aria-hidden",
      "element-pointer-events",
      "element-focusable-descendant",
    ]);
  });

  it("fails closed on a value that is not an element, without throwing", () => {
    for (const value of [undefined, null, {}, "div", 3]) {
      const report = checkBackdropElement(value as unknown as Element);
      expect(report.ok).toBe(false);
      expect(report.unchecked.map((u) => u.reason)).toEqual(["not-an-element", "not-an-element", "not-an-element"]);
    }
  });
});

describe("source", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, "contract.ts"), "utf8");
  // Strip block and line comments: prose may name a token, the code may not carry a literal.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("carries no raw color or length literal", () => {
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/\b(?:oklch|oklab|rgba?|hsla?|color-mix)\(\s*[\d.#a-z]/i);
    expect(code).not.toMatch(/\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%)(?![\w-])/);
    expect(code).not.toMatch(/var\([^)]*,\s*[^)]*\d/);
  });

  it("names only tokens that exist in TOKENS", () => {
    const names = source.match(/--(?:color|ui)-[a-z0-9-]+/g) ?? [];
    for (const name of names) {
      expect(Object.prototype.hasOwnProperty.call(TOKENS, name), name).toBe(true);
    }
  });

  it("imports no DOM or React module at module scope", () => {
    expect(source).not.toMatch(/from\s+["'](?:react|react-dom|jsdom|react-aria-components)/);
    expect(source).not.toMatch(/^\s*(?:window|document|globalThis)\./m);
  });
});
