// Generated from sections.gallery by src/generated/props/generate.ts; do not edit.
export const galleryContractSha256 = "76d4a7e630d8496761798a013e496e7f843ab6504efab1c7e14789df3e8194bf";

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
