// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsumerArtSlot } from "./ConsumerArtSlot.js";
import type { ConsumerArtContract } from "@clossys/designer/tokens";
const art: ConsumerArtContract = {
  slot: "media", purpose: "meaningful", alt: "A tree beside a walking path",
  width: 1600, height: 900, aspect: "16:9", fit: "contain", loading: "lazy",
  bytes: 100000, backgroundToken: "--color-surface-base", source: { format: "webp", src: "/art/photo.webp" },
};
function root(contract: ConsumerArtContract) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<ConsumerArtSlot contract={contract} />);
  return host.firstElementChild!;
}
describe("Publisher checked consumer art slot", () => {
  it("renders media alt, intrinsic dimensions, asynchronous decoding and lazy loading", () => {
    const el = root(art);
    const image = el.querySelector("img")!;
    expect(image.getAttribute("alt")).toBe(art.alt);
    expect(image.getAttribute("width")).toBe("1600");
    expect(image.getAttribute("height")).toBe("900");
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.getAttribute("decoding")).toBe("async");
    expect((el as HTMLElement).style.aspectRatio).toBe("1600 / 900");
  });
  it("makes both backdrop positions decorative and noninteractive", () => {
    for (const slot of ["backdrop", "section-backdrop"] as const) {
      const el = root({ ...art, slot, purpose: "decorative", alt: "", fit: "cover" });
      expect(el.getAttribute("aria-hidden")).toBe("true");
      expect((el as HTMLElement).style.pointerEvents).toBe("none");
      expect(el.querySelector("img")!.getAttribute("alt")).toBe("");
      expect(el.querySelector("[tabindex],a,button")).toBeNull();
    }
  });
  it("renders inline SVG with live tokens and a meaningful accessible name", () => {
    const accentToken = "--color-accent";
    const el = root({ ...art, source: { format: "svg", paths: [{ d: "M0 0H1600V900H0Z", fillToken: accentToken }] } });
    const svg = el.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe(art.alt);
    expect(svg.getAttribute("viewBox")).toBe("0 0 1600 900");
    expect(svg.querySelector("path")!.getAttribute("fill")).toBe(`var(${accentToken})`);
  });
  it("refuses invalid art before producing markup", () => {
    expect(() => root({ ...art, backgroundToken: "#fff" })).toThrow(/backgroundToken/);
    expect(() => root({ ...art, slot: "backdrop" } as ConsumerArtContract)).toThrow(/purpose/);
  });
});
