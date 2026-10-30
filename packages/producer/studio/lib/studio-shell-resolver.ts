import { SHELL_COPY_REFS, type ShellCopyRef, type ShellCopyResolver } from '@clossys/designer/frames';

/** A253 permits these Studio-owned bootstrap words when a Writer cell is absent. */
export const STUDIO_SHELL_FALLBACK = { brand: 'Clossys', label: 'Studio' } as const;
export type StudioWriterCopyPort = (request: ShellCopyRef) => { readonly text: string } | undefined;

/** Writer owns ICU and approval; Designer requires the exact original request identity. */
export function createStudioShellCopyResolver(writer?: StudioWriterCopyPort): ShellCopyResolver {
  return request => {
    let text: string | undefined;
    try { const resolved = writer?.(request); if (typeof resolved?.text === 'string' && resolved.text.trim()) text = resolved.text; }
    catch { /* An unavailable Writer preview cannot prevent the Studio shell from mounting. */ }
    return { ref: request, text: text ?? STUDIO_SHELL_FALLBACK.label };
  };
}

/** Existing explicit shell props use the same Writer port, including native ICU arguments. */
export function studioShellText(resolve: ShellCopyResolver, reference: ShellCopyRef, values?: ShellCopyRef['values']): string {
  const request = values === undefined ? reference : { ...reference, values };
  return resolve(request)?.text ?? STUDIO_SHELL_FALLBACK.label;
}

/** AppFrame computes these eagerly, including when themeControl is explicitly null. */
export function studioShellThemeLabels(resolve: ShellCopyResolver) {
  return {
    system: studioShellText(resolve, SHELL_COPY_REFS.theme.system),
    light: studioShellText(resolve, SHELL_COPY_REFS.theme.light),
    dark: studioShellText(resolve, SHELL_COPY_REFS.theme.dark),
  };
}
