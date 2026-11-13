const INDENT = [""];
/** Two spaces per depth, built once per depth. */
const indentAt = (depth: number): string => {
  while (INDENT.length <= depth) INDENT.push(INDENT[INDENT.length - 1] + "  ");
  return INDENT[depth]!;
};
/** Serialize JSON with object keys in UTF-16 code unit order. */
export function stableStringify(value: unknown): string {
  const unsupported = (): never => { throw new TypeError("stableStringify: unsupported value"); };
  const write = (item: unknown, depth: number): string => {
    if (item === null) return "null";
    if (typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number") return Number.isFinite(item) ? JSON.stringify(item) : unsupported();
    if (typeof item !== "object") return unsupported();
    const nested = indentAt(depth + 1);
    if (Array.isArray(item)) {
      const length = item.length;
      if (length === 0) return "[]";
      let text = "[\n";
      for (let index = 0; index < length; index++) {
        const entry: unknown = item[index];
        text += (index === 0 ? nested : ",\n" + nested) + (entry === undefined ? "null" : write(entry, depth + 1));
      }
      return text + "\n" + indentAt(depth) + "]";
    }
    const object = item as Record<string, unknown>;
    const keys: string[] = [];
    for (const key of Object.keys(object)) if (object[key] !== undefined) keys.push(key);
    if (keys.length === 0) return "{}";
    // The default sort compares strings by UTF-16 code units; keys are unique.
    keys.sort();
    let text = "{\n";
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index]!;
      text += (index === 0 ? nested : ",\n" + nested) + JSON.stringify(key) + ": " + write(object[key], depth + 1);
    }
    return text + "\n" + indentAt(depth) + "}";
  };
  return write(value, 0) + "\n";
}
