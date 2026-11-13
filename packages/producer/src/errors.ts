/**
 * Failure helpers for catch sites (rule R-NO-HIDDEN-FALLBACKS). A catch either answers a yes/no
 * question the error itself decides (the path is absent) or hands the failure on: it never turns
 * a broken input into a silent default.
 */

/** True when a filesystem error only says the path is not there (ENOENT, ENOTDIR). */
export function isAbsent(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** The message of any thrown value, for an error record or a finding. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True when a module resolution error only says the package is not installed from that base. */
export function isModuleAbsent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "MODULE_NOT_FOUND";
}

/** JSON.parse as a result: the parse failure is handed on as an error record, never a default. */
export function parseJson(text: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly message: string } {
  try { return { ok: true, value: JSON.parse(text) }; } catch (error) { return { ok: false, message: errorMessage(error) }; }
}
