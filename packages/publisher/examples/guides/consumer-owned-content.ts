import { createElement } from "react";
import {
  createCopyResolver,
  type CopyRegistry,
} from "@clossys/writer";
import {
  checkContentAssetFill, resolveSectionedViewDocument,
  validateSectionedViewDocument, type SectionedViewDocument,
} from "@clossys/publisher/core";
import { LandingView } from "@clossys/publisher/web";

const registry = {
  id: "content-example", revision: "1", locale: "en",
  source: { kind: "consumer", reference: "example" },
  entries: [
    { id: "example.heading", text: "A place to explore", context: "Heading", status: "approved" },
    { id: "example.alt", text: "A landscape beside a walking path", context: "Image description", status: "approved" },
  ],
} satisfies CopyRegistry;
const contract = {
  width: 1600, height: 900, aspectRatio: "16:9",
  format: "image/webp", loading: "lazy",
} as const;
const fill = {
  id: "example.image", type: "image", src: "/media/example.webp", mimeType: "image/webp",
  width: 1600, height: 900, alt: "Registry description",
};
export const document = {
  id: "content-example", sectionGroundRhythm: "base-then-sunken",
  sections: [
    { id: "opening", kind: "hero", heading: { id: "example.heading" } },
    { id: "photograph", kind: "content-section", layout: "split-end",
      heading: { id: "example.heading" },
      media: { type: "asset", assetId: "example.image", purpose: "meaningful",
        alt: { id: "example.alt" }, contract } },
  ],
} satisfies SectionedViewDocument;
export const findings = validateSectionedViewDocument(document);
export const fillReport = checkContentAssetFill(contract, fill, "example.image");
if (findings.some(finding => finding.severity === "error") || !fillReport.ok) {
  throw new Error("Invalid content declaration or fill metadata");
}
export const resolved = resolveSectionedViewDocument(document, createCopyResolver(registry));
export const element = createElement(LandingView, {
  document: resolved,
  resolveAssetId: id => id === "example.image" ? fill : undefined,
});
