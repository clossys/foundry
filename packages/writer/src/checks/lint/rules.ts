import { retext } from "retext";
import type { Root } from "nlcst";
import type { Plugin } from "unified";
import type { WriterRecord } from "../../model/types.js";
import { checkPatternSafety } from "../../voice/internal/pattern-safety.js";

type Severity = "error" | "warning" | "advisory";
export interface LintRuleIssue { recordId: string; message: string }
export interface LintMatch { ruleId: string; severity: Severity; message: string; offset?: number }
/** Compiled by compileLexiconRules; expressions are never accepted from copy. */
export interface LintRule {
  id: string;
  severity: Severity;
  message: string;
  phrases?: readonly RegExp[];
  pattern?: RegExp;
}
const normalize = (text: string): string => text.trim().replace(/\s+/gu, " ").toLowerCase();
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Only explicit bans and authored, statically bounded patterns become rules. */
export function compileLexiconRules(records: readonly WriterRecord[]): { rules: LintRule[]; issues: LintRuleIssue[] } {
  const rules: LintRule[] = [], issues: LintRuleIssue[] = [];
  for (const record of records) {
    if (record.status === "retired" || !record.leaf.startsWith("lexicon.") || !("kind" in record)) continue;
    const issue = (message: string): void => { issues.push({ recordId: record.id, message }); };
    let phrases: unknown, reason: string, alternative: string | undefined;
    if (record.kind === "pattern-rule") {
      const checked = checkPatternSafety(record.pattern);
      if (!checked.ok) { issue(`Invalid pattern (${checked.issue}): ${checked.detail}`); continue; }
      if (!["error", "warning", "advisory"].includes(record.severity) || !nonempty(record.reason)) {
        issue("Pattern rules require a valid severity and a non-empty reason."); continue;
      }
      if (record.alternative !== undefined && !nonempty(record.alternative)) {
        issue("Pattern alternative must be a non-empty string when present."); continue;
      }
      rules.push({ id: record.id, severity: record.severity,
        message: `${record.id}: ${record.reason}${record.alternative ? ` Use ${record.alternative}.` : ""}`,
        pattern: checked.regex });
      continue;
    }
    if (record.kind === "term" && record.termStatus === "avoid") {
      if (!nonempty(record.term) || !Array.isArray(record.forms) || !nonempty(record.reason)) {
        issue("Avoid terms require a non-empty term, forms array and reason."); continue;
      }
      phrases = [record.term, ...record.forms]; reason = `Avoid "${record.term}": ${record.reason}`; alternative = record.alternative;
      if (alternative !== undefined && !nonempty(alternative)) {
        issue("Term alternative must be a non-empty string when present."); continue;
      }
    } else if (record.kind === "voice-rule" && record.forbidden !== undefined) {
      phrases = record.forbidden; reason = `Forbidden wording for ${record.rule}: ${Array.isArray(record.forbidden) ? record.forbidden.join(", ") : "invalid list"}.`;
    } else continue;
    if (!Array.isArray(phrases) || !phrases.every(nonempty)) {
      issue("Forbidden wording must be an array of non-empty strings."); continue;
    }
    const unique = [...new Set((phrases as string[]).map(normalize))];
    if (unique.some((phrase) => !/[\p{L}\p{N}]/u.test(phrase))) {
      issue("Forbidden wording must contain a lexical word."); continue;
    }
    if (unique.length) rules.push({ id: record.id, severity: "error",
      message: `${record.id}: ${reason}${alternative ? ` Use ${alternative}.` : ""}`,
      phrases: unique.map((phrase) => new RegExp(phrase.split(" ").map(escape).join("\\s+"), "giu")) });
  }
  return { rules, issues };
}

interface LexicalNode {
  type: string;
  children?: readonly LexicalNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

/** Run an actual synchronous retext transformer; word boundaries come from its AST. */
export function runRetextRules(text: string, rules: readonly LintRule[]): LintMatch[] {
  const matches: LintMatch[] = [];
  const plugin: Plugin<[], Root> = () => (tree, file) => {
    const words: { start: number; end: number }[] = [];
    const visit = (node: LexicalNode): void => {
      const start = node.position?.start.offset, end = node.position?.end.offset;
      if (node.type === "WordNode" && start !== undefined && end !== undefined) words.push({ start, end });
      else node.children?.forEach(visit);
    };
    visit(tree);
    for (const rule of rules) {
      const seen = new Set<number>();
      const emit = (start: number): void => {
        if (seen.has(start)) return;
        seen.add(start);
        file.message(rule.message, { source: "writer-lint", ruleId: rule.id });
        matches.push({ ruleId: rule.id, severity: rule.severity, message: rule.message, offset: start });
      };
      const expressions = rule.pattern ? [rule.pattern] : rule.phrases ?? [];
      for (const expression of expressions) {
        const regex = new RegExp(expression.source, expression.flags.includes("g") ? expression.flags : `${expression.flags}g`);
        for (const match of text.matchAll(regex)) {
          const start = match.index, end = start + match[0].length;
          if (!rule.pattern) {
            // A phrase must cover whole lexical nodes, including internal apostrophes/hyphens.
            if (!words.some((word) => word.start >= start && word.end <= end)) continue;
            if (words.some((word) => (word.start < start && word.end > start) || (word.start < end && word.end > end))) continue;
            if (/[\p{L}\p{N}\p{M}_]$/u.test(text.slice(0, start)) || /^[\p{L}\p{N}\p{M}_]/u.test(text.slice(end))) continue;
          }
          emit(start);
        }
      }
    }
  };
  retext().use(plugin).processSync(text);
  return matches.sort((left, right) => (left.offset ?? 0) - (right.offset ?? 0));
}
