/**
 * The single conversation contract every composed skill carries (#1182).
 * Source of truth: the conversation-contract document kept in this
 * monorepo's shared contracts directory (not part of this package's own
 * published files). This package's own build step packs it into `contracts/`
 * so the published tarball is self-contained.
 */

const CONTRACT_HEADING = "## How we work together";
const LEGACY_HEADING = "## One question at a time";
const INSTALLED_HEADING = "## When this package is installed";

function lineIndex(lines: readonly string[], heading: string, from = 0): number {
  for (let index = from; index < lines.length; index += 1) {
    if ((lines[index] ?? "").trim() === heading) return index;
  }
  return -1;
}

/**
 * Extracts the injectable block from the raw conversation-contract.md text:
 * everything from its `## How we work together` heading to end of file,
 * trimmed. Content above that heading (a title, a provenance note) is
 * documentation for a human reader of the contract file itself and is never
 * injected.
 */
export function extractContractBlock(rawDocText: string): string {
  const lines = rawDocText.split("\n");
  const index = lineIndex(lines, CONTRACT_HEADING);
  if (index === -1) {
    throw new Error("conversation contract document is missing its `## How we work together` heading");
  }
  return lines.slice(index).join("\n").trim();
}

/**
 * Replaces a skill's own `## How we work together` and `## One question at a
 * time` sections (if present) with the shared conversation contract, at the
 * same position. When neither heading is present, inserts the contract
 * before `## When this package is installed` if that heading exists, else
 * appends it at the end of the file. A blank line is preserved (or added)
 * on both sides of the inserted block; existing content is otherwise left
 * untouched. Idempotent: composing an already-composed skill a second time
 * (the contract's own heading is `## How we work together`, so a repeat run
 * finds and replaces exactly the block it wrote) leaves it unchanged.
 */
export function injectContract(skillBody: string, contractBlock: string): string {
  const contract = contractBlock.trim();
  const lines = skillBody.split("\n");
  const howIdx = lineIndex(lines, CONTRACT_HEADING);
  const oneIdx = lineIndex(lines, LEGACY_HEADING);

  let start: number;
  let end: number;
  if (howIdx !== -1 || oneIdx !== -1) {
    start = howIdx === -1 ? oneIdx : oneIdx === -1 ? howIdx : Math.min(howIdx, oneIdx);
    end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      const trimmed = (lines[index] ?? "").trim();
      if (trimmed.startsWith("## ") && trimmed !== CONTRACT_HEADING && trimmed !== LEGACY_HEADING) {
        end = index;
        break;
      }
    }
  } else {
    const installedIdx = lineIndex(lines, INSTALLED_HEADING);
    start = installedIdx === -1 ? lines.length : installedIdx;
    end = start;
  }

  const before = lines.slice(0, start);
  const after = lines.slice(end);
  const needsLeadingBlank = before.length > 0 && (before[before.length - 1] ?? "").trim() !== "";
  const needsTrailingBlank = after.length > 0 && (after[0] ?? "").trim() !== "";
  const block = [
    ...(needsLeadingBlank ? [""] : []),
    ...contract.split("\n"),
    ...(needsTrailingBlank ? [""] : []),
  ];
  return [...before, ...block, ...after].join("\n");
}
