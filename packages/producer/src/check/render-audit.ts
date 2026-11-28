/// <reference lib="dom" />
/**
 * The rendered-output audit of `clossys check --render` (Reviewer's Production stage, rule R-RENDER-AUDIT).
 *
 * Two functions run inside the captured page, and each is sent to the browser as its own source text, so neither
 * may reference anything outside its own body:
 *
 *   measureRender   runs once per capture in the real browser: it strips any earlier `data-render-*` marks and
 *                   writes what only layout knows onto the elements themselves (box, hidden, horizontal clip and
 *                   spill, painted background or mask, the viewport). The page's HTML after this step is the
 *                   saved capture.
 *   auditRender     reads only the document and those marks, never live layout, and returns the findings. It
 *                   therefore gives the same answer on a saved capture (jsdom, a test, a later re-read) as in the
 *                   browser that took it: a saved capture is the evidence, not a screenshot of it.
 *
 * Every finding names its owning slot, the nearest ancestor `data-slot="<agent>/<slot id>"` (a shadcn part such as
 * `data-slot="button"` is not a slot ref and is passed over), and the agent that owns the fix: Writer for copy,
 * the slot's agent otherwise, Publisher (which assembles the page) when no slot owns the content.
 */

export const RENDER_RULES = [
  "RENDER_NOT_CAPTURED", "RENDER_EMPTY_ICON", "RENDER_GLYPH", "RENDER_NO_NAME", "RENDER_OVERFLOW",
  "RENDER_COPY_UNKEYED", "RENDER_COPY_UNRESOLVED", "RENDER_SLOT_UNATTRIBUTED",
] as const;
export type RenderRule = typeof RENDER_RULES[number];

export interface RenderFinding {
  readonly rule: RenderRule;
  /** `<agent>/<slot id>` of the nearest slot that owns the element, or null when none does. */
  readonly slot: string | null;
  /** The agent a request for this finding goes to. */
  readonly agent: string;
  /** A CSS path from the owning slot (or the body) to the element. */
  readonly selector: string;
  readonly message: string;
  readonly evidence?: string;
  /** The Writer copy key, for the copy rules. */
  readonly copyKey?: string;
}

export interface RenderAuditOptions {
  /** The agents whose `<agent>/<slot>` refs attribute an element (records/slot-model MODEL_AGENTS). */
  readonly agents: readonly string[];
  /** The agent named when no slot owns the content. */
  readonly fallbackAgent: string;
}

/**
 * Marks the live document with what the audit needs from layout. Runs in the browser; self-contained.
 * Returns the number of elements measured.
 */
export function measureRender(): number {
  const MARKS = ["data-render-viewport", "data-render-box", "data-render-hidden", "data-render-clips", "data-render-spill", "data-render-paint"];
  const all = Array.from(document.querySelectorAll("*"));
  for (const element of all) for (const mark of MARKS) element.removeAttribute(mark);
  const root = document.documentElement;
  root.setAttribute("data-render-viewport", `${window.innerWidth} ${window.innerHeight}`);
  let measured = 0;
  for (const element of all) {
    if (element === root || element.closest("head")) continue;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number(style.opacity) === 0) element.setAttribute("data-render-hidden", "");
    const rect = element.getBoundingClientRect();
    element.setAttribute("data-render-box", [rect.left + window.scrollX, rect.top + window.scrollY, rect.width, rect.height].map(value => Math.round(value)).join(" "));
    if (style.overflowX !== "visible") element.setAttribute("data-render-clips", style.overflowX);
    const scrollable = style.overflowX === "auto" || style.overflowX === "scroll";
    if (!scrollable && element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1) element.setAttribute("data-render-spill", `${element.scrollWidth} ${element.clientWidth}`);
    if ((style.backgroundImage && style.backgroundImage !== "none") || ((style as unknown as Record<string, string>).maskImage ?? "none") !== "none" || ((style as unknown as Record<string, string>).webkitMaskImage ?? "none") !== "none") element.setAttribute("data-render-paint", "");
    measured++;
  }
  return measured;
}

