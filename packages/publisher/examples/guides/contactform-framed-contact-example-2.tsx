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

import { CaptureView, SiteFrame } from "@clossys/publisher/web";
import type { SiteFrameInput } from "@clossys/publisher/web";

type CopyRef = Parameters<SiteFrameInput["resolveCopy"]>[0];
const frame: SiteFrameInput = fixtureFrame;
const pageCopy: { heading: CopyRef; description: CopyRef; formLabel: CopyRef } = { heading: { id: "contact.heading" }, description: { id: "contact.description" }, formLabel: { id: "contact.form" } };
function ContactFormIsland(): React.ReactElement { return <form><button type="submit">Send</button></form>; }

export function FramedContactPage() {
  const heading = frame.resolveCopy(pageCopy.heading)!.text;
  const description = frame.resolveCopy(pageCopy.description)!.text;
  const formLabel = frame.resolveCopy(pageCopy.formLabel)!.text;
  return (
    <SiteFrame {...frame}>
      <CaptureView
        heading={heading}
        description={description}
        formLabel={formLabel}
        form={<ContactFormIsland />}
      />
    </SiteFrame>
  );
}

export default FramedContactPage;
