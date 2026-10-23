type AssetEntry = ImageAssetEntry | VideoAssetEntry;

interface ImageAssetEntry {
  id: string;
  type: "image";
  src: string;            // primary/fallback source — unchanged from v1
  width: number;
  height: number;
  alt: string;             // required, unchanged from v1
  mimeType?: string;
  licence?: string;        // optional — unchanged from v1, see below
  credit?: string;
  sources?: { src: string; width: number; format?: string }[]; // NEW — responsive <picture>/srcset
}

interface VideoAssetEntry {
  id: string;
  type: "video";           // NEW — this package's first video support at all
  sources: { src: string; mimeType: string }[]; // required, at least one
  width: number;
  height: number;
  alt: string;
  captions?: { src: string; srclang: string; label: string }[];
  transcript?: string;     // at least one of captions/transcript is REQUIRED
  poster?: string;
  reducedMotion: "pause" | "no-autoplay" | "static-poster"; // required
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
  licence?: string;
  credit?: string;
}

export type { AssetEntry };
