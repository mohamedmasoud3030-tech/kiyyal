'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { ar, type AppRole } from '../copy/ar';
import { requireInjectedRole } from '../requiredRole';
import { Amount } from './Amount';
import { Button } from './Button';
import { FormField } from './FormField';
import { PageContainer } from './PageContainer';
import { PageHeader } from './PageHeader';
import { Section } from './Section';
import { StatePanel } from './StatePanel';
import { StatusBadge } from './StatusBadge';
import { TextInput } from './TextInput';

interface Transaction {
  readonly id: string;
  readonly number: string | null;
  readonly type: 'purchase' | 'sale' | 'payment' | 'expense' | 'opening' | 'adjustment' | 'cost_adjustment' | 'regrade';
  readonly status: 'draft' | 'pending_tare' | 'pending_stock_resolution' | 'posted' | 'reversed' | 'voided';
  readonly business_date: string;
  readonly party: { readonly name: string | null; readonly phone: string | null } | null;
  readonly total_amount: string;
  /** Omitted from the operator list API by schema, not merely hidden in UI. */
  readonly cost_adjustment_delta?: string | null;
  readonly expense_category: keyof typeof ar.expense.categories | null;
  readonly note: string | null;
}

interface HistoryPage {
  readonly limit: number;
  readonly next_cursor: string | null;
}

interface OwnerHistoryDraft {
  readonly q: string;
  readonly type: '' | Transaction['type'];
  readonly status: '' | Transaction['status'];
  readonly from: string;
  readonly to: string;
}

type OwnerHistoryFilters = OwnerHistoryDraft;

const PAGE_SIZE = 30;
const emptyOwnerFilters: OwnerHistoryDraft = { q: '', type: '', status: '', from: '', to: '' };

type HistoryState =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly data: readonly Transaction[]; readonly page: HistoryPage }
  | { readonly status: 'error' };

function isHistoryPage(value: unknown): value is HistoryPage {
  if (!value || typeof value !== 'object') return false;
  const page = value as Record<string, unknown>;
  return typeof page.limit === 'number'
    && (typeof page.next_cursor === 'string' || page.next_cursor === null);
}

function transactionTypeLabel(type: Transaction['type']): string {
  return ar.history.typeLabels[type];
}

function transactionStatus(transaction: Transaction): { label: string; tone: 'success' | 'pending' | 'warning' | 'neutral' | 'danger' } {
  if (transaction.status === 'posted') return { label: ar.status.posted, tone: 'success' };
  if (transaction.status === 'pending_stock_resolution') return { label: ar.status.pendingStock, tone: 'pending' };
  if (transaction.status === 'pending_tare') return { label: ar.status.pendingTare, tone: 'pending' };
  if (transaction.status === 'draft') return { label: ar.status.draft, tone: 'neutral' };
  if (transaction.status === 'reversed') return { label: ar.status.reversed, tone: 'danger' };
  if (transaction.status === 'voided') return { label: ar.status.voided, tone: 'warning' };
  return { label: ar.status.warning, tone: 'warning' };
}

function amountForTransaction(transaction: Transaction, isOwner: boolean) {
  if (isOwner && transaction.type === 'cost_adjustment' && typeof transaction.cost_adjustment_delta === 'string') {
    return <Amount value={transaction.cost_adjustment_delta} />;
  }
  return <Amount value={transaction.total_amount} />;
}

function ownerQuery(filters: OwnerHistoryFilters, cursor: string | undefined): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) params.set('cursor', cursor);
  if (filters.q) params.set('q', filters.q);
  if (filters.type) params.set('type', filters.type);
  if (filters.status) params.set('status', filters.status);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  return params.toString();
}

