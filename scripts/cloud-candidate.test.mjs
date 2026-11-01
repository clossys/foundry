import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeTmpDirSync } from './lib/tmp-fixture.mjs';
import { exportCandidate, qualifyCandidate, verifyReceipt, digest, encode, engineDigest, INPUTS } from './lib/cloud-candidate.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture(t) {
  const temp = makeTmpDirSync(t, 'cloud-candidate-');
  const repo = join(temp, 'repository'); mkdirSync(repo);
  git(repo, 'init', '-q'); git(repo, 'config', 'user.name', 'Fixture'); git(repo, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(repo, 'readme.txt'), 'safe\n');
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'Initial fixture');
  const base = git(repo, 'rev-parse', 'HEAD');
  const trusted = join(temp, 'trusted'); mkdirSync(trusted);
  const inputs = {};
  for (const [id, path] of Object.entries(INPUTS)) {
    const bytes = readFileSync(join(root, path));
    const copy = join(trusted, id); writeFileSync(copy, bytes);
    inputs[id] = { path: copy, sha256: digest(bytes) };
  }
  // A separately pinned native-tool fixture checks invocation and simulates findings.
  const history = join(trusted, 'history');
  writeFileSync(history, '#!/bin/sh\ncase "$*" in *--log-opts=*) exit 0;; *) exit 2;; esac\n'); chmodSync(history, 0o700);
  inputs.history = { path: history, sha256: digest(readFileSync(history)) };
  const scope = join(trusted, 'scope'); writeFileSync(scope, '{"scope":"@sample","registry":"https://registry.npmjs.org"}');
  inputs.scope = { path: scope, sha256: digest(readFileSync(scope)) };
  const exemptions = join(trusted, 'exceptions');
  writeFileSync(exemptions, JSON.stringify({ $comment: 'Fixture', schemaVersion: 1, sealedAtCommit: base, exceptions: [] }));
  inputs.exceptions = { path: exemptions, sha256: digest(readFileSync(exemptions)) };
  const denylist = join(trusted, 'terms'); writeFileSync(denylist, JSON.stringify({ version: 1, terms: [{ pattern: 'fixture-forbidden-identity', why: 'fixture identity', severity: 'high' }] }));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const message = 'Add safe candidate\n';
  const policy = { version: 1, repository: 'sample/repository', owner: 'sample', base, unit: 'unit-1', messageSha256: digest(message), nonce: 'd'.repeat(64), expiresAt: Date.now() + 300000, engineSha256: engineDigest(), denylistSha256: digest(readFileSync(denylist)), inputs, publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
  const exportNow = () => exportCandidate({ repositoryPath: repo, ...policy, message });
  const qualify = artifact => qualifyCandidate({ artifact, policy, trustedRepository: repo, denylistPath: denylist, privateKey });
  return { temp, repo, base, trusted, policy, denylist, privateKey, message, exportNow, qualify };
}

test('immutable FULL clearance binds staged bytes, deletions, mode and export attributes', t => {
  const f = fixture(t);
  writeFileSync(join(f.repo, '.gitattributes'), '*.txt export-ignore\n');
  writeFileSync(join(f.repo, 'script.mjs'), 'throw new Error("candidate must never execute");\n');
  git(f.repo, 'rm', 'readme.txt');
  writeFileSync(join(f.repo, 'new.txt'), 'new safe bytes\n'); chmodSync(join(f.repo, 'new.txt'), 0o755);
  git(f.repo, 'add', '.');
  const artifact = f.exportNow(); const candidate = JSON.parse(artifact);
  assert.equal(candidate.tree, git(f.repo, 'write-tree'));
  assert.equal(candidate.files.some(e => e.path === 'readme.txt'), false);
  assert.equal(candidate.files.find(e => e.path === 'new.txt').mode, '100755');
  assert.equal(candidate.files.some(e => e.path === '.gitattributes'), true);
  const receipt = f.qualify(artifact);
  assert.equal(verifyReceipt({ artifact, receipt, policy: f.policy, repositoryPath: f.repo, message: f.message }).status, 'FULL');
  for (const mutate of [v => v.files.pop(), v => { v.files[0].bytes = 'YQ=='; }, v => { v.unit = 'wrong'; }, v => { v.owner = 'wrong'; }, v => { v.base = '1'.repeat(40); }, v => { v.message = 'changed'; }]) {
    const changed = structuredClone(candidate); mutate(changed);
    assert.throws(() => verifyReceipt({ artifact: encode(changed), receipt, policy: f.policy, repositoryPath: f.repo, message: f.message }));
  }
  for (const mutate of [p => { p.status = 'PARTIAL'; }, p => { p.scannerSha256 = '0'.repeat(64); }, p => { p.checks.history = 'SKIP'; }, p => { p.history.head = '0'.repeat(40); }, p => { p.issuedAt = 0; }, p => { p.expiresAt = 1; }]) {
    const { payload } = JSON.parse(receipt); mutate(payload);
    const forged = encode({ payload, signature: sign(null, encode(payload), f.privateKey).toString('base64') });
    assert.throws(() => verifyReceipt({ artifact, receipt: forged, policy: f.policy, message: f.message }));
  }
  const forged = JSON.parse(receipt); forged.signature = Buffer.alloc(64).toString('base64');
  assert.throws(() => verifyReceipt({ artifact, receipt: encode(forged), policy: f.policy, message: f.message }));
  assert.throws(() => verifyReceipt({ artifact, receipt, policy: f.policy, message: 'other' }));
  const scannerPolicy = structuredClone(f.policy); scannerPolicy.inputs.tree.sha256 = '0'.repeat(64);
  assert.throws(() => verifyReceipt({ artifact, receipt, policy: scannerPolicy, message: f.message }));
  assert.throws(() => verifyReceipt({ artifact, receipt, policy: { ...f.policy, expiresAt: 1 }, message: f.message }));
  writeFileSync(join(f.repo, 'new.txt'), 'changed index\n'); git(f.repo, 'add', 'new.txt');
  assert.throws(() => verifyReceipt({ artifact, receipt, policy: f.policy, repositoryPath: f.repo, message: f.message }));
});

