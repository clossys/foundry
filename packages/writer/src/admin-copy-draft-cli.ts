import { readFileSync, writeFileSync } from "node:fs";
import { validateWriterRecord } from "./model/validate.js";
import { loadWriterCatalog } from "./catalog/ia/index.js";
import { checkWriterICU } from "./checks/icu.js";

/** A create-only command for unapproved English admin Writer strings. */
export function mainAdminCopyDraft(argv: string[], io = { stdout: console.log, stderr: console.error }): number {
  try {
    if (argv.length === 1 && argv[0] === "--help") { io.stdout("Usage: writer-check admin-copy-draft <records.json> <new-envelope.json>"); return 0; }
    if (argv.length !== 2 || argv.some(value => !value || value.startsWith("-"))) throw new Error("Two file paths required");
    const input: unknown = JSON.parse(readFileSync(argv[0]!, "utf8"));
    if (!input || typeof input !== "object" || Array.isArray(input) || !("locale" in input) || input.locale !== "en"
      || Object.keys(input).some(key => key !== "locale" && key !== "records") || !("records" in input)) throw new Error("Explicit English draft input required");
    const records: unknown = input.records;
    const leaves = new Set(loadWriterCatalog().slots.map(slot => slot.id));
    const ids = new Set<string>(), contexts = new Set<string>();
    if (!Array.isArray(records) || !records.length) throw new Error("Nonempty string record list required");
    for (const row of records) {
      if (validateWriterRecord(row, "strings").length || !leaves.has(row.leaf) || row.status !== "draft" || row.approval !== undefined
        || !row.context.startsWith("admin.writer.") || ids.has(row.id) || contexts.has(row.context)) throw new Error("Distinct unapproved admin.writer draft strings required");
      ids.add(row.id); contexts.add(row.context);
    }
    if (checkWriterICU({ manifest: { consumer: "admin-copy-draft", messageSyntax: "icu-mf1", defaultLocale: "en", locales: [{ tag: "en", dir: "ltr", state: "active" }], fallback: {}, strategy: { root: "strategy", contract: "writer.messaging" }, leafFreeze: { lexicon: "", strings: "", patterns: "", passages: "", narratives: "" } }, locales: { en: { records, documents: [] } } }).length) throw new Error("Valid declared English ICU arguments required");
    const envelope = { version: 1, revision: 1, state: "draft", locale: "en", activation: "none", records,
      bindings: records.map(row => ({ cellId: row.context, recordId: row.id, target: "WriterRoutePage", kind: "CopyRef" })) };
    // Never replace a source envelope or follow an existing destination symlink.
    writeFileSync(argv[1]!, JSON.stringify(envelope, null, 2) + "\n", { flag: "wx" });
    io.stdout(JSON.stringify({ records: records.length, state: envelope.state, activation: envelope.activation }));
    return 0;
  } catch (error) { io.stderr(error instanceof Error ? error.message : "Draft command failed"); return 2; }
}
