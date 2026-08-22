import { useCallback, useEffect, useState } from "react";
import { decideHolding } from "../contract.js";
import type { DispositionRead, Holding, ReachRead, RetentionRead, SourceRead } from "../contract.js";
import type { DeletionEffect, HeldItem } from "../schema.js";

/**
 * The client-side counterpart to `HoldingStore` and `DisclosureDirectory`.
 *
 * Those ports are `Promise`-based host-implemented I/O, most naturally
 * implemented behind a server boundary — a database read, an object store, a
 * server-side session — that a browser cannot call directly as a plain async
 * function. A hook that genuinely shows a person what is held about them
 * needs a client-shaped port instead: something a browser really can call,
 * typically a `fetch` to a host-owned route that itself reads the store and
 * writes the correction server-side. This is that port — still
 * host-implemented, still carrying no opinion about transport, but shaped for
 * the side of the boundary that actually runs in a browser.
 */
export interface HeldRecordClient {
  /**
   * Everything held about `subjectId`, along with what the host can say about
   * each item's retention, reach and source. Returned together rather than
   * across three calls because `decideHolding` needs all of them for one
   * item, and a surface that rendered a verdict from a partial read would be
   * showing the person an answer nobody actually computed.
   */
  read(subjectId: string): Promise<readonly HeldRecordEntry[]>;
  /**
   * Applies one correction the person made and returns the item as durably
   * stored. The host is expected to write both the item and its own audit
   * record before resolving; this hook stores nothing itself.
   */
  correct(subjectId: string, item: HeldItem): Promise<HeldItem>;
  /**
   * Erases one item at the person's request, returning what the host actually
   * OBSERVED — not `void`, and not a boolean. A host that cannot confirm the
   * record is gone must return `"unknown"`, and this hook surfaces that
   * rather than removing the row: telling someone their data is deleted when
   * nobody checked is the failure this whole role exists to prevent.
   */
  forget(subjectId: string, itemId: string): Promise<DeletionEffect>;
}

/**
 * One held item, with everything the host can say about it. Every field is
 * required, for the same reason `HoldingInputs`' are: a surface that defaults
 * an unknown reach to "reachable" shows a person a reassurance nobody earned.
 */
export interface HeldRecordEntry {
  item: HeldItem;
  retention: RetentionRead;
  reach: ReachRead;
  source: SourceRead;
  disposition: DispositionRead;
}

export interface UseHeldRecordOptions {
  /** The person the surface is FOR — and the person every item shown must be about. */
  subjectId: string;
  /** Whoever or whatever is rendering. Separate from `subjectId`, always. */
  actorId: string;
  /** The instant to judge against, as an ISO timestamp. Supplied by the caller so a surface renders the same answer on the server and on the client rather than drifting with an ambient clock. */
  now: string;
  client: HeldRecordClient;
}

/** One row of the showing surface: the item, and the verdict on holding it. */
export interface HeldRecordRow {
  entry: HeldRecordEntry;
  holding: Holding;
}

export interface UseHeldRecordResult {
  /**
   * One row per held item, each carrying its own verdict. Items whose subject
   * does not match `subjectId` are DROPPED rather than rendered: a surface
   * that showed one person another person's record would be the exact defect
   * `checkVisibility` reports as `disclosed-to-another-subject`, committed by
   * the surface built to prevent it.
   */
  rows: readonly HeldRecordRow[];
  /** `true` while the initial `client.read` call is in flight. */
  loading: boolean;
  /** The error thrown by the most recent client call, if any. Never thrown by this hook itself. */
  error: unknown;
  /**
   * The observed effect of the most recent `forget`, or `undefined` if none
   * has been attempted. Surfaced rather than swallowed so a consumer can
   * distinguish "gone" from "we asked and nobody confirmed".
   */
  lastForgetEffect: DeletionEffect | undefined;
  correct(item: HeldItem): Promise<void>;
  /**
   * Erasure is reachable through the SAME call shape as reading and
   * correcting — one id, one promise, one function on the same object. There
   * is no separate, harder-to-reach path for being forgotten than for being
   * shown, which is the structural half of the correction step: a surface
   * that shows a person their record and makes deletion a support ticket has
   * observation without correction, and an open loop.
   */
  forget(itemId: string): Promise<void>;
}

/**
 * Reads everything held about one person, renders each item's verdict, and
 * exposes correction and erasure as identically-shaped async functions.
 *
 * This is the SHOWING STEP — the observation half of the loop this package
 * closes, and the step products skip. Nothing errors when material is held
 * and never shown: there is no exception, no alert, no broken build. The
 * person simply never finds out. A store that a person can read, correct and
 * empty is the difference between a holding and a hoard, and this hook is the
 * smallest honest version of it.
 *
 * The verdict is computed here, per item, by the same `decideHolding` the
 * gates and the CLI use, rather than by a second rendering-side rule that
 * could drift. An item the host reports as unjustifiable renders as
 * unjustifiable to the person it is about.
 */
export function useHeldRecord(options: UseHeldRecordOptions): UseHeldRecordResult {
  const { subjectId, actorId, now, client } = options;
  const [entries, setEntries] = useState<readonly HeldRecordEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(undefined);
  const [lastForgetEffect, setLastForgetEffect] = useState<DeletionEffect | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    client
      .read(subjectId)
      .then((all) => {
        if (cancelled) return;
        setEntries(all);
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

  const correct = useCallback(
    async (item: HeldItem) => {
      try {
        const stored = await client.correct(subjectId, item);
        setEntries((previous) => previous.map((entry) => (entry.item.itemId === stored.itemId ? { ...entry, item: stored } : entry)));
      } catch (caught: unknown) {
        setError(caught);
      }
    },
    [client, subjectId],
  );

  const forget = useCallback(
    async (itemId: string) => {
      try {
        const effect = await client.forget(subjectId, itemId);
        setLastForgetEffect(effect);
        // Only a confirmed erasure removes the row. A failed one, and an
        // erasure nobody observed, leave the item on screen with its effect
        // reported — because a surface that hides a record the host could not
        // promise is gone has told the person something nobody checked.
        if (effect === "erased") setEntries((previous) => previous.filter((entry) => entry.item.itemId !== itemId));
      } catch (caught: unknown) {
        setError(caught);
      }
    },
    [client, subjectId],
  );

  const rows: HeldRecordRow[] = [];
  for (const entry of entries) {
    if (entry.item.subjectId !== subjectId) continue;
    rows.push({
      entry,
      holding: decideHolding({
        item: entry.item,
        actorId,
        at: now,
        retention: entry.retention,
        reach: entry.reach,
        source: entry.source,
        disposition: entry.disposition,
      }),
    });
  }

  return { rows, loading, error, lastForgetEffect, correct, forget };
}
