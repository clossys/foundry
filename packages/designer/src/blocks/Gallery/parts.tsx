import type { ReactNode } from "react";
import { Button } from "../../components/Button.js";
import { Dialog } from "../../components/Dialog.js";
import { SemanticContent } from "../../components/SemanticContent.js";
import { cx } from "../../components/internal/cx.js";
import type { GalleryImage } from "../Gallery.js";

export interface GalleryLabels { close: string; enlarge: string | ((label: string) => string) }
const TILE = "block w-full overflow-hidden rounded-panel bg-surface-sunken";

export function GalleryCaption({ children, dialog = false }: { children: ReactNode; dialog?: boolean }) {
  return dialog ? <SemanticContent as="p" className="text-body-s text-ink-secondary">{children}</SemanticContent>
    : <SemanticContent as="figcaption" className="text-caption text-ink-muted">{children}</SemanticContent>;
}
export function GalleryTile({ children, caption }: { children: ReactNode; caption?: ReactNode }) {
  return <SemanticContent as="figure" className="flex flex-col gap-xs">
    <SemanticContent as="div" className={TILE}>{children}</SemanticContent>
    {caption ? <GalleryCaption>{caption}</GalleryCaption> : null}
  </SemanticContent>;
}
export function GalleryLightbox({ image, labels }: { image: GalleryImage; labels: GalleryLabels }) {
  const enlarge = typeof labels.enlarge === "function" ? labels.enlarge(image.label) : `${labels.enlarge} ${image.label}`;
  if (typeof enlarge !== "string" || !enlarge.trim()) throw new TypeError("Gallery: each image requires an authored control label.");
  return <Dialog size="lg" trigger={<Button variant="ghost" aria-label={enlarge} className={cx(TILE, "p-0 cursor-zoom-in")}>{image.media}</Button>}>
    {({ close }) => <>
      <Dialog.Heading className="sr-only">{image.label}</Dialog.Heading>
      <SemanticContent as="div" className={TILE}>{image.media}</SemanticContent>
      {image.caption ? <GalleryCaption dialog>{image.caption}</GalleryCaption> : null}
      <SemanticContent as="div" className="flex justify-end"><Button variant="secondary" size="md" onPress={close}>{labels.close}</Button></SemanticContent>
    </>}
  </Dialog>;
}
