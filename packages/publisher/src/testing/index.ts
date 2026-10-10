import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatPageTitle } from "../web/siteMetadata.js";

/** The class token Designer's primary `Button` carries and the one-primary-action rule looks for. */
export const PRIMARY_ACTION_CLASS = "bg-accent";

/** A front-door surface a consumer renders and asks this kit to check. */
export type FrontDoorSurface =
  | "sign-in"
  | "activation"
  | "sign-out-landing"
  | "reset"
  | "boundary"
  | "not-found"
  | "global-error"
  | "service-unavailable";

/** The invariant a finding reports. */
export type FrontDoorRule =
  | "one-h1"
  | "form-measure"
  | "one-primary-action"
  | "page-title"
  | "global-error-head";

/**
 * One surface to check. `render` returns the consumer's own element; the kit
 * builds no view and no copy. `title` is the two parts of the page title the
 * surface should carry, and `actual` is the title the consumer's own metadata
 * produces, compared against `formatPageTitle`. It is required on every
 * surface except `global-error`.
 */
export interface FrontDoorSurfaceCase {
  surface: FrontDoorSurface;
  render(): ReactElement;
  title?: { page: string; brand: string; actual?: string };
}

export interface FrontDoorConfig {
  surfaces: readonly FrontDoorSurfaceCase[];
}

export interface FrontDoorFinding {
  surface: FrontDoorSurface;
  rule: FrontDoorRule;
  message: string;
}

const FORM_MEASURE = "var(--ui-width-form-max, none)";
const FORM_SURFACES: readonly FrontDoorSurface[] = ["sign-in", "activation", "reset"];

function requireDomParser(): typeof DOMParser {
  const parser = (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  if (typeof parser !== "function") {
    throw new Error(
      "checkFrontDoor needs a DOMParser: run it in a DOM test environment (for example jsdom) or provide your own global DOMParser.",
    );
  }
  return parser;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The controls the one-primary-action rule counts: a button, a link or a `[role=button]` carrying the primary class token. */
function primaryActions(scope: ParentNode): Element[] {
  return [...scope.querySelectorAll('button, a, [role="button"]')].filter((element) =>
    element.classList.contains(PRIMARY_ACTION_CLASS),
  );
}

function checkSurface(parser: typeof DOMParser, entry: FrontDoorSurfaceCase): FrontDoorFinding[] {
  const { surface } = entry;
  const findings: FrontDoorFinding[] = [];
  const add = (rule: FrontDoorRule, message: string): void => {
    findings.push({ surface, rule, message });
  };

  const doc = new parser().parseFromString(renderToStaticMarkup(entry.render()), "text/html");

  const h1Count = doc.querySelectorAll("h1").length;
  if (h1Count !== 1) add("one-h1", `expected exactly one <h1>, found ${h1Count}`);

  if (FORM_SURFACES.includes(surface)) {
    const main = doc.querySelector("main");
    if (!main) add("form-measure", "expected a <main> carrying the form measure, found none");
    // The legacy page puts the measure on its own `<main>`; a view inside
    // `SiteFrame` puts it on its content root, a direct child of the frame's `<main>`.
    else if (
      main.style.maxWidth !== FORM_MEASURE &&
      ![...main.children].some((child) => (child as HTMLElement).style?.maxWidth === FORM_MEASURE)
    ) {
      add("form-measure", `expected <main> to carry max-width:${FORM_MEASURE}, found "${main.style.maxWidth}"`);
    }
  }

  const actionCount = primaryActions(doc.querySelector("main") ?? doc.body).length;
  if (actionCount !== 1) {
    add("one-primary-action", `expected exactly one control with class ${PRIMARY_ACTION_CLASS}, found ${actionCount}`);
  }

  let formatted: string | undefined;
  if (entry.title === undefined) {
    if (surface !== "global-error") add("page-title", "a page title is required on this surface and none was given");
  } else {
    try {
      formatted = formatPageTitle(entry.title);
    } catch (error) {
      add("page-title", `formatPageTitle rejected the title: ${describeError(error)}`);
    }
    if (formatted !== undefined && entry.title.actual !== undefined && entry.title.actual !== formatted) {
      add("page-title", `expected the actual title "${entry.title.actual}" to equal "${formatted}"`);
    }
  }

  if (surface === "global-error") {
    const titles = doc.querySelectorAll("title");
    if (titles.length !== 1) add("global-error-head", `expected exactly one <title>, found ${titles.length}`);
    else {
      const text = titles[0]?.textContent ?? "";
      if (entry.title !== undefined) {
        if (formatted !== undefined && text !== formatted) {
          add("global-error-head", `expected the <title> to equal "${formatted}", found "${text}"`);
        }
      } else if (!/^.+ · .+$/.test(text)) {
        add("global-error-head", `expected a <title> of the form "<page> · <brand>", found "${text}"`);
      }
    }

    const noindex = [...doc.querySelectorAll('meta[name="robots"]')].some((meta) =>
      /noindex/i.test(meta.getAttribute("content") ?? ""),
    );
    if (!noindex) add("global-error-head", "expected a robots meta containing noindex");

    const icons = doc.querySelectorAll('link[rel="icon"]').length;
    if (icons !== 1) add("global-error-head", `expected exactly one link[rel=icon], found ${icons}`);
  }

  return findings;
}

/**
 * Render each surface with `renderToStaticMarkup`, parse it with the caller's
 * own `DOMParser`, and return every front-door invariant it breaks. Throws a
 * plain `Error` when no `DOMParser` is available.
 */
export function checkFrontDoor(config: FrontDoorConfig): FrontDoorFinding[] {
  const parser = requireDomParser();
  return config.surfaces.flatMap((entry) => checkSurface(parser, entry));
}

/** `checkFrontDoor`, throwing one `Error` that lists every finding. */
export function expectFrontDoorConformance(config: FrontDoorConfig): void {
  const findings = checkFrontDoor(config);
  if (findings.length === 0) return;
  const lines = findings.map((finding) => `- ${finding.surface} [${finding.rule}] ${finding.message}`);
  throw new Error(
    `Front-door conformance failed with ${findings.length} finding${findings.length === 1 ? "" : "s"}:\n${lines.join("\n")}`,
  );
}
