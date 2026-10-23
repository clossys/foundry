const fixtureResolveCopy: import("@clossys/writer").CopyResolver = (ref) => ({
  ref, text: ref.id, recordId: "readme-example", revision: "1", locale: "en",
  source: { kind: "consumer", reference: "readme-example" }, entryId: ref.id,
});
const fixtureFrame: import("@clossys/publisher/web").SiteFrameInput = {
  shell: {
    brand: { assetId: "brand-mark", label: { id: "brand.home" }, size: "md", variant: "mark" },
    skipLink: { id: "shell.skip" },
    footer: { legal: { entity: { id: "legal.entity" }, links: [{ href: "/privacy", label: { id: "legal.privacy" } }] } },
  },
  resolveCopy: fixtureResolveCopy,
  resolveAsset: () => ({ type: "image", src: "/mark.svg", width: 48, height: 48, alt: "Example" }),
};

// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { SiteFrame, StatusView } from "@clossys/publisher/web";
import type { SiteFrameInput } from "@clossys/publisher/web";
import { expectFrontDoorConformance } from "@clossys/publisher/testing";
import { expect, it } from "vitest";

const frame: SiteFrameInput = fixtureFrame; // the shell and resolvers the layout passes

const notFound = () => (
  <SiteFrame {...frame}>
    <StatusView status="404" subtitle="This page does not exist." action={<a href="/" className="bg-accent">Back to home</a>} />
  </SiteFrame>
);

it("renders one frame around the not-found view", () => {
  const doc = new DOMParser().parseFromString(renderToStaticMarkup(notFound()), "text/html");
  expect(doc.querySelectorAll("h1")).toHaveLength(1);
  expect(doc.querySelectorAll("main")).toHaveLength(1);
  expect(doc.querySelectorAll("header")).toHaveLength(1);
  expect(doc.querySelectorAll("footer")).toHaveLength(1);
  expect(doc.querySelector("main .rounded-control")).toBeNull();
  expectFrontDoorConformance({
    surfaces: [{ surface: "not-found", title: { page: "Page not found", brand: "Example Studio" }, render: notFound }],
  });
});

export default notFound;
