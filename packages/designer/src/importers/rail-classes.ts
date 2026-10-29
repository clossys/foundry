import bindings from "./rail-token-bindings.json" with { type: "json" };

/** Adapt utilities after token rewriting; attribute values retain their upstream identity. */
function split(value: string): [string, string] {
  let depth = 0, boundary = -1;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "[" || value[index] === "(") depth++;
    if (value[index] === "]" || value[index] === ")") depth--;
    if (value[index] === ":" && depth === 0) boundary = index;
  }
  return [value.slice(0, boundary + 1), value.slice(boundary + 1)];
}

export function adaptRailClasses(source: string, sidebar = false): string {
  return source.replace(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, quoted => {
    if (quoted.startsWith("/")) return quoted;
    const text = quoted.slice(1, -1);
    if (!/\s|^(?:group|peer)$|(?:^|:)(?:(?:group|peer)-data-\[|-?(?:[mp][lr]|left|right)-|text-(?:left|right)|border-[lr]|rounded-[tb]?[lr]|animate-|transition|duration-)/.test(text) || /^\.\.?\//.test(text)) return quoted;
    const values = text.split(/\s+/).flatMap(value => {
      if (sidebar && (value === "group" || value === "peer")) return [];
      let [prefix, base] = split(value);
      const group: string[] = [], peer: string[] = [];
      if (sidebar) prefix = prefix.replace(/(group|peer)-data-\[([^=\]]+)=([^\]]+)\]:/g, (_match, kind: string, key: string, state: string) => {
        (kind === "group" ? group : peer).push(`[data-${key}=${state}]`); return "";
      });
      if (group.length) prefix += `[[data-slot=sidebar]${group.join("")}_&]:`;
      if (peer.length) prefix += `[[data-slot=sidebar]${peer.join("")}~&]:`;
      base = base.replace(/^(-?)([mp])([lr])-/, (_match, sign: string, axis: string, side: string) => `${sign}${axis}${side === "l" ? "s" : "e"}-`)
        .replace(/^(-?)(left|right)-/, (_match, sign: string, side: string) => `${sign}${side === "left" ? "start" : "end"}-`)
        .replace(/^text-(left|right)$/, (_match, side: string) => `text-${side === "left" ? "start" : "end"}`)
        .replace(/^border-([lr])(?=-|$)/, (_match, side: string) => `border-${side === "l" ? "s" : "e"}`)
        .replace(/^rounded-([lr])(?=-|$)/, (_match, side: string) => `rounded-${side === "l" ? "s" : "e"}`)
        .replace(/^rounded-([tb])([lr])(?=-|$)/, (_match, block: string, side: string) => `rounded-${block === "t" ? "s" : "e"}${side === "l" ? "s" : "e"}`)
        .replace(/^transition-\[left,right,width\]$/, "transition-[inset-inline-start,inset-inline-end,width]");
      for (const row of bindings.variables) base = base.replaceAll(row.input, row.property);
      const centeredOnStart = /(?:^|\s)(?:after:)?(?:left|start)-1\/2(?:\s|$)/.test(text);
      if (centeredOnStart && base === "-translate-x-1/2") {
        if (!prefix) return ["ltr:-translate-x-1/2", "rtl:translate-x-1/2"];
        if (prefix === "rtl:") return ["rtl:translate-x-1/2"];
      }
      if (/data-\[side=(?:left|right)\]/.test(prefix) && /^-?translate-x-/.test(base)) {
        // Physical enum values name logical start/end after adaptation; horizontal travel mirrors with them.
        const positive = base.replace(/^-/, "");
        const ltr = base.startsWith("-") ? `-${positive}` : positive;
        const rtl = base.startsWith("-") ? positive : `-${positive}`;
        return [`${prefix}ltr:${ltr}`, `${prefix}rtl:${rtl}`];
      }
      if (/^(?:animate-|transition(?:-|$)|duration-)/.test(base)) {
        return [`${prefix}motion-safe:${base}`, "motion-reduce:transition-none", "motion-reduce:animate-none", "motion-reduce:duration-0"];
      }
      return [prefix + base];
    });
    return quoted[0] + [...new Set(values)].join(" ") + quoted[0];
  });
}
