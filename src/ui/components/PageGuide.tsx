'use client';

import { useEffect, useState } from 'react';

import { ar } from '../copy/ar';

const guideLines = ar.guides.lines as Readonly<Record<string, string>>;
const guideDetailLines = ar.guides.detailLines as Readonly<Record<string, string>>;

export function guideForPath(activePath: string): string | null {
  const exact = guideLines[activePath];
  if (exact) return exact;
  for (const prefix of Object.keys(guideDetailLines)) {
    if (activePath.startsWith(`${prefix}/`)) return guideDetailLines[prefix]!;
  }
  for (const prefix of Object.keys(guideLines)) {
    if (activePath.startsWith(`${prefix}/`)) return guideLines[prefix]!;
  }
  return null;
}

function storageKey(activePath: string): string {
  return `kayyal:guide-hidden:${activePath}`;
}

/**
 * One plain-Egyptian-Arabic line explaining the current page, shown once per
 * page until dismissed. Purely informational; it never blocks or mutates.
 */
export function PageGuide({ activePath }: { readonly activePath: string }) {
  const line = guideForPath(activePath);
  const [hidden, setHidden] = useState<boolean>(true);
  useEffect(() => {
    try {
      setHidden(globalThis.localStorage?.getItem(storageKey(activePath)) === '1');
    } catch {
      setHidden(false);
    }
  }, [activePath]);
  if (!line || hidden) return null;
  return (
    <p className="page-guide" role="note">
      <span className="page-guide__text"><strong>{ar.guides.label}:</strong> {line}</span>
      <button
        aria-label={ar.guides.dismiss}
        className="page-guide__dismiss"
        onClick={() => {
          try { globalThis.localStorage?.setItem(storageKey(activePath), '1'); } catch { /* storage unavailable: the guide reappears next visit */ }
          setHidden(true);
        }}
        type="button"
      >
        {ar.guides.dismiss}
      </button>
    </p>
  );
}
