/**
 * The specimen page's own frame: containers, the text specimen, token and asset specimens and the
 * error panel. The stage never grows past its frame: the size reporter's contract is `reflow` (the
 * page lays out at the frame's own width, unscaled), so a stage pinned at the requested width would
 * push a narrow card's content out of view.
 * Publisher owns these styles; every color, radius and font comes from the theme's shadcn
 * variables.
 */
export const SPECIMEN_CHROME_CSS = `
html, body { margin: 0; }
#specimen-stage { width: min(100%, var(--specimen-width, 100%)); max-width: none; margin: 0 auto; box-sizing: border-box; }
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
.specimen-tokens { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 136px), 1fr)); gap: 16px; padding: 20px; box-sizing: border-box; color: var(--foreground); font: 400 0.875rem/1.4 var(--font-sans, ui-sans-serif, system-ui, sans-serif); }
.specimen-tokens-wide, .specimen-tokens:has(> [data-token="color"]:only-child), .specimen-tokens:has(> [data-token="radius"]), .specimen-tokens:has(> [data-token="spacing"]), .specimen-tokens:has(> [data-token="motion"]), .specimen-tokens:has(> [data-token="tracking"]) { grid-template-columns: minmax(0, 1fr); }
.specimen-token { margin: 0; display: grid; gap: 8px; min-width: 0; }
.specimen-token-sample { display: grid; place-items: center; min-height: 72px; min-width: 0; overflow: hidden; border-radius: var(--radius, 8px); background: var(--muted); padding: 12px; box-sizing: border-box; }
.specimen-token[data-token="color"] .specimen-token-sample { padding: 0; background: none; }
.specimen-token figcaption { display: grid; gap: 2px; min-width: 0; }
.specimen-token-name { font-weight: 500; overflow-wrap: anywhere; }
.specimen-token-value, .specimen-token-raw { font: 400 0.75rem/1.4 var(--font-mono, ui-monospace, monospace); color: var(--muted-foreground); overflow-wrap: anywhere; }
.specimen-swatch { width: 100%; height: 96px; border-radius: var(--radius, 8px); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--foreground) 12%, transparent); }
.specimen-shadow { width: 64px; height: 48px; border-radius: var(--radius, 8px); background: var(--card, var(--background)); }
.specimen-token[data-token="shadow"] .specimen-token-sample { background: var(--background); padding: 20px; }
.specimen-radius-ramp { display: flex; flex-wrap: wrap; gap: 16px; justify-content: center; }
.specimen-radius-step { display: grid; gap: 4px; justify-items: center; font-size: 0.75rem; color: var(--muted-foreground); }
.specimen-radius { width: 56px; height: 56px; background: var(--primary); }
.specimen-space-ladder { display: grid; gap: 6px; width: 100%; }
.specimen-space-step { display: grid; grid-template-columns: 2ch minmax(0, 1fr); align-items: center; gap: 8px; font: 400 0.75rem/1 var(--font-mono, ui-monospace, monospace); color: var(--muted-foreground); }
.specimen-space { height: 10px; max-width: 100%; border-radius: 2px; background: var(--primary); }
.specimen-type-ladder { display: grid; gap: 8px; width: 100%; justify-items: start; }
.specimen-type-sample { margin: 0; max-width: 100%; color: var(--foreground); line-height: 1.2; overflow-wrap: anywhere; }
.specimen-motion-track { width: 100%; overflow: hidden; --duration: 12s; --gap: 12px; }
.specimen-motion-row { display: flex; gap: var(--gap); width: max-content; }
.specimen-motion-chip { display: grid; place-items: center; width: 48px; height: 32px; border-radius: var(--radius, 8px); background: var(--background); border: 1px solid var(--border); font-size: 0.75rem; }
.specimen-motion-shine { --shiny-width: 100px; margin: 0; font-size: 1.25rem; font-weight: 600; color: color-mix(in oklab, var(--foreground) 55%, transparent); background: linear-gradient(120deg, transparent 40%, var(--foreground) 50%, transparent 60%) 0 0 / var(--shiny-width) 100% no-repeat; -webkit-background-clip: text; background-clip: text; }
.specimen-asset-image { display: block; max-width: 100%; max-height: 120px; height: auto; width: auto; object-fit: contain; }
.specimen-asset-glyph { width: 32px; height: 32px; color: var(--foreground); }
.specimen-asset-ratio { display: grid; place-items: center; width: min(100%, 120px); max-height: 120px; border: 1px dashed var(--muted-foreground); border-radius: 4px; font: 400 0.75rem/1 var(--font-mono, ui-monospace, monospace); color: var(--muted-foreground); box-sizing: border-box; }
.specimen-asset-pattern { width: 100%; height: 96px; border-radius: 4px; }
.specimen-unavailable { min-height: 1px; }
.specimen-missing, .specimen-error { margin: 24px; padding: 24px; border: 1px dashed var(--border); border-radius: var(--radius, 8px); color: var(--muted-foreground); font: 400 0.875rem/1.5 var(--font-sans, ui-sans-serif, system-ui, sans-serif); }
.specimen-missing strong { color: var(--foreground); font-weight: 600; }
.specimen-error { border-style: solid; border-color: var(--destructive); color: var(--destructive); }
`;
