'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { ar, type AppRole } from '../copy/ar';
import { requireInjectedRole } from '../requiredRole';
import { apiErrorMessage, ensureCsrfToken } from '../clientSecurity';
import { Alert } from './Alert';
import { Amount } from './Amount';
import { Button } from './Button';
import { FormActions } from './FormActions';
import { FormField } from './FormField';
import { NumericInput } from './NumericInput';
import { PageContainer } from './PageContainer';
import { PageHeader } from './PageHeader';
import { Section } from './Section';
import { StatePanel } from './StatePanel';
import { StatusBadge } from './StatusBadge';
import { TextInput } from './TextInput';

interface CashMovement {
  readonly id: string;
  readonly business_date: string;
  readonly direction: 'in' | 'out';
  readonly amount: string;
  readonly source: keyof typeof ar.cash.sourceLabels;
  readonly status: 'pending' | 'posted';
  readonly transaction_id: string | null;
  readonly party: { readonly name: string | null; readonly phone: string | null } | null;
  readonly expense_category: keyof typeof ar.expense.categories | null;
  readonly note: string | null;
  readonly actor_name: string;
  readonly created_at: string;
}

interface CashBlocker {
  readonly id: string;
  readonly type: keyof typeof ar.history.typeLabels;
  readonly status: 'pending_tare' | 'pending_stock_resolution';
  readonly business_date: string;
  readonly number: string | null;
}

interface CashDay {
  readonly business_date: string;
  readonly status: 'open' | 'closed';
  readonly opening_amount: string;
  readonly posted_expected_amount: string;
  readonly pending_received_amount: string;
  readonly total_expected_amount: string;
  readonly movements: readonly CashMovement[];
  readonly blockers: readonly CashBlocker[];
  readonly close: {
    readonly counted_amount: string;
    readonly difference: string;
    readonly closed_at: string;
    readonly note: string | null;
  } | null;
}

type CashState =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly data: CashDay }
  | { readonly status: 'error' };

function isCashDay(value: unknown): value is CashDay {
  if (!value || typeof value !== 'object') return false;
  const day = value as Record<string, unknown>;
  return typeof day.business_date === 'string'
    && (day.status === 'open' || day.status === 'closed')
    && typeof day.opening_amount === 'string'
    && typeof day.posted_expected_amount === 'string'
    && typeof day.pending_received_amount === 'string'
    && typeof day.total_expected_amount === 'string'
    && Array.isArray(day.movements)
    && Array.isArray(day.blockers)
    && (day.close === null || typeof day.close === 'object');
}

function blockerStatus(status: CashBlocker['status']): string {
  return status === 'pending_stock_resolution' ? ar.status.pendingStock : ar.status.pendingTare;
}

interface CashCloseResponse {
  readonly id: string;
  readonly business_date: string;
  readonly opening_amount: string;
  readonly expected_amount: string;
  readonly counted_amount: string;
  readonly difference: string;
  readonly idempotent_replay: boolean;
}

function isCashCloseResponse(value: unknown): value is CashCloseResponse {
  if (!value || typeof value !== 'object') return false;
  const close = value as Record<string, unknown>;
  return typeof close.id === 'string'
    && typeof close.business_date === 'string'
    && typeof close.opening_amount === 'string'
    && typeof close.expected_amount === 'string'
    && typeof close.counted_amount === 'string'
    && typeof close.difference === 'string'
    && typeof close.idempotent_replay === 'boolean';
}

