import { ConsumerArtSlot, type ConsumerArtSlotProps } from "@clossys/publisher/web";

const art: ConsumerArtSlotProps["contract"] = {
  slot: "media", purpose: "meaningful", alt: "A tree beside a walking path",
  width: 1600, height: 900, aspect: "16:9", fit: "contain",
  loading: "lazy", bytes: 100000, backgroundToken: "--color-surface-base",
  source: { format: "webp", src: "/art/photo.webp" },
};
const visual = <ConsumerArtSlot contract={art} />;

export default function Example() { return visual; }
