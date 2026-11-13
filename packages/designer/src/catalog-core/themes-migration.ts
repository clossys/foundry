/**
 * Read-time migration of retired `tokens.*` leaf ids to their `themes.*`
 * successors, driven only by catalog/ia/themes.id-migration.json.
 *
 * Historical surface registrations keep their authentic bytes (their descriptor
 * hash is computed over the old ids, and installed pins point at that hash), so
 * the history file is never rewritten. A caller that validates a historical
 * contract against the current shape maps its reads through this table instead:
 * a renamed id expands to every successor, a deleted id is dropped, and the
 * result is de-duplicated in first-seen order.
 */
import migration from "../catalog/ia/themes.id-migration.json" with { type: "json" };

type Row = { readonly old: string; readonly new?: readonly string[] };

const renamed = new Map<string, readonly string[]>((migration.renamed as readonly Row[]).map(row => [row.old, row.new ?? []]));
const deleted = new Set<string>((migration.deleted as readonly string[]));

/** Successor themes ids for one id. Non-`tokens.*` ids pass through unchanged. */
export function migrateThemeId(id: string): readonly string[] {
    if (!id.startsWith("tokens.")) return [id];
    const next = renamed.get(id);
    if (next) return next;
    if (deleted.has(id)) return [];
    // A sub-id (`tokens.breakpoint.mobile`) follows its retired leaf (`tokens.breakpoint`).
    const leaf = id.split(".").slice(0, 2).join(".");
    if (deleted.has(leaf)) return [];
    const leafNext = renamed.get(leaf);
    if (leafNext) return leafNext;
    throw new Error(`themes id migration: ${id} is neither renamed nor deleted in themes.id-migration.json`);
}

/** Map a list of ids through the table, de-duplicated in first-seen order. */
export function migrateThemeIds(ids: readonly string[]): string[] {
    const out: string[] = [];
    for (const id of ids) for (const next of migrateThemeId(id)) if (!out.includes(next)) out.push(next);
    return out;
}

type Reads = Record<string, unknown>;

/**
 * Move a reads object's `tokens` list to `themes` through the table. An object
 * that already reads `themes` and no `tokens` is returned unchanged. Key order
 * follows the input, with `themes` taking the place of `tokens`.
 */
export function migrateReads<T extends Reads>(reads: T): T {
    if (!Object.hasOwn(reads, "tokens")) return reads;
    const out: Reads = {};
    for (const [key, value] of Object.entries(reads)) {
        if (key === "tokens") out.themes = migrateThemeIds([...(Array.isArray(reads.themes) ? reads.themes as string[] : []), ...(value as string[])]);
        else if (key !== "themes") out[key] = value;
    }
    return out as T;
}

/**
 * Deep-migrate a historical value: every `tokens` key becomes `themes`, and every
 * string list carrying `tokens.*` ids (reads, breakpoints, layers) is mapped
 * through the table. Everything else is copied unchanged.
 */
export function migrateHistorical<T>(value: T): T {
    if (Array.isArray(value)) {
        if (value.every(item => typeof item === "string") && value.some(item => (item as string).startsWith("tokens."))) return migrateThemeIds(value as string[]) as T;
        return value.map(item => migrateHistorical(item)) as T;
    }
    if (value === null || typeof value !== "object") return value;
    const source = value as Record<string, unknown>;
    if (Object.hasOwn(source, "tokens") && Object.hasOwn(source, "themes")) throw new Error("themes id migration: value reads both tokens and themes");
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(source)) out[key === "tokens" ? "themes" : key] = migrateHistorical(item);
    return out as T;
}
