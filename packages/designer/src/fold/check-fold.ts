/**
 * Pure fold-contract gate over a JSON measurement produced by the consumer
 * (or a browser script). No live CSSOM — evidence file only.
 */

export const HERO_MEDIA_KINDS = ["product-surface", "original-art", "none"] as const;
export type HeroMediaKind = (typeof HERO_MEDIA_KINDS)[number];

export interface FoldViewport {
  width: number;
  height: number;
}

export interface FoldMeasurement {
  viewport: FoldViewport;
  h1Clipped: boolean;
  overlayIntersectingFold: string[];
  primaryCtaCount: number;
  heroMediaKind: HeroMediaKind;
}

export interface FoldFinding {
  rule: string;
  message: string;
}

export type FoldParseFailure =
  | { kind: "missing-field"; field: string }
  | { kind: "invalid-type"; field: string; detail: string }
  | { kind: "invalid-hero-media-kind"; value: string };

export type FoldParseResult =
  | { ok: true; measurement: FoldMeasurement }
  | { ok: false; failure: FoldParseFailure };

function isHeroMediaKind(value: string): value is HeroMediaKind {
  return (HERO_MEDIA_KINDS as readonly string[]).includes(value);
}

function parseViewport(raw: unknown): FoldViewport | FoldParseFailure {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "invalid-type", field: "viewport", detail: "must be an object" };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.width !== "number" || !Number.isFinite(obj.width)) {
    return { kind: "missing-field", field: "viewport.width" };
  }
  if (typeof obj.height !== "number" || !Number.isFinite(obj.height)) {
    return { kind: "missing-field", field: "viewport.height" };
  }
  return { width: obj.width, height: obj.height };
}

export function parseFoldMeasurement(raw: unknown): FoldParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, failure: { kind: "invalid-type", field: "(root)", detail: "must be a JSON object" } };
  }
  const obj = raw as Record<string, unknown>;

  if (!("viewport" in obj)) {
    return { ok: false, failure: { kind: "missing-field", field: "viewport" } };
  }
  const viewport = parseViewport(obj.viewport);
  if ("kind" in viewport) {
    return { ok: false, failure: viewport };
  }

  if (!("h1Clipped" in obj) || typeof obj.h1Clipped !== "boolean") {
    return { ok: false, failure: { kind: "missing-field", field: "h1Clipped" } };
  }

  if (!("overlayIntersectingFold" in obj) || !Array.isArray(obj.overlayIntersectingFold)) {
    return { ok: false, failure: { kind: "missing-field", field: "overlayIntersectingFold" } };
  }
  const overlayIntersectingFold: string[] = [];
  for (const entry of obj.overlayIntersectingFold) {
    if (typeof entry !== "string") {
      return {
        ok: false,
        failure: { kind: "invalid-type", field: "overlayIntersectingFold", detail: "every entry must be a string selector" },
      };
    }
    overlayIntersectingFold.push(entry);
  }

  if (!("primaryCtaCount" in obj) || typeof obj.primaryCtaCount !== "number" || !Number.isFinite(obj.primaryCtaCount)) {
    return { ok: false, failure: { kind: "missing-field", field: "primaryCtaCount" } };
  }

  if (!("heroMediaKind" in obj) || typeof obj.heroMediaKind !== "string") {
    return { ok: false, failure: { kind: "missing-field", field: "heroMediaKind" } };
  }
  if (!isHeroMediaKind(obj.heroMediaKind)) {
    return { ok: false, failure: { kind: "invalid-hero-media-kind", value: obj.heroMediaKind } };
  }

  return {
    ok: true,
    measurement: {
      viewport,
      h1Clipped: obj.h1Clipped,
      overlayIntersectingFold,
      primaryCtaCount: obj.primaryCtaCount,
      heroMediaKind: obj.heroMediaKind,
    },
  };
}

export function checkFoldMeasurement(measurement: FoldMeasurement): FoldFinding[] {
  const findings: FoldFinding[] = [];

  if (measurement.h1Clipped) {
    findings.push({
      rule: "fold:h1-clipped",
      message: "The primary H1 is clipped in the declared viewport — the full heading must be visible above the fold.",
    });
  }

  if (measurement.overlayIntersectingFold.length > 0) {
    findings.push({
      rule: "fold:overlay-intersecting-fold",
      message: `Chrome or overlays intersect the fold: ${measurement.overlayIntersectingFold.join(", ")}.`,
    });
  }

  if (measurement.primaryCtaCount !== 1) {
    findings.push({
      rule: "fold:primary-cta-count",
      message: `Expected exactly one primary CTA in the hero; measured ${measurement.primaryCtaCount}.`,
    });
  }

  return findings;
}

export function formatParseFailure(failure: FoldParseFailure): string {
  switch (failure.kind) {
    case "missing-field":
      return `Required field "${failure.field}" is missing or has the wrong type.`;
    case "invalid-type":
      return `Field "${failure.field}" ${failure.detail}.`;
    case "invalid-hero-media-kind":
      return `heroMediaKind "${failure.value}" is not one of: ${HERO_MEDIA_KINDS.join(", ")}.`;
  }
}
