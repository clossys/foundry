// @vitest-environment node
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { runtimeHash, type RuntimeJson, type RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { surfaceRuntimeRenderers } from "../index.js";

const content = (values: Record<string, RuntimeJson>) => Object.fromEntries(Object.entries(values).map(([slot, value]) => [slot, {
  reference: { kind: "region", ref: `example:${slot}` }, value, hash: runtimeHash(value),
}]));
function heroNode(values: Record<string, RuntimeJson> = { header: { heading: "Native home" } }): ReactNode {
  return surfaceRuntimeRenderers["sections.hero"]!.render({
    fill: { leaf: "sections.hero", slots: Object.keys(values), members: ["size.display"] },
    selection: { leaf: "sections.hero", members: ["size.display"] }, content: content(values),
    sectionHost: { heroCopy: { "header.heading": "Native home" } },
    cell: { theme: "light", state: "default", width: 1280 }, profile: { values: {} },
  } as unknown as RuntimeRenderInput<ReactNode>);
}
const overlayFrame = (main: ReactNode) => renderToStaticMarkup(<>{surfaceRuntimeRenderers["frames.site-shell"]!.render({
  fill: { leaf: "frames.site-shell" }, slots: { main: [main] },
  selection: { leaf: "frames.site-shell", members: ["footer-placement.overlay"] },
  content: content({
    "skip-link": "Skip to content",
    header: { brand: { label: "Example home", mark: { src: "/mark.svg", width: 32, height: 32 } }, surface: "glass", tone: "inverse" },
    footer: { legal: { entity: "Example", links: [] } },
  }),
} as unknown as RuntimeRenderInput<ReactNode>)}</>);

// REQ-0008: the element Designer's own sections.hero runtime renders must pass
// SiteFrame's overlay guard; a hero with no bound backdrop carries no backdrop props.
it("renders the runtime hero without a backdrop inside the overlay site frame", () => {
  const hero = heroNode();
  expect(isValidElement(hero)).toBe(true);
  expect(Object.keys((hero as { props: object }).props).filter(key => key.startsWith("backdrop"))).toEqual([]);
  const html = overlayFrame(hero);
  expect(html.match(/<h1\b/g)).toHaveLength(1);
  expect(html).toContain("Native home");
  expect(html).toContain("data-frame-footer-overlay");
});
