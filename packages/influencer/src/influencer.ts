import { InfluencerActionError } from "./errors.js";
import type {
  CompletedPresenceActionResult,
  Influencer,
  InfluencerConfig,
  PresenceActionFailure,
  PresenceActionResult,
} from "./types.js";
import { assertValidPresenceActionIntent } from "./validation.js";

function validInstant(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function normalizeFailure(error: unknown): PresenceActionFailure {
  if (error instanceof InfluencerActionError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.provider === undefined ? {} : { provider: error.provider }),
    };
  }
  return {
    code: "unexpected_actuator_error",
    message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    retryable: false,
  };
}

async function observe(observer: InfluencerConfig["onResult"], result: PresenceActionResult): Promise<void> {
  try {
    await observer?.(result);
  } catch {
    // Best-effort observability is not a second action dependency.
  }
}

/** Build the required atomic claim -> authority -> act -> durable completion cycle. */
export function createInfluencer(config: InfluencerConfig): Influencer {
  if (typeof config.authority !== "function") throw new TypeError("Influencer requires a current authority policy");
  if (!config.actuator || typeof config.actuator.execute !== "function") {
    throw new TypeError("Influencer requires an injected presence actuator");
  }
  if (!config.ledger || typeof config.ledger.claim !== "function" || typeof config.ledger.complete !== "function") {
    throw new TypeError("Influencer requires an atomic durable action ledger");
  }

  return {
    async act(intent) {
      assertValidPresenceActionIntent(intent);
      const base = {
        intentId: intent.id,
        experimentId: intent.experimentId,
        channelId: intent.channelId,
        actionKind: intent.actionKind,
      } as const;

      const claim = await config.ledger.claim(intent);
      if (claim.state === "duplicate") {
        const result: PresenceActionResult = { ...base, state: "duplicate", reason: "duplicate" };
        await observe(config.onResult, result);
        return result;
      }

      // A thrown or malformed authority read deliberately leaves this lease
      // uncompleted. The host may reclaim it under its declared lease rules;
      // no authorization or terminal denial was observed.
      const decision = await config.authority(intent);
      if (
        !decision
        || !(["authorized", "denied", "unverifiable"] as const).includes(decision.state)
        || ((decision.state === "denied" || decision.state === "unverifiable") && !decision.reason.trim())
      ) {
        throw new TypeError("Influencer authority policy returned an invalid decision");
      }
      if (decision.state === "unverifiable") {
        const result: PresenceActionResult = { ...base, state: "unverifiable", reason: decision.reason };
        await observe(config.onResult, result);
        return result;
      }
      if (decision.state === "denied") {
        const result: CompletedPresenceActionResult = { ...base, state: "skipped", reason: decision.reason };
        await config.ledger.complete(claim, result);
        await observe(config.onResult, result);
        return result;
      }

      let result: CompletedPresenceActionResult;
      try {
        const receipt = await config.actuator.execute(intent);
        if (
          !receipt
          || !receipt.provider?.trim()
          || !receipt.remoteActionId?.trim()
          || !validInstant(receipt.observedAt)
          || Date.parse(receipt.observedAt) < Date.parse(intent.requestedAt)
        ) {
          throw new InfluencerActionError(
            "invalid_actuator_receipt",
            "Presence actuator receipt must identify the provider, remote action, and a valid observation at or after requestedAt",
            { retryable: false },
          );
        }
        result = { ...base, state: "applied", receipt };
      } catch (error) {
        result = { ...base, state: "failed", failure: normalizeFailure(error) };
      }

      await config.ledger.complete(claim, result);
      await observe(config.onResult, result);
      return result;
    },
  };
}
