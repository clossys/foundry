// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "@clossys/designer/atoms";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthView } from "../web/views/AuthView.js";
import { BoundaryView } from "../web/views/BoundaryView.js";
import { GlobalErrorDocument } from "../web/views/GlobalErrorDocument.js";
import { StatusView } from "../web/views/StatusView.js";
import { SiteFrame } from "../web/frame/SiteFrame.js";
import type { SiteShellInput } from "../web/frame/types.js";
import type { CopyResolver } from "@clossys/writer";
import {
  PRIMARY_ACTION_CLASS,
  checkFrontDoor,
  expectFrontDoorConformance,
} from "./index.js";
import type { FrontDoorFinding, FrontDoorSurfaceCase } from "./index.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const ALLOWED_IMPORTS = ["react", "react-dom/server", "../web/siteMetadata.js"];

/** Every module specifier named by an `import` statement or an `export ... from` re-export. */
const MODULE_SPECIFIER =
  /^\s*(?:import\b[^;]*?|export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*)["']([^"']+)["']/gm;

function moduleSpecifiers(source: string): string[] {
  return [...source.matchAll(MODULE_SPECIFIER)].map((m) => m[1] as string);
}

const TOKEN_FORM_MEASURE = "var(--ui-width-form-max, none)";

const signIn = (): ReactElement => (
  <AuthView
    brand="Example Studio"
    heading="Sign in"
    description="Welcome back."
    form={<Button type="submit">Sign in</Button>}
  />
);

const notFound = (): ReactElement => (
  <BoundaryView
    brand="Example Studio"
    status="404"
    title="Page not found"
    description="That page does not exist."
    action={<Button>Go home</Button>}
  />
);

const globalError = (): ReactElement => (
  <GlobalErrorDocument
    lang="en"
    documentTitle={{ page: "Something went wrong", brand: "Example Studio" }}
    icon={{ href: "/icon.svg", type: "image/svg+xml" }}
    status={500}
    title="Something went wrong"
    description="Something went wrong. Error: 8f2a91c0."
    action={<Button>Try again</Button>}
  />
);

const title = { page: "Sign in", brand: "Example Studio" };

const conforming: FrontDoorSurfaceCase[] = [
  { surface: "sign-in", render: signIn, title },
  { surface: "not-found", render: notFound, title: { page: "Page not found", brand: "Example Studio" } },
  { surface: "global-error", render: globalError },
];

function rulesFor(surface: FrontDoorSurfaceCase): string[] {
  return checkFrontDoor({ surfaces: [surface] }).map((finding) => finding.rule);
}

