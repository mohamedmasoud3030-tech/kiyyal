import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it } from 'vitest';

import { DataTable } from '../../src/ui/components/DataTable.js';

describe('DataTable', () => {
  it('renders an accessible shared table skeleton without altering cell values', () => {
    const html = renderToStaticMarkup(
      <DataTable
        ariaLabel="تقرير المشتريات"
        caption="تقرير المشتريات"
        columns={[{ key: 'name', header: 'الاسم', cell: (row: { name: string }) => <bdi dir="ltr">{row.name}</bdi> }]}
        getRowKey={(row) => row.name}
        rows={[{ name: 'A-01' }]}
        tableClassName="reports-table"
        wrapperClassName="reports-table-wrap"
      />,
    );

    expect(html).toContain('class="reports-table-wrap"');
    expect(html).toContain('role="region"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('class="reports-table"');
    expect(html).toContain('<caption class="visually-hidden">تقرير المشتريات</caption>');
    expect(html).toContain('scope="col"');
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('A-01');
  });

  it('keeps the empty state inside the table and spans all columns', () => {
    const html = renderToStaticMarkup(
      <DataTable
        caption="النتائج"
        columns={[
          { key: 'name', header: 'الاسم', cell: () => null },
          { key: 'status', header: 'الحالة', cell: () => null },
        ]}
        emptyMessage="لا توجد صفوف"
        getRowKey={(_row, index) => `empty-${index}`}
        rows={[]}
      />,
    );

    expect(html).toContain('colSpan="2"');
    expect(html).toContain('لا توجد صفوف');
  });

  it('passes long numeric/unit text through unchanged inside an LTR boundary', () => {
    const value = '1234567890.1200 / كجم';
    const html = renderToStaticMarkup(
      <DataTable
        caption="تفاصيل الأوزان"
        columns={[{ key: 'value', header: 'القيمة', cell: (row: { value: string }) => <bdi dir="ltr">{row.value}</bdi> }]}
        getRowKey={(row) => row.value}
        rows={[{ value }]}
      />,
    );

    expect(html).toContain(value);
    expect(html).toContain('<bdi dir="ltr">1234567890.1200 / كجم</bdi>');
  });
});
