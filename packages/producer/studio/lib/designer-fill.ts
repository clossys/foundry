import { stripFrontMatter } from './studio-text';

export interface DesignerTokenValue { token: string; step: string; type?: string; value: string; dark?: string; color: boolean }
export interface DesignerFill { layer: string; tokens: DesignerTokenValue[]; composes: string[]; members: string[]; slots: [string, string][]; reads: string[]; implementation?: string; source?: string; trust?: string; status?: string; conforms: string[] }

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab|color-mix)\(.+\))$/i;

function display(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (object(value) && (typeof value.value === 'number' || typeof value.value === 'string')) return `${value.value}${typeof value.unit === 'string' ? value.unit : ''}`;
  return JSON.stringify(value);
}

/** Read the JSON block under `## Fill` in a Designer cell. Malformed fills return undefined. */
export function designerFill(source: string, layer: string): DesignerFill | undefined {
  const fill = /(?:^|\n)## Fill\s*\n([\s\S]*?)(?=\n## |$)/.exec(stripFrontMatter(source))?.[1];
  const json = fill && /```json\s*\n([\s\S]*?)\n```/.exec(fill)?.[1];
  if (!json) return undefined;
  let value: unknown;
  try { value = JSON.parse(json); } catch { return undefined; }
  if (!object(value)) return undefined;
  const meta = object(value.$extensions) && object(value.$extensions['com.clossys.fill']) ? value.$extensions['com.clossys.fill'] : {};
  const result: DesignerFill = {
    layer,
    tokens: [],
    composes: [],
    members: [],
    slots: [],
    reads: [],
    conforms: Array.isArray(meta.conforms) ? meta.conforms.filter((entry): entry is string => typeof entry === 'string') : [],
    ...(typeof meta.source === 'string' ? { source: meta.source } : {}),
    ...(typeof meta.trust === 'string' ? { trust: meta.trust } : {}),
    ...(typeof meta.status === 'string' ? { status: meta.status } : {}),
  };
  if (object(value.tokens)) {
    for (const [token, steps] of Object.entries(value.tokens)) {
      if (!object(steps)) continue;
      for (const [step, entry] of Object.entries(steps)) {
        if (!object(entry)) continue;
        const extensions = object(entry.$extensions) ? entry.$extensions : {};
        const css = object(extensions['com.clossys.css']) && typeof extensions['com.clossys.css'].raw === 'string' ? extensions['com.clossys.css'].raw : undefined;
        const modes = object(extensions['com.clossys.modes']) ? extensions['com.clossys.modes'] : {};
        const shown = css ?? display(entry.$value);
        const dark = typeof modes.dark === 'string' ? modes.dark : undefined;
        result.tokens.push({ token, step, ...(typeof entry.$type === 'string' ? { type: entry.$type } : {}), value: shown, ...(dark ? { dark } : {}), color: entry.$type === 'color' || COLOR.test(shown) });
      }
    }
  }
  for (const group of ['sections', 'frames', 'components'] as const) {
    const entries = value[group];
    if (!object(entries)) continue;
    for (const entry of Object.values(entries)) {
      if (!object(entry)) continue;
      if (Array.isArray(entry.composes)) for (const part of entry.composes) if (typeof part === 'string' && !result.composes.includes(part)) result.composes.push(part);
      if (Array.isArray(entry.members)) for (const member of entry.members) if (typeof member === 'string' && !result.members.includes(member)) result.members.push(member);
      if (object(entry.slots)) for (const [slot, port] of Object.entries(entry.slots)) if (typeof port === 'string') result.slots.push([slot, port]);
      if (object(entry.reads)) for (const list of Object.values(entry.reads)) if (Array.isArray(list)) for (const read of list) if (typeof read === 'string' && !result.reads.includes(read)) result.reads.push(read);
      if (object(entry.impl) && typeof entry.impl.export === 'string') result.implementation = typeof entry.impl.module === 'string' ? `${entry.impl.export} from ${entry.impl.module}` : entry.impl.export;
    }
  }
  return result;
}

/** Designer cells have no authored tree; their layer is the identity prefix. */
export function designerLayer(id: string): string { return id.split('.')[0] ?? id; }
