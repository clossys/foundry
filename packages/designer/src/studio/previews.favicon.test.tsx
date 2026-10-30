import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SlotPreview } from "./previews.js";
import { labels } from "./__fixtures__/studio.js";

afterEach(cleanup);

const DARK = "@media (prefers-color-scheme: dark){svg{color:#111111;fill:#ffffff}}";
const wrap = (style: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" color="#000000"><style>${style}</style><path d="M2 2h20v20H2z" fill="currentColor"/></svg>`;
const member = (slot: string, svg: string) => ({ slot, source: "example", fill: "example/x", via: "authored" as const, $type: "svg" as const, value: { light: svg }, css: { light: svg }, alias: {} });
const show = (id: string, svg: string) => {
  const slot = id.split(".").slice(0, 2).join(".");
  return render(<SlotPreview members={[{ id, member: member(slot, svg) }]} labels={labels} />).container;
};

describe("favicon vector preview", () => {
  it("renders the favicon vector with the one allowed dark-scheme style as an image, not code", () => {
    const svg = wrap(DARK);
    const view = show("assets.favicon.vector", svg);
    expect(view.querySelector("img")?.getAttribute("src")).toBe(`data:image/svg+xml,${encodeURIComponent(svg)}`);
    expect(view.querySelectorAll("code")).toHaveLength(1); // only the member-name label
  });

  it("keeps the code fallback for a non-favicon member carrying the same style", () => {
    const view = show("assets.mark.positive", wrap(DARK));
    expect(view.querySelector("img")).toBeNull();
    expect(view.querySelectorAll("code")).toHaveLength(2);
  });

  it.each([
    ["a second style", wrap(DARK).replace("</style>", `</style><style>${DARK}</style>`)],
    ["a script", wrap(DARK).replace("</svg>", "<script>alert(1)</script></svg>")],
    ["a different media query", wrap(DARK.replace("dark", "light"))],
  ])("keeps the code fallback for the favicon member with %s", (_name, svg) => {
    const view = show("assets.favicon.vector", svg);
    expect(view.querySelector("img")).toBeNull();
    expect(view.querySelectorAll("code")).toHaveLength(2);
  });
});
