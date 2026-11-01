'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ar, type AppRole } from '../copy/ar';
import { requireInjectedRole } from '../requiredRole';
import { Amount } from './Amount';
import { PageContainer } from './PageContainer';
import { PageHeader } from './PageHeader';
import { Section } from './Section';
import { StatePanel } from './StatePanel';
import { PriceWithUnit, Weight } from './Weight';

interface OperatorStockItem {
  readonly material_id: string;
  readonly material_name: string;
  readonly quantity_kg: string;
}

interface OwnerStockItem extends OperatorStockItem {
  readonly weighted_avg_cost_per_kg: string;
  readonly total_value: string;
  readonly is_active: boolean;
  readonly has_unknown_opening_cost: boolean;
}

type InventoryState =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly items: readonly OperatorStockItem[] | readonly OwnerStockItem[] }
  | { readonly status: 'error' };

function isOwnerStock(item: OperatorStockItem | OwnerStockItem): item is OwnerStockItem {
  return 'weighted_avg_cost_per_kg' in item && 'total_value' in item
    && 'is_active' in item && 'has_unknown_opening_cost' in item;
}

/** Inventory values are rendered only when the verified server response includes them. */
export function InventoryContent({ role: injectedRole }: { readonly role?: AppRole }) {
  const role = requireInjectedRole(injectedRole);
  const [state, setState] = useState<InventoryState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/stock', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('stock_unavailable');
        const payload = await response.json() as { role?: unknown; data?: unknown };
        if (payload.role !== role || !Array.isArray(payload.data)) throw new Error('stock_shape');
        setState({ status: 'loaded', items: payload.data as OperatorStockItem[] | OwnerStockItem[] });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [role]);

  return (
    <PageContainer>
      <PageHeader description={ar.inventory.description} title={ar.inventory.title} />
      {state.status === 'loading' ? <StatePanel description={ar.state.sessionCheckingDescription} title={ar.common.loading} /> : null}
      {state.status === 'error' ? <StatePanel description={ar.inventory.unavailableDescription} title={ar.inventory.unavailableTitle} tone="warning" /> : null}
      {state.status === 'loaded' ? (
        <Section title={ar.inventory.title}>
          {state.items.length === 0 ? (
            <StatePanel description={ar.inventory.noStockDescription} title={ar.inventory.noStockTitle} />
          ) : (
            <ul className="inventory-list">
              {state.items.map((item) => (
                <li className="inventory-list__item" key={item.material_id}>
                  <div className="inventory-list__identity">
                    {role === 'owner' ? (
                      <Link prefetch={false} className="inventory-list__name inventory-list__name--link" href={`/inventory/${encodeURIComponent(item.material_id)}`}>
                        {item.material_name}
                      </Link>
                    ) : <strong className="inventory-list__name">{item.material_name}</strong>}
                    {role === 'owner' && isOwnerStock(item) && !item.is_active ? <span className="inventory-list__status">{ar.inventory.inactiveMaterial}</span> : null}
                    {role === 'owner' && isOwnerStock(item) && item.has_unknown_opening_cost ? <span className="inventory-list__status inventory-list__status--warning">{ar.stockMovement.unknownCost}</span> : null}
                  </div>
                  <div className="inventory-list__facts">
                    <span className="inventory-list__fact"><span>{ar.inventory.quantityLabel}</span><Weight emphasis value={item.quantity_kg} /></span>
                    {role === 'owner' && isOwnerStock(item) ? (
                      <>
                        <span className="inventory-list__fact"><span>{ar.inventory.averageCostLabel}</span><PriceWithUnit unit="kg" value={item.weighted_avg_cost_per_kg} /></span>
                        <span className="inventory-list__fact"><span>{ar.inventory.totalValueLabel}</span><Amount value={item.total_value} /></span>
                      </>
                    ) : null}
                  </div>
                  {role === 'owner' ? <Link prefetch={false} className="operational-list__detail-link inventory-list__detail-link" href={`/inventory/${encodeURIComponent(item.material_id)}`}>{ar.inventory.detailAction}</Link> : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}
    </PageContainer>
  );
}
