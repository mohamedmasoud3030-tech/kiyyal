'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { ar } from '../copy/ar';
import { apiErrorMessage, ensureCsrfToken } from '../clientSecurity';
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
export function ExpenseContent() {
  const [category, setCategory] = useState<ExpenseCategory | ''>('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [result, setResult] = useState<ExpenseResponse | null>(null);

  function resetForNextExpense() {
    setCategory('');
    setAmount('');
    setNote('');
    setIdempotencyKey(null);
    setError(null);
    setCategoryError(null);
    setNoteError(null);
    setResult(null);
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
    const key = idempotencyKey ?? globalThis.crypto?.randomUUID();
    if (!key) {
      setError(ar.expense.failed);
      return;
    }
    setError(null);
    setCategoryError(null);
    setNoteError(null);
    setSubmitting(true);
    setIdempotencyKey(key);
    const csrf = await ensureCsrfToken();
    if (!csrf) {
      setError(ar.auth.csrfUnavailable);
      setSubmitting(false);
      return;
    }
    try {
      const response = await fetch('/api/transactions/expense', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-kayyal-csrf': csrf },
        body: JSON.stringify({
          category,
          amount: amount.trim(),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isExpenseResponse(payload)) {
        setError(apiErrorMessage(payload) ?? ar.expense.failed);
        return;
      }
      setResult(payload);
      setIdempotencyKey(null);
    } catch {
      setError(ar.expense.failed);
    } finally {
      setSubmitting(false);
    }
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
        <FormActions stickyOnMobile {...(error ? { status: <span role="alert">{error}</span> } : {})}>
          <Button loading={submitting} size="lg" type="submit">{submitting ? ar.expense.savingAction : ar.expense.saveAction}</Button>
        </FormActions>
      </form>
    </PageContainer>
  );
}
