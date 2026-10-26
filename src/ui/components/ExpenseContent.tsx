'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { ar } from '../copy/ar';
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
import { TextInput } from './TextInput';

const categories = ['fuel', 'wages', 'food', 'transport', 'rent', 'maintenance', 'other'] as const;
type ExpenseCategory = (typeof categories)[number];

interface ExpenseResponse {
  readonly id: string;
  readonly number: string;
  readonly business_date: string;
  readonly category: ExpenseCategory;
  readonly amount: string;
  readonly idempotent_replay: boolean;
}

function isExpenseResponse(value: unknown): value is ExpenseResponse {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return typeof result.id === 'string'
    && typeof result.number === 'string'
    && typeof result.business_date === 'string'
    && typeof result.amount === 'string'
    && typeof result.idempotent_replay === 'boolean'
    && typeof result.category === 'string'
    && categories.includes(result.category as ExpenseCategory);
}

/**
 * A focused expense action intentionally has no cash-balance read model. Both
 * permitted roles can record a categorised cash-out; only the owner can later
 * reconcile its effect on the Cash workspace.
 */
export function ExpenseContent({ scope = null }: { readonly scope?: string | null }) {
  const [category, setCategory] = useState<ExpenseCategory | ''>('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [result, setResult] = useState<ExpenseResponse | null>(null);
  const [replayNote, setReplayNote] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const { submit: resilientSubmit, submitting, outcome, intentState, externallyAcked, externalAckNumber, consumeExternalAck, dismissExternalAckBanner, persistDraft } = useResilientSubmit('expense', scope);
  const [extAckShown, setExtAckShown] = useState(false);
  useEffect(() => { if (externallyAcked) setExtAckShown(true); }, [externallyAcked]);
  useEffect(() => {
    if (externallyAcked) { setCategory('fuel'); setAmount(''); setNote(''); consumeExternalAck(); }
  }, [externallyAcked, consumeExternalAck]);

  // المسودة المحلية (PWA_RULES 4): إغلاق/موت جهاز لا يفقد إدخالًا ناقصًا،
  // والاستعادة تقتصر على النطاق نفسه (لا تسريب بين مستخدمين/ساحات).
  useEffect(() => {
    if (!scope || draftRestored) return;
    setDraftRestored(true);
    void loadDraft(scope, 'expense').then((fields) => {
      if (!fields) return;
      if (typeof fields.category === 'string' && (categories as readonly string[]).includes(fields.category)) {
        setCategory(fields.category as ExpenseCategory);
      }
      if (typeof fields.amount === 'string') setAmount(fields.amount);
      if (typeof fields.note === 'string') setNote(fields.note);
    });
  }, [scope, draftRestored]);

  useEffect(() => {
    if (!scope || !draftRestored || result) return;
    const timer = window.setTimeout(() => {
      // مسودة فارغة لا تُسكّ نيةً: صفر مبلغ = لا عمل.
      if (Number(amount) > 0) void persistDraft({ category, amount, note });
      else void offlineStore().removeDraft(scope, 'expense');
    }, 500);
    return () => window.clearTimeout(timer);
  }, [scope, draftRestored, category, amount, note, result, persistDraft]);

  function resetForNextExpense() {
    setCategory('');
    setAmount('');
    setNote('');
    setSubmitError(null);
    setCategoryError(null);
    setNoteError(null);
    setResult(null);
    setReplayNote(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || result) return;
    if (!category) {
      setCategoryError(ar.form.required);
      return;
    }
    if (category === 'other' && !note.trim()) {
      setNoteError(ar.expense.otherNoteRequired);
      return;
    }
    setSubmitError(null);
    setCategoryError(null);
    setNoteError(null);
    const outcomeResult = await resilientSubmit({
      category,
      amount: amount.trim(),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    if (!outcomeResult) {
      setSubmitError(ar.expense.failed);
      return;
    }
    if (outcomeResult.kind === 'acknowledged') {
      if (isExpenseResponse(outcomeResult.payload)) {
        setResult(outcomeResult.payload);
        setReplayNote(outcomeResult.idempotentReplay);
      } else {
        setSubmitError(ar.expense.failed);
      }
    }
    // queued / parked / conflict تُعرض من جسم النتيجة أدناه — بلا زعم حفظ.
  }

  if (result) {
    return (
      <PageContainer width="form">
        <PageHeader description={ar.expense.savedDescription} title={ar.expense.savedTitle} />
        <Section title={ar.expense.savedTitle} tone="muted">
          <dl className="expense-result">
            <div>
              <dt>{ar.expense.categoryLabel}</dt>
              <dd>{ar.expense.categories[result.category]}</dd>
            </div>
            <div>
              <dt>{ar.expense.amountLabel}</dt>
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
        {replayNote ? <p className="offline-outcome" role="status">{ar.offline.replayedNote}</p> : null}
        <FormActions>
          <Button onClick={resetForNextExpense} type="button" variant="secondary">{ar.expense.newExpenseAction}</Button>
          <Link className="ui-button ui-button--primary ui-button--md" href={`/transactions/${encodeURIComponent(result.id)}/receipt`}>
            {ar.receipt.viewAction}
          </Link>
          <Link className="ui-button ui-button--secondary ui-button--md" href={`/transactions/${encodeURIComponent(result.id)}`}>
            {ar.expense.viewTransactionAction}
          </Link>
          <Link className="ui-link" href="/today">{ar.expense.backToToday}</Link>
        </FormActions>
      </PageContainer>
    );
  }

  return (
    <PageContainer width="form">
      <PageHeader
        action={<Link className="ui-link" href="/today">{ar.expense.backToToday}</Link>}
        description={ar.expense.description}
        title={ar.expense.title}
      />
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
      <form className="expense-form" onSubmit={submit}>
        <FormField {...(categoryError ? { error: categoryError } : {})} id="expense-category" label={ar.expense.categoryLabel} required>
          <select
            className="text-input"
            onChange={(event) => { setCategory(event.target.value as ExpenseCategory | ''); setCategoryError(null); }}
            required
            value={category}
          >
            <option value="">{ar.expense.categoryPlaceholder}</option>
            {categories.map((item) => <option key={item} value={item}>{ar.expense.categories[item]}</option>)}
          </select>
        </FormField>
        <FormField hint={ar.expense.amountHint} id="expense-amount" label={ar.expense.amountLabel} required>
          <NumericInput
            autoComplete="off"
            maxLength={32}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            required
            step="0.01"
            unit={ar.units.currencyShort}
            value={amount}
          />
        </FormField>
        <FormField {...(noteError ? { error: noteError } : {})} hint={ar.expense.noteHint} id="expense-note" label={ar.expense.noteLabel}>
          <TextInput
            autoComplete="off"
            maxLength={1000}
            onChange={(event) => { setNote(event.target.value); setNoteError(null); }}
            value={note}
          />
        </FormField>
        {outcome && outcome.kind !== 'acknowledged' ? (
          <p aria-live="polite" className="offline-outcome" role="status">
            {outcome.kind === 'conflict'
              ? `${ar.offline.conflictPrefix} ${outcome.message}`
              : outcome.kind === 'parked'
                ? outcome.message
                : outcome.kind === 'queued'
                  ? `${ar.offline.queuedPrefix} ${outcome.message}`
                  : null}
          </p>
        ) : null}
        <FormActions stickyOnMobile {...(submitError ? { status: <span role="alert">{submitError}</span> } : {})}>
          <Button loading={submitting} size="lg" type="submit">{submitting ? ar.expense.savingAction : ar.expense.saveAction}</Button>
        </FormActions>
      </form>
    </PageContainer>
  );
}
