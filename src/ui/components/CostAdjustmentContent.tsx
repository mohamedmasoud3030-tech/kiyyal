'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { ar, type AppRole } from '../copy/ar';
import { requireInjectedRole } from '../requiredRole';
import { apiErrorMessage, ensureCsrfToken } from '../clientSecurity';
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

const correctionReasons = ['wrong_weight', 'wrong_price', 'wrong_unit', 'supplier_invoice', 'other'] as const;
type CostAdjustmentReason = (typeof correctionReasons)[number];

interface PurchaseLine {
  readonly id: string;
  readonly material_id: string;
  readonly material_name: string;
  readonly line_total: string;
}

interface PurchaseForCorrection {
  readonly id: string;
  readonly number: string | null;
  readonly type: 'purchase' | 'sale' | 'payment' | 'expense' | 'opening' | 'adjustment' | 'cost_adjustment' | 'regrade';
  readonly status: 'draft' | 'pending_tare' | 'pending_stock_resolution' | 'posted' | 'reversed' | 'voided';
  readonly business_date: string;
  readonly purchase_correction: { readonly original_day_closed: boolean } | null;
  readonly lines: readonly PurchaseLine[];
}

interface CostAdjustmentResponse {
  readonly id: string;
  readonly number: string;
  readonly business_date: string;
  readonly original_transaction_id: string;
  readonly original_line_id: string;
  readonly material_id: string;
  readonly original_line_value: string;
  readonly corrected_line_value: string;
  readonly delta_value: string;
  readonly idempotent_replay: boolean;
}

type ContentState =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly purchase: PurchaseForCorrection }
  | { readonly status: 'error' };

function isPurchaseLine(value: unknown): value is PurchaseLine {
  if (!value || typeof value !== 'object') return false;
  const line = value as Record<string, unknown>;
  return typeof line.id === 'string'
    && typeof line.material_id === 'string'
    && typeof line.material_name === 'string'
    && typeof line.line_total === 'string';
}

function isPurchaseForCorrection(value: unknown): value is PurchaseForCorrection {
  if (!value || typeof value !== 'object') return false;
  const transaction = value as Record<string, unknown>;
  const correction = transaction.purchase_correction;
  return typeof transaction.id === 'string'
    && typeof transaction.type === 'string'
    && typeof transaction.status === 'string'
    && typeof transaction.business_date === 'string'
    && (correction === null || (typeof correction === 'object' && correction !== null
      && typeof (correction as Record<string, unknown>).original_day_closed === 'boolean'))
    && Array.isArray(transaction.lines)
    && transaction.lines.every(isPurchaseLine);
}

function isCostAdjustmentResponse(value: unknown): value is CostAdjustmentResponse {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return typeof result.id === 'string'
    && typeof result.number === 'string'
    && typeof result.business_date === 'string'
    && typeof result.original_transaction_id === 'string'
    && typeof result.original_line_id === 'string'
    && typeof result.material_id === 'string'
    && typeof result.original_line_value === 'string'
    && typeof result.corrected_line_value === 'string'
    && typeof result.delta_value === 'string'
    && typeof result.idempotent_replay === 'boolean';
}

function isEligible(purchase: PurchaseForCorrection): boolean {
  return purchase.type === 'purchase'
    && purchase.status === 'posted'
    && purchase.purchase_correction?.original_day_closed === true
    && purchase.lines.length > 0;
}

/**
 * A deliberately focused, owner-only correction form. The browser selects a
 * displayed source line and corrected final value; all financial identity and
 * delta facts are re-derived by the protected API under the session yard.
 */
