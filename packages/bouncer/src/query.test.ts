/**
 * The query seam every host-supplied store reaches this package through.
 * Statements and result shapes stay application-owned; this file only proves
 * the shape discipline, including that a `transaction` method without the
 * base `query` method is deliberately NOT accepted.
 *
 * The two reconciliation-through-an-adapter cases the donor kept in this same
 * block live in `membership.test.ts` instead, beside the repository double
 * they need.
 */
import { describe, expect, it } from "vitest";
import { isQueryAdapter, isTransactionalQueryAdapter, requireTransactionalQueryAdapter } from "./index.js";

function transactionalAdapter() {
  const adapter = {
    transactions: 0,
    async query<TResult>(): Promise<TResult> {
      return undefined as TResult;
    },
    async transaction<TResult>(work: (query: unknown) => Promise<TResult>): Promise<TResult> {
      this.transactions += 1;
      return work(this);
    },
  };
  return adapter;
}

function withTransactionAdapter() {
  const adapter = {
    transactions: 0,
    async query(_statement: string, _parameters?: readonly unknown[]): Promise<{ rows: never[] }> {
      return { rows: [] };
    },
    async withTransaction<TResult>(work: (query: unknown) => Promise<TResult>): Promise<TResult> {
      this.transactions += 1;
      return work(this);
    },
  };
  return adapter;
}

describe("query adapter compatibility", () => {
  it("accepts only adapters with both query and transaction support", () => {
    const adapter = transactionalAdapter();
    const poolAdapter = withTransactionAdapter();
    expect(isQueryAdapter(adapter)).toBe(true);
    expect(isTransactionalQueryAdapter(adapter)).toBe(true);
    expect(isQueryAdapter(poolAdapter)).toBe(true);
    expect(isTransactionalQueryAdapter(poolAdapter)).toBe(true);
    expect(requireTransactionalQueryAdapter(poolAdapter).transaction).toBeTypeOf("function");
    expect(isQueryAdapter({ transaction() {} })).toBe(false);
    expect(isTransactionalQueryAdapter({ query() {} })).toBe(false);
    expect(() => requireTransactionalQueryAdapter({ query() {} })).toThrow(/transactional/i);
  });
});

