import type { HTMLAttributes, ReactNode } from "react";
import { Button } from "../components/Button.js";
import { Dialog } from "../components/Dialog.js";
import { cx } from "../components/internal/cx.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.gallery", "foundry/sections.gallery");

export interface GalleryImage {
  /** Stable key for the image. */
  id: string;
  /** The image node the host renders (an `<img>`, `<picture>` or labelled `<svg>`), with its own alt text. */
  media: ReactNode;
  /** Text name of the image; names the enlarge control and the lightbox dialog. */
  label: string;
  /** Optional caption under the image. */
  caption?: ReactNode;
}
export interface GalleryProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** The images, in reading order. */
  images: readonly GalleryImage[];
  /** Accessible name of the gallery region. */
  label: string;
  /**
   * `true` makes each image a control that opens it in a modal lightbox
   * (the Foundry `Dialog`: focus trap, Escape, focus return). `false`
   * renders plain figures. @default true
   */
  lightbox?: boolean;
  /** Labels for the lightbox chrome. */
  labels?: { close: string; enlarge: (label: string) => string };
}

const DEFAULT_LABELS = { close: "Close", enlarge: (label: string) => `Enlarge ${label}` };
const TILE = "block w-full overflow-hidden rounded-panel bg-surface-sunken";

/**
 * A grid of images with optional captions. With `lightbox` on (the default),
 * each image is a Foundry `Button` (ghost, reshaped to the tile; its own
 * focus ring) that opens a modal `Dialog` showing the
 * image at full measure with its caption and a close action; with it off the
 * gallery is a list of plain figures. The host supplies every image node and
 * its alternative text; the gallery never fetches or crops.
 */
export function Gallery({ images, label, lightbox = true, labels = DEFAULT_LABELS, className, ...rest }: GalleryProps) {
  return (
    <section {...SECTION_STAMP} {...rest} aria-label={label} data-lightbox={lightbox ? "enabled" : "disabled"} className={cx("flex flex-col", className)}>
      <ul role="list" className="grid grid-cols-1 gap-md tablet:grid-cols-2 desktop:grid-cols-3">
        {images.map(image => (
          <li key={image.id} className="min-w-0">
            <figure className="flex flex-col gap-xs">
              {lightbox ? (
                <Dialog
                  size="lg"
                  trigger={
                    <Button variant="ghost" aria-label={labels.enlarge(image.label)} className={cx(TILE, "p-0 cursor-zoom-in")}>
                      {image.media}
                    </Button>
                  }
                >
                  {({ close }) => (
                    <>
                      <Dialog.Heading className="sr-only">{image.label}</Dialog.Heading>
                      <div className={TILE}>{image.media}</div>
                      {image.caption ? <p className="text-body-s text-ink-secondary">{image.caption}</p> : null}
                      <div className="flex justify-end">
                        <Button variant="secondary" size="md" onPress={close}>{labels.close}</Button>
                      </div>
                    </>
                  )}
                </Dialog>
              ) : (
                <div className={TILE}>{image.media}</div>
              )}
              {image.caption ? <figcaption className="text-caption text-ink-muted">{image.caption}</figcaption> : null}
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}
