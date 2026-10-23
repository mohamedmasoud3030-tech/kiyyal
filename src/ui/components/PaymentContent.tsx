'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { ar, type AppRole } from '../copy/ar';
import { requireInjectedRole } from '../requiredRole';
import { apiErrorCode, apiErrorMessage, ensureCsrfToken } from '../clientSecurity';
import { Amount } from './Amount';
import { Button } from './Button';
import { FormActions } from './FormActions';
import { FormField } from './FormField';
import { NumericInput } from './NumericInput';
import { PageContainer } from './PageContainer';
import { PageHeader } from './PageHeader';
import { Section } from './Section';
import { StatePanel } from './StatePanel';
import { TextInput } from './TextInput';

type PaymentDirection = 'in' | 'out';

interface Party {
  readonly id: string;
  readonly name: string | null;
  readonly phone: string | null;
  readonly kind: 'supplier' | 'customer' | 'both';
}

interface PaymentResponse {
  readonly id: string;
  readonly number: string;
  readonly business_date: string;
  readonly direction: PaymentDirection;
  readonly amount: string;
  readonly idempotent_replay: boolean;
}

type PartiesState =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly data: readonly Party[] }
  | { readonly status: 'error' };

function isPaymentResponse(value: unknown): value is PaymentResponse {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return typeof result.id === 'string'
    && typeof result.number === 'string'
    && typeof result.business_date === 'string'
    && typeof result.amount === 'string'
    && typeof result.idempotent_replay === 'boolean'
    && (result.direction === 'in' || result.direction === 'out');
}

function partyLabel(party: Party): string {
  return party.name ?? party.phone ?? ar.payment.partyPlaceholder;
}

/**
 * Focused party-payment entry. It selects a scoped contact but deliberately
 * avoids fetching any party balance for an operator; only its server receipt is
 * rendered after submission.
 */
