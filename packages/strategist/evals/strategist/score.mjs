import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const rubric = JSON.parse(readFileSync(new URL('./rubric.json', import.meta.url), 'utf8'));
const refPattern = /^[a-z]+(?:-[a-z]+)*\.[a-z]+(?:-[a-z]+)*\.[a-z]+(?:-[a-z]+)*@[1-9]\d*$/;
const refsIn = text => text.match(/[a-z]+(?:-[a-z]+)*\.[a-z]+(?:-[a-z]+)*\.[a-z]+(?:-[a-z]+)*@[1-9]\d*/g) ?? [];
function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
function count(value, name) {
  requireValue(Number.isSafeInteger(value) && value >= 0, `Invalid count: ${name}`);
  return value;
}
function rate(value, name) {
  count(value?.passed, `${name}.passed`); count(value?.total, `${name}.total`);
  requireValue(value.total > 0 && value.passed <= value.total, `Invalid measured total: ${name}`);
  return value.passed / value.total;
}
const rateScore = value => value === 1 ? 2 : value >= 0.8 ? 1 : 0;
const cellId = ref => ref.slice(0, ref.lastIndexOf('@'));

// Session authenticity remains trust-based (SPEC R7). This checks recorded ordering
// and exact listed refs; it never asserts that an authored fixture was a live run.
function confirmed(activation, transcript) {
  const index = transcript.findIndex(t => t.id === activation.confirm);
  const after = transcript.findIndex(t => t.id === activation.after);
  const user = transcript[index];
  const playback = transcript[index - 1];
  if (index < 1 || after < index || !user.id.startsWith('U') || !playback.id.startsWith('S')) return false;
  const listing = playback.text.match(/Playback for confirm:\s*(.*)/i)?.[1];
  if (!listing) return false;
  const refs = refsIn(listing);
  const position = refs.indexOf(activation.ref);
  if (position < 0) return false;
  const answer = user.text.trim().replace(/[.!]+$/, '');
  if (/^yes(?:,? (?:both|all|to both|to all|to the listed batch only))?$/i.test(answer)) return true;
  const except = answer.match(/^yes[,]? except (\d+(?:\s*,\s*\d+)*)$/i);
  if (!except) return false;
  const excluded = except[1].split(',').map(Number);
  return excluded.every(n => n > 0 && n <= refs.length) && !excluded.includes(position + 1);
}

