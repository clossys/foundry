export interface CandidatePromptData {
  consumer: string;
  board: { id: string; label: string };
  slot: { id: string; label: string };
  variants: readonly string[];
  guidelines?: readonly string[];
  tokens: readonly { id: string; value: string }[];
  siblings: readonly { id: string; source: string }[];
  currentCandidate?: { id: string; source: string; variants: readonly string[] };
  returnStep: string;
}
/** Only explicit catalog and consumer data enters the prompt; no environment or routing data. */
export function candidatePrompt(instruction: string, data: CandidatePromptData): string {
  return `${instruction}\n\n${JSON.stringify({ consumer: data.consumer, board: data.board, slot: data.slot, variants: data.variants, ...(data.guidelines?.length ? { guidelines: data.guidelines } : {}), tokens: data.tokens, siblings: data.siblings, ...(data.currentCandidate ? { currentCandidate: data.currentCandidate } : {}), returnStep: data.returnStep }, null, 2)}`;
}
