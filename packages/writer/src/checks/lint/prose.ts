import { parseIcuMessage, type IcuNode } from "../../icu/parse.js";

const MAX_VARIANTS = 256;
/** Unknown runtime arguments interrupt phrases without becoming authored words. */
const ARGUMENT = "\uFFFC";

export function writerProseVariants(text: string): { variants: string[]; incomplete?: string } {
  const parsed = parseIcuMessage(text);
  // WR8 owns malformed MessageFormat; lint must not reinterpret its syntax as prose.
  if (parsed.issues.length) return { variants: [] };
  const expand = (nodes: readonly IcuNode[]): string[] | undefined => {
    let values = [""];
    for (const node of nodes) {
      let alternatives: string[];
      if (node.kind === "literal") alternatives = [node.text];
      else if (node.kind === "choice") {
        alternatives = [];
        for (const option of node.options) {
          const branch = expand(option.nodes);
          if (!branch) return undefined;
          alternatives.push(...branch);
        }
      } else alternatives = [ARGUMENT];
      const next = new Set<string>();
      for (const prefix of values) for (const suffix of alternatives) {
        next.add(prefix + suffix);
        if (next.size > MAX_VARIANTS) return undefined;
      }
      values = [...next];
    }
    return values;
  };
  const variants = expand(parsed.nodes);
  return variants ? { variants } : { variants: [], incomplete: `Prose lint exceeds ${MAX_VARIANTS} distinct ICU variants; check is incomplete.` };
}
