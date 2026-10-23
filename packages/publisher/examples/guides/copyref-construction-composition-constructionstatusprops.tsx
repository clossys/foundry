const fixtureResolveCopy: import("@clossys/writer").CopyResolver = (ref) => ({
  ref, text: ref.id, recordId: "readme-example", revision: "1", locale: "en",
  source: { kind: "consumer", reference: "readme-example" }, entryId: ref.id,
});
const frame: import("@clossys/publisher/web").SiteFrameInput = {
  shell: {
    brand: { assetId: "brand-mark", label: { id: "brand.home" }, size: "md", variant: "mark" },
    skipLink: { id: "shell.skip" },
    footer: { legal: { entity: { id: "legal.entity" }, links: [{ href: "/privacy", label: { id: "legal.privacy" } }] } },
  },
  resolveCopy: fixtureResolveCopy,
  resolveAsset: () => ({ type: "image", src: "/mark.svg", width: 48, height: 48, alt: "Example" }),
};

import { constructionStatusProps, SiteFrame, StatusView } from "@clossys/publisher/web";
import type { ConstructionStatusInput, SiteFrameInput } from "@clossys/publisher/web";

export function ConstructionPage({ shell, resolveCopy, resolveAsset }: SiteFrameInput) {
  const input: ConstructionStatusInput = {
    title: { id: "construction.title" },
    description: { id: "construction.description" },
    action: { label: { id: "construction.action" }, href: "/" },
  };
  return (
    <SiteFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}>
      <StatusView {...constructionStatusProps(input, resolveCopy)} />
    </SiteFrame>
  );
}

export const smokeProps = frame satisfies Parameters<typeof ConstructionPage>[0];
export default ConstructionPage;
