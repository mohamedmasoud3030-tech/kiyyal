'use client';

import { useEffect, useState } from 'react';

export interface SetupStatus {
  readonly materialsCount: number;
  readonly partiesCount: number;
  readonly hasPurchase: boolean;
}

export type SetupStatusState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'loaded'; readonly setup: SetupStatus };

export function isSetupComplete(setup: SetupStatus): boolean {
  return setup.materialsCount > 0 && setup.partiesCount > 0 && setup.hasPurchase;
}

async function readCount(response: Response): Promise<number> {
  if (!response.ok) throw new Error('setup_unavailable');
  const payload = await response.json() as { data?: unknown };
  if (!Array.isArray(payload.data)) throw new Error('setup_shape');
  return payload.data.length;
}

/**
 * Read-only first-run check: counts materials and parties and whether any
 * purchase exists. No mutation is issued from this hook.
 */
export function useSetupStatus(): SetupStatusState {
  const [state, setState] = useState<SetupStatusState>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    const init: RequestInit = { credentials: 'same-origin', cache: 'no-store', signal: controller.signal };
    void Promise.all([
      fetch('/api/materials', init),
      fetch('/api/parties', init),
      fetch('/api/transactions?type=purchase&limit=1', init),
    ])
      .then(async ([materialsResponse, partiesResponse, purchasesResponse]) => {
        const [materialsCount, partiesCount, purchasesCount] = await Promise.all([
          readCount(materialsResponse),
          readCount(partiesResponse),
          readCount(purchasesResponse),
        ]);
        setState({
          status: 'loaded',
          setup: { materialsCount, partiesCount, hasPurchase: purchasesCount > 0 },
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ status: 'error' });
      });
    return () => controller.abort();
  }, []);
  return state;
}
