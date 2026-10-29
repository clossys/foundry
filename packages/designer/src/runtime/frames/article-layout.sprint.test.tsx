import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { SiteFrame } from "../../frames/site-frame/SiteFrame.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";
import { siteShellProps, siteShellRuntimeRenderer } from "./site-shell.js";

function props(article = true, toc = true) {
  const values = siteShellRuntimeRenderer.sample(specimenDataset) as Record<string, unknown>;
  return siteShellProps({
    content: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { reference: { kind: "region", ref: key }, value, hash: "sha256:0" }])),
    selection: { leaf: "frames.site-shell", fill: "foundry/frames.site-shell", members: article ? ["layout.article"] : [], config: null, content: {} },
    slots: { main: [<article key="body"><h1>Example reading</h1></article>], ...(toc ? { toc: [<nav key="toc" aria-label="Contents">Example outline</nav>] } : {}), progress: [<div key="progress">Visual only</div>] },
  } as unknown as RuntimeRenderInput<ReactNode>);
}
describe("site article reading layout", () => {
  it("transports the proposed article member into one main, a sticky rail and decorative progress slot", () => {
    const input = props(); expect(input.mainLayout).toBe("article");
    const view = render(<SiteFrame {...input} />);
    expect(view.getAllByRole("main")).toHaveLength(1);
    expect(view.container.querySelector("[data-site-article-toc]")).toHaveClass("desktop:sticky");
    expect(view.container.querySelector("[data-site-article-body] h1")).toHaveTextContent("Example reading");
    expect(view.container.querySelector("[data-article-progress]")).toHaveAttribute("aria-hidden", "true");
    expect(view.container.textContent).toContain("prefers-reduced-motion:reduce");
  });
  it("adds no empty rail and preserves ordinary main layout when the article member is absent", () => {
    const view = render(<SiteFrame {...props(true, false)} />);
    expect(view.container.querySelector("[data-site-article-toc]")).toBeNull();
    view.rerender(<SiteFrame {...props(false)} />);
    expect(view.container.querySelector("[data-article-progress]")).toBeNull();
    expect(view.container.querySelector("[data-site-main-layout]")).toBeNull();
  });
});
