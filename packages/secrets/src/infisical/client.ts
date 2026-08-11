import { spawn } from "node:child_process";
import type { SecretCatalog, SecretKey } from "../types.js";
import { InfisicalError } from "./errors.js";
import { InfisicalTransport } from "./internal.js";
import type {
  InfisicalClient,
  InfisicalClientConfig,
  InfisicalRunOptions,
  InfisicalRunResult,
  SecretReadinessReport,
} from "./types.js";

const ENVIRONMENT_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PROVIDER_AUTH_ENVIRONMENT_KEYS = new Set([
  "INFISICAL_TOKEN",
  "INFISICAL_JWT",
  "INFISICAL_MACHINE_IDENTITY_ID",
  "INFISICAL_UNIVERSAL_AUTH_CLIENT_ID",
  "INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET",
  "INFISICAL_CUSTOM_HEADERS",
]);

export function createInfisicalClient(config: InfisicalClientConfig): InfisicalClient {
  const transport = new InfisicalTransport(config);

  const client: InfisicalClient = {
    async get(key: SecretKey): Promise<string | null> {
      return transport.get(key);
    },

    async listSecretNames(): Promise<readonly SecretKey[]> {
      const records = await transport.list(false);
      return [...new Set(records.map((record) => record.key))].sort();
    },

    async checkCatalog(catalog: SecretCatalog): Promise<SecretReadinessReport> {
      if (catalog.entries.length === 0) {
        throw new InfisicalError(
          "INFISICAL_CONFIGURATION_INVALID",
          "Secret catalog must contain at least one entry.",
        );
      }
      const keys = new Set<SecretKey>();
      for (const entry of catalog.entries) {
        if (keys.has(entry.key)) {
          throw new InfisicalError(
            "INFISICAL_CONFIGURATION_INVALID",
            "Secret catalog keys must be unique.",
            { key: entry.key },
          );
        }
        keys.add(entry.key);
      }
      const entries = [];
      for (const entry of catalog.entries) {
        const value = await transport.get(entry.key);
        entries.push({ key: entry.key, required: entry.required, present: value !== null && value.length > 0 });
      }
      return {
        ok: entries.every((entry) => !entry.required || entry.present),
        entries,
      };
    },

    async run(command: readonly string[], options: InfisicalRunOptions = {}): Promise<InfisicalRunResult> {
      const executable = command[0];
      if (executable === undefined || executable.length === 0) {
        throw new InfisicalError("INFISICAL_RUN_FAILED", "Infisical run requires a command.");
      }
      const records = await transport.list(true);
      const injected = Object.create(null) as NodeJS.ProcessEnv;
      const injectedKeys = new Map<string, string>();
      for (const record of records) {
        if (PROVIDER_AUTH_ENVIRONMENT_KEYS.has(record.key.toUpperCase())) {
          throw new InfisicalError(
            "INFISICAL_RUN_FAILED",
            `Infisical key ${JSON.stringify(record.key)} conflicts with provider authentication state.`,
            { key: record.key },
          );
        }
        if (!ENVIRONMENT_KEY.test(record.key) || record.value === undefined) {
          throw new InfisicalError(
            "INFISICAL_RUN_FAILED",
            `Infisical key ${JSON.stringify(record.key)} cannot be injected as an environment variable.`,
            { key: record.key },
          );
        }
        const comparableKey = process.platform === "win32" ? record.key.toUpperCase() : record.key;
        if (injectedKeys.has(comparableKey)) {
          throw new InfisicalError(
            "INFISICAL_RUN_FAILED",
            `Infisical returned duplicate key ${JSON.stringify(record.key)}; refusing ambiguous injection.`,
            { key: record.key },
          );
        }
        injectedKeys.set(comparableKey, record.key);
        injected[record.key] = record.value;
      }

      const childEnvironment = { ...(options.env ?? process.env) };
      for (const key of Object.keys(childEnvironment)) {
        if (PROVIDER_AUTH_ENVIRONMENT_KEYS.has(key.toUpperCase())) delete childEnvironment[key];
      }
      if (process.platform === "win32") {
        for (const key of Object.keys(childEnvironment)) {
          const injectedKey = injectedKeys.get(key.toUpperCase());
          if (injectedKey !== undefined && injectedKey !== key) {
            throw new InfisicalError(
              "INFISICAL_RUN_FAILED",
              `Inherited environment key ${JSON.stringify(key)} conflicts with injected key ${JSON.stringify(injectedKey)}.`,
              { key },
            );
          }
        }
      }

      return new Promise((resolve, reject) => {
        try {
          const child = spawn(executable, command.slice(1), {
            cwd: options.cwd,
            env: { ...childEnvironment, ...injected },
            shell: false,
            stdio: "inherit",
          });
          let settled = false;
          const signalHandlers = (["SIGINT", "SIGTERM"] as const).map((signal) => {
            const handler = (): void => {
              try {
                child.kill(signal);
              } catch {
                // The exit/error listeners below remain authoritative for the result.
              }
            };
            process.on(signal, handler);
            return { signal, handler };
          });
          const cleanup = (): void => {
            for (const { signal, handler } of signalHandlers) process.off(signal, handler);
          };
          child.once("error", () => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new InfisicalError("INFISICAL_RUN_FAILED", "Infisical child process failed to start."));
          });
          child.once("exit", (exitCode, signal) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve({ exitCode, signal });
          });
        } catch {
          reject(new InfisicalError("INFISICAL_RUN_FAILED", "Infisical child process failed to start."));
        }
      });
    },
  };

  return Object.freeze(client);
}