describe("conforming surfaces", () => {
  it("gives no findings for an AuthView sign-in, a BoundaryView not-found and a GlobalErrorDocument", () => {
    expect(checkFrontDoor({ surfaces: conforming })).toEqual([]);
  });

  it("gives no findings for a global error with a matching title", () => {
    const findings = checkFrontDoor({
      surfaces: [
        {
          surface: "global-error",
          render: globalError,
          title: { page: "Something went wrong", brand: "Example Studio" },
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it("does not throw from expectFrontDoorConformance", () => {
    expect(() => expectFrontDoorConformance({ surfaces: conforming })).not.toThrow();
  });

  it("gives no findings for framed surfaces: AuthView and StatusView inside SiteFrame, and the framed GlobalErrorDocument", () => {
    const COPY: Readonly<Record<string, string>> = { brand: "Example home", skip: "Skip to content", entity: "Example Ltd", privacy: "Privacy" };
    const resolveCopy: CopyResolver = (copyRef) => {
      const text = COPY[copyRef.id];
      return text === undefined
        ? undefined
        : { ref: copyRef, text, recordId: copyRef.id, revision: "1", locale: "en-US", source: { kind: "consumer", reference: "fixture" }, entryId: copyRef.id };
    };
    const resolveAsset = (assetId: string): unknown =>
      assetId === "mark" ? { type: "image", src: "/mark.svg", width: 48, height: 48, alt: "Example mark" } : undefined;
    const shell: SiteShellInput = {
      brand: { assetId: "mark", label: { id: "brand" }, size: "md", variant: "mark" },
      skipLink: { id: "skip" },
      footer: { legal: { entity: { id: "entity" }, links: [{ href: "/privacy", label: { id: "privacy" } }] } },
    };
    const framed: FrontDoorSurfaceCase[] = [
      {
        surface: "sign-in",
        title,
        render: () => (
          <SiteFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}>
            <AuthView heading="Sign in" description="Welcome back." form={<Button type="submit">Sign in</Button>} />
          </SiteFrame>
        ),
      },
      {
        surface: "not-found",
        title: { page: "Page not found", brand: "Example Studio" },
        render: () => (
          <SiteFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}>
            <StatusView status="404" subtitle="That page does not exist." action={<Button>Go home</Button>} />
          </SiteFrame>
        ),
      },
      {
        surface: "global-error",
        render: () => (
          <GlobalErrorDocument
            lang="en"
            documentTitle={{ page: "Something went wrong", brand: "Example Studio" }}
            icon={{ href: "/icon.svg", type: "image/svg+xml" }}
            shell={shell}
            resolveCopy={resolveCopy}
            resolveAsset={resolveAsset}
            status="500"
            subtitle="Something went wrong. Error: 8f2a91c0."
            action={<Button>Try again</Button>}
          />
        ),
      },
    ];
    expect(checkFrontDoor({ surfaces: framed })).toEqual([]);
  });

  it("returns no findings for an empty surface list", () => {
    expect(checkFrontDoor({ surfaces: [] })).toEqual([]);
  });

  it("names the bg-accent token as the primary-action class", () => {
    expect(PRIMARY_ACTION_CLASS).toBe("bg-accent");
  });

  it("is carried by a primary Designer Button and not by ghost or secondary ones", () => {
    const classOf = (variant: "primary" | "secondary" | "ghost"): string[] => {
      const html = renderToStaticMarkup(<Button variant={variant}>Go</Button>);
      const button = new DOMParser().parseFromString(html, "text/html").querySelector("button");
      return [...(button?.classList ?? [])];
    };
    expect(classOf("primary")).toContain(PRIMARY_ACTION_CLASS);
    expect(classOf("secondary")).not.toContain(PRIMARY_ACTION_CLASS);
    expect(classOf("ghost")).not.toContain(PRIMARY_ACTION_CLASS);
  });
});

describe("each rule fires", () => {
  it("one-primary-action: two primary buttons in main", () => {
    const render = (): ReactElement => (
      <AuthView
        brand="Example Studio"
        heading="Sign in"
        form={
          <>
            <Button type="submit">Sign in</Button>
            <Button type="button">Create account</Button>
          </>
        }
      />
    );
    const findings = checkFrontDoor({ surfaces: [{ surface: "sign-in", render, title }] });
    expect(findings.map((f) => f.rule)).toEqual(["one-primary-action"]);
    expect(findings[0]?.surface).toBe("sign-in");
  });

  it("one-primary-action: no primary action in main", () => {
    const render = (): ReactElement => (
      <AuthView brand="Example Studio" heading="Sign in" form={<Button variant="secondary">Sign in</Button>} />
    );
    expect(rulesFor({ surface: "sign-in", render, title })).toEqual(["one-primary-action"]);
  });

  it("one-primary-action: counts links and role=button elements, not other elements", () => {
    const withLinkAndRole = (): ReactElement => (
      <main style={{ maxWidth: TOKEN_FORM_MEASURE }}>
        <h1>Sign in</h1>
        <a href="/x" className="bg-accent">
          Go
        </a>
        <div role="button" className="bg-accent">
          Also go
        </div>
      </main>
    );
    expect(rulesFor({ surface: "sign-in", render: withLinkAndRole, title })).toEqual(["one-primary-action"]);

    const decorative = (): ReactElement => (
      <main style={{ maxWidth: TOKEN_FORM_MEASURE }}>
        <h1>Sign in</h1>
        <a href="/x" className="bg-accent">
          Go
        </a>
        <span className="bg-accent" />
      </main>
    );
    expect(rulesFor({ surface: "sign-in", render: decorative, title })).toEqual([]);
  });

  it("one-primary-action: only matches the whole class token", () => {
    const render = (): ReactElement => (
      <main style={{ maxWidth: TOKEN_FORM_MEASURE }}>
        <h1>Sign in</h1>
        <button type="button" className="bg-accent-hover">
          Go
        </button>
      </main>
    );
    expect(rulesFor({ surface: "sign-in", render, title })).toEqual(["one-primary-action"]);
  });

  it("one-primary-action: looks in the body when there is no main, and ignores controls outside main", () => {
    const noMain = (): ReactElement => (
      <div>
        <h1>Oops</h1>
        <button type="button" className="bg-accent">
          Retry
        </button>
        <button type="button" className="bg-accent">
          Again
        </button>
      </div>
    );
    expect(rulesFor({ surface: "service-unavailable", render: noMain, title })).toEqual(["one-primary-action"]);

    const outsideMain = (): ReactElement => (
      <div>
        <header>
          <a href="/" className="bg-accent">
            Brand
          </a>
        </header>
        <main>
          <h1>Oops</h1>
          <button type="button" className="bg-accent">
            Retry
          </button>
        </main>
      </div>
    );
    expect(rulesFor({ surface: "boundary", render: outsideMain, title })).toEqual([]);
  });

  it("one-h1: zero and two headings", () => {
    const none = (): ReactElement => (
      <main style={{ maxWidth: TOKEN_FORM_MEASURE }}>
        <h2>Sign in</h2>
        <Button>Go</Button>
      </main>
    );
    const two = (): ReactElement => (
      <main style={{ maxWidth: TOKEN_FORM_MEASURE }}>
        <h1>Sign in</h1>
        <h1>Welcome</h1>
        <Button>Go</Button>
      </main>
    );
    expect(rulesFor({ surface: "sign-in", render: none, title })).toEqual(["one-h1"]);
    expect(rulesFor({ surface: "sign-in", render: two, title })).toEqual(["one-h1"]);
  });

  it("form-measure: a bare main on sign-in, activation and reset", () => {
    const bare = (): ReactElement => (
      <main>
        <h1>Sign in</h1>
        <Button>Go</Button>
      </main>
    );
    for (const surface of ["sign-in", "activation", "reset"] as const) {
      expect(rulesFor({ surface, render: bare, title })).toEqual(["form-measure"]);
    }
  });

  it("form-measure: a missing main, and a raw length instead of the token", () => {
    const noMain = (): ReactElement => (
      <div>
        <h1>Sign in</h1>
        <Button>Go</Button>
      </div>
    );
    expect(rulesFor({ surface: "sign-in", render: noMain, title })).toEqual(["form-measure"]);

    const raw = (): ReactElement => (
      <main style={{ maxWidth: "32rem" }}>
        <h1>Sign in</h1>
        <Button>Go</Button>
      </main>
    );
    expect(rulesFor({ surface: "sign-in", render: raw, title })).toEqual(["form-measure"]);
  });

  it("form-measure: not asked of the other surfaces", () => {
    const bare = (): ReactElement => (
      <main>
        <h1>Gone</h1>
        <Button>Go</Button>
      </main>
    );
    for (const surface of ["sign-out-landing", "boundary", "not-found", "service-unavailable"] as const) {
      expect(rulesFor({ surface, render: bare, title })).toEqual([]);
    }
  });

  it("page-title: a blank page or brand", () => {
    expect(rulesFor({ ...conforming[0]!, title: { page: "  ", brand: "Example Studio" } })).toEqual(["page-title"]);
    expect(rulesFor({ ...conforming[0]!, title: { page: "Sign in", brand: "" } })).toEqual(["page-title"]);
    const [finding] = checkFrontDoor({ surfaces: [{ ...conforming[0]!, title: { page: " Sign in", brand: "X" } }] });
    expect(finding?.message).toMatch(/page/);
  });

  it("page-title: an actual title that does not match", () => {
    expect(rulesFor({ ...conforming[0]!, title: { ...title, actual: "Sign in | Example Studio" } })).toEqual([
      "page-title",
    ]);
    expect(rulesFor({ ...conforming[0]!, title: { ...title, actual: "Sign in · Example Studio" } })).toEqual([]);
  });

  it("page-title: required except on global-error", () => {
    expect(rulesFor({ surface: "sign-in", render: signIn })).toEqual(["page-title"]);
    expect(rulesFor({ surface: "not-found", render: notFound })).toEqual(["page-title"]);
    expect(rulesFor({ surface: "global-error", render: globalError })).toEqual([]);
  });

  it("global-error-head: two titles", () => {
    const render = (): ReactElement => (
      <html lang="en">
        <head>
          <title>Something went wrong · Example Studio</title>
          <title>Again</title>
          <meta name="robots" content="noindex, nofollow" />
          <link rel="icon" href="/icon.svg" />
        </head>
        <body>
          <h1>500</h1>
          <Button>Try again</Button>
        </body>
      </html>
    );
    expect(rulesFor({ surface: "global-error", render })).toEqual(["global-error-head"]);
  });

  it("global-error-head: no noindex", () => {
    const render = (): ReactElement => (
      <html lang="en">
        <head>
          <title>Something went wrong · Example Studio</title>
          <meta name="robots" content="index, follow" />
          <link rel="icon" href="/icon.svg" />
        </head>
        <body>
          <h1>500</h1>
          <Button>Try again</Button>
        </body>
      </html>
    );
    expect(rulesFor({ surface: "global-error", render })).toEqual(["global-error-head"]);
  });

  it("global-error-head: no icon, or two", () => {
    const head = (icons: number): ReactElement => (
      <html lang="en">
        <head>
          <title>Something went wrong · Example Studio</title>
          <meta name="robots" content="noindex" />
          {Array.from({ length: icons }, (_, i) => (
            <link key={i} rel="icon" href={`/icon-${i}.svg`} />
          ))}
        </head>
        <body>
          <h1>500</h1>
          <Button>Try again</Button>
        </body>
      </html>
    );
    expect(rulesFor({ surface: "global-error", render: () => head(0) })).toEqual(["global-error-head"]);
    expect(rulesFor({ surface: "global-error", render: () => head(2) })).toEqual(["global-error-head"]);
  });

  it("global-error-head: a title that does not match the given title, or the <page> · <brand> shape", () => {
    const render = (): ReactElement => (
      <html lang="en">
        <head>
          <title>Something went wrong</title>
          <meta name="robots" content="noindex" />
          <link rel="icon" href="/icon.svg" />
        </head>
        <body>
          <h1>500</h1>
          <Button>Try again</Button>
        </body>
      </html>
    );
    expect(rulesFor({ surface: "global-error", render })).toEqual(["global-error-head"]);
    expect(
      rulesFor({
        surface: "global-error",
        render,
        title: { page: "Something went wrong", brand: "Example Studio" },
      }),
    ).toEqual(["global-error-head"]);
  });
});

describe("boundary", () => {
  it("never gives a boundary or not-found surface global-error-head", () => {
    // A <title> pair and no robots meta or icon would fail a global-error surface, but not these.
    const render = (): ReactElement => (
      <main>
        <title>One</title>
        <title>Two</title>
        <h1>404</h1>
        <Button>Go home</Button>
      </main>
    );
    for (const surface of ["boundary", "not-found", "service-unavailable"] as const) {
      const rules = rulesFor({ surface, render, title });
      expect(rules).not.toContain("global-error-head");
    }
  });

  it("expectFrontDoorConformance throws one Error listing every finding", () => {
    const render = (): ReactElement => (
      <main>
        <Button>One</Button>
        <Button>Two</Button>
      </main>
    );
    const surfaces: FrontDoorSurfaceCase[] = [
      { surface: "sign-in", render, title },
      { surface: "not-found", render },
    ];
    const findings = checkFrontDoor({ surfaces });
    expect(findings.length).toBeGreaterThanOrEqual(5);

    let thrown: unknown;
    try {
      expectFrontDoorConformance({ surfaces });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    for (const finding of findings as FrontDoorFinding[]) {
      expect(message).toContain(finding.surface);
      expect(message).toContain(finding.rule);
      expect(message).toContain(finding.message);
    }
  });

  it("throws a plain Error naming DOMParser when the caller has none", () => {
    vi.stubGlobal("DOMParser", undefined);
    let thrown: unknown;
    try {
      checkFrontDoor({ surfaces: conforming });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).constructor).toBe(Error);
    expect((thrown as Error).message).toMatch(/DOMParser/);
  });

  it("imports only react types, react-dom/server and the site metadata module", () => {
    const source = readFileSync(join(import.meta.dirname, "index.ts"), "utf8");
    const specifiers = moduleSpecifiers(source);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(ALLOWED_IMPORTS).toContain(specifier);
    }
    expect(specifiers).toContain("react-dom/server");
    expect(specifiers).toContain("../web/siteMetadata.js");
    for (const forbidden of ["vitest", "@testing-library", "@clossys/designer", "next"]) {
      expect(source).not.toMatch(new RegExp(`from\\s*["']${forbidden}`));
    }
  });
});
