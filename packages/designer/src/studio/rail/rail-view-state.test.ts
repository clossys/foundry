import { describe, expect, it } from "vitest";
import { DEFAULT_RAIL_VIEW, parseRailView, RAIL_CARDS, RAIL_VIEW_KEY, readRailView, writeRailView } from "./rail-view-state.js";

/** A Web Storage stand-in; the rail persists through the package's try/catch Web Storage pattern. */
function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, data };
}
const throwing = { getItem: (): string | null => { throw new Error("SecurityError"); }, setItem: (): void => { throw new Error("QuotaExceededError"); } };

describe("rail view state", () => {
  it("names the four cards in rail order", () => {
    expect(RAIL_CARDS).toEqual(["explorer", "map", "zoom", "checks"]);
  });
  it("round-trips hidden and collapsed state through the store", () => {
    const store = memoryStore();
    writeRailView({ hidden: true, collapsed: ["zoom", "explorer"] }, store);
    expect(JSON.parse(store.data.get(RAIL_VIEW_KEY)!)).toEqual({ version: 2, hidden: true, collapsed: ["explorer", "zoom"] });
    expect(readRailView(store)).toEqual({ hidden: true, collapsed: ["explorer", "zoom"] });
  });
  it("defaults when nothing is stored, and tolerates malformed or foreign values", () => {
    expect(readRailView(memoryStore())).toEqual(DEFAULT_RAIL_VIEW);
    expect(parseRailView("not json")).toEqual(DEFAULT_RAIL_VIEW);
    expect(parseRailView(JSON.stringify({ hidden: "yes", collapsed: ["zoom", "bogus", 3, "zoom"] }))).toEqual({ hidden: false, collapsed: ["zoom", "checks"] });
    expect(parseRailView(null)).toEqual(DEFAULT_RAIL_VIEW);
  });
  it("degrades gracefully when the store is missing or throws", () => {
    expect(readRailView(null)).toEqual(DEFAULT_RAIL_VIEW);
    expect(readRailView(throwing)).toEqual(DEFAULT_RAIL_VIEW);
    expect(() => writeRailView({ hidden: true, collapsed: [] }, throwing)).not.toThrow();
    expect(() => writeRailView({ hidden: true, collapsed: [] }, null)).not.toThrow();
  });
});
