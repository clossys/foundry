import { useCallback, useEffect, useState } from "react";
import { evaluateStandingInstruction } from "../contract.js";
import type {
  CurrencyWindow,
  PolicyVersion,
  StandingAction,
  StandingEvaluation,
  StandingEvaluationPolicy,
  StandingInstruction,
  StandingTopic,
} from "../schema.js";

/**
 * The client-side counterpart to `StandingInstructionStore`.
 *
 * `StandingInstructionStore` is `Promise`-based host-implemented I/O, most
 * naturally implemented behind a server boundary — a database read, a
 * server-side session — that a browser cannot call directly as a plain
 * async function. A hook that genuinely reads and writes standing
 * instructions needs a client-shaped port instead: something a browser
 * really can call, typically a `fetch` to a host-owned route that itself
 * runs `decideStandingChange` and writes both the instruction and the
 * audit event server-side. This is that port — still host-implemented,
 * still carrying no opinion about transport, but shaped for the side of
 * the boundary that actually runs in a browser.
 */
export interface StandingWantsClient {
  /** Reads every stored instruction for `subjectId`, however the host's own API/storage boundary is reached. */
  read(subjectId: string): Promise<readonly StandingInstruction[]>;
  /**
   * Applies one decided action and returns the durably-stored instruction.
   * The host is expected to run `decideStandingChange` (or equivalent) on
   * its own server and write both the instruction and the audit event
   * before resolving — this hook never computes or stores anything itself.
   */
  apply(subjectId: string, action: StandingAction): Promise<StandingInstruction>;
}

export interface UseStandingWantsOptions {
  subjectId: string;
  /** The topics this preference surface manages. Determines the keys of `evaluations`. */
  topics: readonly StandingTopic[];
  policyVersion: PolicyVersion;
  /** The window written onto any instruction this surface decides. No default — see `CurrencyWindow`. */
  currency: CurrencyWindow;
  /** No default — see `StandingEvaluationPolicy`; the host must decide this explicitly. */
  evaluationPolicy: StandingEvaluationPolicy;
  /** The moment to evaluate currency against, as an ISO timestamp. Supplied by the caller so a surface renders the same answer on the server and on the client rather than drifting with an ambient clock. */
  now: string;
  client: StandingWantsClient;
}

export interface UseStandingWantsResult {
  /** One evaluation per requested topic. A topic with no stored instruction evaluates to `absent`, never to a falsy value that could read as a denial or as permission. */
  evaluations: Readonly<Record<StandingTopic, StandingEvaluation>>;
  /** `true` while the initial `client.read` call is in flight. */
  loading: boolean;
  /** The error thrown by the most recent `client.read`/`client.apply` call, if any. Never thrown by this hook itself. */
  error: unknown;
  grant(topic: StandingTopic): Promise<void>;
  deny(topic: StandingTopic): Promise<void>;
  /**
   * Withdraw is reachable through the SAME call shape as grant and deny —
   * one topic, one promise, one function on the same object. That is
   * withdrawal parity enforced structurally at the API surface, not
   * asserted in prose: there is no separate, harder-to-reach function and
   * no extra argument for revoking a want than for giving one. The
   * `withdrawal-parity` gate measures the same property one layer out, in
   * a consumer's real interface, where this hook cannot see.
   */
  withdraw(topic: StandingTopic): Promise<void>;
}

/**
 * Manages a preference surface's standing wants: reads every stored
 * instruction for `subjectId` once on mount, evaluates each of `topics`
 * against `policyVersion` AND the supplied `now`, and exposes
 * `grant`/`deny`/`withdraw` as identically-shaped async functions backed by
 * the same `client.apply` call.
 *
 * The evaluation is currency-aware, which is the whole difference between
 * this and a hook that reads a row: an instruction that exists, and was
 * granted, and is a year past its own declared window comes back `stale`,
 * not `granted`. Rendering a surface off `evaluations` therefore re-asks
 * on its own rather than quietly continuing to act on an answer nobody has
 * checked since it was written.
 */
export function useStandingWants(options: UseStandingWantsOptions): UseStandingWantsResult {
  const { subjectId, topics, policyVersion, currency, evaluationPolicy, now, client } = options;
  const [instructions, setInstructions] = useState<Readonly<Record<StandingTopic, StandingInstruction>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    client
      .read(subjectId)
      .then((all) => {
        if (cancelled) return;
        const byTopic: Record<StandingTopic, StandingInstruction> = {};
        for (const instruction of all) byTopic[instruction.topic] = instruction;
        setInstructions(byTopic);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, subjectId]);

  const applyAction = useCallback(
    async (action: StandingAction) => {
      try {
        const instruction = await client.apply(subjectId, action);
        setInstructions((previous) => ({ ...previous, [instruction.topic]: instruction }));
      } catch (caught: unknown) {
        setError(caught);
      }
    },
    [client, subjectId],
  );

  const grant = useCallback((topic: StandingTopic) => applyAction({ kind: "grant", topic, policyVersion, currency }), [applyAction, policyVersion, currency]);
  const deny = useCallback((topic: StandingTopic) => applyAction({ kind: "deny", topic, policyVersion, currency }), [applyAction, policyVersion, currency]);
  const withdraw = useCallback((topic: StandingTopic) => applyAction({ kind: "withdraw", topic, policyVersion, currency }), [applyAction, policyVersion, currency]);

  const evaluations: Record<StandingTopic, StandingEvaluation> = {};
  for (const topic of topics) {
    evaluations[topic] = evaluateStandingInstruction(instructions[topic], policyVersion, evaluationPolicy, now);
  }

  return { evaluations, loading, error, grant, deny, withdraw };
}
