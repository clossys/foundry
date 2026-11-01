/** Shared record viewport metadata; safe for the Studio layout to import. */
export const RECORD_SPECIMEN_THEME_HEADER = 'x-clossys-record-theme';
export const RECORD_SPECIMEN_WIDTH_HEADER = 'x-clossys-record-width';

/** Canonical viewport defaults shared by the direct transport and Studio host. */
export function recordSpecimenViewport(params: URLSearchParams): { width: 375 | 768 | 1280; theme: 'light' | 'dark' } {
  const width = Number(params.get('width'));
  return { width: width === 375 || width === 768 ? width : 1280, theme: params.get('theme') === 'dark' ? 'dark' : 'light' };
}

