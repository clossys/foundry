/**
 * The consumer a package test or script reads (SOURCE-MIGRATE step 8): `$CLOSSYS_ROOT`, a root that
 * holds the consumer's clossys/ folder, else this package's synthetic fixture consumer
 * (test-fixtures/consumer). A package never reaches its consumer by a relative path.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURE_CONSUMER = fileURLToPath(new URL('../test-fixtures/consumer', import.meta.url));

/** The consumer root (the directory holding clossys/). */
export function consumerRoot() {
  return process.env.CLOSSYS_ROOT ? resolve(process.env.CLOSSYS_ROOT) : FIXTURE_CONSUMER;
}

/** A path inside the consumer's clossys/ folder. */
export function consumerPath(...parts) {
  return join(consumerRoot(), 'clossys', ...parts);
}

/**
 * `<root>/clossys/<parts>` when the caller named `root`, else the configured consumer's: a script
 * whose default root is this checkout reads `$CLOSSYS_ROOT` or the fixture (step 11, no clossys/ here).
 */
export function consumerUnder(root, defaultRoot, ...parts) {
  return resolve(root) === resolve(defaultRoot) ? consumerPath(...parts) : join(root, 'clossys', ...parts);
}

/** A cwd-default script's consumer root: `$CLOSSYS_ROOT`, else `cwd` when it holds clossys/, else the fixture. */
export function consumerRootAt(cwd = process.cwd()) {
  if (process.env.CLOSSYS_ROOT) return resolve(process.env.CLOSSYS_ROOT);
  return existsSync(join(cwd, 'clossys')) ? resolve(cwd) : FIXTURE_CONSUMER;
}
