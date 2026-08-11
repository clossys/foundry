import type { SecretKey, SyncSecretsAdapter, TestSecretsAdapter } from "./types.js";

export type EnvironmentSource = Readonly<Record<string, string | undefined>> | (() => Readonly<Record<string, string | undefined>>);

export function createEnvSecretsAdapter(source: EnvironmentSource = () => process.env): SyncSecretsAdapter {
  return Object.freeze({
    get(key: SecretKey): string | null {
      const environment = typeof source === "function" ? source() : source;
      return Object.hasOwn(environment, key) ? environment[key] ?? null : null;
    },
  });
}

function isReadonlyMap(
  value: Readonly<Record<SecretKey, string>> | ReadonlyMap<SecretKey, string>,
): value is ReadonlyMap<SecretKey, string> {
  const candidate = value as Partial<ReadonlyMap<SecretKey, string>>;
  return typeof candidate.get === "function" && typeof candidate[Symbol.iterator] === "function";
}

export function createTestSecretsAdapter(
  initial: Readonly<Record<SecretKey, string>> | ReadonlyMap<SecretKey, string> = {},
): TestSecretsAdapter {
  const values = isReadonlyMap(initial) ? new Map(initial) : new Map(Object.entries(initial));

  return {
    get(key: SecretKey): string | null {
      return values.get(key) ?? null;
    },
    set(key: SecretKey, value: string): void {
      values.set(key, value);
    },
    delete(key: SecretKey): boolean {
      return values.delete(key);
    },
    clear(): void {
      values.clear();
    },
    keys(): readonly SecretKey[] {
      return [...values.keys()].sort();
    },
  };
}
