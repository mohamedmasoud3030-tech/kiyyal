import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { ar } from '../ui/copy/ar';

import './globals.css';

export const metadata: Metadata = {
  title: ar.app.name,
  description: ar.app.description,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html dir="rtl" lang="ar">
      <body>{children}</body>
    </html>
  );
}
