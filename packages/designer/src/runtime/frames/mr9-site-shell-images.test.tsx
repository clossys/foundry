// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import type { RuntimeJson, RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { SiteFrame } from "../../frames/site-frame/SiteFrame.js";
import { resolveShell } from "../../frames/site-frame/internal/resolveShell.js";
import { siteShellProps } from "./site-shell.js";

const image = { kind: "illustration", src: "/consumer-profile.svg", width: 24, height: 24, decorative: true };
const icon = [["path", { d: "M0 0h24" }]];
function props(links: RuntimeJson = [{ label: "[[profile]]", href: "https://example.com/profile", image }]) {
  const values: Record<string, RuntimeJson> = {
    "skip-link": "[[skip]]",
    header: { brand: { label: "[[brand]]", mark: { src: "/brand.svg", width: 32, height: 32 } }, nav: { label: "[[navigation]]", links: [] } },
    footer: { brandBand: true, social: { label: "[[connect]]", links }, legal: { entity: "[[entity]]", links: [] } },
  };
  return siteShellProps({ content: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { reference: { kind: "region", ref: key }, value, hash: "sha256:0" }])), selection: { leaf: "frames.site-shell", fill: "foundry/frames.site-shell", members: [], config: null, content: {} }, slots: { main: [] } } as unknown as RuntimeRenderInput<ReactNode>);
}
afterEach(cleanup);
describe("MR9 closed runtime image transport", () => {
  it("renders the consumer image through the real frame and named external profile link", () => {
    const input = props();
    render(<SiteFrame {...input} />);
    const footer = screen.getByRole("contentinfo");
    const profile = within(footer).getByRole("link", { name: "[[profile]]" });
    expect(profile).toHaveAttribute("rel", "noopener noreferrer");
    expect(profile.querySelector("img")).toHaveAttribute("src", image.src);
    expect(profile.querySelector("img")).toHaveAttribute("alt", "");
    expect(within(footer).getByRole("heading", { name: "[[connect]]" })).toBeInTheDocument();
    expect(footer.querySelector('[data-footer-region="copyright"]')).toHaveTextContent("[[entity]]");
  });
  it("retains existing glyph data without making it an image", () => {
    const input = props([{ label: "[[profile]]", href: "https://example.com/profile", icon }]);
    const resolved = resolveShell(input.shell, input.resolveCopy, input.resolveAsset);
    expect(resolved.footer!.social!.links[0]).toMatchObject({ icon });
    expect(resolved.footer!.social!.links[0]).not.toHaveProperty("image");
  });
  it("refuses ambiguous artwork and invalid image resources", () => {
    expect(() => props([{ label: "[[profile]]", href: "https://example.com/profile", image, icon }])).toThrow(/one image or icon/);
    const invalid = props([{ label: "[[profile]]", href: "https://example.com/profile", image: { ...image, width: 0 } }]);
    expect(() => resolveShell(invalid.shell, invalid.resolveCopy, invalid.resolveAsset)).toThrow(/image asset/);
  });
});