test('native scanners fail closed for identity, secret, proposed message, history and PARTIAL', t => {
  const f = fixture(t); const original = f.exportNow();
  const receipt = f.qualify(original);
  for (const text of ['fixture-forbidden-identity\n', ['gh', 'p_', 'A'.repeat(36)].join('')]) {
    writeFileSync(join(f.repo, 'readme.txt'), text); git(f.repo, 'add', '.');
    assert.throws(() => f.qualify(f.exportNow()), /clearance refused/);
  }
  for (const message of ['fixture-forbidden-identity', ['gh', 'p_', 'A'.repeat(36)].join('')]) {
    const changed = JSON.parse(original); changed.message = message;
    const policy = { ...f.policy, messageSha256: digest(changed.message) };
    assert.throws(() => qualifyCandidate({ artifact: encode(changed), policy, trustedRepository: f.repo, denylistPath: f.denylist, privateKey: f.privateKey }), /clearance refused/);
  }
  assert.throws(() => qualifyCandidate({ artifact: original, policy: f.policy, trustedRepository: f.repo, denylistPath: join(f.temp, 'absent'), privateKey: f.privateKey }), /clearance refused/);
  assert.throws(() => verifyReceipt({ artifact: original, receipt, policy: { ...f.policy, nonce: 'e'.repeat(64) }, message: f.message }));
  assert.throws(() => verifyReceipt({ artifact: original, receipt, policy: { ...f.policy, denylistSha256: 'f'.repeat(64) }, message: f.message }));
  const otherDenylist = join(f.trusted, 'other-terms'); writeFileSync(otherDenylist, '{"version":1,"terms":[{"pattern":"other-fixture","why":"other"}]}');
  assert.throws(() => qualifyCandidate({ artifact: original, policy: f.policy, trustedRepository: f.repo, denylistPath: otherDenylist, privateKey: f.privateKey }), /denylist pin/);
  const partial = join(f.trusted, 'partial'); writeFileSync(partial, '{"version":1,"terms":[]}');
  assert.throws(() => qualifyCandidate({ artifact: original, policy: { ...f.policy, denylistSha256: digest(readFileSync(partial)) }, trustedRepository: f.repo, denylistPath: partial, privateKey: f.privateKey }), /clearance refused/);
  writeFileSync(f.policy.inputs.history.path, '#!/bin/sh\nexit 1\n');
  const historyPolicy = structuredClone(f.policy); historyPolicy.inputs.history.sha256 = digest(readFileSync(historyPolicy.inputs.history.path));
  assert.throws(() => qualifyCandidate({ artifact: original, policy: historyPolicy, trustedRepository: f.repo, denylistPath: f.denylist, privateKey: f.privateKey }), /clearance refused/);
  assert.throws(() => f.qualify(original), /pin/);
  writeFileSync(historyPolicy.inputs.history.path, '#!/bin/sh\nprintf "native scanner error" >&2\nexit 0\n');
  historyPolicy.inputs.history.sha256 = digest(readFileSync(historyPolicy.inputs.history.path));
  assert.throws(() => qualifyCandidate({ artifact: original, policy: historyPolicy, trustedRepository: f.repo, denylistPath: f.denylist, privateKey: f.privateKey }), /native history scanner failed/);
});

