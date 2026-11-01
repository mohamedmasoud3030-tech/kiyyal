'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ar, type AppRole } from '../copy/ar';
import { requireInjectedRole } from '../requiredRole';
import { apiErrorMessage, ensureCsrfToken } from '../clientSecurity';
import { Amount } from './Amount';
import { Button } from './Button';
import { FormActions } from './FormActions';
import { FormField } from './FormField';
import { PageContainer } from './PageContainer';
import { PageHeader } from './PageHeader';
import { Section } from './Section';
import { StatePanel } from './StatePanel';
import { StatusBadge } from './StatusBadge';
import { TextInput } from './TextInput';
import { canIssueTransactionReceipt } from './TransactionReceiptDocument';
import { PriceWithUnit, Weight } from './Weight';

interface TransactionLine {
  readonly id: string;
  readonly material_id: string;
  readonly material_name: string;
  readonly gross_kg: string;
  readonly deduction_type: 'none' | 'percent' | 'kg';
  readonly deduction_value: string;
  readonly net_kg: string;
  readonly price_per_kg: string;
  readonly line_total: string;
  readonly price_unit: 'kg' | 'ton';
}

interface OwnerTransactionLine extends TransactionLine {
  readonly cost_snapshot_per_kg: string | null;
  readonly gross_profit: string | null;
}

interface CostAdjustmentDetail {
  readonly original_transaction_id: string;
  readonly original_transaction_number: string | null;
  readonly original_business_date: string;
  readonly original_line_id: string;
  readonly material_id: string;
  readonly material_name: string;
  readonly original_line_value: string;
  readonly corrected_line_value: string;
  readonly delta_value: string;
  readonly correction_reason: keyof typeof ar.costAdjustment.reasonLabels;
}

const stockAdjustmentReasons = ['physical_count', 'loss', 'theft', 'weighing_error', 'correction'] as const;
type StockAdjustmentReason = (typeof stockAdjustmentReasons)[number];

interface StockAdjustment {
  readonly material_id: string;
  readonly kg: string;
  readonly cost_per_kg: string;
  readonly reason: StockAdjustmentReason;
  readonly note?: string;
}

interface Transaction {
  readonly id: string;
  readonly number: string | null;
  readonly type: 'purchase' | 'sale' | 'payment' | 'expense' | 'opening' | 'adjustment' | 'cost_adjustment' | 'regrade';
  readonly status: 'draft' | 'pending_tare' | 'pending_stock_resolution' | 'posted' | 'reversed' | 'voided';
  readonly business_date: string;
  readonly party: { readonly id: string; readonly name: string | null; readonly phone: string | null } | null;
  readonly total_amount: string;
  readonly amount_cash: string;
  readonly balance_amount: string;
  readonly expense_category: keyof typeof ar.expense.categories | null;
  readonly payment_direction: 'in' | 'out' | null;
  readonly adjustment_reason: StockAdjustmentReason | null;
  readonly note: string | null;
  /** Serialized only for owner detail responses. */
  readonly cost_adjustment_delta?: string | null;
  readonly purchase_correction?: { readonly original_day_closed: boolean } | null;
  readonly cost_adjustment?: CostAdjustmentDetail | null;
  readonly lines: readonly TransactionLine[] | readonly OwnerTransactionLine[];
}

type DetailState =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly transaction: Transaction }
  | { readonly status: 'error' };

type SettlementState = 'idle' | 'confirming' | 'adjusting' | 'submitting' | 'succeeded';

function typeLabel(type: Transaction['type']): string {
  return ar.history.typeLabels[type];
}

function isStockOnlyTransaction(type: Transaction['type']): type is 'opening' | 'adjustment' {
  return type === 'opening' || type === 'adjustment';
}

function statusFor(status: Transaction['status']): { label: string; tone: 'success' | 'warning' | 'pending' | 'neutral' | 'danger' } {
  if (status === 'posted') return { label: ar.status.posted, tone: 'success' };
  if (status === 'pending_stock_resolution') return { label: ar.status.pendingStock, tone: 'pending' };
  if (status === 'pending_tare') return { label: ar.status.pendingTare, tone: 'pending' };
  if (status === 'draft') return { label: ar.status.draft, tone: 'neutral' };
  if (status === 'reversed') return { label: ar.status.reversed, tone: 'danger' };
  if (status === 'voided') return { label: ar.status.voided, tone: 'warning' };
  return { label: ar.status.warning, tone: 'warning' };
}

