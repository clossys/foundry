import { checkConsumerArtContract, type ConsumerArtContract } from "@clossys/designer/tokens";

const art: ConsumerArtContract = {
  slot: "media", purpose: "meaningful", alt: "A tree beside a walking path",
  width: 1600, height: 900, aspect: "16:9", fit: "contain",
  loading: "lazy", bytes: 100000, backgroundToken: "--color-surface-base",
  source: { format: "webp", src: "/art/photo.webp" },
};
const report = checkConsumerArtContract(art);
export { report };
