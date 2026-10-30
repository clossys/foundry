import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { discoverBriefContracts } from '../../dist/brief-contracts.js';

const absent = error => error.code === 'ENOENT';
// Mirror the CLI's confined reader policy, retaining raw bytes rather than decoded JSON.
function confined(root, path) {
  if (lstatSync(root).isSymbolicLink()) throw new Error('Symlink root is not allowed');
  const anchor = realpathSync(root);
  if (!lstatSync(anchor).isDirectory()) throw new Error('Expected a directory root');
  const rel = relative(anchor, resolve(anchor, path));
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Path is outside root');
  let current = anchor;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error('Symlink path is not allowed');
  }
  return current;
}
function bytesAt(root, path) {
  let fd;
  try {
    fd = openSync(confined(root, path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = fstatSync(fd);
    if (!opened.isFile()) throw new Error('Expected a regular file');
    const current = lstatSync(confined(root, path));
    if (current.dev !== opened.dev || current.ino !== opened.ino) throw new Error('File changed while opening');
    return readFileSync(fd);
  } catch (error) { if (absent(error)) return undefined; throw error; }
  finally { if (fd !== undefined) closeSync(fd); }
}

// Keep source lookup aligned with discoverBriefContracts: all local JSON files, then
// every ancestor's sorted @clossys packages, real package roots deduplicated globally.
// Package links intentionally may resolve outside the strategy root, just as in the CLI.
export function snapshotContracts(rootArg, catalog) {
  const root = resolve(rootArg), files = {}, inventory = [], issues = [], seen = new Set();
  const issue = (path, message) => issues.push({ path, message });
  function read(anchor, path, source) {
    try {
      const bytes = bytesAt(anchor, path);
      if (bytes === undefined) return;
      const key = join(anchor, path);
      inventory.push({ source, path: key });
      files[key] = { base64: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') };
    } catch { issue(path, 'Brief contract path is unreadable or unsafe'); }
  }
  try {
    const local = confined(root, 'contracts');
    for (const name of readdirSync(local).sort()) if (name.endsWith('.json')) read(root, `contracts/${name}`, `contracts/${name}`);
  } catch (error) { if (!absent(error)) issue('contracts', 'Brief contract directory is unreadable or unsafe'); }
  for (let ancestor = root; ; ancestor = dirname(ancestor)) {
    const scope = join(ancestor, 'node_modules', '@clossys');
    try {
      if (lstatSync(scope).isSymbolicLink() || !lstatSync(scope).isDirectory()) throw new Error('Unsafe package scope');
      for (const name of readdirSync(scope).sort()) {
        try {
          const packageRoot = realpathSync(join(scope, name));
          if (!lstatSync(packageRoot).isDirectory() || seen.has(packageRoot)) continue;
          seen.add(packageRoot);
          read(packageRoot, 'strategy-brief.json', join(scope, name, 'strategy-brief.json'));
        } catch { issue(join(scope, name), 'Installed contract package is unreadable'); }
      }
    } catch (error) { if (!absent(error)) issue(scope, 'Installed brief contract scope is unreadable or unsafe'); }
    if (dirname(ancestor) === ancestor) break;
  }
  const discovered = discoverBriefContracts(root, catalog);
  return { inventory, files, contracts: discovered.contracts, issues: [...issues, ...discovered.issues] };
}
