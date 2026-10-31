/**
 * The specimen page's own frame: containers, the text specimen, stubs and the error panel.
 * Publisher owns these styles; every color, radius and font comes from the theme's shadcn
 * variables.
 */
export const SPECIMEN_CHROME_CSS = `
html, body { margin: 0; }
#specimen-stage { width: var(--specimen-width, 100%); max-width: none; margin: 0 auto; box-sizing: border-box; }
.specimen-canvas { min-height: 100vh; display: grid; place-items: center; padding: 32px; box-sizing: border-box; background: var(--background); }
.specimen-canvas > #specimen-stage { width: min(100%, var(--specimen-width, 100%)); }
.specimen-frame { min-height: 100vh; display: flex; flex-direction: column; }
.specimen-frame > main { flex: 1; }
.specimen-text { display: grid; gap: 24px; padding: 24px; box-sizing: border-box; }
.specimen-copy { display: grid; gap: 8px; }
.specimen-copy-text { margin: 0; color: var(--foreground); font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif); letter-spacing: var(--tracking-normal, normal); overflow-wrap: break-word; }
.specimen-copy[data-max-lines] .specimen-copy-text { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: var(--specimen-max-lines); overflow: hidden; }
.specimen-copy[data-role="display"] .specimen-copy-text { font-family: var(--font-heading, var(--font-sans, ui-sans-serif, system-ui, sans-serif)); font-size: 3rem; line-height: 1.05; font-weight: 600; letter-spacing: var(--tracking-tight, -0.02em); }
.specimen-copy[data-role="heading"] .specimen-copy-text { font-family: var(--font-heading, var(--font-sans, ui-sans-serif, system-ui, sans-serif)); font-size: 1.875rem; line-height: 1.15; font-weight: 600; }
.specimen-copy[data-role="subheading"] .specimen-copy-text { font-size: 1.25rem; line-height: 1.4; font-weight: 500; color: var(--muted-foreground); }
.specimen-copy[data-role="body"] .specimen-copy-text { font-size: 1rem; line-height: 1.6; }
.specimen-copy[data-role="label"] .specimen-copy-text { font-size: 0.875rem; line-height: 1.25; font-weight: 500; }
.specimen-copy[data-role="caption"] .specimen-copy-text { font-size: 0.75rem; line-height: 1.4; color: var(--muted-foreground); }
.specimen-copy-meta { margin: 0; font: 500 0.75rem/1.4 var(--font-mono, ui-monospace, monospace); color: var(--muted-foreground); }
.specimen-copy[data-over] .specimen-copy-meta { color: var(--destructive); }
.specimen-stub, .specimen-missing, .specimen-error { margin: 24px; padding: 24px; border: 1px dashed var(--border); border-radius: var(--radius, 8px); color: var(--muted-foreground); font: 400 0.875rem/1.5 var(--font-sans, ui-sans-serif, system-ui, sans-serif); }
.specimen-stub strong, .specimen-missing strong { color: var(--foreground); font-weight: 600; }
.specimen-error { border-style: solid; border-color: var(--destructive); color: var(--destructive); }
`;