/** The findings over a measured document. Runs in the browser or over a saved capture; self-contained. */
export function auditRender(doc: Document, options: RenderAuditOptions): RenderFinding[] {
  type Finding = { rule: string; slot: string | null; agent: string; selector: string; message: string; evidence?: string; copyKey?: string };
  const findings: Finding[] = [];
  const root = doc.documentElement;
  const body = doc.body;
  const viewport = (root.getAttribute("data-render-viewport") ?? "").split(" ").map(Number);
  if (!body || viewport.length !== 2 || !viewport.every(value => Number.isFinite(value) && value > 0)) {
    return [{ rule: "RENDER_NOT_CAPTURED", slot: null, agent: options.fallbackAgent, selector: "html", message: "The page carries no browser measurements: it was not captured, so nothing about it can pass." }] as RenderFinding[];
  }
  const width = viewport[0]!;
  const agents = new Set(options.agents);
  const SLOT_REF = /^([a-z][a-z0-9-]*)\/([a-z0-9][a-z0-9._-]*)$/;
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TITLE", "HEAD", "META", "LINK"]);
  const clean = (value: string): string => value.replace(/\s+/g, " ").trim();
  const clip = (value: string): string => (value.length > 120 ? `${value.slice(0, 117)}...` : value);

  const slotOf = (element: Element, agent?: string): string | null => {
    for (let current: Element | null = element; current; current = current.parentElement) {
      const ref = current.getAttribute("data-slot");
      const match = ref ? SLOT_REF.exec(ref) : null;
      if (match && agents.has(match[1]!) && (agent === undefined || match[1] === agent)) return ref;
    }
    return null;
  };
  const agentOf = (slot: string | null): string => (slot ? slot.split("/")[0]! : options.fallbackAgent);
  const box = (element: Element): number[] | null => {
    const raw = element.getAttribute("data-render-box");
    if (raw === null) return null;
    const parts = raw.split(" ").map(Number);
    return parts.length === 4 && parts.every(Number.isFinite) ? parts : null;
  };
  // Not hidden by markup or style (an empty element can still collapse to no area: that is not hiding it).
  const displayed = (element: Element): boolean => {
    for (let current: Element | null = element; current && current !== root; current = current.parentElement) {
      if (current.hasAttribute("data-render-hidden") || current.hasAttribute("hidden") || SKIP.has(current.tagName)) return false;
    }
    return true;
  };
  const shown = (element: Element): boolean => {
    if (!displayed(element)) return false;
    const rect = box(element);
    return rect === null || (rect[2]! > 0 && rect[3]! > 0);
  };
  const ariaHidden = (element: Element): boolean => {
    for (let current: Element | null = element; current && current !== root; current = current.parentElement) if (current.getAttribute("aria-hidden") === "true") return true;
    return false;
  };
  const selectorOf = (element: Element): string => {
    const steps: string[] = [];
    for (let current: Element | null = element; current && current !== body && current !== root; current = current.parentElement) {
      const ref = current.getAttribute("data-slot");
      if (ref && SLOT_REF.test(ref) && agents.has(ref.split("/")[0]!)) { steps.unshift(`[data-slot="${ref}"]`); return steps.join(" > "); }
      const tag = current.tagName.toLowerCase();
      if (current.id) { steps.unshift(`${tag}#${current.id}`); return steps.join(" > "); }
      const parent: Element | null = current.parentElement;
      const same = parent ? Array.from(parent.children).filter(child => child.tagName === current!.tagName) : [];
      steps.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(current) + 1})` : tag);
    }
    steps.unshift("body");
    return steps.join(" > ");
  };
  const add = (rule: string, element: Element, message: string, extra: { evidence?: string; copy?: string } = {}): void => {
    const copy = rule === "RENDER_COPY_UNKEYED" || rule === "RENDER_COPY_UNRESOLVED";
    const slot = copy ? slotOf(element, "writer") : slotOf(element);
    findings.push({
      rule, slot, agent: copy ? "writer" : agentOf(slot), selector: selectorOf(element), message,
      ...(extra.evidence !== undefined ? { evidence: clip(extra.evidence) } : {}), ...(extra.copy !== undefined ? { copyKey: extra.copy } : {}),
    });
  };

  // The accessible name, as far as markup decides it (aria-labelledby, aria-label, label, alt, value, subtree, title).
  const subtreeName = (element: Element): string => {
    let out = "";
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === 3) out += node.textContent ?? "";
      else if (node.nodeType === 1) {
        const child = node as Element;
        if (child.getAttribute("aria-hidden") === "true" || SKIP.has(child.tagName) || child.hasAttribute("data-render-hidden") || child.hasAttribute("hidden")) continue;
        const label = child.getAttribute("aria-label");
        if (label && clean(label)) { out += ` ${label} `; continue; }
        if (child.tagName === "IMG") { out += ` ${child.getAttribute("alt") ?? ""} `; continue; }
        if (child.tagName.toLowerCase() === "svg") { out += ` ${child.querySelector("title")?.textContent ?? ""} `; continue; }
        out += ` ${subtreeName(child)} `;
      }
    }
    return clean(out);
  };
  const nameOf = (element: Element): string => {
    const labelledby = element.getAttribute("aria-labelledby");
    if (labelledby) {
      const text = clean(labelledby.split(/\s+/).map(id => { const target = doc.getElementById(id); return target ? subtreeName(target) || clean(target.getAttribute("aria-label") ?? "") : ""; }).join(" "));
      if (text) return text;
    }
    const label = clean(element.getAttribute("aria-label") ?? "");
    if (label) return label;
    const tag = element.tagName;
    if (tag === "IMG") return clean(element.getAttribute("alt") ?? "");
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
      const type = (element.getAttribute("type") ?? "").toLowerCase();
      if (tag === "INPUT" && ["submit", "button", "reset"].includes(type)) { const value = clean(element.getAttribute("value") ?? ""); if (value) return value; }
      if (tag === "INPUT" && type === "image") { const alt = clean(element.getAttribute("alt") ?? ""); if (alt) return alt; }
      const id = element.getAttribute("id");
      const labels = id ? Array.from(doc.querySelectorAll("label")).filter(item => item.getAttribute("for") === id) : [];
      const wrapping = element.closest("label");
      const text = clean([...labels, ...(wrapping ? [wrapping] : [])].map(item => subtreeName(item)).join(" "));
      if (text) return text;
    } else if (tag.toLowerCase() === "svg") {
      const title = clean(element.querySelector("title")?.textContent ?? "");
      if (title) return title;
    } else {
      const text = subtreeName(element);
      if (text) return text;
    }
    return clean(element.getAttribute("title") ?? "");
  };

  const elements = Array.from(body.querySelectorAll("*"));
  const unattributed = new Set<Element>();
  const claim = (element: Element): void => {
    if (slotOf(element) !== null) return;
    let top: Element = element;
    while (top.parentElement && top.parentElement !== body && top.parentElement !== root) top = top.parentElement;
    unattributed.add(top);
  };

  // Icons: an svg, a [data-icon] or a role=img element that paints nothing.
  const DRAWN = "path[d]:not([d='']),circle,rect,ellipse,line,polyline[points],polygon[points],use,image,text,foreignObject";
  for (const element of elements) {
    // An icon that paints nothing may lay out at 0x0; only markup or style hiding it takes it out of the audit.
    if (!displayed(element)) continue;
    const svg = element.tagName.toLowerCase() === "svg";
    const icon = svg || element.hasAttribute("data-icon") || (element.getAttribute("role") === "img" && element.tagName !== "IMG");
    if (!icon || (svg && element.parentElement?.closest("svg"))) continue;
    claim(element);
    const paints = svg
      ? Array.from(element.querySelectorAll(DRAWN)).some(shape => shape.tagName.toLowerCase() !== "text" || clean(shape.textContent ?? "") !== "")
      : element.hasAttribute("data-render-paint")
        || Array.from(element.querySelectorAll("svg")).some(inner => inner.querySelector(DRAWN) !== null)
        || element.querySelector("img") !== null || clean(element.textContent ?? "") !== "";
    if (!paints) add("RENDER_EMPTY_ICON", element, "An icon renders empty: it has no drawn shape, image, glyph or painted background.", { evidence: element.outerHTML });
  }

  // Interactive elements and images without an accessible name.
  const ROLES = new Set(["button", "link", "checkbox", "radio", "switch", "tab", "menuitem", "option", "combobox", "textbox", "slider"]);
  for (const element of elements) {
    if (!shown(element) || ariaHidden(element)) continue;
    const tag = element.tagName;
    const type = (element.getAttribute("type") ?? "").toLowerCase();
    const interactive = (tag === "A" && element.hasAttribute("href")) || tag === "BUTTON" || (tag === "INPUT" && type !== "hidden") || tag === "SELECT" || tag === "TEXTAREA" || tag === "SUMMARY"
      || ROLES.has(element.getAttribute("role") ?? "");
    const image = tag === "IMG" || (tag.toLowerCase() === "svg" && element.getAttribute("role") === "img");
    if (!interactive && !image) continue;
    claim(element);
    if (tag === "IMG" && element.hasAttribute("alt") && !interactive) continue; // alt="" marks a decorative image
    if (nameOf(element)) continue;
    add("RENDER_NO_NAME", element, interactive ? `A ${element.getAttribute("role") ?? tag.toLowerCase()} has no accessible name.` : "An image has no text alternative (no alt attribute).", { evidence: element.outerHTML });
  }

  // Overflow, blamed on its cause: first what runs past the viewport's right edge (the outermost such element), then
  // content spilling out of its own box, unless the spill is explained by a descendant already reported above.
  const overflowing = new Set<Element>();
  const inside = (element: Element): boolean => {
    for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
      // An ancestor already reported, or one that clips or scrolls horizontally (its own spill is its finding).
      if (overflowing.has(parent) || parent.hasAttribute("data-render-clips")) return true;
    }
    return false;
  };
  for (const element of elements) {
    const rect = box(element);
    if (!shown(element) || rect === null || rect[0]! + rect[2]! <= width + 1 || inside(element)) continue;
    overflowing.add(element);
    add("RENDER_OVERFLOW", element, `The element runs past the ${width}px viewport's right edge.`, { evidence: `right edge ${rect[0]! + rect[2]!}px > ${width}px` });
  }
  const past = [...overflowing];
  for (const element of elements) {
    const spill = element.getAttribute("data-render-spill");
    if (spill === null || !shown(element) || overflowing.has(element) || inside(element) || past.some(item => element.contains(item))) continue;
    const [scroll, client] = spill.split(" ");
    overflowing.add(element);
    add("RENDER_OVERFLOW", element, "The element's content is wider than its box.", { evidence: `content ${scroll}px in ${client}px` });
  }

  // Glyphs, copy keys and attribution, per visible text run.
  const GLYPH = /�|[-]|&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/i;
  const seenGlyph = new Set<Element>(), seenUnkeyed = new Set<Element>();
  const walker = doc.createTreeWalker(body, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    const text = clean(node.textContent ?? "");
    if (!parent || !text || !shown(parent) || parent.closest("svg")) continue;
    claim(parent);
    const glyph = GLYPH.exec(text);
    if (glyph && !seenGlyph.has(parent)) {
      seenGlyph.add(parent);
      add("RENDER_GLYPH", parent, "Visible text holds a glyph that does not render as text (a replacement character, a private-use code point, or an escaped entity).", { evidence: `U+${(glyph[0].codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")} in "${text}"` });
    }
    if (!/[\p{L}\p{N}]/u.test(text)) continue;
    if (!parent.closest("[data-copy]") && !seenUnkeyed.has(parent)) {
      seenUnkeyed.add(parent);
      add("RENDER_COPY_UNKEYED", parent, "Visible text is not bound to a Writer copy key (no data-copy ancestor).", { evidence: text });
    }
  }
  for (const element of Array.from(body.querySelectorAll("[data-copy]"))) {
    if (!shown(element)) continue;
    const key = element.getAttribute("data-copy") ?? "";
    const text = clean(element.textContent ?? "");
    if (!key || !text || text === key) add("RENDER_COPY_UNRESOLVED", element, !key ? "A data-copy attribute names no key." : !text ? `Copy key ${key} renders no text.` : `Copy key ${key} renders as its own key.`, { evidence: text || key, copy: key });
  }
  for (const element of unattributed) add("RENDER_SLOT_UNATTRIBUTED", element, "Visible content sits under no data-slot=\"<agent>/<slot>\": no slot owns it.", { evidence: clean(element.textContent ?? "") || element.tagName.toLowerCase() });

  const order = new Map(elements.map((element, index) => [selectorOf(element), index]));
  return (findings as RenderFinding[]).sort((a, b) => (order.get(a.selector) ?? -1) - (order.get(b.selector) ?? -1) || a.rule.localeCompare(b.rule));
}

/** The expression the browser evaluates to measure a page (Playwright `page.evaluate(string)`). */
export const MEASURE_EXPRESSION = `(${measureRender.toString()})()`;

/** The expression the browser evaluates to audit the measured page; returns the findings and the capture's HTML. */
export const auditExpression = (options: RenderAuditOptions): string =>
  `(() => ({ findings: (${auditRender.toString()})(document, ${JSON.stringify(options)}), html: "<!doctype html>\\n" + document.documentElement.outerHTML }))()`;