function deductionLabel(line: TransactionLine): string {
  if (line.deduction_type === 'none') return ar.transactionEntry.deductionNone;
  if (line.deduction_type === 'percent') return `${line.deduction_value}%`;
  return `${line.deduction_value} ${ar.units.kilogram}`;
}

function isOwnerLine(line: TransactionLine | OwnerTransactionLine): line is OwnerTransactionLine {
  return 'cost_snapshot_per_kg' in line && 'gross_profit' in line;
}

/** Owner extras are absent, not merely hidden, in the operator API contract. */
function isOwnerTransaction(transaction: Transaction): boolean {
  return 'cost_adjustment_delta' in transaction
    && 'purchase_correction' in transaction
    && 'cost_adjustment' in transaction;
}

function isClosedPurchaseEligibleForCostAdjustment(transaction: Transaction, role: AppRole): boolean {
  return role === 'owner'
    && isOwnerTransaction(transaction)
    && transaction.type === 'purchase'
    && transaction.status === 'posted'
    && transaction.purchase_correction?.original_day_closed === true
    && transaction.lines.length > 0;
}

function adjustmentMaterials(lines: readonly TransactionLine[] | readonly OwnerTransactionLine[]): readonly TransactionLine[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    if (seen.has(line.material_id)) return false;
    seen.add(line.material_id);
    return true;
  });
}

