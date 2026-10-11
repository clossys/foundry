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
  type BackdropCheckOptions,
  type BackdropKind,
} from "../tokens/index.js";
import { parseDeclarationsForSelector, parseRootDeclarations } from "../tokens/internal/parse-css.js";
import { mergeDeclarations, registryFromDeclarations } from "../tokens/internal/registry-from-css.js";

/** Fixture colors live in this file only; `contract.ts` carries none. */
const DARK_WORST_CASE = "#6b6b6b";
const LIGHT_WORST_CASE = "#ffffff";

const SCRIM = {
  token: "--color-overlay-scrim",
  textToken: "--color-neutral-50",
  worstCaseBackdrop: DARK_WORST_CASE,
} as const;

/**
 * The real dark theme, built from styles/tokens.css the way the contrast
 * CLI builds it: the dark block layered over the light :root block.
 */
const tokensCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "styles", "tokens.css"), "utf8");
const LIGHT_DECLARATIONS = parseRootDeclarations(tokensCss);
const DARK_TOKENS = registryFromDeclarations(
  mergeDeclarations(LIGHT_DECLARATIONS, parseDeclarationsForSelector(tokensCss, ':root[data-theme="dark"]')),
);

/** Checks in both themes, against the shipped light and dark values, unless told otherwise. */
function check(contract: BackdropContract, options: BackdropCheckOptions = {}) {
  return checkBackdropContract(contract, { darkTokens: DARK_TOKENS, ...options });
}

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
      const contract = check(FIXTURES[kind]);
      expect(contract).toEqual({ ok: true, findings: [], unchecked: [], themes: ["light", "dark"] });

      const element = checkBackdropElement(buildElement(kind));
      expect(element).toEqual({ ok: true, findings: [], unchecked: [] });
    });
  }

  it("fails a video fixture that has no reduced-motion fallback", () => {
    const { reducedMotion: _omitted, ...withoutFallback } = FIXTURES.video as Extract<BackdropContract, { kind: "video" }>;
    const report = check(withoutFallback as unknown as BackdropContract);
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.rule)).toEqual(["reduced-motion-fallback"]);
  });

  it("lets an image be its own frame", () => {
    expect(FIXTURES.image).not.toHaveProperty("reducedMotion");
    expect(check(FIXTURES.image).ok).toBe(true);
  });
});