export function HistoryContent({ role: injectedRole }: { readonly role?: AppRole }) {
  const role = requireInjectedRole(injectedRole);
  const isOwner = role === 'owner';
  const [draft, setDraft] = useState<OwnerHistoryDraft>(emptyOwnerFilters);
  const [filters, setFilters] = useState<OwnerHistoryFilters>(emptyOwnerFilters);
  const [cursorStack, setCursorStack] = useState<readonly string[]>([]);
  const [state, setState] = useState<HistoryState>({ status: 'loading' });
  const rangeInvalid = Boolean(draft.from && draft.to && draft.from > draft.to);
  const currentCursor = cursorStack[cursorStack.length - 1];
  const requestQuery = useMemo(
    () => (isOwner
      ? ownerQuery(filters, currentCursor)
      : new URLSearchParams({ scope: 'today', limit: String(PAGE_SIZE) }).toString()),
    [currentCursor, filters, isOwner],
  );

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    void fetch(`/api/transactions?${requestQuery}`, {
      credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('history_unavailable');
        const payload = await response.json() as { data?: unknown; page?: unknown };
        if (!Array.isArray(payload.data) || !isHistoryPage(payload.page)) throw new Error('history_shape');
        setState({ status: 'loaded', data: payload.data as Transaction[], page: payload.page });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [requestQuery]);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (rangeInvalid) return;
    setCursorStack([]);
    setFilters(draft);
  };

  const resetFilters = () => {
    setCursorStack([]);
    setDraft(emptyOwnerFilters);
    setFilters(emptyOwnerFilters);
  };

  return (
    <PageContainer>
      <PageHeader description={ar.history.description} title={ar.history.title} />
      {isOwner ? (
        <Section description={ar.history.filtersDescription} title={ar.history.filtersTitle} tone="muted">
          <form className="history-filters" onSubmit={applyFilters}>
            <FormField id="history-search" label={ar.history.searchLabel}>
              <TextInput
                onChange={(event) => setDraft((previous) => ({ ...previous, q: event.target.value }))}
                placeholder={ar.history.searchPlaceholder}
                type="search"
                value={draft.q}
              />
            </FormField>
            <FormField id="history-type" label={ar.history.typeLabel}>
              <select
                className="text-input"
                onChange={(event) => setDraft((previous) => ({ ...previous, type: event.target.value as OwnerHistoryDraft['type'] }))}
                value={draft.type}
              >
                <option value="">{ar.history.allTypesOption}</option>
                {(Object.keys(ar.history.typeLabels) as Transaction['type'][]).map((type) => (
                  <option key={type} value={type}>{ar.history.typeLabels[type]}</option>
                ))}
              </select>
            </FormField>
            <FormField id="history-status" label={ar.history.statusLabel}>
              <select
                className="text-input"
                onChange={(event) => setDraft((previous) => ({ ...previous, status: event.target.value as OwnerHistoryDraft['status'] }))}
                value={draft.status}
              >
                <option value="">{ar.history.allStatusesOption}</option>
                <option value="posted">{ar.status.posted}</option>
                <option value="pending_stock_resolution">{ar.status.pendingStock}</option>
                <option value="pending_tare">{ar.status.pendingTare}</option>
                <option value="draft">{ar.status.draft}</option>
                <option value="reversed">{ar.status.reversed}</option>
                <option value="voided">{ar.status.voided}</option>
              </select>
            </FormField>
            <FormField id="history-from" label={ar.history.fromLabel}>
              <TextInput
                max={draft.to || undefined}
                onChange={(event) => setDraft((previous) => ({ ...previous, from: event.target.value }))}
                type="date"
                value={draft.from}
              />
            </FormField>
            <FormField
              {...(rangeInvalid ? { error: ar.history.invalidDateRange } : {})}
              id="history-to"
              label={ar.history.toLabel}
            >
              <TextInput
                min={draft.from || undefined}
                onChange={(event) => setDraft((previous) => ({ ...previous, to: event.target.value }))}
                type="date"
                value={draft.to}
              />
            </FormField>
            <div className="history-filters__actions">
              <Button disabled={rangeInvalid} type="submit" variant="primary">{ar.history.applyFiltersAction}</Button>
              <Button onClick={resetFilters} type="button" variant="tertiary">{ar.history.clearFiltersAction}</Button>
            </div>
          </form>
        </Section>
      ) : null}
      {state.status === 'loading' ? <StatePanel description={ar.state.sessionCheckingDescription} title={ar.common.loading} /> : null}
      {state.status === 'error' ? <StatePanel description={ar.history.unavailableDescription} title={ar.history.unavailableTitle} tone="warning" /> : null}
      {state.status === 'loaded' ? (
        <Section title={ar.history.title}>
          {state.data.length === 0 ? (
            <StatePanel description={ar.history.noTransactionsDescription} title={ar.history.noTransactionsTitle} />
          ) : (
            <>
              <ul className="operational-list">
                {state.data.map((transaction) => {
                  const status = transactionStatus(transaction);
                  return (
                    <li className="operational-list__item" key={transaction.id}>
                      <div className="operational-list__primary">
                        <strong>{transactionTypeLabel(transaction.type)}</strong>
                        <span>{transaction.type === 'cost_adjustment'
                          ? ar.costAdjustment.deltaValueLabel
                          : transaction.expense_category
                            ? ar.expense.categories[transaction.expense_category]
                            : transaction.party?.name ?? transaction.party?.phone ?? transaction.business_date}</span>
                      </div>
                      <div className="operational-list__meta">
                        <span><bdi dir="ltr">{transaction.number ?? transaction.business_date}</bdi></span>
                        {amountForTransaction(transaction, isOwner)}
                        <StatusBadge label={status.label} tone={status.tone} />
                        <Link className="operational-list__detail-link" href={`/transactions/${encodeURIComponent(transaction.id)}`}>
                          {ar.history.detailAction}
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {isOwner ? (
                <nav aria-label={ar.history.paginationLabel} className="history-pagination">
                  <Button
                    disabled={cursorStack.length === 0}
                    onClick={() => setCursorStack((previous) => previous.slice(0, -1))}
                    variant="secondary"
                  >
                    {ar.history.previousPageAction}
                  </Button>
                  <span aria-live="polite" className="history-pagination__status">
                    {ar.history.currentPageLabel} <bdi dir="ltr">{cursorStack.length + 1}</bdi>
                  </span>
                  <Button
                    disabled={!state.page.next_cursor}
                    onClick={() => {
                      if (state.page.next_cursor) setCursorStack((previous) => [...previous, state.page.next_cursor!]);
                    }}
                    variant="secondary"
                  >
                    {ar.history.nextPageAction}
                  </Button>
                </nav>
              ) : null}
            </>
          )}
        </Section>
      ) : null}
    </PageContainer>
  );
}