test('export refuses unmerged entries, links, unsupported names and wrong HEAD', t => {
  const f = fixture(t);
  symlinkSync('readme.txt', join(f.repo, 'link')); git(f.repo, 'add', 'link');
  assert.throws(() => f.exportNow()); git(f.repo, 'rm', '--cached', 'link');
  const blob = git(f.repo, 'rev-parse', 'HEAD:readme.txt');
  execFileSync('git', ['update-index', '--index-info'], { cwd: f.repo, input: `0 ${'0'.repeat(40)}\treadme.txt\n100644 ${blob} 1\treadme.txt\n100644 ${blob} 2\treadme.txt\n100644 ${blob} 3\treadme.txt\n`, stdio: ['pipe', 'pipe', 'pipe'] });
  assert.throws(() => f.exportNow(), /Git input/); git(f.repo, 'read-tree', 'HEAD');
  git(f.repo, 'commit', '--allow-empty', '-qm', 'New base');
  assert.throws(() => f.exportNow(), /base/);
});

test('candidate scanner/config code and ambient runtime overrides never execute', t => {
  const f = fixture(t); const marker = join(f.temp, 'executed');
  mkdirSync(join(f.repo, 'scripts'));
  writeFileSync(join(f.repo, 'scripts', 'check-public-safety.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed');\n`);
  writeFileSync(join(f.repo, '.gitleaks.toml'), 'invalid candidate selected config\n');
  writeFileSync(join(f.repo, 'package-scope.json'), '{"scope":"@other"}');
  git(f.repo, 'add', '.');
  const saved = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = '--require /missing-candidate-preload';
  try {
    const artifact = f.exportNow(); const receipt = f.qualify(artifact);
    assert.equal(verifyReceipt({ artifact, receipt, policy: f.policy, repositoryPath: f.repo, message: f.message }).status, 'FULL');
    assert.equal(existsSync(marker), false);
  } finally { if (saved === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = saved; }
  const pinned = f.policy.inputs.scope.path;
  symlinkSync(pinned, join(f.trusted, 'redirect'));
  const policy = structuredClone(f.policy); policy.inputs.scope.path = join(f.trusted, 'redirect');
  assert.throws(() => qualifyCandidate({ artifact: f.exportNow(), policy, trustedRepository: f.repo, denylistPath: f.denylist, privateKey: f.privateKey }), /link/);
});

test('CLI requires explicit local artifact and externally pinned policy; writes are exclusive', t => {
  const f = fixture(t); const cli = join(root, 'scripts/cloud-candidate.mjs');
  const output = join(f.temp, 'candidate.json'); const message = join(f.temp, 'message'); writeFileSync(message, f.message);
  const args = [cli, 'export', '--repository-path', f.repo, '--repository', f.policy.repository, '--owner', f.policy.owner, '--base', f.base, '--unit', f.policy.unit, '--message', message, '--output', output];
  const run = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr); assert.equal(existsSync(output), true);
  assert.equal(spawnSync(process.execPath, args).status, 2);
  assert.equal(spawnSync(process.execPath, [cli, 'qualify', '--artifact', output]).status, 2);
  assert.equal(spawnSync(process.execPath, [cli, 'upload', '--artifact', output]).status, 2);
  const state = join(f.temp, 'signing'); mkdirSync(state, { mode: 0o700 });
  const privatePath = join(state, 'key'), publicPath = join(state, 'public');
  assert.equal(spawnSync(process.execPath, [cli, 'keygen', '--repository-path', f.repo, '--private-key', privatePath, '--public-key', publicPath]).status, 0);
  const policy = { ...f.policy, publicKey: readFileSync(publicPath, 'utf8') };
  const policyPath = join(f.trusted, 'policy.json'); writeFileSync(policyPath, JSON.stringify(policy));
  const receipt = join(f.temp, 'receipt.json');
  const qualify = spawnSync(process.execPath, [cli, 'qualify', '--artifact', output, '--policy', policyPath, '--trusted-repository', f.repo, '--denylist', f.denylist, '--private-key', privatePath, '--output', receipt], { encoding: 'utf8' });
  assert.equal(qualify.status, 0, qualify.stderr);
  assert.equal(spawnSync(process.execPath, [cli, 'verify', '--artifact', output, '--receipt', receipt, '--policy', policyPath, '--repository-path', f.repo, '--message', message]).status, 0);
  const internalPolicy = join(f.repo, 'policy.json'); writeFileSync(internalPolicy, JSON.stringify(policy));
  assert.equal(spawnSync(process.execPath, [cli, 'verify', '--artifact', output, '--receipt', receipt, '--policy', internalPolicy, '--repository-path', f.repo, '--message', message]).status, 2);
});
