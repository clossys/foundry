/**
 * The specimen frame page, shared by `/__specimen` (installed library items) and the Publisher
 * page preview (`/preview/<publication>/frame/<page>.html`).
 *
 * It loads the real page at `width` CSS px and scales it to the frame, so breakpoints follow the
 * specimen's own viewport. It also measures the page's natural height and reports it:
 *   - a `clossys:specimen-size` message to the parent (same origin only), and
 *   - when the host wrapper (`frameElement.parentElement`) opts in with
 *     `data-specimen-fit="content"`, the wrapper's height is set to the scaled content height,
 *     capped at the wrapper's own aspect-ratio height. Short items (a logo, a toast) no longer sit
 *     in a tall empty box; long pages keep the viewport crop.
 *
 * The script is static (the width rides on a data attribute), so its CSP hash is constant and
 * the frame page runs no other script.
 */
import { createHash } from "node:crypto";

export const SPECIMEN_WIDTHS: ReadonlySet<number> = new Set([375, 768, 1280]);
export const SPECIMEN_SIZE_MESSAGE = "clossys:specimen-size";

const SCRIPT = [
  "(function(){",
  "var f=document.getElementById('page'),w=Number(f.getAttribute('data-width'))||1280,last=-1,box=null,cap=0;",
  "try{var host=window.frameElement&&window.frameElement.parentElement;",
  "if(host&&host.getAttribute('data-specimen-fit')==='content'){box=host;",
  "var r=String(getComputedStyle(box).aspectRatio||'').split('/').map(Number);",
  "cap=r.length===2&&r[0]>0&&r[1]>0?r[1]/r[0]:0;}}catch(e){box=null;}",
  "function scale(){return Math.min(1,innerWidth/w);}",
  "function fit(){var s=scale();f.style.width=w+'px';f.style.height=Math.ceil(innerHeight/s)+'px';",
  "f.style.transform='scale('+s+')';f.style.marginLeft=Math.max(0,(innerWidth-w*s)/2)+'px';}",
  "function natural(){var d;try{d=f.contentDocument;}catch(e){return 0;}",
  "if(!d||!d.documentElement||!d.body||(f.contentWindow&&f.contentWindow.location.href==='about:blank'))return 0;",
  "var keep=f.style.height;f.style.height='0px';",
  "var h=Math.max(d.documentElement.scrollHeight,d.body.scrollHeight),fixed=0,all=d.body.getElementsByTagName('*');",
  "for(var i=0;i<all.length&&i<4000;i++){var c=d.defaultView.getComputedStyle(all[i]);",
  "if(c.position==='fixed'&&c.display!=='none'){var b=all[i].getBoundingClientRect();if(b.height>0)fixed=Math.max(fixed,b.height+48);}}",
  "f.style.height=keep;return Math.ceil(Math.max(h,fixed));}",
  "function measure(){fit();var h=natural();if(!h||Math.abs(h-last)<2)return;last=h;var s=scale();",
  "try{parent.postMessage({type:'" + SPECIMEN_SIZE_MESSAGE + "',width:w,height:h},location.origin);}catch(e){}",
  "if(box){var edge=box.offsetHeight-box.clientHeight,want=h*s,max=cap?box.clientWidth*cap:want;",
  "box.style.aspectRatio='auto';box.style.height=Math.ceil(Math.min(want,max)+edge)+'px';fit();}}",
  "var timer=0;function soon(){clearTimeout(timer);timer=setTimeout(measure,30);}",
  "function loaded(){last=-1;soon();[100,500,1500,3000].forEach(function(t){setTimeout(measure,t);});",
  "try{var d=f.contentDocument;d.addEventListener('load',soon,true);if(d.fonts&&d.fonts.ready)d.fonts.ready.then(soon);}catch(e){}}",
  "f.addEventListener('load',loaded);addEventListener('resize',function(){fit();last=-1;soon();});fit();",
  // A host that bound after the first report asks again.
  "addEventListener('message',function(e){if(e.source===parent&&e.origin===location.origin&&e.data&&e.data.type==='clossys:specimen-size-request'){last=-1;soon();}});",
  "})();",
].join("");

export const SPECIMEN_FRAME_SCRIPT_HASH = `sha256-${createHash("sha256").update(SCRIPT).digest("base64")}`;

/** Script runs only by hash; the inner page loads from this origin only. */
export const SPECIMEN_FRAME_CSP = `default-src 'none'; script-src '${SPECIMEN_FRAME_SCRIPT_HASH}'; style-src 'unsafe-inline'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

export function specimenWidth(value: unknown): number {
  const width = Number(value);
  return SPECIMEN_WIDTHS.has(width) ? width : 1280;
}

/**
 * The frame page HTML. `sandbox` is set on the inner iframe when given (Publisher pages load with
 * `allow-same-origin` only: same-origin stylesheets, no scripts); installed specimens run their
 * own built bundle and load unsandboxed from `/__specimen-site/`.
 */
export function specimenFramePage(options: { src: string; width: number; title: string; sandbox?: string }): string {
  const sandbox = options.sandbox === undefined ? "" : ` sandbox="${escapeHtml(options.sandbox)}"`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(options.title)}</title>`
    + "<style>html,body{margin:0;height:100%;overflow:hidden;background:transparent}iframe{display:block;border:0;transform-origin:0 0}</style></head>"
    + `<body><iframe id="page" title="${escapeHtml(options.title)}" data-width="${specimenWidth(options.width)}"${sandbox} src="${escapeHtml(options.src)}"></iframe>`
    + `<script>${SCRIPT}</script></body></html>\n`;
}
