export type WorkspaceIconName = 'today' | 'inventory' | 'materials' | 'parties' | 'cash' | 'history' | 'purchase' | 'sale' | 'payment' | 'expense' | 'more' | 'arrow' | 'scale';

const paths: Record<WorkspaceIconName, string> = {
  today: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  inventory: 'M3 8l9-5 9 5v9l-9 5-9-5z M3 8l9 5 9-5 M12 13v9 M7.5 5.5l9 5v5',
  materials: 'M3 3h8l10 10-8 8L3 11z M7 7h.01',
  parties: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  cash: 'M20 8V5H5a3 3 0 0 0 0 6h16v9H5a3 3 0 0 1-3-3V8 M21 14h-5v3h5',
  history: 'M3 11a9 9 0 1 1 2.5 7 M3 4v7h7 M12 7v5l3 2',
  purchase: 'M12 3v12 M7 10l5 5 5-5 M4 15v6h16v-6',
  sale: 'M12 15V3 M7 8l5-5 5 5 M4 15v6h16v-6',
  payment: 'M3 6h18v13H3z M3 10h18 M7 15h4',
  expense: 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 7h6 M9 11h6 M9 15h3',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  arrow: 'M19 12H5 M11 6l-6 6 6 6',
  scale: 'M12 3v18 M5 21h14 M4 7h16 M6 7l-4 8h8z M18 7l-4 8h8z',
};

export function WorkspaceIcon({ name }: { readonly name: WorkspaceIconName }) {
  return <svg aria-hidden="true" focusable="false" fill="none" width="24" height="24" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={name === 'more' ? 3.5 : 1.7} strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

export function BrandMark() {
  return <span aria-hidden="true" className="brand-mark"><WorkspaceIcon name="scale" /></span>;
}
