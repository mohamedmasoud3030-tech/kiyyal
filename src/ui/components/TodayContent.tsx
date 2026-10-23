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
import { StatusBadge } from './StatusBadge';
import { Weight } from './Weight';

interface TransactionSummary {
  readonly id: string;
  readonly number: string | null;
  readonly type: 'purchase' | 'sale' | 'payment' | 'expense' | 'opening' | 'adjustment' | 'cost_adjustment' | 'regrade';
  readonly status: 'draft' | 'pending_tare' | 'pending_stock_resolution' | 'posted' | 'reversed' | 'voided';
  readonly business_date: string;
  readonly party: { readonly name: string | null; readonly phone: string | null } | null;
  readonly total_amount: string;
  /** Owner list responses serialize this only for a cost-only adjustment. */
  readonly cost_adjustment_delta?: string | null;
  readonly expense_category: keyof typeof ar.expense.categories | null;
}

interface StockItem {
  readonly material_id: string;
  readonly material_name: string;
  readonly quantity_kg: string;
}

type ContentState =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly transactions: readonly TransactionSummary[]; readonly stock: readonly StockItem[] }
  | { readonly status: 'error' };

function typeLabel(type: TransactionSummary['type']): string {
  return ar.history.typeLabels[type];
}

function amountForTransaction(transaction: TransactionSummary, role: AppRole) {
  if (role === 'owner' && transaction.type === 'cost_adjustment' && typeof transaction.cost_adjustment_delta === 'string') {
    return <Amount value={transaction.cost_adjustment_delta} />;
  }
  return <Amount value={transaction.total_amount} />;
}

function statusFor(transaction: TransactionSummary): { label: string; tone: 'success' | 'warning' | 'pending' | 'neutral' | 'danger' } {
  if (transaction.status === 'posted') return { label: ar.status.posted, tone: 'success' };
  if (transaction.status === 'pending_stock_resolution') return { label: ar.status.pendingStock, tone: 'pending' };
  if (transaction.status === 'pending_tare') return { label: ar.status.pendingTare, tone: 'pending' };
  if (transaction.status === 'draft') return { label: ar.status.draft, tone: 'neutral' };
  if (transaction.status === 'reversed') return { label: ar.status.reversed, tone: 'danger' };
  if (transaction.status === 'voided') return { label: ar.status.voided, tone: 'warning' };
  return { label: ar.status.warning, tone: 'warning' };
}

export function TodayContent({ role: injectedRole }: { readonly role?: AppRole }) {
  const role = requireInjectedRole(injectedRole);
  const [state, setState] = useState<ContentState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch('/api/transactions?scope=today&limit=8', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }),
      fetch('/api/stock', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }),
    ])
      .then(async ([transactionsResponse, stockResponse]) => {
        if (!transactionsResponse.ok || !stockResponse.ok) throw new Error('today_data_unavailable');
        const transactionsPayload = await transactionsResponse.json() as { data?: unknown };
        const stockPayload = await stockResponse.json() as { data?: unknown };
        if (!Array.isArray(transactionsPayload.data) || !Array.isArray(stockPayload.data)) {
          throw new Error('today_data_shape');
        }
        setState({
          status: 'loaded',
          transactions: transactionsPayload.data as TransactionSummary[],
          stock: stockPayload.data as StockItem[],
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [role]);

  return (
    <PageContainer>
      <PageHeader
        action={(
          <div className="page-header__actions">
            <Link className="ui-button ui-button--secondary ui-button--md" href="/purchase">{ar.today.purchaseAction}</Link>
            <Link className="ui-button ui-button--primary ui-button--md" href="/sale">{ar.today.saleAction}</Link>
            <Link className="ui-button ui-button--secondary ui-button--md" href="/expense">{ar.expense.title}</Link>
            <Link className="ui-button ui-button--secondary ui-button--md" href="/payment">{ar.today.paymentAction}</Link>
          </div>
        )}
        description={ar.today.description}
        title={ar.today.title}
      />
      {state.status === 'loading' ? (
        <StatePanel description={ar.state.sessionCheckingDescription} title={ar.common.loading} />
      ) : null}
      {state.status === 'error' ? (
        <StatePanel description={ar.state.sessionUnavailableDescription} title={ar.state.sessionUnavailableTitle} tone="warning" />
      ) : null}
      {state.status === 'loaded' ? (
        <>
          <Section description={ar.today.recentTransactionsDescription} title={ar.today.recentTransactionsTitle}>
            {state.transactions.length === 0 ? (
              <StatePanel description={ar.today.noTransactionsDescription} title={ar.today.noTransactionsTitle} />
            ) : (
              <ul className="operational-list">
                {state.transactions.map((transaction) => {
                  const status = statusFor(transaction);
                  return (
                    <li className="operational-list__item" key={transaction.id}>
                      <div className="operational-list__primary">
                        <strong>{typeLabel(transaction.type)}</strong>
                        <span>{transaction.type === 'cost_adjustment'
                          ? ar.costAdjustment.deltaValueLabel
                          : transaction.expense_category
                            ? ar.expense.categories[transaction.expense_category]
                            : transaction.party?.name ?? transaction.party?.phone ?? ar.today.noTransactionNumber}</span>
                      </div>
                      <div className="operational-list__meta">
                        <span><bdi dir="ltr">{transaction.business_date}</bdi></span>
                        {amountForTransaction(transaction, role)}
                        <StatusBadge label={status.label} tone={status.tone} />
                        <Link className="operational-list__detail-link" href={`/transactions/${encodeURIComponent(transaction.id)}`}>
                          {ar.history.detailAction}
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
          <Section description={ar.today.stockDescription} title={ar.today.stockTitle}>
            {state.stock.length === 0 ? (
              <StatePanel description={ar.today.noStockDescription} title={ar.today.noStockTitle} />
            ) : (
              <ul className="operational-list">
                {state.stock.map((item) => (
                  <li className="operational-list__item" key={item.material_id}>
                    <strong>{item.material_name}</strong>
                    <Weight emphasis value={item.quantity_kg} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      ) : null}
    </PageContainer>
  );
}
