/**
 * The consumer a package test reads (SOURCE-MIGRATE step 8): `$CLOSSYS_ROOT`, a root that holds the
 * consumer's clossys/ folder, else this package's synthetic fixture consumer (test-fixtures/consumer).
 * A package never reaches its consumer by a relative path. scripts/consumer-root.mjs is the same for scripts.
 */
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_CONSUMER = fileURLToPath(new URL("../test-fixtures/consumer", import.meta.url));

/** The consumer root (the directory holding clossys/). */
export function consumerRoot(): string {
  return process.env.CLOSSYS_ROOT ? resolve(process.env.CLOSSYS_ROOT) : FIXTURE_CONSUMER;
}

/** A path inside the consumer's clossys/ folder. */
export function consumerPath(...parts: string[]): string {
  return join(consumerRoot(), "clossys", ...parts);
}
