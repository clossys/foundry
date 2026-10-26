/** Serialize JSON with object keys in UTF-16 code unit order. */
export function stableStringify(value: unknown): string {
  const unsupported = (): never => { throw new TypeError("stableStringify: unsupported value"); };
  const write = (item: unknown, depth: number): string => {
    if (item === null) return "null";
    if (typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number") return Number.isFinite(item) ? JSON.stringify(item) : unsupported();
    if (typeof item !== "object") return unsupported();
    const indent = "  ".repeat(depth);
    const nested = "  ".repeat(depth + 1);
    if (Array.isArray(item)) {
      if (item.length === 0) return "[]";
      return "[\n" + Array.from(item, entry => nested + (entry === undefined ? "null" : write(entry, depth + 1))).join(",\n") + "\n" + indent + "]";
    }
    const object = item as Record<string, unknown>;
    const keys = Object.keys(object).filter(key => object[key] !== undefined).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    if (keys.length === 0) return "{}";
    return "{\n" + keys.map(key => nested + JSON.stringify(key) + ": " + write(object[key], depth + 1)).join(",\n") + "\n" + indent + "}";
  };
  return write(value, 0) + "\n";
}
