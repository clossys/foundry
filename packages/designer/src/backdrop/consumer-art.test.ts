import { describe, expect, it } from "vitest";
import { checkConsumerArtContract, type ConsumerArtContract } from "./consumer-art.js";

const photo: ConsumerArtContract = {
  slot: "media", purpose: "meaningful", alt: "A tree beside a walking path",
  width: 1600, height: 900, aspect: "16:9", fit: "contain",
  loading: "lazy", bytes: 100000, backgroundToken: "--color-surface-base",
  source: { format: "webp", src: "/art/photo.webp" },
};
const vector: ConsumerArtContract = {
  ...photo, source: { format: "svg", paths: [{ d: "M0 0H1600V900H0Z", fillToken: "--color-accent" }] },
};
const ok = (input: unknown) => checkConsumerArtContract(input).ok;

describe("consumer art contract", () => {
  it("accepts static photos and token-painted vector art", () => {
    expect(ok(photo)).toBe(true);
    expect(ok(vector)).toBe(true);
    for (const format of ["avif", "webp", "png", "jpeg"]) expect(ok({ ...photo, source: { format, src: `/art/photo.${format}` } })).toBe(true);
    for (const [aspect, width, height] of [["1:1", 800, 800], ["4:3", 1200, 900], ["3:2", 1200, 800], ["16:9", 1600, 900]]) expect(ok({ ...photo, aspect, width, height })).toBe(true);
  });
  it("requires meaningful alt and keeps hero backdrops decorative", () => {
    expect(ok({ ...photo, alt: " " })).toBe(false);
    expect(ok({ ...photo, slot: "backdrop" })).toBe(false);
    for (const loading of ["lazy", "eager"]) {
      expect(ok({ ...photo, slot: "backdrop", purpose: "decorative", alt: "", fit: "cover", loading })).toBe(true);
    }
    expect(ok({ ...photo, purpose: "decorative", alt: photo.alt })).toBe(false);
  });
  it("refuses a section backdrop before Clossys provides its seam", () => {
    const report = checkConsumerArtContract({ ...photo, slot: "section-backdrop", purpose: "decorative", alt: "", fit: "cover" });
    expect(report.ok).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({ path: "art.slot" }));
  });
  it("accepts registered strokes with an implicit width or a positive width up to 64", () => {
    for (const stroke of [{ strokeToken: "--color-accent" }, { strokeToken: "--color-accent", strokeWidth: 0.25 }, { strokeToken: "--color-accent", strokeWidth: 64 }]) {
      expect(ok({ ...vector, source: { format: "svg", paths: [{ d: "M0 0L10 10", fillToken: "--color-accent", ...stroke }] } })).toBe(true);
    }
  });
  it.each([
    { strokeWidth: 1 }, { strokeToken: "#fff" }, { strokeToken: "--color-imaginary" },
    { strokeToken: "--spacing-md" },
    ...[0, -1, 64.01, Infinity, NaN, "1", null].map(strokeWidth => ({ strokeToken: "--color-accent", strokeWidth })),
  ])("refuses invalid stroke declarations: %j", stroke => {
    expect(ok({ ...vector, source: { format: "svg", paths: [{ d: "M0 0L10 10", fillToken: "--color-accent", ...stroke }] } })).toBe(false);
  });
  it("requires inline SVG declared bytes to cover the path data", () => {
    const d = "M0 0H1600V900H0Z";
    const paths = [{ d, fillToken: "--color-accent" }, { d, fillToken: "--color-accent" }];
    expect(ok({ ...vector, bytes: d.length * 2, source: { format: "svg", paths } })).toBe(true);
    const report = checkConsumerArtContract({ ...vector, bytes: d.length * 2 - 1, source: { format: "svg", paths } });
    expect(report.ok).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({ path: "art.bytes" }));
    expect(ok({ ...vector, bytes: 1, source: { format: "svg", paths: [{ d: "M0 0L10 10 L20 20", fillToken: "--color-accent" }] } })).toBe(false);
  });
  it("accepts only SVG path whitespace: space, tab, CR, LF and FF", () => {
    for (const space of [" ", "\t", "\r", "\n", "\f"]) {
      expect(ok({ ...vector, source: { format: "svg", paths: [{ d: `M0${space}0${space}L10${space}10`, fillToken: "--color-accent" }] } })).toBe(true);
    }
  });
  it.each([["U+00A0", "\u00a0"], ["U+3000", "\u3000"], ["U+2028", "\u2028"], ["U+FEFF", "\ufeff"], ["VT", "\v"]])("refuses non-SVG whitespace %s in path data", (_name, space) => {
    const report = checkConsumerArtContract({ ...vector, source: { format: "svg", paths: [{ d: `M0${space}0L10${space}10`, fillToken: "--color-accent" }] } });
    expect(report.ok).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({ path: "art.source.paths.0.d" }));
  });
  it("requires exact string enum values, not coerced ones", () => {
    let evaluated = false;
    const sneaky = { toString: () => { evaluated = true; return "media"; } };
    for (const slot of [["media"], ["backdrop"], sneaky]) expect(ok({ ...photo, slot })).toBe(false);
    for (const format of [["webp"], ["png"], sneaky]) expect(ok({ ...photo, source: { format, src: "/art/photo.webp" } })).toBe(false);
    expect(evaluated).toBe(false);
  });
  it("accepts credential-free HTTPS but rejects HTTP", () => {
    expect(ok({ ...photo, source: { format: "webp", src: "https://example.com/photo.webp" } })).toBe(true);
    const report = checkConsumerArtContract({ ...photo, source: { format: "webp", src: "http://example.com/photo.webp" } });
    expect(report.ok).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({ path: "art.source.src" }));
  });
  it.each(["username", "password", "both"])("refuses HTTPS with %s credentials", kind => {
    const url = new URL("https://example.com/photo.webp");
    if (kind !== "password") url.username = "art";
    if (kind !== "username") url.password = "placeholder";
    const report = checkConsumerArtContract({ ...photo, source: { format: "webp", src: url.href } });
    expect(report.ok).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({ path: "art.source.src" }));
  });
  it.each([
    { width: 0 }, { height: -1 }, { width: 1.5 }, { width: Infinity },
    { width: 9000 }, { height: 1000 }, { aspect: "auto" }, { fit: "stretch" },
    { bytes: 0 }, { bytes: 2097153 }, { bytes: NaN }, { loading: "idle" },
    { backgroundToken: "#fff" }, { backgroundToken: "--color-imaginary" },
    { backgroundToken: "--spacing-md" }, { className: "custom" }, { owner: "foundry" },
    { source: { format: "gif", src: "/art/animated.gif" } },
    { source: { format: "webp", src: "javascript:void(0)" } },
    { source: { format: "webp", src: "//example.com/photo.webp" } },
    { source: { format: "webp", src: "data:image/webp;base64,AAAA" } },
    { source: { format: "webp", src: "/art/photo.webp", colors: ["#fff"] } },
    { source: { format: "svg", src: "/art/external.svg" } },
    { source: { format: "svg", paths: [] } },
    { source: { format: "svg", paths: [{ d: "M0 0", fillToken: "#fff" }] } },
    { source: { format: "svg", paths: [{ d: "M0 0", fillToken: "--color-accent", onClick: "handler" }] } },
    { source: { format: "svg", paths: [{ d: "<script>", fillToken: "--color-accent" }] } },
  ])("rejects invalid or unsupported declarations: %j", patch => expect(ok({ ...photo, ...patch })).toBe(false));
  it("rejects malformed data without evaluating accessors", () => {
    for (const input of [null, [], true, {}, Object.create(photo)]) expect(ok(input)).toBe(false);
    const getter = { ...photo };
    Object.defineProperty(getter, "width", { get: () => { throw new Error("accessor evaluated"); } });
    expect(ok(getter)).toBe(false);
    const paths = new Array(1);
    expect(ok({ ...vector, source: { format: "svg", paths } })).toBe(false);
  });
});
