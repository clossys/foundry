/** Workspace-relative globs: `*` within a segment, `**` across segments, an optional `#field` carve-out. */
export const PACKAGE_REL = "packages/producer";

export interface Glob { readonly path: string; readonly field: string | null; readonly arg: boolean }

export function parseGlob(glob: string, packageRel = PACKAGE_REL): Glob {
  if (glob.startsWith("arg:")) return { path: glob, field: null, arg: true };
  const at = glob.indexOf("#");
  const raw = at < 0 ? glob : glob.slice(0, at);
  return { path: raw.startsWith("pkg:") ? `${packageRel}/${raw.slice(4)}` : raw, field: at < 0 ? null : glob.slice(at + 1), arg: false };
}

const escape = (text: string) => text.replace(/[.+^$()|[\]\\{}?]/g, "\\$&");

export function globRegex(path: string): RegExp {
  const parts = path.split("/").map(segment => segment === "**" ? null : segment.split("*").map(escape).join("[^/]*"));
  let out = "";
  parts.forEach((part, index) => {
    const last = index === parts.length - 1;
    if (part === null) out += last ? ".*" : "(?:[^/]+/)*";
    else out += part + (last ? "" : "/");
  });
  return new RegExp(`^${out}$`);
}

/** Two single-segment patterns (`*` only) admit a common string. */
function segmentsOverlap(a: string, b: string): boolean {
  const memo = new Map<string, boolean>();
  const go = (i: number, j: number): boolean => {
    const key = `${i},${j}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let result: boolean;
    if (i === a.length && j === b.length) result = true;
    else if (i < a.length && a[i] === "*") result = go(i + 1, j) || (j < b.length && go(i, j + 1));
    else if (j < b.length && b[j] === "*") result = go(i, j + 1) || (i < a.length && go(i + 1, j));
    else result = i < a.length && j < b.length && a[i] === b[j] && go(i + 1, j + 1);
    memo.set(key, result);
    return result;
  };
  return go(0, 0);
}

/** Two path globs admit a common path: segment-wise, with `**` matching any number of segments. */
export function pathsOverlap(a: string, b: string): boolean {
  const x = a.split("/"), y = b.split("/");
  const memo = new Map<string, boolean>();
  const go = (i: number, j: number): boolean => {
    const key = `${i},${j}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let result: boolean;
    if (i === x.length && j === y.length) result = true;
    else if (i < x.length && x[i] === "**") result = go(i + 1, j) || (j < y.length && go(i, j + 1));
    else if (j < y.length && y[j] === "**") result = go(i, j + 1) || (i < x.length && go(i + 1, j));
    else result = i < x.length && j < y.length && segmentsOverlap(x[i]!, y[j]!) && go(i + 1, j + 1);
    memo.set(key, result);
    return result;
  };
  return go(0, 0);
}

/** An output feeds an input when their paths overlap and their fields do not exclude each other. */
export function portsOverlap(output: string, input: string, packageRel = PACKAGE_REL): boolean {
  const out = parseGlob(output, packageRel), inp = parseGlob(input, packageRel);
  if (out.arg || inp.arg) return false;
  if (out.field !== null && inp.field !== null && out.field !== inp.field) return false;
  return pathsOverlap(out.path, inp.path);
}

/** The literal directory a glob is rooted at (the segments before the first wildcard). */
export function staticPrefix(path: string): string {
  const segments = path.split("/");
  const index = segments.findIndex(segment => segment.includes("*"));
  return (index < 0 ? segments.slice(0, -1) : segments.slice(0, index)).join("/");
}