export function scoreRun(run) {
  requireValue(run.schemaVersion === 1 && ['fixture', 'live'].includes(run.kind), 'Invalid run schema or kind');
  requireValue(Array.isArray(run.transcript) && run.transcript.length > 0, 'Missing transcript');
  const turns = new Set();
  for (const turn of run.transcript) {
    requireValue(/^[US][1-9]\d*$/.test(turn.id) && typeof turn.text === 'string' && !turns.has(turn.id), 'Invalid or duplicate transcript line');
    turns.add(turn.id);
  }
  const users = run.transcript.filter(t => t.id.startsWith('U')).length;
  requireValue(users > 0, 'No user turns');
  for (const key of ['activations', 'requiredActive', 'forbiddenActive', 'active']) requireValue(Array.isArray(run[key]), `Missing ${key}`);
  requireValue(run.requiredActive.length > 0 && new Set(run.requiredActive).size === run.requiredActive.length, 'Invalid required scope');
  for (const ref of run.active) requireValue(refPattern.test(ref), 'Invalid active ref');
  for (const a of run.activations) requireValue(refPattern.test(a.ref), 'Invalid activation ref');
  requireValue(new Set(run.active.map(cellId)).size === run.active.length, 'Multiple active versions');
  requireValue(run.measurements?.evidence?.length > 0, 'Missing measurement evidence');
  if (run.kind === 'live') {
    requireValue(run.provenance?.capture === 'native-session' && run.provenance?.strategistTier === 'high' && run.provenance?.userTier === 'mid', 'Live runtime provenance required');
    requireValue(run.judge?.kind === 'fresh-high' && run.judge?.session && run.judge.session !== run.provenance.strategistSession && run.judge.session !== run.provenance.userSession, 'Live judge must be fresh high context');
    requireValue(run.provenance.strategistSession && run.provenance.userSession && run.provenance.strategistSession !== run.provenance.userSession, 'Separate native runtime sessions required');
    requireValue(run.measurements.source === 'strategist-check' && run.measurements.capture, 'CLI measurement capture required');
  } else requireValue(run.judge?.kind === 'fixture', 'Fixture judge provenance required');
  if (run.kind === 'live') {
    requireValue(/^[a-z]+(?:-[a-z]+)*$/.test(run.business), 'Invalid business');
    const expected = JSON.parse(readFileSync(new URL(`./${run.business}/expected.json`, import.meta.url), 'utf8'));
    requireValue(JSON.stringify([...run.requiredActive].sort()) === JSON.stringify([...expected.requiredActive].sort()), 'Live scope must match the full business expected set');
    requireValue(Array.isArray(run.violations), 'Live violations inventory required');
    requireValue(users <= expected.maximumUserTurns, 'Live user-turn limit exceeded');
  }
  const scores = {};
  for (const criterion of rubric.criteria.filter(c => c.source === 'judge')) {
    const verdict = run.judge?.scores?.[criterion.id];
    requireValue(Number.isInteger(verdict?.score) && verdict.score >= 0 && verdict.score <= 2, `Invalid judge score: ${criterion.id}`);
    requireValue(typeof verdict.reason === 'string' && verdict.reason.trim() && Array.isArray(verdict.evidence) && verdict.evidence.length > 0 && verdict.evidence.every(id => turns.has(id)), `Missing judge evidence: ${criterion.id}`);
    scores[criterion.id] = verdict.score;
  }
  scores['quality-pass-rate'] = rateScore(rate(run.measurements.quality, 'quality'));
  scores['file-conventions'] = rateScore(rate(run.measurements.files, 'files'));
  const coherence = run.measurements.coherence;
  for (const key of ['hard', 'pendingJudge', 'judgeFail']) count(coherence?.[key], `coherence.${key}`);
  scores.coherence = coherence.hard || coherence.judgeFail ? 0 : coherence.pendingJudge ? 1 : 2;
  const completion = run.measurements.completion;
  count(completion?.overclaims, 'completion.overclaims');
  requireValue(typeof completion.pending === 'boolean', 'Missing completion judgment state');
  scores['completion-honesty'] = completion.overclaims ? 0 : completion.pending ? 1 : 2;
  const invalidActivations = run.activations.filter(a => !confirmed(a, run.transcript));
  // Final active refs also need an observed activation; omitting an event cannot hide it.
  const unrecordedActive = run.active.filter(ref => !run.activations.some(a => a.ref === ref));
  scores['confirm-discipline'] = invalidActivations.length || unrecordedActive.length ? 0 : run.activations.length ? 2 : 1;
  const activeIds = new Set(run.active.map(cellId));
  const required = run.requiredActive.filter(id => activeIds.has(id));
  const efficiency = required.length / users;
  scores['turn-efficiency'] = efficiency >= 0.5 ? 2 : efficiency >= 0.25 ? 1 : 0;
  const missing = run.requiredActive.filter(id => !activeIds.has(id));
  const forbidden = run.forbiddenActive.filter(id => activeIds.has(id));
  const violations = run.violations ?? [];
  requireValue(Array.isArray(violations) && violations.every(v => typeof v === 'string'), 'Invalid violations');
  if (violations.includes('contradiction-auto-fix')) scores['contradiction-handling'] = 0;
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  return {
    schemaVersion: 1, kind: run.kind, business: run.business, scores, total, maximum: rubric.maximum,
    pass: total >= rubric.passBar && rubric.critical.every(id => scores[id] > 0) && !missing.length && !forbidden.length && !violations.length,
    violations,
    missing, forbidden, invalidActivations, unrecordedActive, coreCellsPerUserTurn: efficiency,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    requireValue(process.argv.length === 3, 'Usage: node score.mjs <run.json>');
    const result = scoreRun(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.pass ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
