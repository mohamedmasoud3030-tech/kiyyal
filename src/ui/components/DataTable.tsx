import type { ReactNode } from 'react';

export type DataTableColumn<Row> = {
  readonly key: string;
  readonly header: ReactNode;
  readonly cell: (row: Row, rowIndex: number) => ReactNode;
};

type DataTableProps<Row> = {
  readonly rows: readonly Row[];
  readonly columns: readonly DataTableColumn<Row>[];
  readonly getRowKey?: (row: Row, rowIndex: number) => string | number;
  readonly wrapperClassName?: string;
  readonly tableClassName?: string;
  readonly emptyMessage?: ReactNode;
  readonly caption?: ReactNode;
};

/**
 * Shared, presentation-only table primitive.
 *
 * The caller owns the row model and cell formatting. This component only
 * centralises the accessible table skeleton and the scroll boundary, so RTL
 * pages can share one predictable table contract without changing API data or
 * financial display semantics.
 */
export function DataTable<Row>({
  rows,
  columns,
  getRowKey,
  wrapperClassName = 'table-scroll',
  tableClassName = 'data-table',
  emptyMessage,
  caption,
}: DataTableProps<Row>) {
  return (
    <div className={wrapperClassName}>
      <table className={tableClassName}>
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => <th key={column.key} scope="col">{column.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row, rowIndex) => (
            <tr key={getRowKey ? getRowKey(row, rowIndex) : rowIndex}>
              {columns.map((column) => <td key={column.key}>{column.cell(row, rowIndex)}</td>)}
            </tr>
          )) : emptyMessage != null ? (
            <tr><td colSpan={Math.max(columns.length, 1)}>{emptyMessage}</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
