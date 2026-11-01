'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ar, type AppRole } from '../copy/ar';
import { Button } from './Button';
import { PageContainer } from './PageContainer';
import { PageHeader } from './PageHeader';
import { StatePanel } from './StatePanel';
import {
  canIssueTransactionReceipt,
  type ReceiptLine,
  type ReceiptTransaction,
  TransactionReceiptDocument,
} from './TransactionReceiptDocument';

const transactionTypes = ['purchase', 'sale', 'payment', 'expense', 'opening', 'adjustment', 'cost_adjustment', 'regrade'] as const;
const transactionStatuses = ['draft', 'pending_tare', 'pending_stock_resolution', 'posted', 'reversed', 'voided'] as const;
const deductionTypes = ['none', 'percent', 'kg'] as const;
const priceUnits = ['kg', 'ton'] as const;
const expenseCategories = ['fuel', 'wages', 'food', 'transport', 'rent', 'maintenance', 'other'] as const;

type ReceiptState =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly transaction: ReceiptTransaction }
  | { readonly status: 'unavailable' };

function oneOf<T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isReceiptLine(value: unknown): value is ReceiptLine {
  if (!value || typeof value !== 'object') return false;
  const line = value as Record<string, unknown>;
  return typeof line.material_id === 'string'
    && typeof line.material_name === 'string'
    && typeof line.gross_kg === 'string'
    && oneOf(line.deduction_type, deductionTypes)
    && typeof line.deduction_value === 'string'
    && typeof line.net_kg === 'string'
    && typeof line.price_per_kg === 'string'
    && typeof line.line_total === 'string'
    && oneOf(line.price_unit, priceUnits);
}

function isReceiptParty(value: unknown): value is ReceiptTransaction['party'] {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const party = value as Record<string, unknown>;
  return typeof party.id === 'string' && isNullableString(party.name) && isNullableString(party.phone);
}

/** Validate the public receipt shape before displaying a browser response. */
export function isReceiptTransaction(value: unknown): value is ReceiptTransaction {
  if (!value || typeof value !== 'object') return false;
  const transaction = value as Record<string, unknown>;
  return typeof transaction.id === 'string'
    && isNullableString(transaction.number)
    && oneOf(transaction.type, transactionTypes)
    && oneOf(transaction.status, transactionStatuses)
    && typeof transaction.business_date === 'string'
    && isReceiptParty(transaction.party)
    && typeof transaction.total_amount === 'string'
    && typeof transaction.amount_cash === 'string'
    && typeof transaction.balance_amount === 'string'
    && (transaction.expense_category === null || oneOf(transaction.expense_category, expenseCategories))
    && (transaction.payment_direction === null || transaction.payment_direction === 'in' || transaction.payment_direction === 'out')
    && isNullableString(transaction.note)
    && Array.isArray(transaction.lines)
    && transaction.lines.every(isReceiptLine);
}

/**
 * Fetches only the existing scoped detail endpoint. The screen never retries or
 * fabricates a receipt: eligibility is derived from the persisted status and
 * assigned number returned by the server.
 */
export function TransactionReceiptContent({ role: _role, transactionId }: {
  readonly role?: AppRole;
  readonly transactionId: string;
}) {
  const [state, setState] = useState<ReceiptState>({ status: 'loading' });
  const detailHref = `/transactions/${encodeURIComponent(transactionId)}`;

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/transactions/${encodeURIComponent(transactionId)}`, {
      credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('transaction_unavailable');
        const payload: unknown = await response.json();
        if (!isReceiptTransaction(payload)) throw new Error('transaction_shape');
        setState(canIssueTransactionReceipt(payload)
          ? { status: 'loaded', transaction: payload }
          : { status: 'unavailable' });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ status: 'unavailable' });
      });
    return () => controller.abort();
  }, [transactionId]);

  if (state.status === 'loading') {
    return (
      <PageContainer width="document">
        <PageHeader backHref={detailHref} backLabel={ar.receipt.backToTransaction} title={ar.receipt.title} />
        <StatePanel description={ar.state.sessionCheckingDescription} title={ar.common.loading} />
      </PageContainer>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <PageContainer width="document">
        <PageHeader backHref={detailHref} backLabel={ar.receipt.backToTransaction} title={ar.receipt.title} />
        <StatePanel description={ar.receipt.unavailableDescription} title={ar.receipt.unavailableTitle} tone="warning" />
      </PageContainer>
    );
  }

  return (
    <PageContainer width="document">
      <div className="receipt-screen__actions">
        <Link prefetch={false} className="ui-link" href={detailHref}>{ar.receipt.backToTransaction}</Link>
        <Button className="receipt-screen__print" onClick={() => window.print()} type="button" variant="secondary">
          {ar.receipt.printAction}
        </Button>
      </div>
      <TransactionReceiptDocument transaction={state.transaction} />
    </PageContainer>
  );
}
