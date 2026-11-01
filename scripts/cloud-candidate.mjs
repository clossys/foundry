#!/usr/bin/env node
// Local artifacts and explicit native commit/delivery admission; no push or hook
// installation exists. Admission uses only a fixed native owner installation.
// TRUST: execute from an independently pinned installation, never the snapshot.
// Provision a canonical external policy JSON with version, repository, owner,
// base (exact HEAD), unit, messageSha256, nonce (64 hex), expiresAt (epoch ms,
// at most 24 h), engineSha256, denylistSha256 (native private configuration
// digest), inputs and Ed25519 publicKey (SPKI PEM). inputs
// pins {path,sha256} for tree/message scanners, scope/opaque/exceptions config,
// history (native gitleaks binary), historyConfig and historyExceptions (reviewed
// exact fingerprints). See INPUTS in the library for source
// paths. Pins and keys are provisioned by the owner, never from candidate data.
// Qualify uses only pinned code/config copies plus a separate trusted full Git
// history repository. A receipt expires within 15 min; verify also compares the
// live index and HEAD. Run native FULL checks and hooks after verification.
// Transport canaries and independent gate reviews are required before use.
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { exportCandidate, qualifyCandidate, verifyReceipt, externalFile, readBounded, writeArtifact, remoteGate, admitCommit, admitDelivery } from './lib/cloud-candidate.mjs';

function options(args, names) {
  const result = {};
  if (args.length !== names.length * 2) throw new Error('Explicit local input/output options required');
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i].slice(2);
    if (!args[i].startsWith('--') || !names.includes(name) || result[name] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Invalid explicit option');
    result[name] = args[i + 1];
  }
  return result;
}
try {
  const [command, ...args] = process.argv.slice(2);
  let outcome;
  if (['remote-check', 'admit-commit', 'admit-delivery'].includes(command)) {
    const o = options(args, ['repository-path', 'artifact', 'receipt', 'message']);
    const input = { repositoryPath: o['repository-path'], artifactPath: o.artifact, receiptPath: o.receipt, messagePath: o.message };
    outcome = command === 'remote-check' ? remoteGate(input) : command === 'admit-commit' ? await admitCommit(input) : admitDelivery(input);
  } else if (command === 'keygen') {
    const o = options(args, ['repository-path', 'private-key', 'public-key']);
    const parent = realpathSync(dirname(resolve(o['private-key'])));
    if ((lstatSync(parent).mode & 0o077) !== 0) throw new Error('Private signing state directory must have mode 0700');
    const keys = generateKeyPairSync('ed25519');
    writeArtifact(o['private-key'], keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), o['repository-path']);
    writeArtifact(o['public-key'], keys.publicKey.export({ type: 'spki', format: 'pem' }), o['repository-path']);
  } else if (command === 'export') {
    const o = options(args, ['repository-path', 'repository', 'owner', 'base', 'unit', 'message', 'output']);
    const message = new TextDecoder('utf-8', { fatal: true }).decode(readBounded(o.message, 32768));
    const artifact = exportCandidate({ repositoryPath: o['repository-path'], repository: o.repository, owner: o.owner, base: o.base, unit: o.unit, message });
    writeArtifact(o.output, artifact, o['repository-path']);
  } else if (command === 'qualify') {
    const o = options(args, ['artifact', 'policy', 'trusted-repository', 'denylist', 'private-key', 'output']);
    const repo = o['trusted-repository'];
    const policy = JSON.parse(externalFile(o.policy, repo).toString('utf8'));
    const keyPath = resolve(o['private-key']);
    if ((lstatSync(keyPath).mode & 0o077) !== 0 || (lstatSync(dirname(keyPath)).mode & 0o077) !== 0) throw new Error('Private signing state permissions required');
    const privateKey = externalFile(keyPath, repo, 4096);
    if (createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString() !== policy.publicKey) throw new Error('Signing key differs from owner trust anchor');
    const receipt = qualifyCandidate({ artifact: readBounded(o.artifact), policy, trustedRepository: repo, denylistPath: o.denylist, privateKey });
    writeArtifact(o.output, receipt, repo);
  } else if (command === 'verify') {
    const o = options(args, ['artifact', 'receipt', 'policy', 'repository-path', 'message']);
    const policy = JSON.parse(externalFile(o.policy, o['repository-path']).toString('utf8'));
    const message = new TextDecoder('utf-8', { fatal: true }).decode(readBounded(o.message, 32768));
    verifyReceipt({ artifact: readBounded(o.artifact), receipt: readBounded(o.receipt, 16384), policy, repositoryPath: o['repository-path'], message });
  } else throw new Error('Use export, qualify, verify or keygen with explicit local paths');
  console.log(JSON.stringify(outcome ?? { operation: command, admission: false }));
} catch {
  // No scanner output, candidate strings, file names, denylist metadata or keys.
  console.error('Candidate operation refused; explicit trusted inputs and native FULL success required.');
  process.exitCode = 2;
}
