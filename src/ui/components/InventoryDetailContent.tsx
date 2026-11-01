'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { ar, type AppRole } from '../copy/ar';
import { requireInjectedRole } from '../requiredRole';
import { apiErrorMessage, ensureCsrfToken } from '../clientSecurity';
import { Alert } from './Alert';
import { Button } from './Button';
import { FormActions } from './FormActions';
import { FormField } from './FormField';
import { NumericInput } from './NumericInput';
import { PageContainer } from './PageContainer';
import { PageHeader } from './PageHeader';
import { Section } from './Section';
import { StatePanel } from './StatePanel';
import { TextInput } from './TextInput';
import { PriceWithUnit, Weight } from './Weight';
import { Amount } from './Amount';

const adjustmentReasons = ['physical_count', 'loss', 'theft', 'weighing_error', 'correction'] as const;
type AdjustmentReason = (typeof adjustmentReasons)[number];
type AdjustmentDirection = 'increase' | 'decrease';
type MovementKind = 'opening' | 'adjustment';

interface StockDetailMovement {
  readonly id: string;
  readonly type: 'purchase' | 'sale' | 'opening' | 'adjustment' | 'cost_adjustment' | 'regrade';
  readonly number: string | null;
  readonly business_date: string;
  readonly direction: 'in' | 'out';
  readonly quantity_kg: string;
  readonly cost_per_kg: string | null;
  /** Present only for a cost-only movement; quantity intentionally remains unchanged. */
  readonly cost_adjustment_delta: string | null;
  readonly adjustment_reason: AdjustmentReason | null;
  readonly note: string | null;
}

interface StockDetail {
  readonly id: string;
  readonly material_name: string;
  readonly material_type: string;
  readonly material_grade: string | null;
  readonly is_active: boolean;
  readonly quantity_kg: string;
  readonly weighted_avg_cost_per_kg: string;
  readonly total_value: string;
  readonly has_unknown_opening_cost: boolean;
  readonly can_create_opening: boolean;
  readonly movements: readonly StockDetailMovement[];
}

interface MovementResponse {
  readonly id: string;
  readonly number: string;
  readonly kind: MovementKind;
  readonly direction: 'in' | 'out';
  readonly quantity_kg: string;
  readonly cost_per_kg: string | null;
  readonly reason: AdjustmentReason | null;
  readonly business_date: string;
  readonly idempotent_replay: boolean;
}

type DetailState =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly data: StockDetail }
  | { readonly status: 'error' };

function isReason(value: unknown): value is AdjustmentReason {
  return typeof value === 'string' && (adjustmentReasons as readonly string[]).includes(value);
}

function isMovement(value: unknown): value is StockDetailMovement {
  if (!value || typeof value !== 'object') return false;
  const movement = value as Record<string, unknown>;
  return typeof movement.id === 'string'
    && (movement.type === 'purchase' || movement.type === 'sale' || movement.type === 'opening' || movement.type === 'adjustment' || movement.type === 'cost_adjustment' || movement.type === 'regrade')
    && (typeof movement.number === 'string' || movement.number === null)
    && typeof movement.business_date === 'string'
    && (movement.direction === 'in' || movement.direction === 'out')
    && typeof movement.quantity_kg === 'string'
    && (typeof movement.cost_per_kg === 'string' || movement.cost_per_kg === null)
    && (typeof movement.cost_adjustment_delta === 'string' || movement.cost_adjustment_delta === null)
    && (isReason(movement.adjustment_reason) || movement.adjustment_reason === null)
    && (typeof movement.note === 'string' || movement.note === null);
}

function isStockDetail(value: unknown): value is StockDetail {
  if (!value || typeof value !== 'object') return false;
  const detail = value as Record<string, unknown>;
  return typeof detail.id === 'string'
    && typeof detail.material_name === 'string'
    && typeof detail.material_type === 'string'
    && (typeof detail.material_grade === 'string' || detail.material_grade === null)
    && typeof detail.is_active === 'boolean'
    && typeof detail.quantity_kg === 'string'
    && typeof detail.weighted_avg_cost_per_kg === 'string'
    && typeof detail.total_value === 'string'
    && typeof detail.has_unknown_opening_cost === 'boolean'
    && typeof detail.can_create_opening === 'boolean'
    && Array.isArray(detail.movements)
    && detail.movements.every(isMovement);
}

function isMovementResponse(value: unknown): value is MovementResponse {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return typeof result.id === 'string'
    && typeof result.number === 'string'
    && (result.kind === 'opening' || result.kind === 'adjustment')
    && (result.direction === 'in' || result.direction === 'out')
    && typeof result.quantity_kg === 'string'
    && (typeof result.cost_per_kg === 'string' || result.cost_per_kg === null)
    && (isReason(result.reason) || result.reason === null)
    && typeof result.business_date === 'string'
    && typeof result.idempotent_replay === 'boolean';
}

