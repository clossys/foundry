/**
 * The smallest common query surface needed by a repository implementation.
 * Statements and result shapes intentionally remain application-owned.
 */
export interface QueryAdapter {
  /**
   * Executes an application-owned SQL statement. The auth package never
   * inspects either the statement or its result; repositories retain their
   * own result typing. Keeping this return value opaque lets ordinary
   * PostgreSQL-style pools (`Promise<{ rows: Row[] }>`) satisfy the seam.
   */
  query(statement: string, parameters?: readonly unknown[]): Promise<unknown>;
}

/** A query adapter able to run a unit of work atomically. */
export interface TransactionalQueryAdapter extends QueryAdapter {
  transaction<TResult>(work: (query: QueryAdapter) => Promise<TResult>): Promise<TResult>;
}

/**
 * A common alternative transaction spelling used by pool adapters. It is
 * accepted anywhere a transactional query adapter is required and normalized
 * by `requireTransactionalQueryAdapter` before repository work begins.
 */
export interface WithTransactionQueryAdapter extends QueryAdapter {
  withTransaction<TResult>(work: (query: QueryAdapter) => Promise<TResult>): Promise<TResult>;
}

type CompatibleTransactionalQueryAdapter = TransactionalQueryAdapter | WithTransactionQueryAdapter;

/** Returns whether a value implements the minimum query-adapter contract. */
export function isQueryAdapter(value: unknown): value is QueryAdapter {
  return typeof value === "object" && value !== null && typeof (value as { query?: unknown }).query === "function";
}

/**
 * Returns whether a value can safely run a reconciliation transaction.
 * A transaction method without the base query method is intentionally not
 * considered compatible.
 */
export function isTransactionalQueryAdapter(value: unknown): value is CompatibleTransactionalQueryAdapter {
  return isQueryAdapter(value) && (
    typeof (value as { transaction?: unknown }).transaction === "function"
    || typeof (value as { withTransaction?: unknown }).withTransaction === "function"
  );
}

/**
 * Returns a standard `transaction` adapter or throws before repository work
 * when transaction support is unavailable. `withTransaction` pool adapters
 * are normalized without changing the transaction-scoped query object.
 */
export function requireTransactionalQueryAdapter(value: unknown): TransactionalQueryAdapter {
  if (!isTransactionalQueryAdapter(value)) {
    throw new TypeError("External membership reconciliation requires a transactional query adapter.");
  }
  if ("transaction" in value && typeof value.transaction === "function") {
    return value;
  }
  const withTransaction = (value as WithTransactionQueryAdapter).withTransaction;
  return {
    query: value.query.bind(value),
    transaction: withTransaction.bind(value),
  };
}
