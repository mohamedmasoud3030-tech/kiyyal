'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { ar, type AppRole } from '../copy/ar';
import { requireInjectedRole } from '../requiredRole';
import { offlineStore } from '../offline/outbox';
import { useResilientSubmit, loadDraft } from '../offline/useResilientSubmit';
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
export function PaymentContent({ initialPartyId, role: injectedRole, scope = null }: {
  readonly initialPartyId?: string;
  readonly role?: AppRole;
  readonly scope?: string | null;
}) {
  const role = requireInjectedRole(injectedRole);
  const [parties, setParties] = useState<PartiesState>({ status: 'loading' });
  const [partyId, setPartyId] = useState(initialPartyId ?? '');
  const [direction, setDirection] = useState<PaymentDirection>('in');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [partyError, setPartyError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);
  const [result, setResult] = useState<PaymentResponse | null>(null);
  const [replayNote, setReplayNote] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const { submit: resilientSubmit, submitting, outcome, intentState, externallyAcked, externalAckNumber, consumeExternalAck, dismissExternalAckBanner, persistDraft } = useResilientSubmit('payment', scope);
  const [extAckShown, setExtAckShown] = useState(false);
  useEffect(() => { if (externallyAcked) setExtAckShown(true); }, [externallyAcked]);
  useEffect(() => {
    if (externallyAcked) { setAmount(''); setNote(''); setDirection('in'); clearDuplicateConfirmation(); consumeExternalAck(); }
  }, [externallyAcked, consumeExternalAck]);

  // مسودة محلية مقفولة على النطاق (PWA_RULES 4, 14-16): نجاة من الإغلاق/الموت،
  // بلا تسريب بين مستخدمين أو ساحات، وبلا أي رصيد أو مجاميع.
  useEffect(() => {
    if (!scope || draftRestored) return;
    setDraftRestored(true);
    void loadDraft(scope, 'payment').then((fields) => {
      if (!fields) return;
      if (typeof fields.partyId === 'string') setPartyId((selected) => selected || fields.partyId as string);
      if (fields.direction === 'in' || fields.direction === 'out') setDirection(fields.direction);
      if (typeof fields.amount === 'string') setAmount(fields.amount);
      if (typeof fields.note === 'string') setNote(fields.note);
    });
  }, [scope, draftRestored]);

  useEffect(() => {
    if (!scope || !draftRestored || result) return;
    const timer = window.setTimeout(() => {
      if (partyId.trim() !== '' && /[1-9]/.test(amount)) void persistDraft({ partyId, direction, amount, note });
      else void offlineStore().removeDraft(scope, 'payment');
    }, 500);
    return () => window.clearTimeout(timer);
  }, [scope, draftRestored, partyId, direction, amount, note, result]);

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
    setError(null);
    setReplayNote(false);
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
    setError(null);
    setPartyError(null);
    const outcomeResult = await resilientSubmit({
      party_id: partyId,
      direction,
      amount: amount.trim(),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(duplicateWarning && duplicateConfirmed ? { confirm_duplicate: true } : {}),
    });
    if (!outcomeResult) {
      setError(ar.payment.failed);
      return;
    }
    if (outcomeResult.kind === 'acknowledged') {
      if (isPaymentResponse(outcomeResult.payload)) {
        setResult(outcomeResult.payload);
        setReplayNote(outcomeResult.idempotentReplay);
        clearDuplicateConfirmation();
      } else {
        setError(ar.payment.failed);
      }
      return;
    }
    // تحذير «سداد مشتبه» يبقى تجربة تأكيد صريحة كما صممها العقد (409 خاص).
    if (outcomeResult.kind === 'conflict' && outcomeResult.code === 'duplicate_payment_suspected') {
      setDuplicateWarning(true);
      setDuplicateConfirmed(false);
      setError(null);
      return;
    }
    // بقية queued/parked/conflict تُعرض بنيرًا ولا تزعم الحفظ أبدًا (أدناه).
    if (outcomeResult.kind === 'conflict' || outcomeResult.kind === 'parked') {
      setError(outcomeResult.kind === 'conflict' ? `${ar.offline.conflictPrefix} ${outcomeResult.message}` : outcomeResult.message);
    }
  }

  if (result) {
    return (
      <PageContainer width="form">
        <PageHeader description={ar.payment.savedDescription} title={ar.payment.savedTitle} />
        {replayNote ? <p className="offline-outcome" role="status">{ar.offline.replayedNote}</p> : null}
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
          <Link prefetch={false} className="ui-button ui-button--primary ui-button--md" href={`/transactions/${encodeURIComponent(result.id)}/receipt`}>
            {ar.receipt.viewAction}
          </Link>
          <Link prefetch={false} className="ui-button ui-button--secondary ui-button--md" href={`/transactions/${encodeURIComponent(result.id)}`}>
            {ar.payment.viewTransactionAction}
          </Link>
          <Link prefetch={false} className="ui-link" href="/today">{ar.payment.backToToday}</Link>
        </FormActions>
      </PageContainer>
    );
  }

  return (
    <PageContainer width="form">
      <PageHeader
        action={<Link prefetch={false} className="ui-link" href="/today">{ar.payment.backToToday}</Link>}
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
          {extAckShown ? (
          <section aria-live="polite" className="offline-outcome ui-alert ui-alert--success" data-testid="external-ack-banner" role="status">
            <p>
              {ar.offlineAck.bannerPrefix}{externalAckNumber ? ` ${ar.offlineAck.bannerNumbered.replace('{n}', externalAckNumber)}` : ''}.
            </p>
            <button className="ui-link" onClick={() => { setExtAckShown(false); dismissExternalAckBanner(); }} type="button">{ar.offlineAck.dismiss}</button>
          </section>
        ) : null}
        {intentState === 'resuming' ? <p className="offline-outcome" role="status">{ar.intentBanners.resuming}</p> : null}
          {intentState === 'hasQueued' ? <p className="offline-outcome" role="status">{ar.intentBanners.hasQueued}</p> : null}
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
          {outcome && outcome.kind === 'queued' ? (
            <p aria-live="polite" className="offline-outcome" role="status">{ar.offline.queuedPrefix} {outcome.message}</p>
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
