import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { ar } from '../ui/copy/ar';
import { OfflineRegistration } from '../ui/components/OfflineRegistration';

import './globals.css';
import './workspace.css';

export const metadata: Metadata = {
  title: ar.app.name,
  description: ar.app.description,
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/icon-192.png', apple: '/icons/icon-192.png' },
};

export const viewport: Viewport = { themeColor: '#173f35' };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html dir="rtl" lang="ar">
      <body><OfflineRegistration />{children}</body>
    </html>
  );
}

