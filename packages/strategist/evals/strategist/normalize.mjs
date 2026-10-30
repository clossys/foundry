import { createHash } from 'node:crypto';
const hash = text => createHash('sha256').update(text).digest('hex');
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function findings(value) {
  requireValue(Array.isArray(value), 'Missing findings');
  for (const f of value) requireValue(['hard', 'judge', 'warning'].includes(f.severity) && typeof f.rule === 'string' && (f.verdict === undefined || ['pass', 'fail'].includes(f.verdict)), 'Invalid finding');
  return value;
}
const pending = f => f.severity === 'judge' && f.verdict === undefined;
const blocked = f => f.severity === 'hard' || f.verdict === 'fail';

// Normalize the actual ST4 envelopes, never exit-code-only or manually supplied counts.
export function normalizeCapture(capture) {
  requireValue(capture.schemaVersion === 1 && capture.source === 'strategist-check', 'Invalid CLI capture');
  requireValue(/^[a-f0-9]{40}$/.test(capture.sourceHead) && /^[a-f0-9]{64}$/.test(capture.cliSha256), 'Missing source/build identity');
  requireValue(capture.implementationDirty === '', 'CLI implementation has uncommitted changes');
  for (const snapshot of [capture.before, capture.after]) {
    requireValue(snapshot && snapshot.files && snapshot.hashes && Array.isArray(snapshot.issues), 'Missing root snapshot');
    requireValue(snapshot.issues.length === 0, 'Root parser issues are missing evidence');
    const contracts = snapshot.briefContracts;
    requireValue(contracts && Array.isArray(contracts.inventory) && contracts.files && Array.isArray(contracts.contracts) && Array.isArray(contracts.issues), 'Missing brief contract snapshot');
    requireValue(contracts.issues.length === 0, 'Brief contract discovery issues are missing evidence');
    requireValue(same(contracts.inventory.map(entry => entry.path), Object.keys(contracts.files)) && contracts.inventory.every(entry => typeof entry.source === 'string' && entry.source.length > 0), 'Brief contract inventory disagrees');
    for (const file of Object.values(contracts.files)) {
      requireValue(typeof file.base64 === 'string' && Buffer.from(file.base64, 'base64').toString('base64') === file.base64 && hash(Buffer.from(file.base64, 'base64')) === file.sha256, 'Brief contract snapshot hashes disagree');
    }
    const calculated = Object.fromEntries(Object.entries(snapshot.files).map(([path, text]) => [path, hash(text)]));
    requireValue(same(calculated, snapshot.hashes), 'Snapshot hashes disagree');
  }
  requireValue(same(capture.before.briefContracts, capture.after.briefContracts), 'Brief contract inputs changed during CLI capture');
  requireValue(same(capture.before.hashes, capture.after.hashes), 'Strategy inputs changed during CLI capture');
  requireValue(hash(capture.before.files['tree.json']) === capture.rootTreeSha256, 'Tree hash disagrees');
  const tree = JSON.parse(capture.before.files['tree.json']);
  const active = Object.entries(tree.active).filter(([, n]) => n !== null).map(([id, n]) => `${id}@${n}`).sort();
  requireValue(same(active, capture.active), 'Active set disagrees with snapshot');
  const expected = [...active.map(ref => ['check', ref]), ['cohere'], ['complete', '--level', 'mvs'], ['complete', '--level', 'full'], ['status', '--scope', 'full']];
  requireValue(Array.isArray(capture.captures) && capture.captures.length === expected.length, 'Incomplete command inventory');
  let root;
  const results = capture.captures.map((c, i) => {
    const args = c.command?.slice(2);
    const prefix = expected[i];
    requireValue(Array.isArray(args) && same(args.slice(0, prefix.length), prefix) && args.length === prefix.length + 3 && args[prefix.length] === '--root' && args.at(-1) === '--json', 'Unexpected CLI command');
    root ??= args.at(-2);
    requireValue(typeof root === 'string' && root.length > 0 && args.at(-2) === root, 'Inconsistent CLI roots');
    requireValue([0, 1].includes(c.exitCode) && !c.error && !c.signal, 'CLI command could not run');
    const output = JSON.parse(c.stdout);
    requireValue(output.command === prefix[0] && output.code === c.exitCode && !output.error && Object.hasOwn(output, 'result'), 'Invalid CLI JSON envelope');
    return output.result;
  });
  let passed = 0, pendingQuality = 0;
  for (const [i, ref] of active.entries()) {
    const report = results[i];
    const at = ref.lastIndexOf('@');
    requireValue(same(report.cells, [{ cell: ref.slice(0, at), version: Number(ref.slice(at + 1)) }]), 'Quality target mismatch');
    const flags = findings(report.findings);
    if (!flags.some(blocked) && !flags.some(pending)) passed++;
    if (flags.some(pending)) pendingQuality++;
  }
  const coherence = findings(results[active.length]);
  const mvs = results[active.length + 1], full = results[active.length + 2], status = results[active.length + 3];
  requireValue(same(mvs, full) && typeof full.mvs === 'boolean' && typeof full.complete === 'boolean' && full.scope === 'full' && status.scope === 'full', 'Incomplete completion/status reports');
  // cohere omits C4 by design. Full status supplies it, including an unjudged critic.
  const allCoherence = findings(status.findings);
  requireValue(allCoherence.some(f => f.rule === 'C4') || ['pass', 'fail'].includes(status.storyline?.critic), 'Missing storyline judgment state');
  requireValue(same(coherence, allCoherence.filter(f => f.rule !== 'C4')), 'Coherence/status reports disagree');
  const files = Object.keys(capture.before.files).length;
  requireValue(files > 0, 'Empty parser inventory');
  return {
    source: 'strategist-check', evidence: capture.captures.map((_, i) => `captures[${i}]`),
    quality: { passed, total: active.length, pendingJudge: pendingQuality },
    files: { passed: files, total: files },
    coherence: { hard: allCoherence.filter(f => f.severity === 'hard').length, pendingJudge: allCoherence.filter(pending).length, judgeFail: allCoherence.filter(f => f.verdict === 'fail').length },
    completion: { measured: { mvs: full.mvs, full: full.complete }, pending: status.storyline?.critic === 'not judged' || allCoherence.some(pending) || pendingQuality > 0 },
  };
}
