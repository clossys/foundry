// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { BRAND_ASSET_ROLES, requiredBrandAssetSize, type BrandAssetEntry } from "../../../media/brand-assets.js";
import { BrandAssetsPack } from "./BrandAssetsPack.js";

afterEach(cleanup);
const item = { id: "assets.brand", label: "Brand mark", assetId: "fixture.brand" };
const complete: BrandAssetEntry[] = BRAND_ASSET_ROLES.map(role => ({ role, src: role === "favicon-svg" ? "<svg></svg>" : "https://example.test/asset.png", alt: "Fixture mark", ...(role === "favicon-svg" ? { width: 0, height: 0 } : requiredBrandAssetSize(role)) }));

it("keeps absent references unresolved even when another consumer roster exists", () => {
  render(<BrandAssetsPack items={[item, { id: "assets.share", label: "Share image" }]} assets={{ "fixture.other": complete }} />);
  expect(screen.getByText("Unresolved asset reference: fixture.brand")).toBeVisible();
  expect(screen.getByText("Choose a consumer asset reference.")).toBeVisible();
  expect(screen.queryByText("Roster metadata complete")).toBeNull();
});

it("binds only the selected host roster and recomputes invalid and incomplete metadata", () => {
  const { rerender } = render(<BrandAssetsPack items={[item]} assets={{ "fixture.brand": complete }} />);
  expect(screen.getByText("Roster metadata complete")).toBeVisible();
  expect(screen.getByText(/File existence and rendered output are unverified/)).toBeVisible();
  expect(document.querySelector("img, iframe, svg, a")).toBeNull();
  rerender(<BrandAssetsPack items={[item]} assets={{ "fixture.brand": [{ ...complete[1]!, width: 16, alt: "" }] }} />);
  expect(screen.getByText("Roster metadata needs input")).toBeVisible();
  expect(screen.getByText("favicon-32 must be 32×32, got 16×32")).toBeVisible();
  expect(screen.getByText("favicon-32 requires alt text")).toBeVisible();
  expect(screen.getByText('missing required role "open-graph"')).toBeVisible();
  expect(screen.queryByText("Roster metadata complete")).toBeNull();
});

it("treats a bound empty roster as incomplete rather than unresolved or ready", () => {
  render(<BrandAssetsPack items={[item]} assets={{ "fixture.brand": [] }} />);
  expect(screen.getByText("Roster metadata needs input")).toBeVisible();
  expect(screen.queryByText(/Unresolved asset reference/)).toBeNull();
  expect(screen.queryByText(/Ready|Export: passed|Deploy: healthy/)).toBeNull();
});

it("accepts host messages for visible and accessible roster text", () => {
  render(<BrandAssetsPack items={[item]} assets={{ "fixture.brand": complete }} sectionLabel="Host assets" completeLabel="Host metadata" evidenceDescription="Host evidence limits" referenceLabel={id => "Host reference " + id} entriesLabel={label => "Host entries " + label} requiredSizeLabel={(width, height) => "Host size " + width + "/" + height} />);
  expect(screen.getByRole("region", { name: "Host assets" })).toBeVisible();
  expect(screen.getByText("Host metadata")).toBeVisible();
  expect(screen.getByText("Host reference fixture.brand")).toBeVisible();
  expect(screen.getByRole("list", { name: "Host entries Brand mark" })).toHaveTextContent("Host size 32/32");
  expect(screen.getByText("Host evidence limits")).toBeVisible();
  expect(screen.queryByText("Roster metadata complete")).toBeNull();
});
