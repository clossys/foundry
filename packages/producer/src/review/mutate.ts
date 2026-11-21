/**
 * Deterministic mutants of the changed source lines. Each operator rewrites one site on one line; string and template
 * literals and line comments are masked first, so no operator fires inside them. Above the cap, the selection is the
 * MUTANT_CAP mutants with the lowest sha256(seed:id), then back in file and line order: the same diff and seed always
 * give the same mutants.
 */
import { createHash } from "node:crypto";

export const MUTANT_CAP = 40;

export interface Mutant { readonly id: string; readonly file: string; readonly line: number; readonly column: number; readonly operator: string; readonly from: string; readonly to: string }

const COMPARISON: Readonly<Record<string, string>> = { "===": "!==", "!==": "===", "<=": ">", ">=": "<", "<": ">=", ">": "<=" };

/** The operators, by id, with what each does (docs/review.md lists them). */
export const OPERATORS: readonly { readonly id: string; readonly does: string }[] = [
  { id: "flip-comparison", does: "=== <-> !==, <= -> >, >= -> <, < -> >=, > -> <= (spaced binary operators only)" },
  { id: "negate-condition", does: "if (c) -> if (!(c)), when the condition closes on the same line" },
  { id: "drop-return", does: "return <expr>; -> return undefined; (as never in TypeScript)" },
  { id: "drop-throw", does: "throw <expr>; -> void (<expr>);" },
  { id: "swap-literal", does: "true <-> false, an integer n -> n + 1 (0 -> 1)" },
];

/** The line with string, template and regex-free comment text replaced by spaces, so offsets still line up. */
export function mask(line: string): string {
  let out = "", quote = "";
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quote) {
      if (char === "\\") { out += "  "; i++; continue; }
      if (char === quote) { quote = ""; out += char; continue; }
      out += " ";
      continue;
    }
    if (char === "/" && line[i + 1] === "/") return out + " ".repeat(line.length - i);
    if (char === "\"" || char === "'" || char === "`") quote = char;
    out += char;
  }
  return out;
}

function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/** Every mutant of one line (1-based number), in column order. */
export function lineMutants(file: string, number: number, line: string): Mutant[] {
  const trimmed = line.trim();
  if (!trimmed || /^(?:\/\/|\/\*|\*|import\b|export\s+(?:type|interface)\b|type\b|interface\b)/.test(trimmed)) return [];
  const masked = mask(line);
  const ts = /\.(?:ts|tsx|mts|cts)$/.test(file);
  const out: Mutant[] = [];
  const add = (column: number, operator: string, from: string, to: string) => {
    const mutated = line.slice(0, column) + to + line.slice(column + from.length);
    out.push({ id: `${file}:${number}:${column + 1}:${operator}`, file, line: number, column, operator, from: line, to: mutated });
  };
  for (const match of masked.matchAll(/ (===|!==|<=|>=|<|>) /g)) add(match.index! + 1, "flip-comparison", match[1]!, COMPARISON[match[1]!]!);
  for (const match of masked.matchAll(/\bif \(/g)) {
    const open = match.index! + 3, close = closing(masked, open);
    if (close > open) add(open, "negate-condition", line.slice(open, close + 1), `(!${line.slice(open, close + 1)})`);
  }
  const ret = /^(\s*)return\s+([^;]+);\s*$/.exec(masked);
  if (ret && ret[2]!.trim() !== "undefined") add(ret[1]!.length, "drop-return", line.slice(ret[1]!.length).trimEnd(), ts ? "return undefined as never;" : "return undefined;");
  const thrown = /^(\s*)throw\s+(.+);\s*$/.exec(masked);
  if (thrown) {
    const start = thrown[1]!.length, body = line.slice(start).trimEnd();
    add(start, "drop-throw", body, `void (${body.replace(/^throw\s+/, "").replace(/;$/, "")});`);
  }
  for (const match of masked.matchAll(/\b(true|false)\b/g)) add(match.index!, "swap-literal", match[1]!, match[1] === "true" ? "false" : "true");
  for (const match of masked.matchAll(/(?<![\w.$])(\d+)(?![\w.$])/g)) add(match.index!, "swap-literal", match[1]!, String(Number(match[1]) + 1));
  return out.sort((a, b) => a.column - b.column || a.operator.localeCompare(b.operator));
}

/** The mutants of the given line ranges of a file's text. */
export function fileMutants(file: string, text: string, ranges: readonly [number, number][]): Mutant[] {
  const lines = text.split("\n");
  const out: Mutant[] = [];
  for (const [start, end] of ranges) for (let number = start; number <= end && number <= lines.length; number++) out.push(...lineMutants(file, number, lines[number - 1]!));
  return out;
}

const rank = (seed: string, id: string) => createHash("sha256").update(`${seed}:${id}`).digest("hex");

/** At most cap mutants: all of them when they fit, else the cap lowest-ranked for seed, in their original order. */
export function selectMutants(mutants: readonly Mutant[], seed: string, cap = MUTANT_CAP): Mutant[] {
  if (mutants.length <= cap) return [...mutants];
  const chosen = new Set([...mutants].sort((a, b) => rank(seed, a.id).localeCompare(rank(seed, b.id))).slice(0, cap).map(mutant => mutant.id));
  return mutants.filter(mutant => chosen.has(mutant.id));
}

/** text with the mutant's line replaced. */
export function applyMutant(text: string, mutant: Mutant): string {
  const lines = text.split("\n");
  if (lines[mutant.line - 1] !== mutant.from) throw new Error(`${mutant.id}: line ${mutant.line} no longer matches`);
  lines[mutant.line - 1] = mutant.to;
  return lines.join("\n");
}

/** A test run's output that shows a compile error, not a failing assertion: the mutant is invalid, not killed. */
export const COMPILE_ERROR = /\berror TS\d+:|SyntaxError: /;
