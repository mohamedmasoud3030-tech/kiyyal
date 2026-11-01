'use client';
import { useEffect } from 'react';

export function OfflineRegistration() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      // Failure leaves the existing online application working; the offline
      // shell is guaranteed only after installation has actually succeeded.
      void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {});
    }
  }, []);
  return null;
}
