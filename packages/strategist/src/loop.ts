import { createHash } from 'node:crypto';
import type { StrategyModel } from './format/types.js';
import { buildCitationIndex, type CitationIndex, type ScanInput } from './citations/index.js';
import { readStrategyRoot } from './store.js';
import { createRequest, listRequests } from './write/index.js';

/** Review planning is pure. Production callers supply validated active pointers,
 * findings, citation drift and existing request keys from their owning services. */
export interface ReviewInput {
  today: string;
  cells: readonly { id: string; version: number; status: string; updated: string; watch: readonly {text: string; line: number}[] }[];
  active: Readonly<Record<string, number | null>>;
  findings: readonly {id: string; observed: string; value?: string | number | boolean; unit?: string; aliases?: readonly string[]}[];
  stale: readonly {cell: string; version: number; detail: string; rule?: string}[];
  existingKeys: readonly string[];
}
export interface ReviewRequest {
  key: string;
  kind: 'tripwire' | 'reading' | 'drift';
  cells: string[];
  detail: string;
  rule: string;
  period: string;
}
export interface ReviewReport {
  requests: ReviewRequest[];
  issues: {cell: string; line: number; reason: string}[];
}
type Period = 'day' | 'week' | 'month' | 'quarter' | 'year';
export interface WatchRule {
  signal: string;
  comparator: string;
  threshold: string | number | boolean;
  unit?: string;
  schedule: 'by' | 'each' | 'in any';
  date?: string;
  period?: Period;
  action: string;
}
const DAY = 86_400_000;
const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function date(value: string): number {
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(time) || new Date(time).toISOString().slice(0,10) !== value) {
    throw new Error('Expected a valid ISO date');
  }
  return time;
}
/** Numeric thresholds accept an optional unit suffix; units do not convert.
 * Quoted thresholds use exact string equality. No prose values are inferred. */
export function parseWatch(text: string): WatchRule | undefined {
  const match = /^If (.+?) (rises above|falls below|stays below|stays above|is still|appears|reaches|>=|<=|>|<|=) (.+?) (by|each|in any) (.+?), then (.+)\.$/.exec(text.trim());
  if (!match) return undefined;
  const [, signal, comparator, rawThreshold, schedule, when, action] = match;
  if (!signal || !comparator || !rawThreshold || !when || !action) return undefined;
  const quoted = /^"([^"\n]*)"$/.exec(rawThreshold);
  const numeric = /^(-?\d+(?:\.\d+)?)([^\d]*)$/.exec(rawThreshold);
  const threshold = quoted ? quoted[1]! : numeric ? Number(numeric[1]) : rawThreshold === 'true' ? true : rawThreshold === 'false' ? false : undefined;
  if (threshold === undefined || (typeof threshold !== 'number' && !['=', 'is still', 'appears'].includes(comparator))) return undefined;
  const unit = numeric?.[2]?.trim();
  const units = unit ? {unit} : {};
  if (schedule === 'by') {
    try { date(when); } catch { return undefined; }
    return {signal, comparator, threshold, ...units, schedule, date:when, action};
  }
  if (schedule !== 'each' && schedule !== 'in any') return undefined;
  if (!['day','week','month','quarter','year'].includes(when)) return undefined;
  return {signal, comparator, threshold, ...units, schedule, period:when as Period, action};
}
function periodBounds(time: number, period: Period): [number,number] {
  const value = new Date(time);
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth();
  if (period === 'day') return [time,time+DAY];
  if (period === 'week') {
    const start = time - ((value.getUTCDay()+6)%7)*DAY;
    return [start,start+7*DAY];
  }
  if (period === 'month') return [Date.UTC(year,month,1),Date.UTC(year,month+1,1)];
  if (period === 'quarter') {
    const startMonth = Math.floor(month/3)*3;
    return [Date.UTC(year,startMonth,1),Date.UTC(year,startMonth+3,1)];
  }
  return [Date.UTC(year,0,1),Date.UTC(year+1,0,1)];
}
function compares(value: string | number | boolean | undefined, rule: WatchRule, unit?: string): boolean {
  if (typeof rule.threshold === 'number' && (unit?.trim() || undefined) !== rule.unit) return false;
  const threshold = rule.threshold;
  if (rule.comparator === '=' || rule.comparator === 'is still' || rule.comparator === 'appears' || rule.comparator === 'reaches') return value === threshold;
  if (typeof value !== 'number' || typeof threshold !== 'number' || !Number.isFinite(value)) return false;
  if (['>', 'rises above','stays above'].includes(rule.comparator)) return value > threshold;
  if (['<', 'falls below','stays below'].includes(rule.comparator)) return value < threshold;
  if (rule.comparator === '>=') return value >= threshold;
  if (rule.comparator === '<=') return value <= threshold;
  return false;
}
/** Dates are inclusive. Calendar weeks start Monday in UTC. Recurrences begin
 * on the active cell's updated date. A completed period without a matching
 * observation opens a reading request; an observed non-trigger does not.
 * `each` evaluates the latest observation; `in any` evaluates any observation
 * in that calendar period. The same unchanged rule survives version re-cites. */