/** A scoped detail response is rendered as fact cards, not a compressed table. */
export function TransactionDetailContent({ role: injectedRole, transactionId }: { readonly role?: AppRole; readonly transactionId: string }) {
  const role = requireInjectedRole(injectedRole);
  const [state, setState] = useState<DetailState>({ status: 'loading' });
  const [settlement, setSettlement] = useState<SettlementState>('idle');
  const [settlementKey, setSettlementKey] = useState<string | null>(null);
  const [settlementError, setSettlementError] = useState<string | null>(null);
  const [settlementUsesAdjustment, setSettlementUsesAdjustment] = useState(false);
  const [adjustmentMaterialId, setAdjustmentMaterialId] = useState('');
  const [adjustmentKg, setAdjustmentKg] = useState('');
  const [adjustmentCostPerKg, setAdjustmentCostPerKg] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState<StockAdjustmentReason | ''>('');
  const [adjustmentNote, setAdjustmentNote] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/transactions/${encodeURIComponent(transactionId)}`, {
      credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('transaction_unavailable');
        const payload: unknown = await response.json();
        if (!isTransaction(payload)) throw new Error('transaction_shape');
        setState({ status: 'loaded', transaction: payload });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState((current) => current.status === 'loaded' ? current : { status: 'error' });
      });
    return () => controller.abort();
  }, [refreshVersion, transactionId]);

  async function settlePendingSale(adjustment: StockAdjustment | null) {
    if (state.status !== 'loaded' || settlement === 'submitting') return;
    const usesAdjustment = adjustment !== null;
    const retryState: SettlementState = usesAdjustment ? 'adjusting' : 'confirming';
    const key = settlementKey ?? globalThis.crypto?.randomUUID();
    if (!key) {
      setSettlementError(ar.transactionDetail.settlementFailed);
      return;
    }
    setSettlementKey(key);
    setSettlementUsesAdjustment(usesAdjustment);
    setSettlementError(null);
    setSettlement('submitting');
    const csrf = await ensureCsrfToken();
    if (!csrf) {
      setSettlementError(ar.transactionDetail.settlementFailed);
      setSettlement(retryState);
      return;
    }
    try {
      const response = await fetch(`/api/transactions/${encodeURIComponent(transactionId)}/resolve-stock`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-kayyal-csrf': csrf },
        body: JSON.stringify({ adjustment }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isResolvedTransaction(payload)) {
        setSettlementError(apiErrorMessage(payload) ?? ar.transactionDetail.settlementFailed);
        setSettlement(retryState);
        return;
      }
      setState((current) => current.status === 'loaded'
        ? { status: 'loaded', transaction: { ...current.transaction, status: 'posted', number: payload.number } }
        : current);
      setSettlement('succeeded');
      setSettlementKey(null);
      setRefreshVersion((version) => version + 1);
    } catch {
      setSettlementError(ar.transactionDetail.settlementFailed);
      setSettlement(retryState);
    }
  }

  if (state.status === 'loading') {
    return (
      <PageContainer>
        <PageHeader title={ar.transactionDetail.title} />
        <StatePanel description={ar.state.sessionCheckingDescription} title={ar.common.loading} />
      </PageContainer>
    );
  }
  if (state.status === 'error') {
    return (
      <PageContainer>
        <PageHeader title={ar.transactionDetail.title} />
        <StatePanel description={ar.transactionDetail.unavailableDescription} title={ar.transactionDetail.unavailableTitle} tone="warning" />
      </PageContainer>
    );
  }

  const { transaction } = state;
  const transactionStatus = statusFor(transaction.status);
  const stockOnlyTransaction = isStockOnlyTransaction(transaction.type);
  const costAdjustmentTransaction = transaction.type === 'cost_adjustment';
  const ownerTransaction = role === 'owner' && isOwnerTransaction(transaction);
  const canCorrectClosedPurchase = isClosedPurchaseEligibleForCostAdjustment(transaction, role);
  const canSettle = role === 'owner' && transaction.status === 'pending_stock_resolution';
  const settlementMaterials = canSettle ? adjustmentMaterials(transaction.lines) : [];
  const showingAdjustment = settlement === 'adjusting' || (settlement === 'submitting' && settlementUsesAdjustment);
  const settlementSubmitting = settlement === 'submitting';
  return (
    <PageContainer>
      <PageHeader
        {...(canIssueTransactionReceipt(transaction) || canCorrectClosedPurchase ? {
          action: (
            <div className="page-header__actions">
              {canIssueTransactionReceipt(transaction) ? (
                <Link prefetch={false} className="ui-button ui-button--secondary ui-button--md" href={`/transactions/${encodeURIComponent(transaction.id)}/receipt`}>
                  {ar.receipt.viewAction}
                </Link>
              ) : null}
              {canCorrectClosedPurchase ? (
                <Link prefetch={false} className="ui-button ui-button--primary ui-button--md" href={`/transactions/${encodeURIComponent(transaction.id)}/cost-adjustment`}>
                  {ar.transactionDetail.costAdjustmentAction}
                </Link>
              ) : null}
            </div>
          ),
        } : {})}
        description={transaction.business_date}
        eyebrow={typeLabel(transaction.type)}
        title={transaction.number ?? ar.today.noTransactionNumber}
      />
      <Section action={<StatusBadge label={transactionStatus.label} tone={transactionStatus.tone} />} title={ar.transactionDetail.title}>
        <dl className="transaction-detail__summary">
          <div><dt>{ar.transactionDetail.businessDateLabel}</dt><dd><bdi dir="ltr">{transaction.business_date}</bdi></dd></div>
          <div><dt>{ar.transactionDetail.transactionNumberLabel}</dt><dd><bdi dir="ltr">{transaction.number ?? ar.today.noTransactionNumber}</bdi></dd></div>
          {!stockOnlyTransaction && !costAdjustmentTransaction ? <div><dt>{ar.transactionDetail.partyLabel}</dt><dd>{transaction.party?.name ?? transaction.party?.phone ?? '—'}</dd></div> : null}
          {!stockOnlyTransaction && !costAdjustmentTransaction ? <div><dt>{ar.transactionDetail.totalLabel}</dt><dd><Amount emphasis value={transaction.total_amount} /></dd></div> : null}
          {!stockOnlyTransaction && !costAdjustmentTransaction ? <div><dt>{ar.transactionDetail.cashLabel}</dt><dd><Amount value={transaction.amount_cash} /></dd></div> : null}
          {!stockOnlyTransaction && !costAdjustmentTransaction ? <div><dt>{ar.transactionDetail.balanceLabel}</dt><dd><Amount value={transaction.balance_amount} /></dd></div> : null}
          {ownerTransaction && costAdjustmentTransaction && transaction.cost_adjustment_delta !== null && transaction.cost_adjustment_delta !== undefined ? (
            <div><dt>{ar.transactionDetail.costAdjustmentDeltaLabel}</dt><dd><Amount emphasis value={transaction.cost_adjustment_delta} /></dd></div>
          ) : null}
          {canCorrectClosedPurchase ? <div><dt>{ar.transactionDetail.costAdjustmentAction}</dt><dd>{ar.transactionDetail.costAdjustmentAvailable}</dd></div> : null}
          {transaction.expense_category ? <div><dt>{ar.expense.categoryLabel}</dt><dd>{ar.expense.categories[transaction.expense_category]}</dd></div> : null}
          {transaction.type === 'payment' && transaction.payment_direction ? <div><dt>{ar.payment.directionLabel}</dt><dd>{transaction.payment_direction === 'in' ? ar.payment.directionIn : ar.payment.directionOut}</dd></div> : null}
          {transaction.type === 'adjustment' && transaction.adjustment_reason ? <div><dt>{ar.stockMovement.reasonLabel}</dt><dd>{ar.stockMovement.reasonLabels[transaction.adjustment_reason]}</dd></div> : null}
          {transaction.type === 'expense' && transaction.note ? <div><dt>{ar.expense.noteLabel}</dt><dd>{transaction.note}</dd></div> : null}
          {transaction.type === 'payment' && transaction.note ? <div><dt>{ar.payment.noteLabel}</dt><dd>{transaction.note}</dd></div> : null}
          {stockOnlyTransaction && transaction.note ? <div><dt>{ar.stockMovement.noteLabel}</dt><dd>{transaction.note}</dd></div> : null}
          {costAdjustmentTransaction && transaction.note ? <div><dt>{ar.transactionDetail.costAdjustmentNoteLabel}</dt><dd>{transaction.note}</dd></div> : null}
        </dl>
      </Section>
      {ownerTransaction && transaction.cost_adjustment ? (
        <Section title={ar.transactionDetail.costAdjustmentFactsTitle} tone="muted">
          <dl className="transaction-detail__summary">
            <div>
              <dt>{ar.transactionDetail.originalTransactionLabel}</dt>
              <dd>
                <Link prefetch={false} className="operational-list__detail-link" href={`/transactions/${encodeURIComponent(transaction.cost_adjustment.original_transaction_id)}`}>
                  <bdi dir="ltr">{transaction.cost_adjustment.original_transaction_number ?? transaction.cost_adjustment.original_transaction_id}</bdi>
                </Link>
              </dd>
            </div>
            <div><dt>{ar.transactionDetail.originalBusinessDateLabel}</dt><dd><bdi dir="ltr">{transaction.cost_adjustment.original_business_date}</bdi></dd></div>
            <div><dt>{ar.transactionDetail.linesTitle}</dt><dd>{transaction.cost_adjustment.material_name}</dd></div>
            <div><dt>{ar.transactionDetail.originalValueLabel}</dt><dd><Amount value={transaction.cost_adjustment.original_line_value} /></dd></div>
            <div><dt>{ar.transactionDetail.correctedValueLabel}</dt><dd><Amount value={transaction.cost_adjustment.corrected_line_value} /></dd></div>
            <div><dt>{ar.transactionDetail.costAdjustmentDeltaLabel}</dt><dd><Amount emphasis value={transaction.cost_adjustment.delta_value} /></dd></div>
            <div><dt>{ar.costAdjustment.reasonLabel}</dt><dd>{ar.costAdjustment.reasonLabels[transaction.cost_adjustment.correction_reason]}</dd></div>
          </dl>
        </Section>
      ) : null}
      {canSettle || settlement === 'succeeded' ? (
        <Section
          {...(canSettle ? {
            description: ar.transactionDetail.pendingSettlementDescription,
            title: ar.transactionDetail.pendingSettlementTitle,
            tone: 'critical' as const,
          } : {
            title: ar.transactionDetail.settledTitle,
            tone: 'muted' as const,
          })}
        >
          {settlement === 'idle' ? (
            <Button onClick={() => setSettlement('confirming')} type="button">{ar.transactionDetail.reviewSettlementAction}</Button>
          ) : null}
          {settlement === 'confirming' || (settlementSubmitting && !settlementUsesAdjustment) ? (
            <FormActions {...(settlementError ? { status: settlementError } : {})}>
              <Button loading={settlementSubmitting} onClick={() => void settlePendingSale(null)} type="button">
                {settlementSubmitting ? ar.transactionDetail.settlingAction : ar.transactionDetail.confirmSettlementAction}
              </Button>
              <Button
                disabled={settlementSubmitting}
                onClick={() => {
                  setAdjustmentMaterialId(settlementMaterials[0]?.material_id ?? '');
                  setSettlementError(null);
                  setSettlement('adjusting');
                }}
                type="button"
                variant="secondary"
              >
                {ar.transactionDetail.addStockAdjustmentAction}
              </Button>
              <Button disabled={settlementSubmitting} onClick={() => { setSettlement('idle'); setSettlementError(null); }} type="button" variant="tertiary">
                {ar.transactionDetail.cancelSettlementAction}
              </Button>
            </FormActions>
          ) : null}
          {showingAdjustment ? (
            <form
              className="transaction-detail__adjustment"
              onSubmit={(event) => {
                event.preventDefault();
                if (!adjustmentReason) {
                  setSettlementError(ar.stockMovement.reasonRequired);
                  return;
                }
                void settlePendingSale({
                  material_id: adjustmentMaterialId,
                  kg: adjustmentKg,
                  cost_per_kg: adjustmentCostPerKg,
                  reason: adjustmentReason,
                  ...(adjustmentNote.trim() ? { note: adjustmentNote.trim() } : {}),
                });
              }}
            >
              <p className="transaction-detail__adjustment-note">{ar.transactionDetail.adjustmentDescription}</p>
              <FormField id="settlement-material" label={ar.transactionDetail.adjustmentMaterialLabel} required>
                <select className="text-input" name="material_id" onChange={(event) => setAdjustmentMaterialId(event.target.value)} required value={adjustmentMaterialId}>
                  <option value="">{ar.transactionDetail.adjustmentMaterialPlaceholder}</option>
                  {settlementMaterials.map((line) => <option key={line.material_id} value={line.material_id}>{line.material_name}</option>)}
                </select>
              </FormField>
              <FormField id="settlement-quantity" label={ar.transactionDetail.adjustmentQuantityLabel} required>
                <TextInput inputMode="decimal" name="kg" onChange={(event) => setAdjustmentKg(event.target.value)} required type="text" value={adjustmentKg} />
              </FormField>
              <FormField id="settlement-cost" label={ar.transactionDetail.adjustmentCostLabel} required>
                <TextInput inputMode="decimal" name="cost_per_kg" onChange={(event) => setAdjustmentCostPerKg(event.target.value)} required type="text" value={adjustmentCostPerKg} />
              </FormField>
              <FormField id="settlement-reason" label={ar.transactionDetail.adjustmentReasonLabel} required>
                <select
                  className="text-input"
                  name="reason"
                  onChange={(event) => setAdjustmentReason(event.target.value as StockAdjustmentReason | '')}
                  required
                  value={adjustmentReason}
                >
                  <option value="">{ar.stockMovement.reasonPlaceholder}</option>
                  {stockAdjustmentReasons.filter((reason) => reason !== 'loss' && reason !== 'theft').map((reason) => (
                    <option key={reason} value={reason}>{ar.stockMovement.reasonLabels[reason]}</option>
                  ))}
                </select>
              </FormField>
              <FormField id="settlement-adjustment-note" label={ar.stockMovement.noteLabel}>
                <TextInput maxLength={1000} name="note" onChange={(event) => setAdjustmentNote(event.target.value)} value={adjustmentNote} />
              </FormField>
              <FormActions {...(settlementError ? { status: settlementError } : {})}>
                <Button loading={settlementSubmitting} type="submit">
                  {settlementSubmitting ? ar.transactionDetail.settlingAction : ar.transactionDetail.confirmAdjustmentAction}
                </Button>
                <Button
                  disabled={settlementSubmitting}
                  onClick={() => { setSettlement('confirming'); setSettlementError(null); setSettlementUsesAdjustment(false); }}
                  type="button"
                  variant="secondary"
                >
                  {ar.transactionDetail.backToSettlementAction}
                </Button>
              </FormActions>
            </form>
          ) : null}
          {settlement === 'succeeded' ? <StatePanel description={ar.transactionDetail.settledDescription} title={ar.transactionDetail.settledTitle} /> : null}
        </Section>
      ) : null}
      {transaction.lines.length > 0 ? (
        <Section title={ar.transactionDetail.linesTitle}>
          <ul className="transaction-detail__lines">
            {transaction.lines.map((line) => (
              <li className="transaction-detail__line" key={line.id}>
                <strong>{line.material_name}</strong>
                {stockOnlyTransaction ? (
                  <dl className="transaction-detail__facts">
                    <div><dt>{ar.stockMovement.quantityLabel}</dt><dd><Weight emphasis value={line.net_kg} /></dd></div>
                    {role === 'owner' && isOwnerLine(line) ? (
                      <div>
                        <dt>{ar.stockMovement.recordedCostLabel}</dt>
                        <dd>{line.cost_snapshot_per_kg === null
                          ? ar.stockMovement.unknownCost
                          : <PriceWithUnit unit="kg" value={line.cost_snapshot_per_kg} />}</dd>
                      </div>
                    ) : null}
                  </dl>
                ) : (
                  <dl className="transaction-detail__facts">
                    <div><dt>{ar.transactionDetail.grossWeightLabel}</dt><dd><Weight value={line.gross_kg} /></dd></div>
                    <div><dt>{ar.transactionDetail.deductionLabel}</dt><dd><bdi dir="ltr">{deductionLabel(line)}</bdi></dd></div>
                    <div><dt>{ar.transactionDetail.netWeightLabel}</dt><dd><Weight emphasis value={line.net_kg} /></dd></div>
                    <div><dt>{ar.transactionDetail.unitPriceLabel}</dt><dd><PriceWithUnit unit={line.price_unit} value={line.price_per_kg} /></dd></div>
                    <div><dt>{ar.transactionDetail.lineTotalLabel}</dt><dd><Amount emphasis value={line.line_total} /></dd></div>
                    {role === 'owner' && isOwnerLine(line) && line.cost_snapshot_per_kg !== null ? (
                      <div><dt>{ar.transactionDetail.costLabel}</dt><dd><PriceWithUnit unit="kg" value={line.cost_snapshot_per_kg} /></dd></div>
                    ) : null}
                    {role === 'owner' && isOwnerLine(line) && line.gross_profit !== null ? (
                      <div><dt>{ar.transactionDetail.profitLabel}</dt><dd><Amount value={line.gross_profit} /></dd></div>
                    ) : null}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </PageContainer>
  );
}

function isTransaction(value: unknown): value is Transaction {
  if (!value || typeof value !== 'object') return false;
  const transaction = value as Partial<Transaction>;
  return typeof transaction.id === 'string'
    && typeof transaction.type === 'string'
    && typeof transaction.status === 'string'
    && typeof transaction.business_date === 'string'
    && typeof transaction.total_amount === 'string'
    && typeof transaction.amount_cash === 'string'
    && typeof transaction.balance_amount === 'string'
    && (typeof transaction.expense_category === 'string' || transaction.expense_category === null)
    && (transaction.payment_direction === 'in' || transaction.payment_direction === 'out' || transaction.payment_direction === null)
    && (transaction.adjustment_reason === 'physical_count' || transaction.adjustment_reason === 'loss'
      || transaction.adjustment_reason === 'theft' || transaction.adjustment_reason === 'weighing_error'
      || transaction.adjustment_reason === 'correction' || transaction.adjustment_reason === null)
    && (typeof transaction.note === 'string' || transaction.note === null)
    && Array.isArray(transaction.lines);
}

function isResolvedTransaction(value: unknown): value is { readonly number: string | null; readonly status: 'posted' } {
  if (!value || typeof value !== 'object') return false;
  const result = value as { number?: unknown; status?: unknown };
  return result.status === 'posted' && (typeof result.number === 'string' || result.number === null);
}
