import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkConsumerArtContract,
  checkStillBackdrop,
  type StillBackdropArt,
  type ImageBackdropContract,
} from "./consumer-art.js";
import { BACKDROP_BUDGET_CEILING_BYTES, checkBackdropContract } from "./contract.js";
import { parseDeclarationsForSelector, parseRootDeclarations } from "../tokens/internal/parse-css.js";
import { mergeDeclarations, registryFromDeclarations } from "../tokens/internal/registry-from-css.js";

const css = readFileSync(resolve(import.meta.dirname, "../../styles/tokens.css"), "utf8");
const options = {
  darkTokens: registryFromDeclarations(mergeDeclarations(
    parseRootDeclarations(css), parseDeclarationsForSelector(css, ':root[data-theme="dark"]'),
  )),
};
const art: StillBackdropArt = {
  slot: "backdrop", purpose: "decorative", alt: "",
  width: 1600, height: 900, aspect: "16:9", fit: "cover",
  loading: "lazy", bytes: 100_000, backgroundToken: "--color-surface-base",
  source: { format: "webp", src: "/art/still.webp" },
};
const contract: ImageBackdropContract = {
  kind: "image", ariaHidden: true, pointerEvents: "none",
  scrim: { token: "--color-overlay-scrim", textToken: "--color-neutral-50", worstCaseBackdrop: "#6b6b6b" },
  loading: { strategy: "lazy", budgetBytes: art.bytes },
};

describe("still backdrop binding", () => {
  it("accepts decorative lazy still art without a separate reduced-motion frame", () => {
    expect(contract).not.toHaveProperty("reducedMotion");
    const report = checkStillBackdrop(art, contract, options);
    expect(report).toEqual({
      ok: true,
      art: checkConsumerArtContract(art),
      backdrop: checkBackdropContract(contract, options),
      findings: [],
    });
    expect(report.backdrop.themes).toEqual(["light", "dark"]);
  });

  it("accepts the existing token-painted SVG still source", () => {
    const vector: StillBackdropArt = {
      ...art, source: { format: "svg", paths: [{ d: "M0 0H1600V900H0Z", fillToken: "--color-accent" }] },
    };
    expect(checkStillBackdrop(vector, contract, options).ok).toBe(true);
  });

  it("rejects invalid source data through the existing art validator", () => {
    const invalid = { ...art, source: { format: "gif", src: "/art/moving.gif" } };
    const report = checkStillBackdrop(invalid, contract, options);
    expect(report.ok).toBe(false);
    expect(report.art).toEqual(checkConsumerArtContract(invalid));
    expect(report.art.findings).toContainEqual(expect.objectContaining({ path: "art.source.format" }));
  });

  it("refuses valid media art in the backdrop placement", () => {
    const media = { ...art, slot: "media" };
    expect(checkConsumerArtContract(media).ok).toBe(true);
    const report = checkStillBackdrop(media, contract, options);
    expect(report.ok).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({ path: "art.slot" }));
  });

  it("refuses a valid moving declaration even when a still frame is supplied", () => {
    const moving = { ...contract, kind: "video", reducedMotion: { fallbackFrame: "/art/still.webp" } };
    expect(checkBackdropContract(moving as ImageBackdropContract, options).ok).toBe(true);
    const report = checkStillBackdrop(art, moving as ImageBackdropContract, options);
    expect(report.ok).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({ path: "backdrop.kind" }));
  });

  it("refuses eager art even when the declaration promises lazy loading", () => {
    const eager = { ...art, loading: "eager" };
    expect(checkConsumerArtContract(eager).ok).toBe(true);
    const report = checkStillBackdrop(eager, contract, options);
    expect(report.ok).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({ path: "art.loading" }));
  });

  it("refuses an idle declaration that a static lazy image cannot implement", () => {
    const idle: ImageBackdropContract = { ...contract, loading: { ...contract.loading, strategy: "idle" } };
    expect(checkBackdropContract(idle, options).ok).toBe(true);
    const report = checkStillBackdrop(art, idle, options);
    expect(report.ok).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({ path: "backdrop.loading.strategy" }));
  });

  it("binds declared source bytes to the actual backdrop budget", () => {
    expect(checkStillBackdrop(art, contract, options).ok).toBe(true);
    const smaller: ImageBackdropContract = { ...contract, loading: { ...contract.loading, budgetBytes: art.bytes - 1 } };
    expect(checkConsumerArtContract(art).ok).toBe(true);
    expect(checkBackdropContract(smaller, options).ok).toBe(true);
    const report = checkStillBackdrop(art, smaller, options);
    expect(report.ok).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({ path: "art.bytes" }));
  });

  it("preserves the backdrop ceiling, contrast, and theme validation", () => {
    const declarations: ImageBackdropContract[] = [
      { ...contract, loading: { ...contract.loading, budgetBytes: BACKDROP_BUDGET_CEILING_BYTES + 1 } },
      { ...contract, scrim: { ...contract.scrim, worstCaseBackdrop: "#ffffff" } },
      { ...contract, scrim: { ...contract.scrim, token: "--gradient-media-scrim" } },
    ];
    for (const declaration of declarations) {
      const report = checkStillBackdrop(art, declaration, options);
      expect(report.ok).toBe(false);
      expect(report.backdrop).toEqual(checkBackdropContract(declaration, options));
      expect(report.backdrop.ok).toBe(false);
    }
    const uncheckedTheme = checkStillBackdrop(art, contract);
    expect(uncheckedTheme.ok).toBe(false);
    expect(uncheckedTheme.backdrop.unchecked).toContainEqual(expect.objectContaining({ reason: "theme-unchecked" }));
  });

  it("fails closed on missing or unreadable art without evaluating accessors", () => {
    let evaluated = false;
    const accessor = { ...art };
    Object.defineProperty(accessor, "bytes", { enumerable: true, get: () => { evaluated = true; throw new Error("unreadable"); } });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    for (const invalid of [undefined, null, {}, accessor, revoked.proxy]) {
      expect(checkStillBackdrop(invalid, contract, options).ok).toBe(false);
    }
    expect(evaluated).toBe(false);
  });

  it("fails closed on missing or unreadable backdrop declarations", () => {
    const unreadable = new Proxy(contract, { get: () => { throw new Error("unreadable"); } });
    for (const invalid of [undefined, null, {}, unreadable]) {
      const report = checkStillBackdrop(art, invalid as ImageBackdropContract, options);
      expect(report.ok).toBe(false);
      expect(report.backdrop.ok).toBe(false);
    }
  });
});