export function evaluateReview(input: ReviewInput): ReviewReport {
  const today = date(input.today);
  const report: ReviewReport = {requests:[],issues:[]};
  const keys = new Set(input.existingKeys);
  const add = (request: Omit<ReviewRequest,'key'>) => {
    const key = digest(JSON.stringify([request.cells[0],request.rule,request.period]));
    if (!keys.has(key)) { keys.add(key); report.requests.push({...request,key}); }
  };
  for (const cell of input.cells) {
    if (cell.status !== 'active' || input.active[cell.id] !== cell.version) continue;
    let updated: number;
    try { updated = date(cell.updated); } catch {
      report.issues.push({cell:cell.id,line:0,reason:'Invalid cell updated date'}); continue;
    }
    if (updated > today) continue;
    for (const bullet of cell.watch) {
      const rule = parseWatch(bullet.text);
      if (!rule) { report.issues.push({cell:cell.id,line:bullet.line,reason:'Invalid or unsupported Watch rule'}); continue; }
      const ruleId = `watch:${digest(JSON.stringify(rule))}`;
      let windows: [number,number][];
      if (rule.schedule === 'by') {
        const deadline = date(rule.date!);
        if (today < deadline) continue;
        windows = [[updated,deadline+DAY]];
      } else {
        windows = [];
        let bounds = periodBounds(updated,rule.period!);
        while (bounds[0] <= today) {
          windows.push(bounds);
          bounds = periodBounds(bounds[1],rule.period!);
        }
      }
      for (const [start,end] of windows) {
        const period = rule.schedule === 'by' ? `by:${rule.date}` : `${rule.period}:${new Date(start).toISOString().slice(0,10)}`;
        const observations = input.findings.filter(finding => {
          if (![finding.id,...(finding.aliases ?? [])].some(alias=>normalize(alias)===normalize(rule.signal))) return false;
          let observed: number;
          try { observed=date(finding.observed); } catch {
            report.issues.push({cell:cell.id,line:bullet.line,reason:`Invalid observation date: ${finding.id}`}); return false;
          }
          return observed >= Math.max(start,updated) && observed < end && observed <= today;
        }).sort((a,b)=>b.observed.localeCompare(a.observed)||a.id.localeCompare(b.id));
        const evaluated = rule.schedule === 'in any' ? observations : observations.slice(0,1);
        const fired = evaluated.find(finding=>compares(finding.value,rule,finding.unit));
        if (fired) add({kind:'tripwire',cells:[cell.id],rule:ruleId,period,detail:`${bullet.text} Observed finding:${fired.id} on ${fired.observed}.`});
        else if (observations.length === 0 && (rule.schedule === 'by' || end <= today+DAY)) {
          add({kind:'reading',cells:[cell.id],rule:ruleId,period,detail:`Review due without matching evidence: ${bullet.text}`});
        }
      }
    }
  }
  for (const stale of input.stale) {
    if (input.active[stale.cell] !== stale.version) continue;
    add({kind:'drift',cells:[stale.cell],rule:`drift:${digest(stale.rule ?? stale.detail)}`,period:'citation',detail:stale.detail});
  }
  return report;
}

/** Feed active cell dependencies to the citation service using its marker
 * scan contract. Paths identify the citing cell, not the obsolete target. */
export function reviewCitationScan(model: StrategyModel): ScanInput {
  if (!model.tree || model.issues.length) throw new Error('Strategy root is unreadable or invalid');
  return {files: model.cells.filter(cell => cell.status === 'active' && model.tree!.active[cell.id] === cell.version)
    .map(cell => ({path:cell.path, content:cell.cites.filter(ref => ref.kind === 'cell').map(ref => `strategy:${ref.ref.cell}@${ref.ref.version}`).join('\n')}))};
}

/** Adapt the validated store and citation service snapshots without writing them.
 * Persistence owns stable request keys; all statuses count for deduplication. */
export function evaluateModelReview(model: StrategyModel, index: CitationIndex, options: {today: string; existingKeys?: readonly string[]}): ReviewReport {
  if (!model.tree || model.issues.length) throw new Error('Strategy root is unreadable or invalid');
  const active = model.cells.filter(cell => cell.status === 'active' && model.tree!.active[cell.id] === cell.version);
  const stale = index.stale.flatMap(entry => {
    const owner = active.find(cell => cell.path === entry.by.path);
    const cell = owner;
    return cell ? [{cell:cell.id, version:cell.version, rule:`citation:${entry.ref.cell}@${entry.ref.version}`,
      detail:`Stale citation ${entry.ref.cell}@${entry.ref.version} in ${entry.by.path}.`}] : [];
  });
  const existingKeys = [...(options.existingKeys ?? []), ...model.requests.flatMap(request =>
    [...request.detail.matchAll(/\[review:([a-f0-9]{64})\]/g)].map(match => match[1]!))];
  return evaluateReview({...options, existingKeys, cells:model.cells, active:model.tree.active, findings:model.findings, stale});
}

/** Stable marker fits the existing request schema and survives status changes. */
export function reviewRequestDetail(request: ReviewRequest): string {
  return `${request.detail} [review:${request.key}]`;
}

/** Read and evaluate the production strategy graph. This stage never writes. */
export function planReview(root: string, options: {today?: string} = {}): ReviewReport {
  const model = readStrategyRoot(root);
  const index = buildCitationIndex(model, reviewCitationScan(model));
  return evaluateModelReview(model,index,{today:options.today ?? new Date().toISOString().slice(0,10)});
}

/** Persist only requests through the owning write service. All prior statuses
 * retain their marker, so declining or resolving a request cannot reopen it. */
export function review(root: string, options: {today?: string} = {}) {
  const today = options.today ?? new Date().toISOString().slice(0,10);
  const report = planReview(root,{today});
  // Invalid rules or observation dates must be observable without partial writes.
  if (report.issues.length) return {...report, created:[]};
  const existing = new Set(listRequests(root).flatMap(request =>
    [...request.detail.matchAll(/\[review:([a-f0-9]{64})\]/g)].map(match => match[1]!)));
  const created = [];
  for (const request of report.requests) {
    if (existing.has(request.key)) continue;
    created.push(createRequest(root,{raisedBy:'strategy-loop',kind:request.kind,cells:request.cells,
      detail:reviewRequestDetail(request),today}));
    existing.add(request.key);
  }
  return {...report,created};
}
