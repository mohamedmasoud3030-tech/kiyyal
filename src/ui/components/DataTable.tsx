import type { ReactNode } from 'react';

export type DataTableColumn<Row> = {
  readonly key: string;
  readonly header: ReactNode;
  readonly cell: (row: Row, rowIndex: number) => ReactNode;
};

type DataTableProps<Row> = {
  readonly rows: readonly Row[];
  readonly columns: readonly DataTableColumn<Row>[];
  /** A domain identity, not the array position. Duplicate identities are disambiguated locally. */
  readonly getRowKey: (row: Row, rowIndex: number) => string | number;
  readonly wrapperClassName?: string;
  readonly tableClassName?: string;
  readonly emptyMessage?: ReactNode;
  readonly caption: ReactNode;
  readonly ariaLabel?: string;
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
  ariaLabel,
}: DataTableProps<Row>) {
  const seenKeys = new Map<string, number>();

  return (
    <div
      aria-label={ariaLabel}
      className={wrapperClassName}
      role="region"
      tabIndex={0}
    >
      <table className={tableClassName}>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => <th key={column.key} scope="col">{column.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row, rowIndex) => {
            const baseKey = String(getRowKey(row, rowIndex));
            const occurrence = seenKeys.get(baseKey) ?? 0;
            seenKeys.set(baseKey, occurrence + 1);
            const rowKey = occurrence === 0 ? baseKey : `${baseKey}:${occurrence}`;
            return (
              <tr key={rowKey}>
                {columns.map((column) => <td key={column.key}>{column.cell(row, rowIndex)}</td>)}
              </tr>
            );
          }) : emptyMessage != null ? (
            <tr><td colSpan={Math.max(columns.length, 1)}>{emptyMessage}</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
