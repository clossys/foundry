import type { StatGroupItem } from "../../blocks/StatGroup.js";
import { StatGroupSurface } from "../../blocks/Stats/surface.js";
import type { StatTrendLabels } from "../../blocks/Stat.js";
import { stateOf, type GroupBSection, type SectionRenderInput } from "./group-b-support.js";
import { isObject, recordsOf, slotValue } from "./group-c-content.js";
export interface StatsCopy {
  readonly label: string;
  readonly trendLabels: StatTrendLabels;
  readonly states?: Readonly<Record<"loading" | "empty" | "error", { readonly label: string; readonly description?: string }>>;
}
const needed = (path: string): never => { throw new TypeError(`NEED sections.stats ${path}`); };
function copyText(value: unknown, path: string): string {
  return typeof value === "string" && value.trim() ? value : needed(path);
}

/** Caller-owned Writer copy and behavior; no specimen or English fallback enters selected runtime. */
function statsHost(input: SectionRenderInput): { copy: object; label: string; trendLabels: StatTrendLabels; motion: "static" | "count" | undefined } {
  const copy = input.sectionHost?.statsCopy;
  if (!copy || typeof copy !== "object" || !("label" in copy) || !("trendLabels" in copy)) return needed("statsCopy host port");
  const directions = copy.trendLabels;
  if (!directions || typeof directions !== "object" || !("up" in directions) || !("down" in directions) || !("neutral" in directions)) return needed("statsCopy.trendLabels");
  const label = copyText(copy.label, "statsCopy.label");
  const trendLabels = { up: copyText(directions.up, "statsCopy.trendLabels.up"), down: copyText(directions.down, "statsCopy.trendLabels.down"), neutral: copyText(directions.neutral, "statsCopy.trendLabels.neutral") };
  const motion = input.sectionHost?.statsMotion;
  if (motion !== undefined && motion !== "static" && motion !== "count") return needed("statsMotion static or count");
  return { copy, label, trendLabels, motion };
}

/** sections.stats: each stat renders one Stat; the selected `layout` member picks grid or row. */
export function renderStats(input: SectionRenderInput) {
  if (input.fill.leaf !== "sections.stats" || input.selection.leaf !== "sections.stats") return needed("matching selected leaf");
  const members = input.selection.members;
  if (members.length > 1 || members.some(member => member !== "layout.row" && member !== "layout.grid")) return needed("one supported layout member");
  const host = statsHost(input), state = stateOf(input);
  if (state !== "default") {
    const states = "states" in host.copy ? host.copy.states : undefined;
    const message = states && typeof states === "object" && state in states ? Reflect.get(states, state) : undefined;
    if (!message || typeof message !== "object") return needed(`statsCopy.states.${state}`);
    const label = copyText(Reflect.get(message, "label"), `statsCopy.states.${state}.label`);
    const description = Reflect.get(message, "description");
    if (description !== undefined) copyText(description, `statsCopy.states.${state}.description`);
    return <StatGroupSurface mode="state" label={host.label} state={state} stateLabel={label} description={description as string | undefined} />;
  }
  if (!Object.hasOwn(input.content, "stats")) return needed("stats records");
  const items: StatGroupItem[] = recordsOf("sections.stats", "stats", slotValue(input, "stats")).map((row, index) => {
    const path = `stats.${index}`;
    const trend = row.trend;
    if (trend !== undefined && trend !== "up" && trend !== "down" && trend !== "neutral") return needed(`${path}.trend`);
    if (typeof row.value !== "string" && typeof row.value !== "number") return needed(`${path}.value`);
    if (typeof row.value === "number" && !Number.isFinite(row.value)) return needed(`${path}.value finite number`);
    if (row.countTo !== undefined && (typeof row.countTo !== "number" || !Number.isFinite(row.countTo))) return needed(`${path}.countTo finite number`);
    if (row.trendLabels !== undefined && !isObject(row.trendLabels)) return needed(`${path}.trendLabels`);
    return { id: copyText(row.id, `${path}.id`), label: copyText(row.label, `${path}.label`), value: row.value,
      ...(row.delta === undefined ? {} : { delta: copyText(row.delta, `${path}.delta`) }),
      ...(row.description === undefined ? {} : { description: copyText(row.description, `${path}.description`) }),
      ...(trend === undefined ? {} : { trend }), ...(typeof row.countTo === "number" ? { countTo: row.countTo } : {}), trendLabels: host.trendLabels };
  });
  return <StatGroupSurface mode="measurements" props={{ "aria-label": host.label, layout: members.includes("layout.row") ? "row" : "grid", motion: host.motion, items }} />;
}

export const statsSection: GroupBSection = { leaf: "sections.stats", slots: ["stats"], render: renderStats };
