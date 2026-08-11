import { CommunicationDeliveryError } from "./errors.js";
import type {
  CommunicationDispatchResult,
  CommunicationDispatcher,
  CommunicationDispatcherConfig,
  CommunicationFailure,
} from "./types.js";
import { assertValidCommunicationMessage } from "./validation.js";

function failureFrom(error: unknown): CommunicationFailure {
  if (error instanceof CommunicationDeliveryError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.provider === undefined ? {} : { provider: error.provider }),
    };
  }
  return {
    code: "unexpected_adapter_error",
    message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    retryable: false,
  };
}

async function observe(
  observer: CommunicationDispatcherConfig["onResult"],
  result: CommunicationDispatchResult,
): Promise<void> {
  try {
    await observer?.(result);
  } catch {
    // Observability is not a second delivery dependency.
  }
}

/** Create the policy -> claim -> transport -> durable-result pipeline. */
export function createCommunicationDispatcher(config: CommunicationDispatcherConfig): CommunicationDispatcher {
  return {
    async dispatch(message) {
      assertValidCommunicationMessage(message);

      const base = {
        messageId: message.id,
        event: message.event,
        category: message.category,
        channel: message.channel,
      } as const;

      const policy = (await config.policy?.(message)) ?? { outcome: "allow" as const };
      if (policy.outcome === "deny") {
        const result: CommunicationDispatchResult = {
          ...base,
          state: "skipped",
          reason: policy.reason,
        };
        await observe(config.onResult, result);
        return result;
      }

      const claim = await config.ledger?.claim(message);
      if (claim?.outcome === "duplicate") {
        const result: CommunicationDispatchResult = {
          ...base,
          state: "duplicate",
          reason: "duplicate",
        };
        await observe(config.onResult, result);
        return result;
      }

      const adapter = config.adapters[message.channel];
      let result: CommunicationDispatchResult;
      if (!adapter) {
        result = {
          ...base,
          state: "failed",
          failure: {
            code: "channel_unconfigured",
            message: `No adapter is configured for channel "${message.channel}"`,
            retryable: false,
          },
        };
      } else {
        try {
          const acceptance = await adapter.deliver(message);
          if (!acceptance.provider.trim() || !acceptance.messageId.trim()) {
            throw new CommunicationDeliveryError(
              "invalid_adapter_result",
              "Adapter acceptance must contain non-empty provider and messageId values",
              { retryable: false },
            );
          }
          result = { ...base, state: "accepted", acceptance };
        } catch (error) {
          result = { ...base, state: "failed", failure: failureFrom(error) };
        }
      }

      if (claim?.outcome === "claimed") await config.ledger?.complete(claim, result);
      await observe(config.onResult, result);
      return result;
    },
  };
}
