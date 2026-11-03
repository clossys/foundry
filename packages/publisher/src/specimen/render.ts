/**
 * The specimen document: one element record, one theme, one width.
 *
 * - visual: the element's production bundle mounts it client-side with its fixture props;
 * - text: copy set at its slot's real limits with the theme's typography;
 * - data, media, flow: a stub naming the record until their renderers exist.
 *
 * The health reporter runs first in `<head>`, so it sees every error the page raises.
 */
import { specimenReporterScript } from "./health-reporter.js";
import { themeCss, type SpecimenMode } from "./theme.js";
import type { SpecimenBuild } from "./build.js";
import type { SpecimenCopy, SpecimenQuery, SpecimenRecord, SpecimenTheme } from "./types.js";

export interface SpecimenProblem { readonly source: string; readonly message: string }
export interface SpecimenPageInput {
  readonly query: SpecimenQuery;
  readonly record?: SpecimenRecord;
  readonly theme?: SpecimenTheme;
  readonly mode: SpecimenMode;
  readonly build?: SpecimenBuild;
  /** URL prefix the built assets are served under, e.g. `/__specimen/assets/`. */
  readonly assetBase: string;
  /** CSP nonce for the page's inline scripts. */
  readonly nonce: string;
  readonly problems?: readonly SpecimenProblem[];
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, character => character === "\u2028" ? "\\u2028" : "\\u2029");
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Fixture props with `{ "$copy": key }` replaced by that copy's text. */
export function resolveFixtures(value: unknown, copy: Readonly<Record<string, SpecimenCopy>> = {}): unknown {
  if (Array.isArray(value)) return value.map(item => resolveFixtures(item, copy));
  if (!isRecord(value)) return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "$copy" && typeof value.$copy === "string") return copy[value.$copy]?.text ?? `[missing copy ${value.$copy}]`;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveFixtures(item, copy)]));
}

/** Copy for a text record: preview.json copy, else the cell's paragraphs as body text. */
export function textCopy(record: SpecimenRecord): [string, SpecimenCopy][] {
  if (record.preview.copy && Object.keys(record.preview.copy).length) return Object.entries(record.preview.copy);
  const body = record.payload.raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  return body.split(/\r?\n\s*\r?\n/).map(block => block.trim()).filter(block => block && !block.startsWith("#"))
    .map((block, index) => [`paragraph-${index + 1}`, { text: block.replace(/\s*\r?\n\s*/g, " "), role: "body" }]);
}

function renderText(record: SpecimenRecord): string {
  const rows = textCopy(record).map(([key, copy]) => {
    const role = copy.role ?? "body";
    const chars = [...copy.text].length;
    const overChars = copy.maxChars !== undefined && chars > copy.maxChars;
    const limits = [`${chars}${copy.maxChars ? `/${copy.maxChars}` : ""} chars`, ...(copy.maxLines ? [`<span data-specimen-lines>?</span>/${copy.maxLines} lines`] : [])];
    const attrs = [
      `data-copy-key="${escapeHtml(key)}"`, `data-role="${role}"`, `data-chars="${chars}"`,
      ...(copy.maxChars ? [`data-max-chars="${copy.maxChars}"`] : []),
      ...(copy.maxLines ? [`data-max-lines="${copy.maxLines}" style="--specimen-max-lines:${copy.maxLines}"`] : []),
      ...(overChars ? ['data-over="chars"'] : []),
    ].join(" ");
    return `<div class="specimen-copy" ${attrs}><p class="specimen-copy-text">${escapeHtml(copy.text)}</p><p class="specimen-copy-meta">${escapeHtml(key)} · ${role} · ${limits.join(" · ")}</p></div>`;
  });
  return `<section class="specimen-text" data-specimen-text>${rows.join("")}</section>`;
}

/** Counts rendered lines against each copy's line limit (layout is only known in the browser). */
const TEXT_FIT_SCRIPT = `(()=>{const fit=()=>{for(const row of document.querySelectorAll(".specimen-copy[data-max-lines]")){const text=row.querySelector(".specimen-copy-text");const style=getComputedStyle(text);const line=parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.2;const clamp=text.style.webkitLineClamp;text.style.webkitLineClamp="unset";text.style.display="block";const lines=Math.max(1,Math.round(text.scrollHeight/line));text.style.removeProperty("display");text.style.webkitLineClamp=clamp;const max=Number(row.dataset.maxLines);row.dataset.lines=String(lines);const out=row.querySelector("[data-specimen-lines]");if(out)out.textContent=String(lines);if(lines>max)row.dataset.over=row.dataset.over?row.dataset.over+" lines":"lines";}};document.fonts&&document.fonts.ready?document.fonts.ready.then(fit):fit();})();`;

function renderStub(record: SpecimenRecord): string {
  return `<div class="specimen-stub" data-specimen-stub="${record.kind}"><strong>${escapeHtml(record.id)}@v${record.version}</strong><br>${escapeHtml(record.kind)} specimen: this record kind has no renderer yet.<br>Payload: ${escapeHtml(record.payload.path)}</div>`;
}

function wrap(container: string, body: string): string {
  if (container === "canvas") return `<div class="specimen-canvas">${body}</div>`;
  if (container === "section-in-frame") return `<div class="specimen-frame"><main>${body}</main></div>`;
  return body;
}

/**
 * Reports the specimen's natural size to a same-origin host (a Studio gallery card): the page lays
 * out at the frame's own width (`layout: "reflow"`, no scaling), and `empty` says that nothing in
 * the stage paints (no text, media, form control, fill, border or shadow), so the host can drop
 * the preview instead of showing a blank box; `failed` says the specimen reported an error.
 */
