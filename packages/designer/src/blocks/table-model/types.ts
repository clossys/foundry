/** A cell after normalization; absent values become null and dates become UTC ISO strings. */
export type TableValue = string | number | boolean | readonly string[] | null;
export type TableColumnKind = "text" | "number" | "date" | "enum" | "tags" | "boolean";

export interface TableColumn {
  readonly id: string;
  readonly kind: TableColumnKind;
  /** Global search includes this column unless explicitly false. */
  readonly searchable?: boolean;
}

/** An explicit locale avoids process-default collation and case conversion. */
export interface TableCollation {
  readonly locale: string;
  readonly sensitivity?: "base" | "accent" | "case" | "variant";
  readonly numeric?: boolean;
  readonly caseFirst?: "upper" | "lower" | "false";
  readonly ignorePunctuation?: boolean;
}

export type TableFilter =
  | { readonly column: string; readonly kind: "text"; readonly op: "contains" | "equals"; readonly value: string }
  | { readonly column: string; readonly kind: "number"; readonly op: "range"; readonly min?: number; readonly max?: number }
  | { readonly column: string; readonly kind: "date"; readonly op: "range"; readonly min?: string | number; readonly max?: string | number }
  | { readonly column: string; readonly kind: "enum"; readonly op: "in"; readonly values: readonly string[] }
  | { readonly column: string; readonly kind: "tags"; readonly op: "any" | "all" | "none"; readonly values: readonly string[] }
  | { readonly column: string; readonly kind: "boolean"; readonly op: "equals"; readonly value: boolean };

export interface TableDimension {
  readonly column: string;
  readonly order?: "asc" | "desc";
}

export type TableMeasure =
  | { readonly id: string; readonly op: "count"; readonly column?: string }
  | { readonly id: string; readonly op: "sum" | "avg" | "min" | "max" | "distinct"; readonly column: string };

export interface TablePivot {
  readonly rows: readonly TableDimension[];
  readonly columns: readonly TableDimension[];
}

/** Plain saved-view data, with no callbacks, accessors, React nodes or runtime handles. */
export interface TableModel {
  readonly version: 1;
  readonly columns: readonly TableColumn[];
  readonly collation: TableCollation;
  readonly filters?: readonly TableFilter[];
  readonly search?: string;
  readonly groupBy?: readonly TableDimension[];
  readonly measures?: readonly TableMeasure[];
  readonly pivot?: TablePivot;
}

export interface TableFacet {
  readonly value: TableValue;
  readonly count: number;
}

export interface TableFilterResult<Row> {
  readonly rows: readonly Row[];
  /** For each column, global search and other-column filters still apply. */
  readonly facets: Readonly<Record<string, readonly TableFacet[]>>;
}

export type TableAggregateValue = string | number | boolean | null;
export type TableAggregates = Readonly<Record<string, TableAggregateValue>>;

export interface TableGroup<Row> {
  readonly key: string;
  readonly column: string;
  readonly value: TableValue;
  readonly path: readonly TableValue[];
  readonly rows: readonly Row[];
  readonly aggregates: TableAggregates;
  readonly children: readonly TableGroup<Row>[];
}

export interface TablePivotAxis {
  readonly key: string;
  readonly path: readonly TableValue[];
  readonly kind: "total" | "subtotal" | "leaf";
}

export interface TablePivotCell {
  readonly rowKey: string;
  readonly columnKey: string;
  readonly empty: boolean;
  readonly aggregates: TableAggregates;
}

export interface TablePivotResult {
  readonly rowAxis: readonly TablePivotAxis[];
  readonly columnAxis: readonly TablePivotAxis[];
  readonly cells: readonly TablePivotCell[];
  readonly totals: TableAggregates;
}

export type TableModelErrorCode = "invalid-model" | "unsupported-version" | "unknown-column" | "invalid-cell" | "pivot-budget" | "aggregate-overflow";
