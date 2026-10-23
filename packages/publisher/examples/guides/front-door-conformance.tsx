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
import { AuthView, SiteFrame, StatusView } from "@clossys/publisher/web";
import type { SiteFrameInput } from "@clossys/publisher/web";
import { PRIMARY_ACTION_CLASS, expectFrontDoorConformance } from "@clossys/publisher/testing";
import { expect, it } from "vitest";

const frame: SiteFrameInput = fixtureFrame; // the shell and resolvers the layout passes

it("keeps the front door conformant", () => {
  expect(() =>
    expectFrontDoorConformance({
      surfaces: [
        {
          surface: "sign-in",
          title: { page: "Sign in", brand: "Example Studio" },
          render: () => (
            <SiteFrame {...frame}>
              <AuthView
                heading="Sign in"
                description="Welcome back."
                form={<button type="submit" className={PRIMARY_ACTION_CLASS}>Sign in</button>}
              />
            </SiteFrame>
          ),
        },
        {
          surface: "not-found",
          title: { page: "Page not found", brand: "Example Studio" },
          render: () => (
            <SiteFrame {...frame}>
              <StatusView status="404" subtitle="This page does not exist." action={<a href="/" className={PRIMARY_ACTION_CLASS}>Go home</a>} />
            </SiteFrame>
          ),
        },
      ],
    }),
  ).not.toThrow();
});

export default function Example() { return <SiteFrame {...frame}><StatusView status="404" subtitle="This page does not exist." action={<a href="/" className={PRIMARY_ACTION_CLASS}>Go home</a>} /></SiteFrame>; }