const SIZE_SCRIPT = `(()=>{if(parent===window)return;const stage=document.getElementById("specimen-stage");if(!stage)return;let last="",timer=0;`
  + `const failed=()=>{try{return window.__clossysSpecimen.health().errors.count>0;}catch{return false;}};`
  + `const media=/^(img|svg|canvas|video|picture|input|textarea|select|iframe|hr|meter|progress)$/i;`
  + `const paints=(el,c)=>media.test(el.tagName)||(c.backgroundColor!=="transparent"&&!/^rgba\\(.*,\\s*0\\)$/.test(c.backgroundColor))||c.backgroundImage!=="none"||c.boxShadow!=="none"||["Top","Right","Bottom","Left"].some(side=>parseFloat(c["border"+side+"Width"])>0&&c["border"+side+"Style"]!=="none")||[...el.childNodes].some(node=>node.nodeType===3&&node.textContent.trim());`
  + `const measure=()=>{const host=stage.parentElement,box=getComputedStyle(host),pad=host.classList.contains("specimen-canvas")?parseFloat(box.paddingTop)+parseFloat(box.paddingBottom):0;`
  + `let height=stage.getBoundingClientRect().height+pad,shown=false;const all=stage.getElementsByTagName("*");`
  + `for(let i=0;i<all.length&&i<4000;i++){const el=all[i],c=getComputedStyle(el),b=el.getBoundingClientRect();if(c.display==="none"||c.visibility==="hidden"||b.width<1||b.height<1)continue;`
  + `if(c.position==="fixed")height=Math.max(height,b.bottom+48);if(!shown&&paints(el,c))shown=true;}`
  + `const size={type:"clossys:specimen-size",layout:"reflow",width:innerWidth,height:Math.ceil(height),empty:!shown,failed:failed()},key=JSON.stringify(size);`
  + `if(key===last)return;last=key;try{parent.postMessage(size,location.origin);}catch{}};`
  + `const soon=()=>{clearTimeout(timer);timer=setTimeout(measure,50);};`
  + `addEventListener("load",()=>{last="";soon();for(const delay of [300,1000,2500])setTimeout(()=>{last="";measure();},delay);});addEventListener("resize",soon);`
  + `addEventListener("message",event=>{if(event.source===parent&&event.origin===location.origin&&event.data&&event.data.type==="clossys:specimen-size-request"){last="";measure();}});`
  + `if(window.ResizeObserver)new ResizeObserver(soon).observe(stage);if(window.MutationObserver)new MutationObserver(soon).observe(stage,{subtree:true,childList:true,attributes:true,characterData:true});`
  + `if(document.fonts&&document.fonts.ready)document.fonts.ready.then(soon);})();`;

export function renderSpecimenPage(input: SpecimenPageInput): string {
  const { record, query, build } = input;
  const width = query.width ?? record?.preview.width ?? null;
  const themeLabel = `${input.theme?.id ?? "none"}:${input.mode}`;
  const problems = [...(input.problems ?? []), ...(build?.errors ?? []).map(message => ({ source: "build", message }))];
  const reporter = specimenReporterScript({
    element: query.element, elementVersion: record?.version ?? query.version ?? null, kind: record?.kind ?? "unknown",
    theme: themeLabel, width, preErrors: problems,
  });
  let body: string, scripts = "";
  if (!record) {
    body = `<div class="specimen-missing" data-specimen-missing><strong>${escapeHtml(query.element)}${query.version ? `@v${query.version}` : ""}</strong><br>No such element record.</div>`;
  } else if (record.kind === "visual") {
    const props = resolveFixtures(record.preview.fixtures ?? {}, record.preview.copy);
    body = `<div id="specimen-root"></div><script type="application/json" id="specimen-props">${scriptJson({ props, export: record.preview.export ?? null })}</script>`;
    if (build?.js) scripts = `<script type="module" src="${escapeHtml(input.assetBase + build.hash)}.js"></script>`;
  } else if (record.kind === "text") {
    body = renderText(record);
    scripts = `<script nonce="${escapeHtml(input.nonce)}">${TEXT_FIT_SCRIPT}</script>`;
  } else {
    body = renderStub(record);
  }
  scripts += `<script nonce="${escapeHtml(input.nonce)}">${SIZE_SCRIPT}</script>`;
  const container = record?.preview.container ?? (record?.kind === "visual" ? "canvas" : "page");
  const head = [
    '<meta charset="utf-8">',
    `<meta name="viewport" content="width=${width ?? "device-width"}, initial-scale=1">`,
    `<title>${escapeHtml(record ? `${record.id}@v${record.version}` : query.element)} specimen</title>`,
    '<link rel="icon" href="data:,">',
    `<script nonce="${escapeHtml(input.nonce)}">${reporter}</script>`,
    ...(build ? [`<link rel="stylesheet" href="${escapeHtml(input.assetBase + build.hash)}.css">`] : []),
    `<style>${themeCss(input.theme)}${width ? `:root{--specimen-width:${width}px}` : ""}</style>`,
  ].join("");
  const attrs = [`lang="en"`, `data-specimen-kind="${record?.kind ?? "missing"}"`, `data-theme="${input.mode}"`, ...(input.mode === "dark" ? ['class="dark"'] : [])].join(" ");
  return `<!doctype html><html ${attrs} style="color-scheme:${input.mode}"><head>${head}</head><body>${wrap(container, `<div id="specimen-stage">${body}</div>`)}${scripts}</body></html>`;
}