export function PaymentContent({ initialPartyId, role: injectedRole }: {
  readonly initialPartyId?: string;
  readonly role?: AppRole;
}) {
  const role = requireInjectedRole(injectedRole);
  const [parties, setParties] = useState<PartiesState>({ status: 'loading' });
  const [partyId, setPartyId] = useState(initialPartyId ?? '');
  const [direction, setDirection] = useState<PaymentDirection>('in');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partyError, setPartyError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);
  const [result, setResult] = useState<PaymentResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/parties', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('parties_unavailable');
        const payload = await response.json() as { data?: unknown };
        if (!Array.isArray(payload.data)) throw new Error('parties_shape');
        const data = payload.data as Party[];
        setParties({ status: 'loaded', data });
        setPartyId((selected) => selected && !data.some((party) => party.id === selected) ? '' : selected);
      })
      .catch((fetchError: unknown) => {
        if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return;
        setParties({ status: 'error' });
      });
    return () => controller.abort();
  }, []);

  function clearDuplicateConfirmation() {
    setDuplicateWarning(false);
    setDuplicateConfirmed(false);
  }

  function resetForNextPayment() {
    setPartyId('');
    setDirection('in');
    setAmount('');
    setNote('');
    setIdempotencyKey(null);
    setSubmitting(false);
    setError(null);
    setPartyError(null);
    clearDuplicateConfirmation();
    setResult(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || result) return;
    if (!partyId) {
      setPartyError(ar.form.required);
      return;
    }
    if (duplicateWarning && !duplicateConfirmed) {
      setError(ar.payment.duplicateConfirmationLabel);
      return;
    }
    const key = idempotencyKey ?? globalThis.crypto?.randomUUID();
    if (!key) {
      setError(ar.payment.failed);
      return;
    }
    setError(null);
    setPartyError(null);
    setSubmitting(true);
    setIdempotencyKey(key);
    const csrf = await ensureCsrfToken();
    if (!csrf) {
      setError(ar.auth.csrfUnavailable);
      setSubmitting(false);
      return;
    }
    try {
      const response = await fetch('/api/transactions/payment', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-kayyal-csrf': csrf },
        body: JSON.stringify({
          party_id: partyId,
          direction,
          amount: amount.trim(),
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(duplicateWarning && duplicateConfirmed ? { confirm_duplicate: true } : {}),
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isPaymentResponse(payload)) {
        if (apiErrorCode(payload) === 'duplicate_payment_suspected') {
          setDuplicateWarning(true);
          setDuplicateConfirmed(false);
          setError(null);
        } else {
          setError(apiErrorMessage(payload) ?? ar.payment.failed);
        }
        return;
      }
      setResult(payload);
      setIdempotencyKey(null);
      clearDuplicateConfirmation();
    } catch {
      setError(ar.payment.failed);
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <PageContainer width="form">
        <PageHeader description={ar.payment.savedDescription} title={ar.payment.savedTitle} />
        <Section title={ar.payment.savedTitle} tone="muted">
          <dl className="payment-result">
            <div>
              <dt>{ar.payment.directionLabel}</dt>
              <dd>{result.direction === 'in' ? ar.payment.directionIn : ar.payment.directionOut}</dd>
            </div>
            <div>
              <dt>{ar.payment.amountLabel}</dt>
              <dd><Amount emphasis value={result.amount} /></dd>
            </div>
            <div>
              <dt>{ar.cash.businessDateLabel}</dt>
              <dd><bdi dir="ltr">{result.business_date}</bdi></dd>
            </div>
            <div>
              <dt>{ar.today.transactionNumber}</dt>
              <dd><bdi dir="ltr">{result.number}</bdi></dd>
            </div>
          </dl>
        </Section>
        <FormActions>
          <Button onClick={resetForNextPayment} type="button" variant="secondary">{ar.payment.newPaymentAction}</Button>
          <Link className="ui-button ui-button--primary ui-button--md" href={`/transactions/${encodeURIComponent(result.id)}/receipt`}>
            {ar.receipt.viewAction}
          </Link>
          <Link className="ui-button ui-button--secondary ui-button--md" href={`/transactions/${encodeURIComponent(result.id)}`}>
            {ar.payment.viewTransactionAction}
          </Link>
          <Link className="ui-link" href="/today">{ar.payment.backToToday}</Link>
        </FormActions>
      </PageContainer>
    );
  }

  return (
    <PageContainer width="form">
      <PageHeader
        action={<Link className="ui-link" href="/today">{ar.payment.backToToday}</Link>}
        description={ar.payment.description}
        title={ar.payment.title}
      />
      {role === 'operator' ? <p className="payment-privacy-notice">{ar.payment.operatorPrivacyNotice}</p> : null}
      {parties.status === 'loading' ? (
        <StatePanel description={ar.payment.loadingPartiesDescription} title={ar.payment.loadingPartiesTitle} />
      ) : null}
      {parties.status === 'error' ? (
        <StatePanel description={ar.payment.partiesUnavailableDescription} title={ar.payment.partiesUnavailableTitle} tone="warning" />
      ) : null}
      {parties.status === 'loaded' && parties.data.length === 0 ? (
        <StatePanel description={ar.payment.noPartiesDescription} title={ar.payment.noPartiesTitle} />
      ) : null}
      {parties.status === 'loaded' && parties.data.length > 0 ? (
        <form className="payment-form" onSubmit={submit}>
          <FormField {...(partyError ? { error: partyError } : {})} id="payment-party" label={ar.payment.partyLabel} required>
            <select
              className="text-input"
              onChange={(event) => { setPartyId(event.target.value); setPartyError(null); clearDuplicateConfirmation(); }}
              required
              value={partyId}
            >
              <option value="">{ar.payment.partyPlaceholder}</option>
              {parties.data.map((party) => <option key={party.id} value={party.id}>{partyLabel(party)}</option>)}
            </select>
          </FormField>
          <FormField id="payment-direction" label={ar.payment.directionLabel} required>
            <select
              className="text-input"
              onChange={(event) => { setDirection(event.target.value as PaymentDirection); clearDuplicateConfirmation(); }}
              value={direction}
            >
              <option value="in">{ar.payment.directionIn}</option>
              <option value="out">{ar.payment.directionOut}</option>
            </select>
          </FormField>
          <FormField hint={ar.payment.amountHint} id="payment-amount" label={ar.payment.amountLabel} required>
            <NumericInput
              autoComplete="off"
              maxLength={32}
              onChange={(event) => { setAmount(event.target.value); clearDuplicateConfirmation(); }}
              placeholder="0.00"
              required
              step="0.01"
              unit={ar.units.currencyShort}
              value={amount}
            />
          </FormField>
          <FormField hint={ar.payment.noteHint} id="payment-note" label={ar.payment.noteLabel}>
            <TextInput
              autoComplete="off"
              maxLength={1000}
              onChange={(event) => setNote(event.target.value)}
              value={note}
            />
          </FormField>
          {duplicateWarning ? (
            <Section description={ar.payment.duplicateDescription} title={ar.payment.duplicateTitle} tone="critical">
              <label className="payment-duplicate-confirmation">
                <input checked={duplicateConfirmed} onChange={(event) => { setDuplicateConfirmed(event.target.checked); setError(null); }} type="checkbox" />
                <span>{ar.payment.duplicateConfirmationLabel}</span>
              </label>
            </Section>
          ) : null}
          <FormActions stickyOnMobile {...(error ? { status: <span role="alert">{error}</span> } : {})}>
            <Button loading={submitting} size="lg" type="submit">
              {submitting ? ar.payment.savingAction : duplicateWarning ? ar.payment.confirmDuplicateAction : ar.payment.saveAction}
            </Button>
          </FormActions>
        </form>
      ) : null}
    </PageContainer>
  );
}
