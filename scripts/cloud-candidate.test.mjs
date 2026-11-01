import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, symlinkSync, realpathSync } from 'node:fs';
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
  const historyConfig = join(trusted, 'native.toml'); writeFileSync(historyConfig, '[extend]\nuseDefault = true\n');
  inputs.historyConfig = { path: historyConfig, sha256: digest(readFileSync(historyConfig)) };
  const historyExceptions = join(trusted, '.gitleaksignore'); writeFileSync(historyExceptions, '# Exact approved fixture fingerprints only.\n');
  inputs.historyExceptions = { path: historyExceptions, sha256: digest(readFileSync(historyExceptions)) };
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
  for (const id of ['historyConfig', 'historyExceptions']) {
    const policy = structuredClone(f.policy); policy.inputs[id].sha256 = '0'.repeat(64);
    assert.throws(() => qualifyCandidate({ artifact: original, policy, trustedRepository: f.repo, denylistPath: f.denylist, privateKey: f.privateKey }), /pin/);
  }
  const wildcard = join(f.trusted, 'wildcard-ignore'); writeFileSync(wildcard, '*\n');
  const broadPolicy = structuredClone(f.policy); broadPolicy.inputs.historyExceptions = { path: wildcard, sha256: digest(readFileSync(wildcard)) };
  assert.throws(() => qualifyCandidate({ artifact: original, policy: broadPolicy, trustedRepository: f.repo, denylistPath: f.denylist, privateKey: f.privateKey }), /Exact approved history fingerprints/);
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

