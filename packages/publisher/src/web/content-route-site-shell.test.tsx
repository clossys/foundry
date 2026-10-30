/** @vitest-environment node */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { computeCopyFingerprint } from "@clossys/writer";
import { createContentRevision } from "../content/revisions.js";
import { ContentRoutePage, prepareContentRoute } from "./content-route.js";
import { contentRouteFixture, withApprovedRouteCopy } from "./__fixtures__/content-route.js";

function fixture() {
  const input = withApprovedRouteCopy(contentRouteFixture());
  const candidate = input.registry.candidates[0]!;
  const composition = { ...candidate.composition!, frame: { frameId: "frames.site-shell", configId: "default" } };
  const entries = [
    ["site.brand", "Example home"], ["site.skip", "Skip to content"], ["site.legal", "Example"],
  ].map(([id, text]) => ({ id: id!, text: text!, context: "Synthetic shell copy", status: "approved" as const,
    approval: { approvedBy: "owner", approvedAt: input.raisedAt, fingerprintAlgorithm: "sha256" as const, textFingerprint: computeCopyFingerprint(text!) } }));
  return { ...input,
    registry: { ...input.registry, candidates: [{ ...candidate, composition,
      history: candidate.history.map(row => createContentRevision({ ...row.content, composition }, row.revision, row.createdAt)) }] },
    libraries: [{ ...input.libraries[0]!, frames: [{ id: "frames.site-shell", configIds: ["default"] }], assetIds: ["assets.brand"] }],
    writer: { ...input.writer!, registry: { ...input.writer!.registry, entries: [...input.writer!.registry.entries, ...entries] } },
    siteFrame: { shell: { brand: { assetId: "assets.brand", label: { id: "site.brand" }, size: "md", variant: "mark" },
      skipLink: { id: "site.skip" }, footer: { legal: { entity: { id: "site.legal" }, links: [] } } } },
    resolveAsset: (id: string) => id === "assets.brand" ? { type: "image", src: "/mark.svg", width: 32, height: 32, alt: "Example mark" } : undefined,
  };
}

describe("registered content SiteFrame", () => {
  it("prepares and renders the native registered shell with approved Writer copy and registered assets", () => {
    const input = fixture(), before = JSON.stringify(input);
    const prepared = prepareContentRoute(input);
    expect(prepared.needs).toEqual([]);
    expect(prepared.status).toBe("ready");
    const html = renderToStaticMarkup(<ContentRoutePage input={input} />);
    expect(html).toContain('data-ds-leaf="frames.site-shell"');
    expect(html).toContain("Skip to content");
    expect(html).toContain("Example home");
    expect(html).toContain("Sign in to continue");
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toContain('href="#publisher-main-content"');
    expect(JSON.stringify(input)).toBe(before);
    expect(prepared.provenance?.copy.some(row => row.binding === "siteFrame")).toBe(true);
  });

  it.each(["bindings", "writer", "unapproved", "fingerprint", "locale", "fallback", "asset", "registration", "config", "layout"])("refuses missing or invalid %s without rendering", problem => {
    const input: any = fixture();
    if (problem === "bindings") delete input.siteFrame;
    if (problem === "writer") delete input.writer;
    if (problem === "unapproved") input.writer.registry.entries.find((row: any) => row.id === "site.brand").status = "draft";
    if (problem === "fingerprint") input.writer.registry.entries.find((row: any) => row.id === "site.brand").text += " changed";
    if (problem === "locale") input.siteFrame.shell.skipLink.locale = "fr";
    if (problem === "fallback") {
      const source = input.writer.registry;
      input.writer.registries = [{ ...structuredClone(source), id: "site-fr", locale: "fr" }];
      source.entries = source.entries.filter((row: any) => row.id !== "site.brand");
      input.writer.manifest = { defaultLocale: "en", locales: [{ tag: "en", dir: "ltr", state: "active" }, { tag: "fr", dir: "ltr", state: "active" }], fallback: { en: ["fr"] } };
    }
    if (problem === "asset") input.resolveAsset = () => undefined;
    if (problem === "registration") input.libraries[0].assetIds = [];
    if (problem === "config") input.libraries[0].frames[0].configIds = [];
    if (problem === "layout") input.siteFrame.shell.children = "Unowned layout";
    const prepared = prepareContentRoute(input);
    expect(prepared.status).toBe("needs-input");
    expect(prepared.needs.length).toBeGreaterThan(0);
    expect(prepared.node).toBeUndefined();
    expect(() => renderToStaticMarkup(<ContentRoutePage input={input} />)).toThrow();
  });
});
