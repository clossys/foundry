/**
 * token.dtcg: a theme candidate carries its value as a DTCG token file `clossys/<slot>.json`
 * (`<layer>.<leaf>.<member>` with `$type` and `$value`), every member on one `$type`, every mode the
 * standard names present on every member and in the shadcn `cssVars`, and each member's provenance.
 */
import { isRecord, strings } from "../../core/lib.js";
import type { Criterion } from "../../core/types.js";
import { filesOf, itemOf, metaOf } from "./lib.js";

/** The DTCG members of a token file: `{path, token}` for each object with `$value`, at any depth. */
function members(value: unknown, at: string[] = []): { path: string; token: Record<string, unknown> }[] {
  if (!isRecord(value)) return [];
  if ("$value" in value) return [{ path: at.join("."), token: value }];
  return Object.entries(value).filter(([key]) => !key.startsWith("$")).flatMap(([key, item]) => members(item, [...at, key]));
}

/**
 * token.dtcg: the candidate has `clossys/<meta.slot>.json`; it parses and holds at least one member;
 * all members share one `$type` (equal to `params.type` when set); for every mode of `params.modes`
 * past the first, each member carries `$extensions["com.clossys.modes"][mode]`, and when the item has
 * `cssVars` for the first mode it has the same variables for every listed mode; with
 * `params.provenance` true, each member carries `$extensions["com.clossys.provenance"]`.
 */
export const tokenDtcg: Criterion = (subject, params) => {
  const slot = typeof metaOf(subject)?.slot === "string" ? metaOf(subject)!.slot as string : undefined;
  if (!slot) return ["meta.slot is missing"];
  const path = `clossys/${slot}.json`;
  const file = filesOf(subject).find(item => item.path === path);
  if (!file) return [`no token file ${path}`];
  let doc: unknown;
  try { doc = JSON.parse(file.content); } catch (error) { return [`${path} is not JSON: ${(error as Error).message}`]; }
  const found = members(doc);
  if (!found.length) return [`${path} holds no DTCG member ($value)`];
  const failures: string[] = [];
  const types = new Set(found.map(item => item.token.$type));
  if (types.size !== 1 || typeof [...types][0] !== "string") failures.push(`members carry $type ${[...types].map(String).join(", ")}; one $type per token slot`);
  if (typeof params.type === "string" && !types.has(params.type)) failures.push(`$type is ${[...types].map(String).join(", ")}, not ${params.type}`);
  const modes = strings(params.modes);
  for (const item of found) {
    const ext = isRecord(item.token.$extensions) ? item.token.$extensions : {};
    const byMode = isRecord(ext["com.clossys.modes"]) ? ext["com.clossys.modes"] : {};
    for (const mode of modes.slice(1)) if (byMode[mode] === undefined) failures.push(`${item.path} has no ${mode} value ($extensions.com.clossys.modes.${mode})`);
    if (params.provenance === true && !isRecord(ext["com.clossys.provenance"])) failures.push(`${item.path} has no $extensions.com.clossys.provenance`);
  }
  const cssVars = itemOf(subject)?.cssVars;
  if (modes.length > 1 && isRecord(cssVars) && isRecord(cssVars[modes[0]!])) {
    const base = Object.keys(cssVars[modes[0]!] as Record<string, unknown>).sort().join(",");
    for (const mode of modes.slice(1)) {
      const other = isRecord(cssVars[mode]) ? Object.keys(cssVars[mode] as Record<string, unknown>).sort().join(",") : undefined;
      if (other !== base) failures.push(`cssVars.${mode} ${other === undefined ? "is missing" : `sets ${other || "nothing"}`}; cssVars.${modes[0]} sets ${base}`);
    }
  }
  return failures;
};