async function installedFixture(t, check = 'node -e "process.exit(0)"', transform = source => source) {
  const f = fixture(t), installation = join(f.temp, 'owner-installation');
  mkdirSync(join(installation, 'lib'), { recursive: true });
  // Isolate the fixed native owner-home binding in a fixture installation. This
  // changes no real home/config and adds no runtime path override to the product.
  const source = readFileSync(join(root, 'scripts/lib/cloud-candidate.mjs'), 'utf8');
  const fixed = "join(userInfo().homedir, '.config', 'public-safety', 'cloud-candidate')";
  assert.equal(source.split(fixed).length, 2);
  const engine = transform(source.replace(fixed, JSON.stringify(installation)));
  writeFileSync(join(installation, 'lib/cloud-candidate.mjs'), engine);
  const cli = join(installation, 'cloud-candidate.mjs'); writeFileSync(cli, readFileSync(join(root, 'scripts/cloud-candidate.mjs')));
  const module = await import(`${new URL(`file://${installation}/lib/cloud-candidate.mjs`).href}`);
  const policy = { ...f.policy, engineSha256: digest(engine) };
  const npmPath = realpathSync(execFileSync('which', ['npm'], { encoding: 'utf8' }).trim());
  const authority = { version: 1, repository: policy.repository, owner: policy.owner, publicKey: policy.publicKey, engineSha256: policy.engineSha256, cliSha256: digest(readFileSync(cli)), npmPath, npmSha256: digest(readFileSync(npmPath)) };
  writeFileSync(join(installation, 'authority.json'), encode(authority));
  writeFileSync(join(installation, 'policy.json'), encode(policy));
  writeFileSync(join(f.repo, 'package.json'), JSON.stringify({ private: true, scripts: { check } }));
  writeFileSync(join(f.repo, 'readme.txt'), 'Qualified new bytes\n'); git(f.repo, 'add', '.');
  const artifact = module.exportCandidate({ repositoryPath: f.repo, ...policy, message: f.message });
  const receipt = module.qualifyCandidate({ artifact, policy, trustedRepository: f.repo, denylistPath: f.denylist, privateKey: f.privateKey });
  const artifactPath = join(f.temp, 'artifact'), receiptPath = join(f.temp, 'receipt'), messagePath = join(f.temp, 'message');
  writeFileSync(artifactPath, artifact); writeFileSync(receiptPath, receipt); writeFileSync(messagePath, f.message);
  const args = ['--repository-path', f.repo, '--artifact', artifactPath, '--receipt', receiptPath, '--message', messagePath];
  const run = (command, extra = []) => spawnSync(process.execPath, [cli, command, ...args, ...extra], { encoding: 'utf8' });
  return { ...f, installation, policy, module, artifact, receipt, artifactPath, receiptPath, messagePath, run };
}

test('enforced admission runs native checks, freezes exact commit and allows one delivery', async t => {
  const f = await installedFixture(t);
  assert.equal(f.run('remote-check').status, 0);
  const admitted = f.run('admit-commit'); assert.equal(admitted.status, 0, admitted.stderr);
  const result = JSON.parse(admitted.stdout);
  assert.equal(result.provenance, 'trusted-remote-FULL'); assert.equal(result.checkExit, 0);
  assert.equal(git(f.repo, 'rev-parse', 'HEAD^'), f.base);
  assert.equal(git(f.repo, 'rev-parse', 'HEAD^{tree}'), JSON.parse(f.artifact).tree);
  assert.equal(execFileSync('git', ['show', '-s', '--format=%B', 'HEAD'], { cwd: f.repo, encoding: 'utf8' }), `${f.message}\n`);
  assert.equal(f.run('remote-check').status, 2);
  assert.equal(f.run('admit-commit').status, 2);
  const delivery = f.run('admit-delivery'); assert.equal(delivery.status, 0, delivery.stderr);
  assert.equal(JSON.parse(delivery.stdout).pushExecuted, false);
  assert.equal(f.run('admit-delivery').status, 2);
});

test('admission rejects actual working mutations, candidate signer, missing checks and hook mutation before commit', async t => {
  const changed = await installedFixture(t);
  git(changed.repo, 'update-index', '--assume-unchanged', 'readme.txt');
  writeFileSync(join(changed.repo, 'readme.txt'), 'Unstaged bytes\n');
  assert.equal(changed.run('admit-commit').status, 2); assert.equal(git(changed.repo, 'rev-parse', 'HEAD'), changed.base);
  const signer = await installedFixture(t);
  const alternate = generateKeyPairSync('ed25519');
  writeFileSync(join(signer.installation, 'policy.json'), encode({ ...signer.policy, publicKey: alternate.publicKey.export({ type: 'spki', format: 'pem' }).toString() }));
  assert.equal(signer.run('admit-commit').status, 2);
  assert.equal(signer.run('admit-commit', ['--policy', join(signer.installation, 'policy.json')]).status, 2);
  assert.equal(git(signer.repo, 'rev-parse', 'HEAD'), signer.base);
  const red = await installedFixture(t, 'node -e "process.exit(1)"');
  assert.equal(red.run('admit-commit').status, 2); assert.equal(git(red.repo, 'rev-parse', 'HEAD'), red.base);
  assert.equal(red.run('admit-delivery').status, 2);
  const mutating = await installedFixture(t, 'node -e "require(\'node:fs\').writeFileSync(\'readme.txt\',\'changed\')"');
  assert.equal(mutating.run('admit-commit').status, 2); assert.equal(git(mutating.repo, 'rev-parse', 'HEAD'), mutating.base);
  const hook = await installedFixture(t); const marker = join(hook.temp, 'hook-executed');
  const hookPath = join(hook.repo, '.git/hooks/pre-commit');
  writeFileSync(hookPath, `#!/bin/sh\ntouch '${marker}'\nprintf changed > readme.txt\ngit add readme.txt\n`); chmodSync(hookPath, 0o700);
  assert.equal(hook.run('admit-commit').status, 2); assert.equal(git(hook.repo, 'rev-parse', 'HEAD'), hook.base); assert.equal(existsSync(marker), false);
});

test('existing native gates expose trusted remote provenance and reject unknown flags/strict local downgrade', async t => {
  const f = await installedFixture(t);
  const env = { PATH: process.env.PATH, PUBLIC_SAFETY_REMOTE_ARTIFACT: f.artifactPath, PUBLIC_SAFETY_REMOTE_RECEIPT: f.receiptPath, PUBLIC_SAFETY_REMOTE_MESSAGE: f.messagePath };
  for (const name of ['check-public-safety.mjs', 'check-commit-messages.mjs']) {
    const source = readFileSync(join(root, 'scripts', name), 'utf8');
    const fixed = "candidateJoin(candidateUser().homedir, '.config', 'public-safety', 'cloud-candidate')";
    assert.equal(source.split(fixed).length, 2);
    const script = join(f.temp, name); writeFileSync(script, source.replace(fixed, JSON.stringify(f.installation)));
    const baseArgs = name === 'check-public-safety.mjs' ? ['.', '--json', '--trusted-remote-full'] : ['--trusted-remote-full', '--title', f.message];
    const run = extra => spawnSync(process.execPath, [script, ...baseArgs, ...extra], { cwd: f.repo, env, encoding: 'utf8' });
    const good = run([]); assert.equal(good.status, 0, good.stderr);
    const result = JSON.parse(good.stdout); assert.equal(result.provenance, 'trusted-remote-FULL'); assert.equal(result.mode, 'TRUSTED_REMOTE_FULL'); assert.equal(result.localScan, false);
    assert.equal(run(['--require-denylist']).status, 2);
    assert.equal(run(['--unknown']).status, 2);
    if (name === 'check-public-safety.mjs') {
      const args = [script, '.', '--json'];
      const implicit = spawnSync(process.execPath, args, { cwd: f.repo, encoding: 'utf8', env: { ...env, PUBLIC_SAFETY_REMOTE_REPOSITORY: f.repo, npm_lifecycle_event: 'check:safety' } });
      assert.equal(implicit.status, 0, implicit.stderr); assert.equal(JSON.parse(implicit.stdout).mode, 'TRUSTED_REMOTE_FULL');
      const regression = spawnSync(process.execPath, args, { cwd: f.repo, encoding: 'utf8', env: { ...env, PUBLIC_SAFETY_REMOTE_REPOSITORY: f.repo, npm_lifecycle_event: 'check:gates' } });
      assert.equal(regression.status, 0, regression.stderr); assert.equal(JSON.parse(regression.stdout).mode, 'PARTIAL');
    }
  }
});

test('unqualified native index hooks, fsmonitor and signing never execute or commit', async t => {
  for (const name of ['commit-msg', 'post-index-change']) {
    const f = await installedFixture(t); const marker = join(f.temp, 'native-hook-ran');
    const hook = join(f.repo, '.git/hooks', name);
    writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\n`); chmodSync(hook, 0o700);
    assert.equal(f.run('admit-commit').status, 2, name);
    assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.base);
    assert.equal(existsSync(marker), false);
  }
  for (const key of ['core.fsmonitor', 'commit.gpgSign']) {
    const f = await installedFixture(t); const marker = join(f.temp, 'native-config-ran');
    const command = join(f.temp, 'native-command'); writeFileSync(command, `#!/bin/sh\ntouch '${marker}'\n`); chmodSync(command, 0o700);
    if (key === 'core.fsmonitor') git(f.repo, 'config', key, command);
    else { git(f.repo, 'config', key, 'true'); git(f.repo, 'config', 'gpg.program', command); }
    assert.equal(f.run('admit-commit').status, 2, key);
    assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.base);
    assert.equal(existsSync(marker), false);
  }
});

test('racing normal-index mutation cannot change frozen qualified commit bytes', async t => {
  const f = await installedFixture(t, undefined, source => {
    const marker = '    const committed = nativeGit(repositoryPath,';
    assert.equal(source.split(marker).length, 2);
    return source.replace(marker, "    nativeGit(repositoryPath, ['reset', '--quiet', input.policy.base, '--', 'readme.txt']);\n" + marker);
  });
  // The injected race changes only the ordinary index after final verification.
  // Admission refuses delivery, while any created commit remains exactly qualified.
  assert.equal(f.run('admit-commit').status, 2);
  assert.notEqual(git(f.repo, 'rev-parse', 'HEAD'), f.base);
  assert.equal(git(f.repo, 'rev-parse', 'HEAD^'), f.base);
  assert.equal(git(f.repo, 'rev-parse', 'HEAD^{tree}'), JSON.parse(f.artifact).tree);
  assert.equal(f.run('admit-delivery').status, 2);
});
