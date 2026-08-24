import { MessengerDeliveryError } from "./errors.js";
import type { DeliveryFailure, DispatchResult, Messenger, MessengerConfig } from "./types.js";
import { assertValidDeliveryIntent } from "./validation.js";

function normalizeFailure(error: unknown): DeliveryFailure {
  if (error instanceof MessengerDeliveryError) {
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

async function observe(observer: MessengerConfig["onResult"], result: DispatchResult): Promise<void> {
  try {
    await observer?.(result);
  } catch {
    // Best-effort observability is not a second delivery dependency.
  }
}

/** Build the required claim -> policy -> transport -> durable completion pipeline. */
export function createMessenger(config: MessengerConfig): Messenger {
  if (typeof config.policy !== "function") throw new TypeError("Messenger requires an authorization policy");
  if (!config.ledger || typeof config.ledger.claim !== "function" || typeof config.ledger.complete !== "function") {
    throw new TypeError("Messenger requires a durable dispatch ledger");
  }

  return {
    async dispatch(intent) {
      assertValidDeliveryIntent(intent);
      const base = {
        intentId: intent.message.id,
        event: intent.message.event,
        category: intent.message.category,
        channel: intent.message.channel,
      } as const;

      const claim = await config.ledger.claim(intent);
      if (claim.outcome === "duplicate") {
        const result: DispatchResult = { ...base, state: "duplicate", reason: "duplicate" };
        await observe(config.onResult, result);
        return result;
      }

      // A thrown or malformed policy decision deliberately leaves this lease
      // uncompleted and reclaimable under the host ledger's lease rules. It is
      // not evidence of either authorization or terminal denial.
      const decision = await config.policy(intent);
      if (
        !decision
        || (decision.outcome !== "allow" && decision.outcome !== "deny")
        || (decision.outcome === "deny" && !decision.reason.trim())
      ) {
        throw new TypeError("Messenger authorization policy returned an invalid decision");
      }
      if (decision.outcome === "deny") {
        const result: DispatchResult = { ...base, state: "skipped", reason: decision.reason };
        await config.ledger.complete(claim, result);
        await observe(config.onResult, result);
        return result;
      }

      const adapter = config.adapters[intent.message.channel];
      let result: DispatchResult;
      if (!adapter) {
        result = {
          ...base,
          state: "failed",
          failure: {
            code: "channel_unconfigured",
            message: `No adapter is configured for channel "${intent.message.channel}"`,
            retryable: false,
          },
        };
      } else {
        try {
          const acceptance = await adapter.deliver(intent.message);
          if (!acceptance.provider.trim() || !acceptance.messageId.trim()) {
            throw new MessengerDeliveryError(
              "invalid_adapter_result",
              "Adapter acceptance must contain non-empty provider and messageId values",
              { retryable: false },
            );
          }
          result = { ...base, state: "accepted", acceptance };
        } catch (error) {
          result = { ...base, state: "failed", failure: normalizeFailure(error) };
        }
      }

      await config.ledger.complete(claim, result);
      await observe(config.onResult, result);
      return result;
    },
  };
}
