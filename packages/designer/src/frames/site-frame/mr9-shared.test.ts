import { describe, expect, it } from "vitest";
import { resolveShell } from "./internal/resolveShell.js";
import type { SiteShellInput } from "./types.js";
import type { CopyResolver } from "./copy-contract.js";

const resolveCopy: CopyResolver = ref => ({ ref, text: ref.id, recordId: "generic-shell-fixture", revision: "1", entryId: ref.id, locale: "en", source: { kind: "consumer", reference: "generic-fixture" } });
const image = { kind: "illustration" as const, src: "/profile-mark.svg", width: 24, height: 24, decorative: true };
const shell: SiteShellInput = { brand: { assetId: "brand", label: { id: "Brand" }, variant: "mark", size: "sm" }, skipLink: { id: "Skip" }, footer: { brandBand: true, columns: [{ heading: { id: "Company" }, links: [{ href: "/about", label: { id: "About" } }] }], social: { label: { id: "Connect" }, links: [{ href: "https://example.com/profile", label: { id: "Profile" }, assetId: "profile" }] }, legal: { entity: { id: "Example" }, links: [] } } };
const asset = (id: string) => id === "brand" ? { type: "image", src: "/brand.svg", width: 24, height: 24, alt: "Brand" } : image;

describe("MR9 shared shell transport", () => {
  it("resolves actual assets.image resources while retaining group headings and legal strip data", () => {
    const resolved = resolveShell(shell, resolveCopy, asset);
    expect(resolved.footer!.social!.links[0]).toEqual({ href: "https://example.com/profile", label: "Profile", image });
    expect(resolved.footer!.columns[0]).toEqual({ heading: "Company", links: [{ href: "/about", label: "About" }] });
    expect(resolved.footer!.legal.entity).toBe("Example");
  });
  it("refuses missing, invalid and unsafe consumer marks", () => {
    for (const value of [undefined, { ...image, width: 0 }, { ...image, src: "javascript:alert(1)" }, { ...image, src: "//example.com/mark.svg" }]) {
      expect(() => resolveShell(shell, resolveCopy, id => id === "brand" ? asset(id) : value)).toThrow(/image asset/);
    }
  });
  it("refuses ambiguous glyph plus asset identity", () => {
    const invalid = structuredClone(shell);
    Object.assign(invalid.footer!.social!.links[0]!, { icon: [["path", { d: "M0 0" }]] });
    expect(() => resolveShell(invalid, resolveCopy, asset)).toThrow(/one image identity or icon/);
  });
});