function CashCloseForm({
  expectedAmount,
  onConfirmed,
}: {
  readonly expectedAmount: string;
  readonly onConfirmed: (result: CashCloseResponse) => void;
}) {
  const [countedAmount, setCountedAmount] = useState('');
  const [note, setNote] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [countedError, setCountedError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || confirmed) return;
    const amount = countedAmount.trim();
    if (!/^-?\d+(?:\.\d{1,2})?$/.test(amount)) {
      setCountedError(ar.cash.countedAmountRequired);
      return;
    }
    const key = idempotencyKey ?? globalThis.crypto?.randomUUID();
    if (!key) {
      setError(ar.cash.closeFailed);
      return;
    }
    setCountedError(null);
    setError(null);
    setSubmitting(true);
    setIdempotencyKey(key);
    const csrf = await ensureCsrfToken();
    if (!csrf) {
      setError(ar.auth.csrfUnavailable);
      setSubmitting(false);
      return;
    }
    try {
      const response = await fetch('/api/cash/close', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-kayyal-csrf': csrf },
        body: JSON.stringify({
          counted_amount: amount,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isCashCloseResponse(payload)) {
        setError(apiErrorMessage(payload) ?? ar.cash.closeFailed);
        return;
      }
      setConfirmed(true);
      setIdempotencyKey(null);
      onConfirmed(payload);
    } catch {
      setError(ar.cash.closeFailed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Section description={ar.cash.closeDescription} title={ar.cash.closeTitle}>
      <p className="cash-close__expected">{ar.cash.closeExpectedLabel}: <Amount emphasis value={expectedAmount} /></p>
      <form className="cash-close" onSubmit={submit}>
        <FormField {...(countedError ? { error: countedError } : {})} hint={ar.cash.closeCountHint} id="cash-counted-amount" label={ar.cash.countedAmountLabel} required>
          <NumericInput
            autoComplete="off"
            maxLength={32}
            onChange={(event) => { setCountedAmount(event.target.value); setCountedError(null); setAcknowledged(false); }}
            placeholder="0.00"
            step="0.01"
            unit={ar.units.currencyShort}
            value={countedAmount}
          />
        </FormField>
        <FormField hint={ar.cash.closeNoteHint} id="cash-close-note" label={ar.cash.closeNoteLabel}>
          <TextInput
            autoComplete="off"
            maxLength={1000}
            onChange={(event) => setNote(event.target.value)}
            value={note}
          />
        </FormField>
        <label className="cash-close__confirmation">
          <input
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            type="checkbox"
          />
          <span>{ar.cash.closeConfirmationLabel}</span>
        </label>
        <FormActions stickyOnMobile {...(error ? { status: <span role="alert">{error}</span> } : {})}>
          <Button disabled={!acknowledged || confirmed} loading={submitting} type="submit">{submitting ? ar.cash.closingAction : ar.cash.closeAction}</Button>
        </FormActions>
      </form>
    </Section>
  );
}

export function CashContent({ role: injectedRole }: { readonly role?: AppRole }) {
  const role = requireInjectedRole(injectedRole);
  const [state, setState] = useState<CashState>({ status: 'loading' });
  const [reloadVersion, setReloadVersion] = useState(0);
  const [closeConfirmation, setCloseConfirmation] = useState<CashCloseResponse | null>(null);

  useEffect(() => {
    if (role !== 'owner') return;
    const controller = new AbortController();
    void fetch('/api/cash/day', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('cash_unavailable');
        const payload: unknown = await response.json();
        if (!isCashDay(payload)) throw new Error('cash_shape');
        setState({ status: 'loaded', data: payload });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [role, reloadVersion]);

  if (role !== 'owner') {
    return (
      <PageContainer>
        <PageHeader description={ar.cash.description} title={ar.cash.title} />
        <StatePanel description={ar.cash.forbiddenDescription} headingLevel={2} title={ar.cash.forbiddenTitle} tone="warning" />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        action={<div className="page-header__actions"><Link prefetch={false} className="ui-button ui-button--secondary ui-button--md" href="/expense">{ar.expense.title}</Link><Link prefetch={false} className="ui-button ui-button--secondary ui-button--md" href="/payment">{ar.payment.title}</Link></div>}
        description={ar.cash.description}
        title={ar.cash.title}
      />
      {closeConfirmation ? (
        <Alert title={ar.cash.closeSuccessTitle} tone="success">
          <p>{ar.cash.closeSuccessDescription}</p>
          <p>{ar.cash.differenceLabel}: <Amount value={closeConfirmation.difference} /></p>
        </Alert>
      ) : null}
      {state.status === 'loading' ? <StatePanel description={ar.state.sessionCheckingDescription} title={ar.common.loading} /> : null}
      {state.status === 'error' ? <StatePanel description={ar.cash.unavailableDescription} title={ar.cash.unavailableTitle} tone="warning" /> : null}
      {state.status === 'loaded' ? (
        <>
          <Section
            action={<StatusBadge label={state.data.status === 'closed' ? ar.cash.closedDayStatus : ar.cash.openDayStatus} tone={state.data.status === 'closed' ? 'neutral' : 'success'} />}
            description={ar.cash.summaryDescription}
            title={ar.cash.summaryTitle}
          >
            <p className="cash-summary__date">{ar.cash.businessDateLabel} <bdi dir="ltr">{state.data.business_date}</bdi></p>
            <dl className="cash-summary">
              <div>
                <dt>{ar.cash.openingAmountLabel}</dt>
                <dd><Amount value={state.data.opening_amount} /></dd>
              </div>
              <div>
                <dt>{ar.cash.postedExpectedLabel}</dt>
                <dd><Amount value={state.data.posted_expected_amount} /></dd>
              </div>
              <div>
                <dt>{ar.cash.pendingReceivedLabel}</dt>
                <dd><Amount value={state.data.pending_received_amount} /></dd>
              </div>
              <div className="cash-summary__total">
                <dt>{ar.cash.totalExpectedLabel}</dt>
                <dd><Amount emphasis value={state.data.total_expected_amount} /></dd>
              </div>
            </dl>
          </Section>
          {state.data.close ? (
            <Section title={ar.cash.closedDayStatus} tone="muted">
              <dl className="cash-close-facts">
                <div>
                  <dt>{ar.cash.countedAmountLabel}</dt>
                  <dd><Amount value={state.data.close.counted_amount} /></dd>
                </div>
                <div>
                  <dt>{ar.cash.differenceLabel}</dt>
                  <dd><Amount value={state.data.close.difference} /></dd>
                </div>
                <div>
                  <dt>{ar.cash.closedAtLabel}</dt>
                  <dd><time dateTime={state.data.close.closed_at}><bdi dir="ltr">{state.data.close.closed_at}</bdi></time></dd>
                </div>
                {state.data.close.note ? (
                  <div>
                    <dt>{ar.cash.closeNoteLabel}</dt>
                    <dd>{state.data.close.note}</dd>
                  </div>
                ) : null}
              </dl>
            </Section>
          ) : null}
          {state.data.blockers.length > 0 ? (
            <Section description={ar.cash.blockersDescription} title={ar.cash.blockersTitle} tone="critical">
              <ul className="cash-blockers">
                {state.data.blockers.map((blocker) => (
                  <li className="cash-blockers__item" key={blocker.id}>
                    <div>
                      <strong>{ar.history.typeLabels[blocker.type]}</strong>
                      <span><bdi dir="ltr">{blocker.number ?? blocker.business_date}</bdi></span>
                    </div>
                    <div className="cash-blockers__actions">
                      <StatusBadge label={blockerStatus(blocker.status)} tone="pending" />
                      <Link prefetch={false} className="operational-list__detail-link" href={`/transactions/${encodeURIComponent(blocker.id)}`}>
                        {ar.cash.viewTransactionAction}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          <Section description={ar.cash.movementsDescription} title={ar.cash.movementsTitle}>
            {state.data.movements.length === 0 ? (
              <StatePanel description={ar.cash.noMovementsDescription} title={ar.cash.noMovementsTitle} />
            ) : (
              <ul className="operational-list">
                {state.data.movements.map((movement) => (
                  <li className="operational-list__item" key={movement.id}>
                    <div className="operational-list__primary">
                      <strong>{ar.cash.sourceLabels[movement.source]}</strong>
                      <span>{movement.expense_category
                        ? ar.expense.categories[movement.expense_category]
                        : movement.party?.name ?? movement.party?.phone ?? movement.note ?? movement.actor_name}</span>
                    </div>
                    <div className="operational-list__meta">
                      <span>{movement.direction === 'in' ? ar.cash.directionIn : ar.cash.directionOut}</span>
                      <Amount value={movement.amount} />
                      <StatusBadge label={movement.status === 'pending' ? ar.status.pending : ar.status.posted} tone={movement.status === 'pending' ? 'pending' : 'success'} />
                      {movement.transaction_id ? (
                        <Link prefetch={false} className="operational-list__detail-link" href={`/transactions/${encodeURIComponent(movement.transaction_id)}`}>
                          {ar.cash.viewTransactionAction}
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {state.data.status === 'open' && state.data.blockers.length === 0 && state.data.movements.every((movement) => movement.status === 'posted') ? (
            <CashCloseForm
              expectedAmount={state.data.total_expected_amount}
              onConfirmed={(result) => {
                setCloseConfirmation(result);
                setReloadVersion((version) => version + 1);
              }}
            />
          ) : state.data.status === 'open' ? (
            <StatePanel description={ar.cash.closeUnavailableWhilePending} title={ar.cash.closeTitle} tone="warning" />
          ) : null}
        </>
      ) : null}
    </PageContainer>
  );
}
