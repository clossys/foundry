import { describe, expect, it } from "vitest";
import { heroSpecimenInput, HERO_SPECIMEN_COPY } from "../../studio/hero-specimen.js";
import { runtimeHash, type RuntimeJson } from "../../catalog-core/runtime-ports.js";
import { heroCopyOf } from "./hero-copy.js";
import { renderHeroSection } from "./hero.js";

function contentWith(slot: string, value: RuntimeJson) {
  const input = heroSpecimenInput();
  return { ...input, content: { ...input.content, [slot]: { ...input.content[slot]!, value, hash: runtimeHash(value) } } };
}
describe("Hero runtime content and Writer host contract", () => {
  it("uses the declared resolved Writer host port and refuses an absent or blank heading", () => {
    const input = heroSpecimenInput();
    expect(heroCopyOf(input)).toEqual(HERO_SPECIMEN_COPY);
    expect(() => renderHeroSection({ ...input, sectionHost: undefined })).toThrow(/heroCopy host port is required/);
    expect(() => renderHeroSection({ ...input, sectionHost: { heroCopy: { "header.heading": " " } } })).toThrow(/resolved nonempty Writer copy/);
  });
  it("refuses unmapped members, conflicting members and unbound required content", () => {
    expect(() => renderHeroSection(heroSpecimenInput(["layout.unknown"]))).toThrow(/not mapped/);
    expect(() => renderHeroSection(heroSpecimenInput(["layout.editorial", "layout.split"]))).toThrow(/more than one layout/);
    const input = heroSpecimenInput();
    const { header: omitted, ...content } = input.content;
    expect(omitted).toBeDefined();
    expect(() => renderHeroSection({ ...input, content })).toThrow(/required content slot header/);
  });
  it("refuses incomplete action copy and action records instead of falling back to content labels", () => {
    const input = heroSpecimenInput();
    const { "actions.primary.label": omitted, ...heroCopy } = HERO_SPECIMEN_COPY;
    expect(omitted).toBeDefined();
    expect(() => renderHeroSection({ ...input, sectionHost: { heroCopy } })).toThrow(/heroCopy.actions.primary.label/);
    expect(() => renderHeroSection(contentWith("actions", { primary: { label: "Unresolved label" } }))).toThrow(/actions.primary.href/);
    expect(() => renderHeroSection(contentWith("actions", { primary: { href: "#start", variant: "primary" } }))).toThrow(/native LinkButton variant/);
    expect(() => renderHeroSection(contentWith("actions", { primary: { href: "#start" }, third: { href: "#extra" } }))).toThrow(/actions.third/);
  });
  it("requires media copy and rejects malformed art and unknown media kinds", () => {
    const input = heroSpecimenInput();
    const { "media.title": omitted, ...heroCopy } = HERO_SPECIMEN_COPY;
    expect(omitted).toBeDefined();
    expect(() => renderHeroSection({ ...input, sectionHost: { heroCopy } })).toThrow(/heroCopy.media.title/);
    expect(() => renderHeroSection(contentWith("backdrop", { source: { format: "gif" } }))).toThrow(/checked static art/);
    expect(() => renderHeroSection(contentWith("media", { kind: "unknown" }))).toThrow(/no registered media component/);
  });
});
