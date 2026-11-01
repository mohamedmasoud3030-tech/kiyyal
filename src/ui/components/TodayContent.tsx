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
import { Button } from './Button';
import { WorkspaceIcon } from './WorkspaceIcon';

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
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
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
  }, [role, attempt]);

  return (
    <PageContainer>
      <PageHeader
        description={ar.today.description}
        eyebrow={ar.workspace.todayEyebrow}
        action={<Link className="workspace-history-link" href="/history" prefetch={false}><WorkspaceIcon name="history" />{ar.workspace.viewHistory}</Link>}
        title={ar.today.title}
      />
      <div className="workspace-actions-heading"><h2>{ar.workspace.quickActions}</h2><p>{ar.workspace.quickActionsHint}</p></div>
          <div aria-label={ar.workspace.quickActions} className="action-grid">
            <Link className="action-tile action-tile--primary" href="/sale" prefetch={false}>
              <span className="action-tile__icon"><WorkspaceIcon name="sale" /></span>
              <span className="action-tile__title">{ar.today.saleAction}</span>
              <span className="action-tile__hint">{ar.today.saleTileHint}</span>
            </Link>
            <Link className="action-tile" href="/purchase" prefetch={false}>
              <span className="action-tile__icon"><WorkspaceIcon name="purchase" /></span>
              <span className="action-tile__title">{ar.today.purchaseAction}</span>
              <span className="action-tile__hint">{ar.today.purchaseTileHint}</span>
            </Link>
            <Link className="action-tile" href="/payment" prefetch={false}>
              <span className="action-tile__icon"><WorkspaceIcon name="payment" /></span>
              <span className="action-tile__title">{ar.today.paymentAction}</span>
              <span className="action-tile__hint">{ar.today.paymentTileHint}</span>
            </Link>
            <Link className="action-tile" href="/expense" prefetch={false}>
              <span className="action-tile__icon"><WorkspaceIcon name="expense" /></span>
              <span className="action-tile__title">{ar.expense.title}</span>
              <span className="action-tile__hint">{ar.today.expenseTileHint}</span>
            </Link>
          </div>
      {state.status === 'loading' ? (
        <StatePanel description={ar.state.sessionCheckingDescription} title={ar.common.loading} />
      ) : null}
      {state.status === 'error' ? (
        <StatePanel action={<Button onClick={() => setAttempt(value => value + 1)}>{ar.common.tryAgain}</Button>} description={ar.state.sessionUnavailableDescription} title={ar.state.sessionUnavailableTitle} tone="warning" />
      ) : null}
      {state.status === 'loaded' ? (
        <>
          <p className="workspace-scope">{ar.workspace.recentScope}</p>
          <div aria-label={ar.today.title} className="kpi-grid">
            <div className="kpi-card">
              <p className="kpi-card__label">{ar.today.kpiTransactionsLabel}</p>
              <p className="kpi-card__value">{state.transactions.length}</p>
            </div>
            <div className="kpi-card">
              <p className="kpi-card__label">{ar.today.kpiSalesLabel}</p>
              <p className="kpi-card__value">{state.transactions.filter((t) => t.type === 'sale').length}</p>
            </div>
            <div className="kpi-card">
              <p className="kpi-card__label">{ar.today.kpiPendingLabel}</p>
              <p className="kpi-card__value">{state.transactions.filter((t) => t.status === 'pending_tare' || t.status === 'pending_stock_resolution').length}</p>
            </div>
            <div className="kpi-card">
              <p className="kpi-card__label">{ar.today.kpiStockLabel}</p>
              <p className="kpi-card__value">{state.stock.length}</p>
            </div>
          </div>
          <div className="today-columns">
          <Section className="today-transactions" description={ar.today.recentTransactionsDescription} title={ar.today.recentTransactionsTitle}>
            {state.transactions.length === 0 ? (
              <StatePanel description={ar.today.noTransactionsDescription} title={ar.today.noTransactionsTitle} />
            ) : (
              <ul className="operational-list">
                {state.transactions.map((transaction) => {
                  const status = statusFor(transaction);
                  return (
                    <li className="operational-list__item" key={transaction.id}>
                      <span className={`movement-icon movement-icon--${transaction.type}`}><WorkspaceIcon name={transaction.type === 'sale' ? 'sale' : transaction.type === 'purchase' ? 'purchase' : 'history'} /></span>
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
                        <Link className="operational-list__detail-link" href={`/transactions/${encodeURIComponent(transaction.id)}`} prefetch={false}>
                          {ar.history.detailAction}
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
          <Section className="today-stock" action={role === 'owner' ? <Link className="ui-link" href="/inventory" prefetch={false}>{ar.workspace.viewStock}</Link> : undefined} description={ar.workspace.stockHint} title={ar.today.stockTitle}>
            {state.stock.length === 0 ? (
              <StatePanel description={ar.today.noStockDescription} title={ar.today.noStockTitle} />
            ) : (
              <ul className="operational-list">
                {state.stock.map((item) => (
                  <li className="operational-list__item" key={item.material_id}>
                    <span className="stock-icon"><WorkspaceIcon name="inventory" /></span>
                    <strong>{item.material_name}</strong>
                    <Weight emphasis value={item.quantity_kg} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
          </div>
        </>
      ) : null}
    </PageContainer>
  );
}
