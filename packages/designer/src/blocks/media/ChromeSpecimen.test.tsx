import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MediaFigure } from "../MediaFigure.js";
import type { ImageResource } from "../../catalog-assets/media.js";

afterEach(cleanup);
const image: ImageResource = {
  kind: "illustration", src: "/specimen.webp", width: 1440, height: 900, alt: "Project workspace",
  sources: [{ media: "(min-width: 40rem)", src: "/specimen-large.webp", width: 2880, height: 1800 }],
  sizes: "100vw", focal: { x: .25, y: .75 }, placeholder: { kind: "color", value: "#eeeeee" },
};

describe("MediaFigure specimen chrome", () => {
  it.each(["browser", "device", "bare"] as const)("keeps the intrinsic image box and responsive metadata inside %s chrome", chrome => {
    const { container } = render(<MediaFigure image={image} chrome={chrome} />);
    const frame = container.querySelector(`[data-screenshot-chrome="${chrome}"]`)!;
    expect(frame).toBeTruthy();
    const picture = frame.querySelector("picture")!;
    const box = picture.parentElement!;
    expect(box.style.aspectRatio).toBe("1440 / 900");
    expect(box.style.height).toBe("");
    expect(box.style.maxHeight).toBe("");
    expect(picture.querySelector("source")).toHaveAttribute("srcset", "/specimen-large.webp 2880w");
    expect(picture.querySelector("source")).toHaveAttribute("sizes", "100vw");
    expect(screen.getByRole("img", { name: image.alt })).toHaveAttribute("width", "1440");
    expect(screen.getByRole("img", { name: image.alt })).toHaveAttribute("height", "900");
    expect(screen.getByRole("img", { name: image.alt })).toHaveStyle({ objectPosition: "25% 75%" });
    for (const node of [frame, ...frame.querySelectorAll<HTMLElement>("div")]) {
      expect(node.style.height).toBe("");
      expect(node.className).not.toMatch(/(?:^|\s)(?:h-|max-h-|aspect-|animate-|transition)/);
    }
    expect(container.querySelectorAll("button,input,a,[tabindex]")).toHaveLength(0);
  });

  it("keeps the selected canonical crop inside the chrome, outside its title bar", () => {
    const { container } = render(<MediaFigure image={image} chrome="browser" ratio="cinema" chromeLabel="Writer browser title" />);
    expect(container.querySelector("picture")!.parentElement!.style.aspectRatio).toBe("21 / 9");
    expect(container.querySelector('[data-screenshot-chrome="browser"]')!.getAttribute("style")).toBeNull();
    expect(screen.getByText("Writer browser title")).toBeVisible();
  });

  it("draws device details from semantic tokens, without extra media or copy", () => {
    const { container } = render(<MediaFigure image={image} chrome="device" ground="inverse" />);
    const frame = container.querySelector('[data-screenshot-chrome="device"]')!;
    expect(frame).toHaveClass("border-line-on-inverse", "bg-surface-inverse-raised", "rounded-control");
    const detail = frame.querySelector('[data-device-detail]')!;
    expect(detail).toHaveAttribute("aria-hidden", "true");
    expect(detail).toHaveClass("bg-line-on-inverse");
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelectorAll("svg,canvas,video,iframe")).toHaveLength(0);
    expect(container.textContent).toBe("");
  });

  it("leaves bare media unadorned and uses no default copy", () => {
    const { container } = render(<MediaFigure><span>Caller media</span></MediaFigure>);
    const frame = container.querySelector('[data-screenshot-chrome="bare"]')!;
    expect(frame).toBeTruthy();
    expect(frame).toBe(container.querySelector("[data-media-figure]")!.firstElementChild);
    expect(frame.className).toBe("w-full");
    expect(frame.className).not.toMatch(/border|rounded|bg-/);
    expect(container.querySelector('[data-screenshot-chrome-bar],[data-device-detail]')).toBeNull();
    expect(container.textContent).toBe("Caller media");
  });

  it("keeps the framed bare resource box as the figure's first child", () => {
    const { container } = render(<MediaFigure image={image} chrome="bare" framed ground="sunken" />);
    const frame = container.querySelector("[data-media-figure]")!.firstElementChild as HTMLElement;
    expect(frame).toHaveAttribute("data-screenshot-chrome", "bare");
    expect(frame).toHaveClass("rounded-control", "border", "border-line-base");
    expect(frame.style.aspectRatio).toBe("1440 / 900");
    expect(frame.querySelector("picture")!.parentElement).toBe(frame);
  });

  it("keeps callouts as one named list beside the media and caption", () => {
    const { container } = render(<MediaFigure image={image} chrome="browser" caption="Writer caption"
      callouts={{ label: "Workspace highlights", items: [{ id: "one", body: <span>Review queue</span> }, { id: "two", body: "Project history" }] }} />);
    const list = screen.getByRole("list", { name: "Workspace highlights" });
    expect(within(list).getAllByRole("listitem").map(row => row.textContent)).toEqual(["Review queue", "Project history"]);
    expect(list.closest("figure")).toBe(container.querySelector("[data-media-figure]"));
    expect(list.closest("[data-screenshot-chrome]")).toBeNull();
    expect(container.querySelector("figcaption")).toHaveTextContent("Writer caption");
    expect(container.querySelector("[data-media-figure]")!.lastElementChild?.tagName).toBe("FIGCAPTION");
  });

  it("preserves caller media nodes and decorative alternatives across every chrome", () => {
    const { container } = render(<MediaFigure chrome="device"><img src="/child.png" width={900} height={1600} alt="" /></MediaFigure>);
    expect(container.querySelector("img")).toHaveAttribute("width", "900");
    expect(container.querySelector("img")).toHaveAttribute("height", "1600");
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("refuses unsupported chrome instead of falling back", () => {
    expect(() => render(<MediaFigure image={image} chrome={"invented" as "bare"} />)).toThrow(/chrome/);
  });
});
