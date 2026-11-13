import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ImageResource } from "../catalog-assets/media.js";
import { Globe } from "../icons/Globe.js";
import { SiteFooter } from "./SiteFooter.js";
import { UI_BRANDMARK_HEIGHT_SM } from "./internal/shell-vars.js";

const image: ImageResource = { kind: "illustration", src: "/placeholder-profile.svg", width: 48, height: 32, alt: "Placeholder artwork" };
const imageLink = { href: "https://example.org/profile", label: "Public profile", image };
const fixture = () => <SiteFooter columns={<SiteFooter.Column heading="Connect"><SiteFooter.SocialLink {...imageLink} /><SiteFooter.SocialLink href="/community" label="Community" icon={Globe} /></SiteFooter.Column>} secondary={<SiteFooter.Legal entity="Example" links={[]} />} />;

describe("MR-9 consumer image footer marks", () => {
  it("renders supplied artwork through a native named external link with decorative art", () => {
    render(fixture());
    const heading = screen.getByRole("heading", { name: "Connect", level: 2 });
    expect(heading.closest("a")).toBeNull();
    const link = screen.getByRole("link", { name: "Public profile" });
    expect(link).toHaveAttribute("href", imageLink.href);
    expect(link.getAttribute("rel")?.split(/\s+/)).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
    expect(link).toHaveTextContent(imageLink.label);
    expect(link.querySelector("img")).toHaveAttribute("src", image.src);
    expect(link.querySelector("img")).toHaveAttribute("alt", "");
    expect(link.querySelector("img")?.closest('[aria-hidden="true"]')).not.toBeNull();
    const plate = link.querySelector("img")!.parentElement!;
    expect(plate.style.width).toBe(UI_BRANDMARK_HEIGHT_SM);
    expect(plate.style.height).toBe(UI_BRANDMARK_HEIGHT_SM);
    expect(link.querySelector("img")!.style.objectFit).toBe("contain");
    expect(link.querySelector("svg")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("retains existing IconNode marks and native keyboard order", async () => {
    const user = userEvent.setup();
    render(fixture());
    const glyph = screen.getByRole("link", { name: "Community" });
    expect(glyph.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(glyph.querySelector("img")).toBeNull();
    for (const name of ["Public profile", "Community"]) {
      await user.tab();
      expect(screen.getByRole("link", { name })).toHaveFocus();
    }
  });

  it("keeps image and glyph markup stable across SSR and hydration", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(fixture());
    document.body.append(host);
    const before = host.querySelector("footer")!.innerHTML;
    const errors: unknown[] = [];
    let root: Root | undefined;
    try {
      await act(async () => { root = hydrateRoot(host, fixture(), { onRecoverableError: error => errors.push(error) }); });
      expect(errors).toEqual([]);
      expect(host.querySelector("footer")!.innerHTML).toBe(before);
    } finally {
      await act(async () => root?.unmount());
      host.remove();
    }
  });

  it("refuses ambiguous, missing, malformed and unsafe image marks", () => {
    for (const props of [
      { ...imageLink, icon: Globe },
      { href: "/profile", label: "Profile" },
      ...[0, -1, NaN, Infinity].flatMap(size => [
        { ...imageLink, image: { ...image, width: size } },
        { ...imageLink, image: { ...image, height: size } },
      ]),
      { ...imageLink, image: { ...image, src: "javascript:invalid" } },
      { ...imageLink, image: { ...image, src: "//example.org/mark.svg" } },
      { ...imageLink, image: { ...image, src: "https:\\example.org/mark.svg" } },
      { ...imageLink, image: { ...image, kind: "unknown" } },
      { ...imageLink, image: { ...image, alt: undefined, decorative: false } },
      { ...imageLink, label: " " },
      { href: "/profile", label: "Profile", icon: <span>Arbitrary body</span> },
    ]) {
      expect(() => renderToString(<SiteFooter.SocialLink {...props as typeof imageLink} />)).toThrow(TypeError);
    }
  });

  it("accepts decorative catalog records without inventing alternative text", () => {
    render(<SiteFooter.SocialLink {...imageLink} image={{ ...image, alt: undefined, decorative: true }} />);
    expect(screen.getByRole("link", { name: imageLink.label }).querySelector("img")).toHaveAttribute("alt", "");
  });

  it("keeps the profile body closed when untyped input supplies HTML props", () => {
    const props = { ...imageLink, children: <span>Unbound body</span>, dangerouslySetInnerHTML: { __html: "Unbound HTML" } };
    render(<SiteFooter.SocialLink {...props} />);
    expect(screen.getByRole("link", { name: imageLink.label })).toHaveTextContent(imageLink.label);
    expect(screen.queryByText("Unbound body")).toBeNull();
    expect(screen.queryByText("Unbound HTML")).toBeNull();
  });
});
