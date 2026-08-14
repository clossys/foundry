import { useCallback, useEffect, useState } from "react";
import { evaluateConsent } from "../evaluate.js";
import type { ConsentAction, ConsentCategory, ConsentEvaluation, ConsentEvaluationPolicy, ConsentPolicyVersion, ConsentRecord } from "../types.js";

/**
 * The client-side counterpart to `ConsentStoragePort`/`ConsentAuditLedger`.
 *
 * This is a deliberate DIVERGENCE from issue #178's illustrative
 * `useConsentPreferences(subjectId, policyVersion)` two-argument signature.
 * That shape has no way to actually reach storage: `ConsentStoragePort` is
 * `Promise`-based host-implemented I/O, most naturally implemented behind a
 * server boundary (a database read, a server-side cookie jar) that a
 * browser cannot call directly as a plain async function. A hook that
 * genuinely reads and writes consent needs a client-shaped port instead —
 * something a browser really can call, typically a `fetch` to a host-owned
 * API route that itself calls `decideConsentChange` and the two I/O ports
 * server-side. `ConsentPreferencesClient` is that port: still
 * host-implemented, still carrying no opinion about transport, but shaped
 * for the side of the boundary that actually runs in a browser.
 */
export interface ConsentPreferencesClient {
  /** Reads every stored record for `subjectId`, however the host's own API/storage boundary is reached. */
  read(subjectId: string): Promise<readonly ConsentRecord[]>;
  /**
   * Applies one decided action and returns the durably-stored record. The
   * host is expected to run `decideConsentChange` (or equivalent) on its
   * own server and write both the record and the audit event before
   * resolving — this hook never computes or stores anything itself.
   */
  apply(subjectId: string, action: ConsentAction): Promise<ConsentRecord>;
}

export interface UseConsentPreferencesOptions {
  subjectId: string;
  /** The categories this preference surface manages. Determines the keys of `evaluations`. */
  categories: readonly ConsentCategory[];
  policyVersion: ConsentPolicyVersion;
  /** No default — see `ConsentEvaluationPolicy`'s own doc comment; the host must decide this explicitly. */
  evaluationPolicy: ConsentEvaluationPolicy;
  client: ConsentPreferencesClient;
}

export interface UseConsentPreferencesResult {
  evaluations: Readonly<Record<ConsentCategory, ConsentEvaluation>>;
  /** `true` while the initial `client.read` call is in flight. Never used by `ConsentGate` — that component takes `evaluation` as a required prop instead of reading this hook's loading state. */
  loading: boolean;
  /** The error thrown by the most recent `client.read`/`client.apply` call, if any. Never thrown by this hook itself. */
  error: unknown;
  grant(category: ConsentCategory): Promise<void>;
  deny(category: ConsentCategory): Promise<void>;
  /**
   * Withdraw must be reachable through the same call shape as grant/deny —
   * "reopening is not a degraded path" (issue #178). There is no separate,
   * harder-to-reach function or a different argument shape for revoking
   * consent than for giving it.
   */
  withdraw(category: ConsentCategory): Promise<void>;
}

/**
 * Manages a preference-center UI's consent state: reads every stored
 * record for `subjectId` once on mount, evaluates each of `categories`
 * against `policyVersion`, and exposes `grant`/`deny`/`withdraw` as
 * identically-shaped async functions backed by the same `client.apply`
 * call.
 */
export function useConsentPreferences(options: UseConsentPreferencesOptions): UseConsentPreferencesResult {
  const { subjectId, categories, policyVersion, evaluationPolicy, client } = options;
  const [records, setRecords] = useState<Readonly<Record<ConsentCategory, ConsentRecord>>>({});
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
        const byCategory: Record<ConsentCategory, ConsentRecord> = {};
        for (const record of all) byCategory[record.category] = record;
        setRecords(byCategory);
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
    async (action: ConsentAction) => {
      const record = await client.apply(subjectId, action);
      setRecords((previous) => ({ ...previous, [record.category]: record }));
    },
    [client, subjectId],
  );

  const grant = useCallback((category: ConsentCategory) => applyAction({ kind: "grant", category, policyVersion }), [applyAction, policyVersion]);
  const deny = useCallback((category: ConsentCategory) => applyAction({ kind: "deny", category, policyVersion }), [applyAction, policyVersion]);
  const withdraw = useCallback((category: ConsentCategory) => applyAction({ kind: "withdraw", category, policyVersion }), [applyAction, policyVersion]);

  const evaluations: Record<ConsentCategory, ConsentEvaluation> = {};
  for (const category of categories) {
    evaluations[category] = evaluateConsent(records[category], policyVersion, evaluationPolicy);
  }

  return { evaluations, loading, error, grant, deny, withdraw };
}