describe("rules", () => {
  it("scrim-contrast: text below AA over the composited scrim", () => {
    const report = check(variant("image", { scrim: { ...SCRIM, worstCaseBackdrop: LIGHT_WORST_CASE } }));
    expect(report.ok).toBe(false);
    // One finding per theme: a white frame defeats the scrim in light and in dark.
    expect(report.findings.map((f) => f.rule)).toEqual(["scrim-contrast", "scrim-contrast"]);
    expect(report.findings.map((f) => /In the (light|dark) theme/.exec(f.message)?.[1])).toEqual(["light", "dark"]);
    expect(report.unchecked).toEqual([]);
  });

  it("scrim-contrast: composites the scrim over the backdrop before measuring", () => {
    // The scrim is translucent: against the same text, a mid backdrop passes only because the scrim darkens it.
    const withScrim = check(variant("image", { scrim: { ...SCRIM, worstCaseBackdrop: "#808080" } }));
    expect(withScrim.ok).toBe(true);
    // An opaque stand-in for the scrim leaves the light backdrop in place and cannot pass.
    const opaque = check(variant("image", { scrim: { ...SCRIM, token: "--color-surface-base" } }));
    expect(opaque.findings.map((f) => f.rule)).toEqual(["scrim-contrast"]);
  });

  it("aria-hidden: refuses a contract that does not hide the backdrop", () => {
    const report = check(variant("video", { ariaHidden: false }));
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.rule)).toEqual(["aria-hidden"]);
  });

  it("aria-hidden: refuses a chart that is not marked illustrative", () => {
    const report = check(variant("chart", { illustrative: false }));
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.rule)).toEqual(["aria-hidden"]);
  });

  it("pointer-events: refuses anything but none", () => {
    const report = check(variant("canvas", { pointerEvents: "auto" }));
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.rule)).toEqual(["pointer-events"]);
  });

  for (const kind of ["video", "canvas", "chart"] as const) {
    it(`reduced-motion-fallback: ${kind} needs a non-empty fallbackFrame`, () => {
      for (const reducedMotion of [undefined, {}, { fallbackFrame: "" }, { fallbackFrame: "   " }]) {
        const report = check(variant(kind, { reducedMotion }));
        expect(report.ok).toBe(false);
        expect(report.findings.map((f) => f.rule)).toEqual(["reduced-motion-fallback"]);
      }
    });
  }

  it("lazy-loading-budget: refuses an eager strategy", () => {
    const report = check(variant("image", { loading: { strategy: "eager", budgetBytes: 1000 } }));
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.rule)).toEqual(["lazy-loading-budget"]);
  });

  it("lazy-loading-budget: refuses a budget that is not a positive integer at or under the ceiling", () => {
    for (const budgetBytes of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1000", BACKDROP_BUDGET_CEILING_BYTES + 1]) {
      const report = check(variant("image", { loading: { strategy: "lazy", budgetBytes } }));
      expect(report.ok, String(budgetBytes)).toBe(false);
      expect(report.findings.map((f) => f.rule), String(budgetBytes)).toEqual(["lazy-loading-budget"]);
    }
    const atCeiling = check(variant("image", { loading: { strategy: "idle", budgetBytes: BACKDROP_BUDGET_CEILING_BYTES } }));
    expect(atCeiling.ok).toBe(true);
  });

  it("reports every violated rule once, in rule order", () => {
    const report = check(
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
    const report = check(variant("video", { ariaHidden: false, pointerEvents: "auto" }));
    for (const finding of report.findings) {
      expect(finding.rule).toMatch(/^[a-z-]+$/);
      expect(finding.message.length).toBeGreaterThan(10);
    }
  });

  describe("scrim-contrast in both themes", () => {
    const INVERSE_INK = { ...SCRIM, textToken: "--color-ink-on-inverse" } as const;

    it("fails --color-ink-on-inverse in dark mode even though it passes in light", () => {
      const lightOnly = checkBackdropContract(variant("video", { scrim: INVERSE_INK }), { themes: "light-only" });
      expect(lightOnly.ok).toBe(true);
      const report = check(variant("video", { scrim: INVERSE_INK }));
      expect(report.ok).toBe(false);
      expect(report.findings.map((f) => f.rule)).toEqual(["scrim-contrast"]);
      expect(report.findings[0]?.message).toMatch(/^In the dark theme, --color-ink-on-inverse over --color-overlay-scrim/);
      expect(report.unchecked).toEqual([]);
    });

    it("does not pass a theme-dependent pairing when no dark registry is given", () => {
      for (const scrim of [SCRIM, INVERSE_INK]) {
        const report = checkBackdropContract(variant("video", { scrim }));
        expect(report.ok, scrim.textToken).toBe(false);
        expect(report.findings, scrim.textToken).toEqual([]);
        expect(report.unchecked.map((u) => [u.rule, u.reason]), scrim.textToken).toEqual([["scrim-contrast", "theme-unchecked"]]);
        expect(report.unchecked[0]?.message, scrim.textToken).toContain("--color-overlay-scrim");
      }
    });

    it("does not score the light registry passed as darkTokens as if it were dark", () => {
      const report = checkBackdropContract(variant("video", { scrim: INVERSE_INK }), { darkTokens: TOKENS });
      expect(report.ok).toBe(false);
      expect(report.findings).toEqual([]);
      expect(report.unchecked.map((u) => [u.rule, u.reason])).toEqual([["scrim-contrast", "theme-unchecked"]]);
      expect(report.unchecked[0]?.message).toContain("--color-overlay-scrim and --color-ink-on-inverse");
    });

    it("does not pass a partial dark registry spread from TOKENS with only the scrim overridden", () => {
      const darkTokens = {
        ...TOKENS,
        "--color-overlay-scrim": { ...TOKENS["--color-overlay-scrim"], value: DARK_TOKENS["--color-overlay-scrim"]?.value ?? "" },
      };
      const report = checkBackdropContract(variant("video", { scrim: INVERSE_INK }), { darkTokens });
      expect(report.ok).toBe(false);
      expect(report.findings).toEqual([]);
      expect(report.unchecked.map((u) => u.reason)).toEqual(["theme-unchecked"]);
      expect(report.unchecked[0]?.message).toMatch(/^--color-ink-on-inverse changes with the theme/);
    });

    it("finds a theme-dependent alias hop whose dark value was not stated", () => {
      const darkTokens = {
        ...TOKENS,
        "--color-overlay-scrim": { ...TOKENS["--color-overlay-scrim"], value: DARK_TOKENS["--color-overlay-scrim"]?.value ?? "" },
      };
      const report = checkBackdropContract(variant("image", { scrim: { ...SCRIM, textToken: "--color-ink-on-accent" } }), { darkTokens });
      expect(report.unchecked.map((u) => u.reason)).toEqual(["theme-unchecked"]);
      expect(report.unchecked[0]?.message).toMatch(/^--color-ink-on-inverse changes/);
    });

    it("passes a dark registry that states every theme-dependent token's dark value", () => {
      const report = checkBackdropContract(FIXTURES.video, { darkTokens: DARK_TOKENS });
      expect(report).toEqual({ ok: true, findings: [], unchecked: [], themes: ["light", "dark"] });
    });

    it("skips the dark pass under themes: light-only and says so in the report", () => {
      for (const scrim of [SCRIM, INVERSE_INK]) {
        const report = checkBackdropContract(variant("video", { scrim }), { themes: "light-only" });
        expect(report, scrim.textToken).toEqual({ ok: true, findings: [], unchecked: [], themes: ["light"] });
      }
      // light-only still holds the light theme to AA.
      const failing = checkBackdropContract(variant("video", { scrim: { ...SCRIM, worstCaseBackdrop: LIGHT_WORST_CASE } }), { themes: "light-only" });
      expect(failing.findings.map((f) => f.message.slice(0, 20))).toEqual(["In the light theme, "]);
    });

    it("follows the alias chain to a theme-dependent token", () => {
      // --color-ink-on-accent is not theme-dependent itself; it aliases --color-ink-on-inverse, which is.
      const report = checkBackdropContract(variant("image", { scrim: { ...SCRIM, textToken: "--color-ink-on-accent" } }));
      expect(report.unchecked.map((u) => u.reason)).toEqual(["theme-unchecked"]);
      expect(report.unchecked[0]?.message).toContain("--color-ink-on-accent");
    });

    it("keeps TOKENS' theme flags when the supplied registry drops them", () => {
      const flagless = registryFromDeclarations(LIGHT_DECLARATIONS);
      expect(flagless["--color-overlay-scrim"]?.themeDependent).toBe(false);
      const report = checkBackdropContract(FIXTURES.image, { tokens: flagless });
      expect(report.unchecked.map((u) => u.reason)).toEqual(["theme-unchecked"]);
    });

    it("needs no dark registry for a pairing whose tokens never change with the theme", () => {
      const tokens = {
        ...TOKENS,
        "--color-test-fixed-scrim": { ...TOKENS["--color-neutral-950"], property: "--color-test-fixed-scrim", value: "oklch(0 0 0 / 0.5)" },
      };
      const report = checkBackdropContract(variant("image", { scrim: { ...SCRIM, token: "--color-test-fixed-scrim" } }), { tokens });
      expect(report).toEqual({ ok: true, findings: [], unchecked: [], themes: ["light", "dark"] });
    });

    it("reports a dark registry that lacks a token as unchecked, not as a pass", () => {
      const { "--color-overlay-scrim": _dropped, ...darkTokens } = DARK_TOKENS;
      const report = checkBackdropContract(FIXTURES.image, { darkTokens });
      expect(report.ok).toBe(false);
      expect(report.unchecked.map((u) => u.reason)).toEqual(["unresolvable-token"]);
      expect(report.unchecked[0]?.message).toContain("dark scrim");
    });
  });

  describe("fails closed", () => {
    it("a scrim token naming no registry entry is unchecked and not ok", () => {
      const report = check(variant("image", { scrim: { ...SCRIM, token: "--color-overlay-nonexistent" } }));
      expect(report.ok).toBe(false);
      expect(report.findings).toEqual([]);
      // Reported once per theme, since each registry is resolved on its own.
      expect(report.unchecked.map((u) => [u.rule, u.reason])).toEqual([
        ["scrim-contrast", "unresolvable-token"],
        ["scrim-contrast", "unresolvable-token"],
      ]);
    });

    it("a text token naming no registry entry is unchecked and not ok", () => {
      const report = check(variant("image", { scrim: { ...SCRIM, textToken: "--color-ink-nonexistent" } }));
      expect(report.ok).toBe(false);
      expect(report.unchecked.map((u) => u.reason)).toEqual(["unresolvable-token", "unresolvable-token"]);
    });

    it("a token whose value is not a color is unchecked and not ok", () => {
      const report = check(variant("image", { scrim: { ...SCRIM, token: "--ui-z-modal" } }));
      expect(report.ok).toBe(false);
      expect(report.unchecked.map((u) => u.reason)).toEqual(["unparseable-token", "unparseable-token"]);
    });

    it("an unparseable worst-case backdrop is unchecked and not ok", () => {
      for (const worstCaseBackdrop of ["not-a-color", "", "#fff", "oklch(0.5 0 0 / 0.5)"]) {
        const report = check(variant("image", { scrim: { ...SCRIM, worstCaseBackdrop } }));
        expect(report.ok, worstCaseBackdrop).toBe(false);
        expect(report.unchecked.map((u) => u.reason), worstCaseBackdrop).toEqual(["unparseable-backdrop"]);
      }
    });

    it("a translucent text token is unchecked, not guessed at", () => {
      const tokens = {
        ...TOKENS,
        "--color-neutral-50": { ...TOKENS["--color-neutral-50"], value: "oklch(1 0 0 / 0.5)" },
      };
      const darkTokens = { ...DARK_TOKENS, "--color-neutral-50": tokens["--color-neutral-50"] };
      const report = check(FIXTURES.image, { tokens, darkTokens });
      expect(report.ok).toBe(false);
      expect(report.unchecked.map((u) => u.reason)).toEqual(["unparseable-token", "unparseable-token"]);
    });

    it("uses the registry it is given instead of TOKENS", () => {
      const tokens = {
        ...TOKENS,
        "--color-overlay-scrim": { ...TOKENS["--color-overlay-scrim"], value: "oklch(0 0 0 / 0)" },
        "--color-neutral-50": { ...TOKENS["--color-neutral-50"], value: "oklch(0.3 0 0)" },
      };
      const report = check(FIXTURES.image, { tokens });
      expect(report.findings.map((f) => f.rule)).toEqual(["scrim-contrast"]);
    });

    it("an unknown kind leaves the reduced-motion rule unchecked", () => {
      const report = check(variant("image", { kind: "gif" }));
      expect(report.ok).toBe(false);
      expect(report.unchecked.map((u) => [u.rule, u.reason])).toEqual([["reduced-motion-fallback", "unknown-kind"]]);
    });

    it("never throws on a malformed contract", () => {
      for (const value of [undefined, null, 0, "image", [], {}, { kind: "image" }, { kind: "image", scrim: null, loading: 3 }]) {
        const report = check(value as unknown as BackdropContract);
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

  it("fails a descendant that sets pointer events back on", () => {
    for (const value of ["auto", "all", "visiblePainted"]) {
      const element = buildElement("chart");
      const child = document.createElement("div");
      const grandchild = document.createElement("span");
      grandchild.style.setProperty("pointer-events", value);
      child.appendChild(grandchild);
      element.appendChild(child);
      const report = checkBackdropElement(element);
      expect(report.ok, value).toBe(false);
      expect(report.findings.map((f) => f.rule), value).toEqual(["element-pointer-events"]);
      expect(report.findings[0]?.message, value).toContain("span");
    }
  });

  it("allows descendants that inherit or repeat pointer-events none", () => {
    const element = buildElement("chart");
    const inherits = document.createElement("div");
    const repeats = document.createElement("div");
    repeats.style.pointerEvents = "none";
    const explicit = document.createElement("div");
    explicit.style.setProperty("pointer-events", "inherit");
    element.append(inherits, repeats, explicit);
    expect(checkBackdropElement(element)).toEqual({ ok: true, findings: [], unchecked: [] });
  });

  it("walks open shadow roots for pointer events and focusable descendants", () => {
    const element = buildElement("chart");
    const host = document.createElement("div");
    element.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const reclaiming = document.createElement("span");
    reclaiming.style.setProperty("pointer-events", "auto");
    shadow.appendChild(reclaiming);
    const pointerReport = checkBackdropElement(element);
    expect(pointerReport.findings.map((f) => f.rule)).toEqual(["element-pointer-events"]);

    reclaiming.remove();
    const nestedHost = document.createElement("div");
    shadow.appendChild(nestedHost);
    nestedHost.attachShadow({ mode: "open" }).appendChild(document.createElement("button"));
    expect(checkBackdropElement(element).findings.map((f) => f.rule)).toEqual(["element-focusable-descendant"]);

    const ownShadow = buildElement("chart");
    ownShadow.attachShadow({ mode: "open" }).appendChild(document.createElement("button"));
    expect(checkBackdropElement(ownShadow).findings.map((f) => f.rule)).toEqual(["element-focusable-descendant"]);
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
