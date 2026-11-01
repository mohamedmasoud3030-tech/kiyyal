import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it } from 'vitest';

import { DataTable } from '../../src/ui/components/DataTable.js';

describe('DataTable', () => {
  it('renders an accessible shared table skeleton without altering cell values', () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={[{ key: 'name', header: 'الاسم', cell: (row: { name: string }) => <bdi dir="ltr">{row.name}</bdi> }]}
        getRowKey={(row) => row.name}
        rows={[{ name: 'A-01' }]}
        tableClassName="reports-table"
        wrapperClassName="reports-table-wrap"
      />,
    );

    expect(html).toContain('class="reports-table-wrap"');
    expect(html).toContain('class="reports-table"');
    expect(html).toContain('scope="col"');
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('A-01');
  });

  it('keeps the empty state inside the table and spans all columns', () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={[
          { key: 'name', header: 'الاسم', cell: () => null },
          { key: 'status', header: 'الحالة', cell: () => null },
        ]}
        emptyMessage="لا توجد صفوف"
        rows={[]}
      />,
    );

    expect(html).toContain('colSpan="2"');
    expect(html).toContain('لا توجد صفوف');
  });
});
