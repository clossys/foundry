import type { WriterLibrary } from "../../model/types.js";
import type { WriterCheckFinding, WriterCheckOptions } from "../freeze.js";
import { compileLexiconRules, runRetextRules } from "./rules.js";
import { writerLintTargets } from "./targets.js";
import { writerProseVariants } from "./prose.js";

/** Explicit English lexicon rules only; other locales retain their structural/ICU checks. */
export function checkWriterLint(library: WriterLibrary, options: WriterCheckOptions = {}): WriterCheckFinding[] {
  const findings: WriterCheckFinding[] = [];
  const targets = writerLintTargets(library, options);
  for (const { tag: locale } of library.manifest.locales) {
    if (!/^en(?:-|$)/i.test(locale)) continue;
    const content = library.locales[locale];
    if (!content) continue;
    const compiled = compileLexiconRules(content.records);
    for (const issue of compiled.issues) findings.push({
      code: "WR5", severity: "error", locale, recordId: issue.recordId, field: "lexicon", incomplete: true,
      path: `${locale}/${content.files?.find(file => file.recordIds.some(id => id === issue.recordId))?.path ?? issue.recordId}`,
      message: `WR5 (${issue.recordId}): ${issue.message}`,
    });
    for (const target of targets) {
      if (target.locale !== locale) continue;
      if (!compiled.rules.length) continue;
      const prose = writerProseVariants(target.text);
      if (prose.incomplete) findings.push({ code: "WR5", severity: "error", locale, recordId: target.recordId,
        field: target.field, path: target.path, incomplete: true, message: `WR5: ${prose.incomplete}` });
      const seen = new Set<string>();
      for (const variant of prose.variants) for (const fragment of variant.split("\uFFFC")) for (const match of runRetextRules(fragment, compiled.rules)) {
        if (seen.has(match.ruleId)) continue;
        seen.add(match.ruleId);
        findings.push({
          code: "WR5", severity: match.severity, locale, recordId: target.recordId, field: target.field, path: target.path,
          message: `WR5 (${match.ruleId}): ${match.message}`,
        });
      }
    }
  }
  return findings;
}
