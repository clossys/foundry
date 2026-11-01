// Private candidate artifacts are data, never checkouts or executable inputs.
// Invoke this implementation from an independently trusted installation. The
// owner supplies policy and public-key anchors out of band, never in an artifact.
// A receipt authorizes only this verification; native FULL checks/hooks still run.
import { createHash, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync, readSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, realpathSync, openSync, closeSync, fstatSync, constants } from 'node:fs';
import { dirname, join, resolve, isAbsolute, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const LIMITS = Object.freeze({ files: 20000, file: 16 * 1024 * 1024, total: 128 * 1024 * 1024, artifact: 180 * 1024 * 1024, message: 32768 });
export const INPUTS = Object.freeze({ tree: 'scripts/check-public-safety.mjs', message: 'scripts/check-commit-messages.mjs', scope: 'package-scope.json', opaque: 'governance/opaque-content-exemptions.json', exceptions: 'governance/commit-message-history-exceptions.json' });
const HEX = /^[a-f0-9]{64}$/;
const OID = /^[a-f0-9]{40}$/;
const MAX_AGE = 15 * 60 * 1000;
const utf8 = new TextDecoder('utf-8', { fatal: true });
export const encode = value => Buffer.from(`${JSON.stringify(value)}\n`);
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const engineDigest = () => digest(readFileSync(fileURLToPath(import.meta.url)));
const fail = message => { throw new Error(message); };
function keys(value, expected) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).sort().join('\0') !== [...expected].sort().join('\0')) fail('Invalid closed schema');
}
function text(value, max, pattern) {
  if (typeof value !== 'string' || !value.length || Buffer.byteLength(value) > max || value.includes('\0') || (pattern && !pattern.test(value))) fail('Invalid bounded text');
}
function canonical(bytes, limit) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length > limit) fail('Input exceeds byte bound');
  let value;
  try { value = JSON.parse(utf8.decode(bytes)); } catch { fail('Invalid UTF-8 JSON'); }
  if (!encode(value).equals(bytes)) fail('Canonical JSON required (no duplicate keys or alternate encodings)');
  return value;
}
function safePath(path) {
  // Deliberately portable ASCII: reject Unicode normalization/case ambiguities,
  // device names, alternate streams and directory names scanners skip entirely.
  text(path, 1024, /^[A-Za-z0-9_.@+ /-]+$/);
  for (const part of path.split('/')) {
    if (!part || part.length > 255 || part === '.' || part === '..' || /^ |[ .]$/.test(part) || /^(?:\.git|node_modules)$/i.test(part) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)) fail('Unsafe candidate path');
  }
  if (path.split('/').length > 32) fail('Candidate path depth exceeds bound');
}
const gitObject = (kind, bytes) => createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
function decodedFile(entry) {
  keys(entry, ['path', 'mode', 'blob', 'bytes']); safePath(entry.path);
  if (!['100644', '100755'].includes(entry.mode) || !OID.test(entry.blob)) fail('Unsupported file mode or blob');
  if (typeof entry.bytes !== 'string' || entry.bytes.length > Math.ceil(LIMITS.file / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.bytes)) fail('Invalid bounded blob encoding');
  const bytes = Buffer.from(entry.bytes, 'base64');
  if (bytes.length > LIMITS.file || bytes.toString('base64') !== entry.bytes || gitObject('blob', bytes) !== entry.blob) fail('Blob digest mismatch');
  return bytes;
}
function validatedFiles(files) {
  if (!Array.isArray(files) || files.length > LIMITS.files) fail('Invalid file count');
  let size = 0, previous = '';
  const prefixes = new Map(), leaves = new Set();
  for (const file of files) {
    size += decodedFile(file).length;
    if (size > LIMITS.total || (previous && Buffer.compare(Buffer.from(previous), Buffer.from(file.path)) >= 0)) fail('Unsorted, duplicate or oversized manifest');
    previous = file.path;
    const parts = file.path.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('/'), folded = prefix.toLowerCase();
      if (prefixes.has(folded) && prefixes.get(folded) !== prefix) fail('Case collision');
      if (i < parts.length && leaves.has(prefix)) fail('File/directory collision');
      prefixes.set(folded, prefix);
    }
    leaves.add(file.path);
  }
}
export function treeDigest(files) {
  validatedFiles(files);
  const root = new Map();
  for (const file of files) {
    const parts = file.path.split('/'); let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.has(part)) node.set(part, new Map());
      node = node.get(part);
      if (!(node instanceof Map)) fail('File/directory collision');
    }
    node.set(parts.at(-1), file);
  }
  const hash = node => {
    const sorted = [...node.entries()].sort(([a, av], [b, bv]) => Buffer.compare(Buffer.from(a + (av instanceof Map ? '/' : '')), Buffer.from(b + (bv instanceof Map ? '/' : ''))));
    const bytes = Buffer.concat(sorted.flatMap(([name, value]) => [Buffer.from(`${value instanceof Map ? '40000' : value.mode} ${name}\0`), Buffer.from(value instanceof Map ? hash(value) : value.blob, 'hex')]));
    return gitObject('tree', bytes);
  };
  return hash(root);
}
function bindings(candidate, expected) {
  for (const name of ['repository', 'owner', 'base', 'unit', 'tree']) {
    if (expected[name] !== undefined && candidate[name] !== expected[name]) fail(`Candidate ${name} binding mismatch`);
  }
  if (expected.messageSha256 !== undefined && digest(candidate.message) !== expected.messageSha256) fail('Candidate message binding mismatch');
}
export function parseCandidate(bytes, expected = {}) {
  const value = canonical(bytes, LIMITS.artifact);
  keys(value, ['version', 'repository', 'owner', 'base', 'unit', 'message', 'tree', 'files']);
  if (value.version !== 1 || !OID.test(value.base) || !OID.test(value.tree)) fail('Invalid candidate version/base/tree');
  text(value.repository, 160, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  text(value.owner, 80, /^[A-Za-z0-9_.-]+$/);
  if (value.repository.split('/')[0] !== value.owner) fail('Repository owner mismatch');
  text(value.unit, 160, /^[A-Za-z0-9_.:-]+$/);
  text(value.message, LIMITS.message);
  if (/[\x01-\x08\x0b-\x1f\x7f]/.test(value.message) || utf8.decode(Buffer.from(value.message)) !== value.message) fail('Invalid message');
  if (treeDigest(value.files) !== value.tree) fail('Incomplete or altered candidate tree');
  bindings(value, expected);
  return value;
}
// Child environments are literals, not inherited shell environments. In
// particular Node preloads, forge credentials, Git config and denylist paths
// are never inherited. The denylist is passed only to the two pinned scanners.
function cleanEnv() {
  return { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: '/dev/null', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'advice.graftFileDeprecated', GIT_CONFIG_VALUE_0: 'false', GIT_ATTR_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
}
function run(command, args, cwd, limit = 32 * 1024 * 1024) {
  return spawnSync(command, args, { cwd, env: cleanEnv(), input: '', encoding: null, timeout: 120000, maxBuffer: limit, windowsHide: true });
}
function git(repo, args, limit) {
  const result = run('/usr/bin/git', ['--no-replace-objects', '-C', repo, ...args], repo, limit);
  if (result.status !== 0 || result.error) fail('Git input could not be verified');
  return result.stdout;
}
function gitText(repo, args) { return utf8.decode(git(repo, args)).trim(); }
export function exportCandidate({ repositoryPath, repository, owner, base, unit, message }) {
  if (!OID.test(base) || gitText(repositoryPath, ['rev-parse', '--verify', 'HEAD']) !== base) fail('Current HEAD differs from expected base');
  if (gitText(repositoryPath, ['rev-parse', '--show-object-format']) !== 'sha1') fail('Only SHA-1 Git trees are supported');
  const tree = gitText(repositoryPath, ['write-tree']);
  const records = utf8.decode(git(repositoryPath, ['ls-tree', '-rz', '--full-tree', tree])).split('\0');
  if (records.pop() !== '' || records.length > LIMITS.files) fail('Invalid Git tree records');
  let total = 0;
  const files = records.map(record => {
    const match = /^([0-9]{6}) blob ([a-f0-9]{40})\t([\s\S]+)$/.exec(record);
    if (!match || !['100644', '100755'].includes(match[1])) fail('Unsupported candidate link, special file or submodule');
    const [, mode, blob, path] = match; safePath(path);
    const size = Number(gitText(repositoryPath, ['cat-file', '-s', blob]));
    if (!Number.isSafeInteger(size) || size < 0 || size > LIMITS.file || (total += size) > LIMITS.total) fail('Candidate blob exceeds bound');
    const bytes = git(repositoryPath, ['cat-file', 'blob', blob], LIMITS.file + 1);
    return { path, mode, blob, bytes: bytes.toString('base64') };
  }).sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const artifact = encode({ version: 1, repository, owner, base, unit, message, tree, files });
  parseCandidate(artifact);
  // Index/HEAD mutations during export invalidate the entire operation.
  if (gitText(repositoryPath, ['rev-parse', 'HEAD']) !== base || gitText(repositoryPath, ['write-tree']) !== tree) fail('Candidate changed during export');
  return artifact;
}
export function readBounded(path, limit = LIMITS.artifact) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) fail('Regular bounded file required');
    const bytes = Buffer.alloc(stat.size + 1);
    let count = 0, read;
    while (count < bytes.length && (read = readSync(fd, bytes, count, bytes.length - count, null)) > 0) count += read;
    if (count !== stat.size || fstatSync(fd).size !== stat.size) fail('File changed during bounded read');
    return bytes.subarray(0, count);
  } finally { closeSync(fd); }
}
function validatePolicy(policy) {
  keys(policy, ['version', 'repository', 'owner', 'base', 'unit', 'messageSha256', 'nonce', 'expiresAt', 'engineSha256', 'denylistSha256', 'inputs', 'publicKey']);
  if (policy.version !== 1 || !OID.test(policy.base) || !HEX.test(policy.messageSha256) || !HEX.test(policy.nonce) || !HEX.test(policy.engineSha256) || !HEX.test(policy.denylistSha256)) fail('Invalid policy pins');
  text(policy.repository, 160, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/); text(policy.owner, 80, /^[A-Za-z0-9_.-]+$/); text(policy.unit, 160, /^[A-Za-z0-9_.:-]+$/);
  if (policy.repository.split('/')[0] !== policy.owner || !Number.isSafeInteger(policy.expiresAt) || policy.expiresAt <= Date.now() || policy.expiresAt > Date.now() + 24 * 60 * 60 * 1000) fail('Stale or invalid policy');
  keys(policy.inputs, [...Object.keys(INPUTS), 'history']);
  for (const pin of Object.values(policy.inputs)) {
    keys(pin, ['path', 'sha256']); text(pin.path, 4096);
    if (!isAbsolute(pin.path) || !HEX.test(pin.sha256)) fail('Invalid scanner/config pin');
  }
  text(policy.publicKey, 1024);
  if (createPublicKey(policy.publicKey).asymmetricKeyType !== 'ed25519') fail('Ed25519 trust anchor required');
}
const scannerDigest = policy => digest(encode({ engineSha256: policy.engineSha256, denylistSha256: policy.denylistSha256, inputs: Object.fromEntries(Object.entries(policy.inputs).sort(([a], [b]) => a.localeCompare(b)).map(([id, pin]) => [id, pin.sha256])) }));
function outside(path, root) {
  const rel = relative(root, path);
  return rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel);
}
function pinnedInputs(policy, destination) {
  const paths = {};
  for (const [id, pin] of Object.entries(policy.inputs)) {
    // Resolve the full path to refuse directory redirects as well as leaf links.
    if (realpathSync(pin.path) !== resolve(pin.path)) fail('Scanner/config pin follows a link');
    const bytes = readBounded(pin.path, id === 'history' ? 128 * 1024 * 1024 : 8 * 1024 * 1024);
    if (digest(bytes) !== pin.sha256) fail('Scanner/config pin mismatch');
    paths[id] = join(destination, id === 'history' ? 'history' : `${id}.mjs`);
    writeFileSync(paths[id], bytes, { flag: 'wx', mode: id === 'history' ? 0o700 : 0o600 });
  }
  return paths;
}
function scannerPass(result) { return result.status === 0 && !result.error; }
export function qualifyCandidate({ artifact, policy, trustedRepository, denylistPath, privateKey }) {
  artifact = Buffer.from(artifact);
  validatePolicy(policy);
  if (engineDigest() !== policy.engineSha256) fail('Trusted engine pin mismatch');
  const candidate = parseCandidate(artifact, policy);
  // Only a separately maintained trusted repository supplies ancestry. Never
  // import a candidate bundle, config, refs, attributes, executable or Git dir.
  trustedRepository = realpathSync(trustedRepository);
  if (gitText(trustedRepository, ['rev-parse', '--is-shallow-repository']) !== 'false' || gitText(trustedRepository, ['cat-file', '-t', candidate.base]) !== 'commit') fail('Complete trusted base history required');
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'cloud-candidate-run-')));
  try {
    const tools = join(scratch, 'tools'), data = join(scratch, 'data');
    mkdirSync(tools, { mode: 0o700 }); mkdirSync(data, { mode: 0o700 });
    const pins = pinnedInputs(policy, tools);
    // All schema, path, size, blob and tree verification preceded these writes.
    for (const file of candidate.files) {
      const path = join(data, file.path); mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, decodedFile(file), { flag: 'wx', mode: 0o600 });
    }
    // This is the sole narrow native private-configuration read. Keep one
    // immutable local copy in the runner's mode-0700 scratch; only pinned code
    // ever sees it. Hashes, never terms or this private file, leave the runner.
    let denylist;
    try { denylist = readBounded(denylistPath, 2 * 1024 * 1024); }
    catch { fail('FULL clearance refused: pinned denylist unavailable'); }
    if (digest(denylist) !== policy.denylistSha256) fail('FULL clearance refused: denylist pin mismatch');
    const privateConfig = join(tools, 'private-config.json');
    writeFileSync(privateConfig, denylist, { flag: 'wx', mode: 0o600 });
    const full = ['--require-denylist', '--denylist', privateConfig];
    const tree = run(process.execPath, [pins.tree, data, '--no-gitignore', '--allow-changelogs', '--scope-config', pins.scope, '--opaque-exemptions', pins.opaque, '--json', ...full], tools);
    let treeReport;
    try { treeReport = JSON.parse(utf8.decode(tree.stdout)); } catch { fail('FULL clearance refused: tree scanner failed'); }
    if (!scannerPass(tree) || treeReport.mode !== 'FULL' || !Array.isArray(treeReport.failures) || treeReport.failures.length || treeReport.scanned !== candidate.files.length) fail('FULL clearance refused: tree scanner failed');
    const messageData = join(scratch, 'proposed'); mkdirSync(messageData, { mode: 0o700 });
    writeFileSync(join(messageData, 'message.txt'), candidate.message, { flag: 'wx', mode: 0o600 });
    const messageSecrets = run(process.execPath, [pins.tree, messageData, '--no-gitignore', '--scope-config', pins.scope, '--opaque-exemptions', pins.opaque, '--json', ...full], tools);
    let messageReport;
    try { messageReport = JSON.parse(utf8.decode(messageSecrets.stdout)); } catch { fail('FULL clearance refused: proposed message scanner failed'); }
    if (!scannerPass(messageSecrets) || messageReport.mode !== 'FULL' || messageReport.scanned !== 1 || !Array.isArray(messageReport.failures) || messageReport.failures.length) fail('FULL clearance refused: proposed message scanner failed');
    const messages = run(process.execPath, [pins.message, candidate.base, '--title', candidate.message, '--exceptions', pins.exceptions, ...full], trustedRepository);
    const output = messages.stdout?.toString('utf8') ?? '';
    if (!scannerPass(messages) || !/^mode: FULL \(/m.test(output) || !output.endsWith('PASS — no private identity found in scanned commit message text.\n')) fail('FULL clearance refused: message/history scanner failed');
    // Explicit built-in native rules: no candidate-selected config, allowlist,
    // ignore file, baseline or ambient tool setting. Only the base and ancestors
    // are in history; the entire staged tree was scanned above, including adds.
    const config = join(tools, 'native.toml'); writeFileSync(config, '[extend]\nuseDefault = true\n', { flag: 'wx', mode: 0o600 });
    const history = run(pins.history, ['git', trustedRepository, `--log-opts=${candidate.base} --no-ext-diff --no-textconv --no-show-signature`, '--config', config, '--gitleaks-ignore-path', tools, '--ignore-gitleaks-allow', '--redact=100', '--no-banner', '--log-level', 'error', '--exit-code', '1'], tools);
    // Some native scanner versions return 0 when git writes an error to stderr
    // and no patch stream gets scanned. A zero status alone is not clearance.
    if (!scannerPass(history) || history.stderr.length !== 0) fail('FULL clearance refused: native history scanner failed');
    // Revalidate the exact in-memory artifact after scanning, with no output or
    // findings containing private terms. Nothing about the denylist is exported.
    parseCandidate(artifact, policy);
    const issuedAt = Date.now();
    const payload = { version: 1, status: 'FULL', candidateSha256: digest(artifact), repository: candidate.repository, owner: candidate.owner, base: candidate.base, tree: candidate.tree, unit: candidate.unit, messageSha256: digest(candidate.message), policySha256: digest(encode(policy)), scannerSha256: scannerDigest(policy), nonce: policy.nonce, issuedAt, expiresAt: Math.min(policy.expiresAt, issuedAt + MAX_AGE), checks: { tree: 'FULL', message: 'FULL', history: 'PASS' }, history: { kind: 'base-ancestry', head: candidate.base } };
    const signature = sign(null, encode(payload), privateKey).toString('base64');
    const receipt = encode({ payload, signature });
    verifyReceipt({ artifact, receipt, policy, message: candidate.message });
    return receipt;
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
export function verifyReceipt({ artifact, receipt, policy, repositoryPath, message }) {
  artifact = Buffer.from(artifact);
  validatePolicy(policy);
  if (engineDigest() !== policy.engineSha256) fail('Trusted consumer engine pin mismatch');
  const candidate = parseCandidate(artifact, policy);
  if (typeof message !== 'string' || digest(message) !== policy.messageSha256) fail('Expected proposed message required');
  const signed = canonical(receipt, 16384);
  keys(signed, ['payload', 'signature']);
  if (typeof signed.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(signed.signature) || !verify(null, encode(signed.payload), createPublicKey(policy.publicKey), Buffer.from(signed.signature, 'base64'))) fail('Unauthenticated receipt');
  const p = signed.payload;
  keys(p, ['version', 'status', 'candidateSha256', 'repository', 'owner', 'base', 'tree', 'unit', 'messageSha256', 'policySha256', 'scannerSha256', 'nonce', 'issuedAt', 'expiresAt', 'checks', 'history']);
  keys(p.checks, ['tree', 'message', 'history']); keys(p.history, ['kind', 'head']);
  if (p.version !== 1 || p.status !== 'FULL' || p.checks.tree !== 'FULL' || p.checks.message !== 'FULL' || p.checks.history !== 'PASS' || p.history.kind !== 'base-ancestry' || p.history.head !== policy.base) fail('FULL tree, message and complete base history required');
  bindings(candidate, p);
  if (p.candidateSha256 !== digest(artifact) || p.policySha256 !== digest(encode(policy)) || p.scannerSha256 !== scannerDigest(policy) || p.nonce !== policy.nonce) fail('Receipt candidate/policy/scanner binding mismatch');
  const now = Date.now();
  if (!Number.isSafeInteger(p.issuedAt) || !Number.isSafeInteger(p.expiresAt) || p.issuedAt > now || p.issuedAt < now - MAX_AGE || p.expiresAt <= now || p.expiresAt > p.issuedAt + MAX_AGE || p.expiresAt > policy.expiresAt) fail('Stale receipt');
  if (repositoryPath) {
    const current = exportCandidate({ repositoryPath, ...policy, message });
    if (!current.equals(Buffer.from(artifact))) fail('Current staged candidate differs from clearance');
  }
  return { status: 'FULL', tree: candidate.tree, candidateSha256: p.candidateSha256, expiresAt: p.expiresAt };
}
// Used by the CLI only: anchors must be outside the mutable repository and
// regular files, with no symlinked path component. This cannot attest a remote
// owner's authority: the caller must provision this path through its own trust.
export function externalFile(path, repositoryPath, limit = 1024 * 1024) {
  const absolute = resolve(path);
  if (realpathSync(absolute) !== absolute || !outside(absolute, realpathSync(repositoryPath))) fail('External independently provisioned trust file required');
  return readBounded(absolute, limit);
}
export function writeArtifact(path, bytes, repositoryPath) {
  const parent = realpathSync(dirname(resolve(path)));
  if (repositoryPath && !outside(parent, realpathSync(repositoryPath))) fail('Private artifact output must be outside repository');
  writeFileSync(join(parent, path.split(/[\\/]/).at(-1)), bytes, { flag: 'wx', mode: 0o600 });
}
