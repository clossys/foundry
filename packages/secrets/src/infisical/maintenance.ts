import type { SecretKey } from "../types.js";
import { createInfisicalClient } from "./client.js";
import { InfisicalError } from "./errors.js";
import { InfisicalTransport } from "./internal.js";
import type {
  InfisicalClientConfig,
  InfisicalMaintenanceClient,
  InfisicalMutationPolicy,
  ReplaceSecretOptions,
  ReplaceSecretResult,
} from "./types.js";

const replacementQueues = new Map<string, Promise<void>>();

export function createInfisicalMaintenanceClient(
  config: InfisicalClientConfig,
  authorize: InfisicalMutationPolicy,
): InfisicalMaintenanceClient {
  const transport = new InfisicalTransport(config);
  const readClient = createInfisicalClient(config);
  const queueKeyFor = (key: SecretKey): string => JSON.stringify([
    transport.config.baseUrl,
    transport.config.projectId,
    transport.config.environment,
    transport.config.secretPath,
    key,
  ]);

  const replace = async (
    key: SecretKey,
    replacement: string,
    options: ReplaceSecretOptions,
  ): Promise<ReplaceSecretResult> => {
    let allowed = false;
    try {
      allowed = await authorize({
        operation: "replace",
        key,
        projectId: transport.config.projectId,
        environment: transport.config.environment,
        secretPath: transport.config.secretPath,
      });
    } catch {
      allowed = false;
    }
    if (!allowed) {
      throw new InfisicalError("INFISICAL_MUTATION_DENIED", "Infisical secret replacement was not authorized.", {
        key,
      });
    }
    if (replacement.length === 0) {
      throw new InfisicalError("INFISICAL_REPLACEMENT_FAILED", "Infisical secret replacement must not be empty.", {
        key,
      });
    }

    const previous = await transport.get(key, { expandSecretReferences: false });
    if (previous === null) {
      throw new InfisicalError("INFISICAL_REPLACEMENT_FAILED", "Infisical secret replacement requires an existing key.", {
        key,
      });
    }
    if (previous === replacement) {
      throw new InfisicalError(
        "INFISICAL_REPLACEMENT_FAILED",
        "Infisical secret replacement must differ from the current value.",
        { key },
      );
    }

    await transport.replace(key, replacement);
    if (options.verify !== undefined) {
      try {
        await options.verify(readClient);
      } catch {
        throw new InfisicalError(
          "INFISICAL_REPLACEMENT_FAILED",
          "Infisical replacement verification failed; no automatic rollback was attempted.",
          { key },
        );
      }
    }

    return { key, replaced: true, verified: options.verify !== undefined };
  };

  return Object.freeze({
    replaceSecret(
      key: SecretKey,
      replacement: string,
      options: ReplaceSecretOptions = {},
    ): Promise<ReplaceSecretResult> {
      const queueKey = queueKeyFor(key);
      const previous = replacementQueues.get(queueKey) ?? Promise.resolve();
      const pending = previous.then(() => replace(key, replacement, options));
      const tail = pending.then(() => undefined, () => undefined);
      replacementQueues.set(queueKey, tail);
      return pending.finally(() => {
        if (replacementQueues.get(queueKey) === tail) replacementQueues.delete(queueKey);
      });
    },
  });
}
