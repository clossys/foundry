/** Writer's public layer vocabulary, ordered from words to narratives. */
export const WRITER_LAYERS = ["lexicon", "strings", "patterns", "passages", "narratives"] as const;
export type WriterLayer = typeof WRITER_LAYERS[number];

export function isWriterLayer(value: unknown): value is WriterLayer {
  return typeof value === "string" && WRITER_LAYERS.some(layer => layer === value);
}

const LEAF_ID = /^(lexicon|strings|patterns|passages|narratives)\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** One layer and one ASCII kebab-case leaf segment; child/member IDs are separate. */
export function isValidWriterLeafId(value: unknown): value is string {
  return typeof value === "string" && LEAF_ID.exec(value)?.[0] === value;
}
