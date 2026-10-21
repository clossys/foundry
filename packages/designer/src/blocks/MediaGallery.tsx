"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useLocale } from "react-aria-components";
import { Dialog } from "../atoms/Dialog.js";
import { IconButton } from "../atoms/IconButton.js";
import { cx } from "../atoms/internal/cx.js";
import { ChevronLeft } from "../icons/ChevronLeft.js";
import { ChevronRight } from "../icons/ChevronRight.js";
import { X } from "../icons/X.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";

export interface MediaGalleryItem {
  id: string;
  thumbnail: ReactNode;
  full: ReactNode;
  alt: string;
  caption?: ReactNode;
}

export interface MediaGalleryProps {
  /** Two through twenty-four authored media items. */
  items: readonly MediaGalleryItem[];
  /** Desktop column count. @default 3 */
  columns?: 2 | 3 | 4;
  /** Thumbnail proportions. @default "4:3" */
  aspect?: "1:1" | "4:3" | "16:9";
  openLabel: (alt: string) => string;
  closeLabel: string;
  previousLabel: string;
  nextLabel: string;
  /** Formats the one-based selected position. */
  positionLabel: (index: number, total: number) => string;
  /** Semantic surface and ink policy. @default "base" */
  ground?: SectionGround;
  "aria-labelledby"?: string;
  "aria-label"?: string;
  className?: string;
  style?: CSSProperties;
}

const COLUMN_CLASSES = {
  2: "grid-cols-2 tablet:grid-cols-2 desktop:grid-cols-2",
  3: "grid-cols-2 tablet:grid-cols-3 desktop:grid-cols-3",
  4: "grid-cols-2 tablet:grid-cols-3 desktop:grid-cols-4",
} as const;
const ASPECT_CLASSES = {
  "1:1": "aspect-square",
  "4:3": "aspect-4/3",
  "16:9": "aspect-video",
} as const;

/** A thumbnail list with a Dialog lightbox and host-labelled bounded navigation. */
export function MediaGallery({ items, columns = 3, aspect = "4:3", openLabel, closeLabel, previousLabel, nextLabel, positionLabel, ground = "base", className, style, ...rest }: MediaGalleryProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const { direction } = useLocale();
  if (items.length < 2 || items.length > 24) throw new TypeError("MediaGallery: items must contain two through twenty-four items.");
  const colors = SECTION_GROUND_CLASSES[ground];
  const inverse = ground === "inverse";
  const focusClass = inverse ? "focus-visible:outline-accent-on-inverse" : "focus-visible:outline-accent";
  const rtl = direction === "rtl";
  const previousIcon = rtl ? ChevronRight : ChevronLeft;
  const nextIcon = rtl ? ChevronLeft : ChevronRight;
  const current = openIndex === null ? undefined : items[openIndex];

  function navigate(index: number) {
    if (openIndex === null) return;
    const target = Math.max(0, Math.min(items.length - 1, index));
    const buttons = content.current?.querySelectorAll<HTMLButtonElement>("footer button");
    const active = content.current?.ownerDocument.activeElement;
    const transferPrevious = target === 0 && active === buttons?.[0];
    const transferNext = target === items.length - 1 && active === buttons?.[1];
    if (transferPrevious || transferNext) {
      // Commit disabled states before focusing the opposite arrow: with two
      // items that arrow was disabled until this same navigation action.
      flushSync(() => setOpenIndex(target));
      const enabled = content.current?.querySelectorAll<HTMLButtonElement>("footer button");
      enabled?.[transferPrevious ? 1 : 0]?.focus();
    } else {
      setOpenIndex(target);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (openIndex === null) return;
    let target: number;
    switch (event.key) {
      case "ArrowLeft": target = openIndex + (rtl ? 1 : -1); break;
      case "ArrowRight": target = openIndex + (rtl ? -1 : 1); break;
      case "Home": target = 0; break;
      case "End": target = items.length - 1; break;
      default: return;
    }
    event.preventDefault();
    navigate(target);
  }

  return (
    <>
      <ul {...rest} role="list" className={cx("grid gap-md", COLUMN_CLASSES[columns], colors.surface, colors.primary, className)} style={style}>
        {items.map((item, index) => (
          <li key={item.id} className="min-w-0">
            <button type="button" aria-label={openLabel(item.alt)} onClick={() => setOpenIndex(index)} className={cx("block min-h-[var(--ui-layout-tap-target)] w-full overflow-hidden rounded-control [&_img]:size-full [&_img]:object-cover focus-visible:outline-2 focus-visible:outline-offset-2", ASPECT_CLASSES[aspect], focusClass)}>{item.thumbnail}</button>
          </li>
        ))}
      </ul>
      <Dialog trigger={null} isOpen={openIndex !== null} onOpenChange={isOpen => { if (!isOpen) setOpenIndex(null); }} size="lg">
        {current && openIndex !== null ? (
          <div ref={content} onKeyDown={onKeyDown} className="flex min-w-0 flex-col gap-md">
            <Dialog.Heading className="sr-only">{current.alt}</Dialog.Heading>
            <div className="flex justify-center [&_img]:max-h-[60vh] [&_img]:w-auto [&_img]:max-w-full">{current.full}</div>
            {current.caption !== undefined ? <div className="text-body-s text-ink-secondary">{current.caption}</div> : null}
            <footer className="flex flex-wrap items-center justify-center gap-sm">
              <IconButton icon={previousIcon} label={previousLabel} autoFocus={openIndex > 0} isDisabled={openIndex === 0} onPress={() => navigate(openIndex - 1)} />
              <span role="status" aria-live="polite" className="text-body-s text-ink-secondary">{positionLabel(openIndex + 1, items.length)}</span>
              <IconButton icon={nextIcon} label={nextLabel} autoFocus={openIndex === 0} isDisabled={openIndex === items.length - 1} onPress={() => navigate(openIndex + 1)} />
              <IconButton icon={X} label={closeLabel} onPress={() => setOpenIndex(null)} />
            </footer>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
