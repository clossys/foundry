// Generated from sections.gallery by src/generated/props/generate.ts; do not edit.
export const galleryContractSha256 = "4f22da375b596225c2c481ee3038abd3ecf95ed24401c311957a5aecdb1817bf";

export type GalleryCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  images: {
    label: string; // label
    items: Array<{
      label: string; // label
      caption?: string; // body
      media?: {
        title?: string; // heading
      };
    }>;
  };
};
export type GalleryVariant = {
  lightbox?: "enabled" | "disabled";
};
export interface GalleryProps {
  copy: GalleryCopy;
  variant?: GalleryVariant;
}
