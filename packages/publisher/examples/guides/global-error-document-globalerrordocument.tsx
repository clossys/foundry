"use client";

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

import { GlobalErrorDocument } from "@clossys/publisher/web";
import type { SiteFrameInput } from "@clossys/publisher/web";

const frame: SiteFrameInput = fixtureFrame; // the same shell and resolvers the root layout passes to SiteFrame

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <GlobalErrorDocument
      lang="en"
      documentTitle={{ page: "Something went wrong", brand: "Example Studio" }}
      icon={{ href: "/icon.svg", type: "image/svg+xml" }}
      shell={frame.shell}
      resolveCopy={frame.resolveCopy}
      resolveAsset={frame.resolveAsset}
      status="500"
      subtitle="Something went wrong."
      reference={error.digest ? { label: "Error", value: error.digest } : undefined}
      action={<button type="button" onClick={reset}>Try again</button>}
    />
  );
}

export const smokeProps = { error: Object.assign(new Error("Example error"), { digest: "example-digest" }), reset: (): void => {} } satisfies Parameters<typeof GlobalError>[0];