export function CostAdjustmentContent({ role: injectedRole, transactionId }: { readonly role?: AppRole; readonly transactionId: string }) {
  const role = requireInjectedRole(injectedRole);
  const [state, setState] = useState<ContentState>({ status: 'loading' });
  const [lineId, setLineId] = useState('');
  const [correctedValue, setCorrectedValue] = useState('');
  const [reason, setReason] = useState<CostAdjustmentReason | ''>('');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lineError, setLineError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [result, setResult] = useState<CostAdjustmentResponse | null>(null);

  useEffect(() => {
    if (role !== 'owner') return;
    const controller = new AbortController();
    void fetch(`/api/transactions/${encodeURIComponent(transactionId)}`, {
      credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('purchase_unavailable');
        const payload: unknown = await response.json();
        if (!isPurchaseForCorrection(payload)) throw new Error('purchase_shape');
        setState({ status: 'loaded', purchase: payload });
      })
      .catch((fetchError: unknown) => {
        if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return;
        setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [role, transactionId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || result || state.status !== 'loaded' || !isEligible(state.purchase)) return;

    let invalid = false;
    if (!lineId) {
      setLineError(ar.form.required);
      invalid = true;
    }
    if (!reason) {
      setReasonError(ar.form.required);
      invalid = true;
    }
    if (reason === 'other' && !note.trim()) {
      setNoteError(ar.costAdjustment.otherNoteRequired);
      invalid = true;
    }
    if (!confirmed) {
      setConfirmationError(ar.costAdjustment.confirmationRequired);
      invalid = true;
    }
    if (invalid || !reason) return;

    const key = idempotencyKey ?? globalThis.crypto?.randomUUID();
    if (!key) {
      setError(ar.costAdjustment.failed);
      return;
    }
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
      const response = await fetch(`/api/transactions/${encodeURIComponent(transactionId)}/cost-adjustment`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-kayyal-csrf': csrf },
        body: JSON.stringify({
          line_id: lineId,
          corrected_line_value: correctedValue.trim(),
          reason,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isCostAdjustmentResponse(payload)) {
        setError(apiErrorMessage(payload) ?? ar.costAdjustment.failed);
        return;
      }
      setResult(payload);
      setIdempotencyKey(null);
    } catch {
      setError(ar.costAdjustment.failed);
    } finally {
      setSubmitting(false);
    }
  }

  if (role !== 'owner') {
    return <PageContainer><StatePanel description={ar.state.forbiddenDescription} headingLevel={1} title={ar.state.forbiddenTitle} tone="warning" /></PageContainer>;
  }
  if (state.status === 'loading') {
    return (
      <PageContainer width="form">
        <PageHeader title={ar.costAdjustment.title} />
        <StatePanel description={ar.state.sessionCheckingDescription} headingLevel={1} title={ar.common.loading} />
      </PageContainer>
    );
  }
  if (state.status === 'error') {
    return (
      <PageContainer width="form">
        <PageHeader title={ar.costAdjustment.title} />
        <StatePanel description={ar.costAdjustment.unavailableDescription} headingLevel={1} title={ar.costAdjustment.unavailableTitle} tone="warning" />
      </PageContainer>
    );
  }

  const purchase = state.purchase;
  if (!isEligible(purchase)) {
    return (
      <PageContainer width="form">
        <PageHeader action={<Link prefetch={false} className="ui-link" href={`/transactions/${encodeURIComponent(transactionId)}`}>{ar.costAdjustment.backToTransaction}</Link>} title={ar.costAdjustment.title} />
        <StatePanel description={ar.costAdjustment.notEligibleDescription} headingLevel={1} title={ar.costAdjustment.notEligibleTitle} tone="warning" />
      </PageContainer>
    );
  }

  const selectedLine = purchase.lines.find((line) => line.id === lineId) ?? null;
  if (result) {
    return (
      <PageContainer width="form">
        <PageHeader description={ar.costAdjustment.savedDescription} title={ar.costAdjustment.savedTitle} />
        <Section title={ar.costAdjustment.savedTitle} tone="muted">
          <dl className="cost-adjustment-result">
            <div><dt>{ar.costAdjustment.currentBusinessDateLabel}</dt><dd><bdi dir="ltr">{result.business_date}</bdi></dd></div>
            <div><dt>{ar.today.transactionNumber}</dt><dd><bdi dir="ltr">{result.number}</bdi></dd></div>
            <div><dt>{ar.costAdjustment.originalValueLabel}</dt><dd><Amount value={result.original_line_value} /></dd></div>
            <div><dt>{ar.costAdjustment.correctedValueLabel}</dt><dd><Amount value={result.corrected_line_value} /></dd></div>
            <div className="cost-adjustment-result__delta"><dt>{ar.costAdjustment.deltaValueLabel}</dt><dd><Amount emphasis value={result.delta_value} /></dd></div>
          </dl>
        </Section>
        <FormActions>
          <Link prefetch={false} className="ui-button ui-button--primary ui-button--md" href={`/transactions/${encodeURIComponent(result.id)}`}>{ar.costAdjustment.viewAdjustmentAction}</Link>
          <Link prefetch={false} className="ui-button ui-button--secondary ui-button--md" href={`/transactions/${encodeURIComponent(transactionId)}`}>{ar.costAdjustment.backToTransaction}</Link>
        </FormActions>
      </PageContainer>
    );
  }

  return (
    <PageContainer width="form">
      <PageHeader
        action={<Link prefetch={false} className="ui-link" href={`/transactions/${encodeURIComponent(transactionId)}`}>{ar.costAdjustment.backToTransaction}</Link>}
        description={ar.costAdjustment.description}
        eyebrow={purchase.number ?? purchase.business_date}
        title={ar.costAdjustment.title}
      />
      <Section description={ar.costAdjustment.sourceDescription} title={ar.costAdjustment.sourceTitle} tone="critical">
        <form className="cost-adjustment-form" onSubmit={(event) => void submit(event)}>
          <FormField {...(lineError ? { error: lineError } : {})} id="cost-adjustment-line" label={ar.costAdjustment.lineLabel} required>
            <select
              className="text-input"
              onChange={(event) => { setLineId(event.target.value); setLineError(null); }}
              required
              value={lineId}
            >
              <option value="">{ar.costAdjustment.linePlaceholder}</option>
              {purchase.lines.map((line) => (
                <option key={line.id} value={line.id}>{line.material_name} — {line.line_total} {ar.units.currencyShort}</option>
              ))}
            </select>
          </FormField>
          {selectedLine ? (
            <dl className="cost-adjustment-source-facts">
              <div><dt>{ar.costAdjustment.originalValueLabel}</dt><dd><Amount emphasis value={selectedLine.line_total} /></dd></div>
            </dl>
          ) : null}
          <FormField hint={ar.costAdjustment.correctedValueHint} id="cost-adjustment-corrected-value" label={ar.costAdjustment.correctedValueLabel} required>
            <NumericInput
              autoComplete="off"
              maxLength={32}
              onChange={(event) => setCorrectedValue(event.target.value)}
              placeholder="0.00"
              required
              step="0.01"
              unit={ar.units.currencyShort}
              value={correctedValue}
            />
          </FormField>
          <FormField {...(reasonError ? { error: reasonError } : {})} id="cost-adjustment-reason" label={ar.costAdjustment.reasonLabel} required>
            <select
              className="text-input"
              onChange={(event) => { setReason(event.target.value as CostAdjustmentReason | ''); setReasonError(null); }}
              required
              value={reason}
            >
              <option value="">{ar.costAdjustment.reasonPlaceholder}</option>
              {correctionReasons.map((item) => <option key={item} value={item}>{ar.costAdjustment.reasonLabels[item]}</option>)}
            </select>
          </FormField>
          <FormField {...(noteError ? { error: noteError } : {})} hint={ar.costAdjustment.noteHint} id="cost-adjustment-note" label={ar.costAdjustment.noteLabel}>
            <TextInput
              autoComplete="off"
              maxLength={1000}
              onChange={(event) => { setNote(event.target.value); setNoteError(null); }}
              value={note}
            />
          </FormField>
          <label className="cost-adjustment-confirmation">
            <input
              checked={confirmed}
              onChange={(event) => { setConfirmed(event.target.checked); setConfirmationError(null); }}
              type="checkbox"
            />
            <span>{ar.costAdjustment.confirmationLabel}</span>
          </label>
          {confirmationError ? <p className="form-field__error" role="alert">{confirmationError}</p> : null}
          <FormActions stickyOnMobile {...(error ? { status: <span role="alert">{error}</span> } : {})}>
            <Button loading={submitting} size="lg" type="submit">{submitting ? ar.costAdjustment.savingAction : ar.costAdjustment.saveAction}</Button>
          </FormActions>
        </form>
      </Section>
    </PageContainer>
  );
}
