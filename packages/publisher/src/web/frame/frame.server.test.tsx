// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CopyRef, CopyResolver } from "@clossys/writer";
import { AuthView } from "../views/AuthView.js";
import * as webIndex from "../index.js";
import * as webServer from "../server.js";
import * as frameIndex from "./index.js";
import { SITE_MAIN_ID, SiteFrame, siteShellFor } from "./index.js";
import type { SiteFrameConfig } from "./index.js";

const COPY: Readonly<Record<string, string>> = {
  "brand.label": "Example home",
  "skip": "Skip to content",
  "env.app": "App",
  "legal.entity": "Example Ltd",
  "legal.privacy": "Privacy",
};

const ref = (id: string): CopyRef => ({ id });

const resolveCopy: CopyResolver = (copyRef) => {
  const text = COPY[copyRef.id];
  return text === undefined
    ? undefined
    : {
        ref: copyRef,
        text,
        recordId: `record-${copyRef.id}`,
        revision: "1",
        locale: "en-US",
        source: { kind: "consumer", reference: "fixture" },
        entryId: copyRef.id,
      };
};

const resolveAsset = (assetId: string): unknown =>
  assetId === "brand-mark" ? { type: "image", src: "/brand/mark.svg", width: 48, height: 48, alt: "Example mark" } : undefined;

const CONFIG: SiteFrameConfig = {
  brand: { assetId: "brand-mark", label: ref("brand.label"), size: "md", variant: "mark" },
  skipLink: ref("skip"),
  origin: "https://example.com",
  site: {},
  environments: [{ surface: "front-door", href: "https://app.example.com/", label: ref("env.app"), icon: [["path", { d: "M3 12h18" }]] }],
  legal: { entity: ref("legal.entity"), links: [{ href: "/privacy", label: ref("legal.privacy") }] },
};

describe("SiteFrame on the server", () => {
  it("runs where no browser globals exist", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  it("renders the skip link, banner, one main with the fixed id and contentinfo around a chrome-free view", () => {
    const html = renderToStaticMarkup(
      <SiteFrame shell={siteShellFor(CONFIG, "front-door")} resolveCopy={resolveCopy} resolveAsset={resolveAsset}>
        <AuthView heading="Sign in" description="Welcome back." form={<p>form</p>} />
      </SiteFrame>,
    );
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toContain(`<main id="${SITE_MAIN_ID}" tabindex="-1"`);
    expect(html).toContain(`href="#${SITE_MAIN_ID}"`);
    expect(html.indexOf("<header")).toBeLessThan(html.indexOf("<main"));
    expect(html.lastIndexOf("<footer")).toBeGreaterThan(html.indexOf("</main>"));
    expect(html).toContain("https://example.com/privacy");
  });
});

describe("frame exports", () => {
  const frameNames = Object.keys(frameIndex).sort();

  it("the web entry and the server entry export every frame value, and the same ones", () => {
    expect(frameNames).toEqual(["SITE_MAIN_ID", "SITE_PAGE_LAYERS", "SITE_SURFACE_KINDS", "SiteFrame", "siteShellFor"]);
    for (const name of frameNames) {
      expect(webIndex).toHaveProperty(name);
      expect(webServer).toHaveProperty(name);
      expect((webServer as Record<string, unknown>)[name]).toBe((webIndex as Record<string, unknown>)[name]);
      expect((webIndex as Record<string, unknown>)[name]).toBe((frameIndex as Record<string, unknown>)[name]);
    }
  });
});
