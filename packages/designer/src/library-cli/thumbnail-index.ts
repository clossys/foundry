export interface ThumbnailIndex {
  version: 1; libraryHash: string;
  leaves: Record<string, { fill: string; sha256: string; width: number; height: number }>;
}
export function thumbnailState(index: ThumbnailIndex | undefined, receiptFiles: Readonly<Record<string, string>>, leaf: string): "missing" | "fresh" | "stale" {
  if (!index || !Object.hasOwn(index.leaves, leaf)) return "missing";
  return index.leaves[leaf]!.fill === receiptFiles[`fills/${leaf}.json`] ? "fresh" : "stale";
}
