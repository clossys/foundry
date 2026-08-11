/**
 * The smallest common query surface needed by a repository implementation.
 * Statements and result shapes intentionally remain application-owned.
 */
export interface QueryAdapter {
  query<TResult>(statement: unknown, parameters?: readonly unknown[]): Promise<TResult>;
}

/** A query adapter able to run a unit of work atomically. */
export interface TransactionalQueryAdapter extends QueryAdapter {
  transaction<TResult>(work: (query: QueryAdapter) => Promise<TResult>): Promise<TResult>;
}

/** Returns whether a value implements the minimum query-adapter contract. */
export function isQueryAdapter(value: unknown): value is QueryAdapter {
  return typeof value === "object" && value !== null && typeof (value as { query?: unknown }).query === "function";
}

/**
 * Returns whether a value can safely run a reconciliation transaction.
 * A transaction method without the base query method is intentionally not
 * considered compatible.
 */
export function isTransactionalQueryAdapter(value: unknown): value is TransactionalQueryAdapter {
  return isQueryAdapter(value) && typeof (value as { transaction?: unknown }).transaction === "function";
}

/** Throws before any repository work when transaction support is unavailable. */
export function requireTransactionalQueryAdapter(value: unknown): TransactionalQueryAdapter {
  if (!isTransactionalQueryAdapter(value)) {
    throw new TypeError("External membership reconciliation requires a transactional query adapter.");
  }
  return value;
}