function directionLabel(direction: 'in' | 'out'): string {
  return direction === 'in' ? ar.stockMovement.directionIncrease : ar.stockMovement.directionDecrease;
}

function relevantReasons(direction: AdjustmentDirection): readonly AdjustmentReason[] {
  return direction === 'increase'
    ? adjustmentReasons.filter((reason) => reason !== 'loss' && reason !== 'theft')
    : adjustmentReasons;
}

interface OpeningBalanceFormProps {
  readonly materialId: string;
  readonly onSaved: (result: MovementResponse) => void;
}

/** A first balance is deliberately separate from a physical adjustment: omission means unknown cost, not zero. */
export function OpeningBalanceForm({ materialId, onSaved }: OpeningBalanceFormProps) {
  const [quantityKg, setQuantityKg] = useState('');
  const [costPerKg, setCostPerKg] = useState('');
  const [note, setNote] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const key = idempotencyKey ?? globalThis.crypto?.randomUUID();
    if (!key) {
      setError(ar.stockMovement.failed);
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
      const response = await fetch('/api/stock/movements', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-kayyal-csrf': csrf },
        body: JSON.stringify({
          kind: 'opening',
          material_id: materialId,
          quantity_kg: quantityKg.trim(),
          ...(costPerKg.trim() ? { cost_per_kg: costPerKg.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isMovementResponse(payload)) {
        setError(apiErrorMessage(payload) ?? ar.stockMovement.failed);
        return;
      }
      setIdempotencyKey(null);
      onSaved(payload);
    } catch {
      setError(ar.stockMovement.failed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="stock-movement-form" onSubmit={submit}>
      <FormField hint={ar.stockMovement.quantityHint} id="opening-quantity" label={ar.stockMovement.quantityLabel} required>
        <NumericInput autoComplete="off" maxLength={32} onChange={(event) => setQuantityKg(event.target.value)} placeholder="0.00" required step="0.01" unit={ar.units.kilogram} value={quantityKg} />
      </FormField>
      <FormField hint={ar.stockMovement.openingCostHint} id="opening-cost" label={ar.stockMovement.costLabel}>
        <NumericInput autoComplete="off" maxLength={32} onChange={(event) => setCostPerKg(event.target.value)} placeholder="0.000000" step="0.000001" unit={`${ar.units.currencyShort}/${ar.units.kilogram}`} value={costPerKg} />
      </FormField>
      <FormField hint={ar.stockMovement.noteHint} id="opening-note" label={ar.stockMovement.noteLabel}>
        <TextInput autoComplete="off" maxLength={1000} onChange={(event) => setNote(event.target.value)} value={note} />
      </FormField>
      <FormActions stickyOnMobile {...(error ? { status: <span role="alert">{error}</span> } : {})}>
        <Button loading={submitting} size="lg" type="submit">{submitting ? ar.stockMovement.savingAction : ar.stockMovement.openingAction}</Button>
      </FormActions>
    </form>
  );
}

interface StockAdjustmentFormProps {
  readonly materialId: string;
  readonly averageCostPerKg: string;
  readonly onSaved: (result: MovementResponse) => void;
}

export function StockAdjustmentForm({ materialId, averageCostPerKg, onSaved }: StockAdjustmentFormProps) {
  const [direction, setDirection] = useState<AdjustmentDirection>('increase');
  const [quantityKg, setQuantityKg] = useState('');
  const [costPerKg, setCostPerKg] = useState(averageCostPerKg);
  const [reason, setReason] = useState<AdjustmentReason | ''>('');
  const [note, setNote] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeDirection(next: AdjustmentDirection) {
    setDirection(next);
    if (next === 'increase' && !costPerKg) setCostPerKg(averageCostPerKg);
    if (!relevantReasons(next).includes(reason as AdjustmentReason)) setReason('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (!reason) {
      setError(ar.stockMovement.reasonRequired);
      return;
    }
    const key = idempotencyKey ?? globalThis.crypto?.randomUUID();
    if (!key) {
      setError(ar.stockMovement.failed);
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
      const response = await fetch('/api/stock/movements', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-kayyal-csrf': csrf },
        body: JSON.stringify({
          kind: 'adjustment',
          material_id: materialId,
          quantity_kg: quantityKg.trim(),
          direction,
          reason,
          ...(direction === 'increase' ? { cost_per_kg: costPerKg.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isMovementResponse(payload)) {
        setError(apiErrorMessage(payload) ?? ar.stockMovement.failed);
        return;
      }
      setIdempotencyKey(null);
      onSaved(payload);
    } catch {
      setError(ar.stockMovement.failed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="stock-movement-form" onSubmit={submit}>
      <FormField id="stock-adjustment-direction" label={ar.stockMovement.directionLabel} required>
        <select className="text-input" onChange={(event) => changeDirection(event.target.value as AdjustmentDirection)} required value={direction}>
          <option value="increase">{ar.stockMovement.directionIncrease}</option>
          <option value="decrease">{ar.stockMovement.directionDecrease}</option>
        </select>
      </FormField>
      <FormField hint={ar.stockMovement.quantityHint} id="stock-adjustment-quantity" label={ar.stockMovement.quantityLabel} required>
        <NumericInput autoComplete="off" maxLength={32} onChange={(event) => setQuantityKg(event.target.value)} placeholder="0.00" required step="0.01" unit={ar.units.kilogram} value={quantityKg} />
      </FormField>
      {direction === 'increase' ? (
        <FormField hint={ar.stockMovement.costHint} id="stock-adjustment-cost" label={ar.stockMovement.costLabel} required>
          <NumericInput autoComplete="off" maxLength={32} onChange={(event) => setCostPerKg(event.target.value)} placeholder="0.000000" required step="0.000001" unit={`${ar.units.currencyShort}/${ar.units.kilogram}`} value={costPerKg} />
        </FormField>
      ) : null}
      <FormField id="stock-adjustment-reason" label={ar.stockMovement.reasonLabel} required>
        <select className="text-input" onChange={(event) => setReason(event.target.value as AdjustmentReason | '')} required value={reason}>
          <option value="">{ar.stockMovement.reasonPlaceholder}</option>
          {relevantReasons(direction).map((item) => <option key={item} value={item}>{ar.stockMovement.reasonLabels[item]}</option>)}
        </select>
      </FormField>
      <FormField hint={ar.stockMovement.noteHint} id="stock-adjustment-note" label={ar.stockMovement.noteLabel}>
        <TextInput autoComplete="off" maxLength={1000} onChange={(event) => setNote(event.target.value)} value={note} />
      </FormField>
      <FormActions stickyOnMobile {...(error ? { status: <span role="alert">{error}</span> } : {})}>
        <Button loading={submitting} size="lg" type="submit">{submitting ? ar.stockMovement.savingAction : ar.stockMovement.adjustmentAction}</Button>
      </FormActions>
    </form>
  );
}

function SavedMovement({ materialId, result }: { readonly materialId: string; readonly result: MovementResponse }) {
  const title = result.kind === 'opening' ? ar.stockMovement.savedOpeningTitle : ar.stockMovement.savedAdjustmentTitle;
  return (
    <PageContainer width="form">
      <PageHeader description={ar.stockMovement.savedDescription} title={title} />
      <Section title={title} tone="muted">
        <dl className="stock-movement-result">
          <div><dt>{ar.stockMovement.directionLabel}</dt><dd>{directionLabel(result.direction)}</dd></div>
          <div><dt>{ar.stockMovement.quantityLabel}</dt><dd><Weight emphasis value={result.quantity_kg} /></dd></div>
          <div><dt>{ar.stockMovement.recordedCostLabel}</dt><dd>{result.cost_per_kg === null ? ar.stockMovement.unknownCost : <PriceWithUnit unit="kg" value={result.cost_per_kg} />}</dd></div>
          {result.reason ? <div><dt>{ar.stockMovement.reasonLabel}</dt><dd>{ar.stockMovement.reasonLabels[result.reason]}</dd></div> : null}
          <div><dt>{ar.cash.businessDateLabel}</dt><dd><bdi dir="ltr">{result.business_date}</bdi></dd></div>
          <div><dt>{ar.today.transactionNumber}</dt><dd><bdi dir="ltr">{result.number}</bdi></dd></div>
        </dl>
      </Section>
      <FormActions>
        <Link prefetch={false} className="ui-button ui-button--primary ui-button--md" href={`/transactions/${encodeURIComponent(result.id)}`}>{ar.stockMovement.viewTransactionAction}</Link>
        <Link prefetch={false} className="ui-button ui-button--secondary ui-button--md" href={`/inventory/${encodeURIComponent(materialId)}`}>{ar.stockMovement.newAction}</Link>
        <Link prefetch={false} className="ui-link" href="/inventory">{ar.stockMovement.backToInventory}</Link>
      </FormActions>
    </PageContainer>
  );
}

/**
 * The owner’s focused stock context. It is never used as a direct stock editor:
 * each save calls the ledger endpoint and the only editable data is a documented
 * physical fact. The route/API both fail closed for an operator.
 */
export function InventoryDetailContent({ materialId, role: injectedRole }: { readonly materialId: string; readonly role?: AppRole }) {
  const role = requireInjectedRole(injectedRole);
  const [state, setState] = useState<DetailState>({ status: 'loading' });
  const [result, setResult] = useState<MovementResponse | null>(null);

  useEffect(() => {
    if (role !== 'owner') return;
    const controller = new AbortController();
    void fetch(`/api/stock/${encodeURIComponent(materialId)}`, {
      credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('stock_detail_unavailable');
        const payload: unknown = await response.json();
        if (!isStockDetail(payload)) throw new Error('stock_detail_shape');
        setState({ status: 'loaded', data: payload });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [materialId, role]);

  if (role !== 'owner') {
    return <PageContainer><StatePanel description={ar.state.forbiddenDescription} headingLevel={1} title={ar.state.forbiddenTitle} tone="warning" /></PageContainer>;
  }
  if (result) return <SavedMovement materialId={materialId} result={result} />;
  if (state.status === 'loading') {
    return <PageContainer><PageHeader title={ar.stockMovement.title} /><StatePanel description={ar.state.sessionCheckingDescription} headingLevel={1} title={ar.common.loading} /></PageContainer>;
  }
  if (state.status === 'error') {
    return <PageContainer><PageHeader title={ar.stockMovement.title} /><StatePanel description={ar.stockMovement.unavailableDescription} headingLevel={1} title={ar.stockMovement.unavailableTitle} tone="warning" /></PageContainer>;
  }

  const detail = state.data;
  return (
    <PageContainer>
      <PageHeader
        action={<Link prefetch={false} className="ui-link" href="/inventory">{ar.stockMovement.backToInventory}</Link>}
        description={ar.stockMovement.description}
        eyebrow={detail.material_grade ? `${detail.material_type} — ${detail.material_grade}` : detail.material_type}
        title={detail.material_name}
      />
      {detail.has_unknown_opening_cost ? <Alert title={ar.stockMovement.unknownCost} tone="warning">{ar.inventory.unknownOpeningCost}</Alert> : null}
      <Section title={ar.stockMovement.currentStockTitle} tone="muted">
        <dl className="stock-detail__summary">
          <div><dt>{ar.inventory.quantityLabel}</dt><dd><Weight emphasis value={detail.quantity_kg} /></dd></div>
          <div><dt>{ar.inventory.averageCostLabel}</dt><dd><PriceWithUnit unit="kg" value={detail.weighted_avg_cost_per_kg} /></dd></div>
          <div><dt>{ar.inventory.totalValueLabel}</dt><dd><Amount emphasis value={detail.total_value} /></dd></div>
        </dl>
      </Section>
      {detail.can_create_opening ? (
        <Section description={ar.stockMovement.openingDescription} title={ar.stockMovement.openingTitle}>
          <OpeningBalanceForm materialId={detail.id} onSaved={setResult} />
        </Section>
      ) : null}
      <Section description={ar.stockMovement.adjustmentDescription} title={ar.stockMovement.adjustmentTitle} tone="critical">
        <StockAdjustmentForm averageCostPerKg={detail.weighted_avg_cost_per_kg} materialId={detail.id} onSaved={setResult} />
      </Section>
      <Section description={ar.stockMovement.movementLogDescription} title={ar.stockMovement.movementLogTitle}>
        {detail.movements.length === 0 ? (
          <StatePanel description={ar.stockMovement.noMovementsDescription} title={ar.stockMovement.noMovementsTitle} />
        ) : (
          <ol className="stock-movement-log">
            {detail.movements.map((movement) => (
              <li className="stock-movement-log__item" key={movement.id}>
                <div className="stock-movement-log__primary">
                  <strong>{ar.history.typeLabels[movement.type]}</strong>
                  <span><bdi dir="ltr">{movement.business_date}</bdi>{movement.number ? ` · ${ar.today.transactionNumber} ${movement.number}` : ''}</span>
                  {movement.adjustment_reason ? <span>{ar.stockMovement.reasonLabels[movement.adjustment_reason]}</span> : null}
                  {movement.note ? <span>{movement.note}</span> : null}
                </div>
                <dl className="stock-movement-log__facts">
                  {movement.type === 'cost_adjustment' ? (
                    <div><dt>{ar.costAdjustment.deltaValueLabel}</dt><dd>{movement.cost_adjustment_delta === null ? '—' : <Amount emphasis value={movement.cost_adjustment_delta} />}</dd></div>
                  ) : (
                    <>
                      <div><dt>{directionLabel(movement.direction)}</dt><dd><Weight value={movement.quantity_kg} /></dd></div>
                      <div><dt>{ar.stockMovement.recordedCostLabel}</dt><dd>{movement.cost_per_kg === null ? ar.stockMovement.unknownCost : <PriceWithUnit unit="kg" value={movement.cost_per_kg} />}</dd></div>
                    </>
                  )}
                </dl>
                <Link prefetch={false} className="operational-list__detail-link" href={`/transactions/${encodeURIComponent(movement.id)}`}>{ar.history.detailAction}</Link>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </PageContainer>
  );
}
