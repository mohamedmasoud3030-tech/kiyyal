import { ar } from '../copy/ar';
import { Amount } from './Amount';
import { PriceWithUnit, Weight } from './Weight';

export type ReceiptTransactionType = 'purchase' | 'sale' | 'payment' | 'expense' | 'opening' | 'adjustment' | 'cost_adjustment' | 'regrade';

export interface ReceiptLine {
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

export interface ReceiptTransaction {
  readonly id: string;
  readonly number: string | null;
  readonly type: ReceiptTransactionType;
  readonly status: 'draft' | 'pending_tare' | 'pending_stock_resolution' | 'posted' | 'reversed' | 'voided';
  readonly business_date: string;
  readonly party: { readonly id: string; readonly name: string | null; readonly phone: string | null } | null;
  readonly total_amount: string;
  readonly amount_cash: string;
  readonly balance_amount: string;
  readonly expense_category: keyof typeof ar.expense.categories | null;
  readonly payment_direction: 'in' | 'out' | null;
  readonly note: string | null;
  readonly lines: readonly ReceiptLine[];
}

function typeLabel(type: ReceiptTransactionType): string {
  return ar.history.typeLabels[type];
}

function deductionLabel(line: ReceiptLine): string {
  if (line.deduction_type === 'none') return ar.transactionEntry.deductionNone;
  if (line.deduction_type === 'percent') return `${line.deduction_value}%`;
  return `${line.deduction_value} ${ar.units.kilogram}`;
}

/**
 * A receipt may only represent a posted, numbered record. In particular, an
 * unresolved sale is a held operation rather than an issueable receipt.
 */
export function canIssueTransactionReceipt(transaction: ReceiptTransaction): boolean {
  // A receipt represents a counterparty/cash operation. Inventory openings and
  // physical corrections remain immutable history records, not customer slips.
  return transaction.status === 'posted'
    && transaction.number !== null
    && (transaction.type === 'purchase' || transaction.type === 'sale' || transaction.type === 'expense' || transaction.type === 'payment')
    && (transaction.type !== 'payment' || transaction.payment_direction !== null);
}

/**
 * Printable presentation uses only the scoped public transaction fields. It
 * deliberately has no owner cost, profit, cash-drawer or party-ledger facts.
 */
export function TransactionReceiptDocument({ transaction }: { readonly transaction: ReceiptTransaction }) {
  const partyLabel = transaction.party?.name ?? transaction.party?.phone ?? '—';
  return (
    <article aria-labelledby="receipt-title" className="transaction-receipt">
      <header className="transaction-receipt__header">
        <p className="transaction-receipt__brand">{ar.app.name}</p>
        <p className="transaction-receipt__notice">{ar.receipt.nonTaxNotice}</p>
        <h1 id="receipt-title">{ar.receipt.title}</h1>
      </header>

      <dl className="transaction-receipt__summary">
        <div>
          <dt>{ar.receipt.receiptNumberLabel}</dt>
          <dd><bdi dir="ltr">{transaction.number}</bdi></dd>
        </div>
        <div>
          <dt>{ar.receipt.transactionTypeLabel}</dt>
          <dd>{typeLabel(transaction.type)}</dd>
        </div>
        <div>
          <dt>{ar.receipt.businessDateLabel}</dt>
          <dd><bdi dir="ltr">{transaction.business_date}</bdi></dd>
        </div>
        <div>
          <dt>{ar.receipt.partyLabel}</dt>
          <dd>{partyLabel}</dd>
        </div>
        <div>
          <dt>{ar.receipt.totalLabel}</dt>
          <dd><Amount emphasis value={transaction.total_amount} /></dd>
        </div>
        <div>
          <dt>{ar.receipt.cashLabel}</dt>
          <dd><Amount value={transaction.amount_cash} /></dd>
        </div>
        <div>
          <dt>{ar.receipt.balanceLabel}</dt>
          <dd><Amount value={transaction.balance_amount} /></dd>
        </div>
        {transaction.type === 'payment' && transaction.payment_direction ? (
          <div>
            <dt>{ar.receipt.directionLabel}</dt>
            <dd>{transaction.payment_direction === 'in' ? ar.payment.directionIn : ar.payment.directionOut}</dd>
          </div>
        ) : null}
        {transaction.type === 'expense' && transaction.expense_category ? (
          <div>
            <dt>{ar.receipt.expenseCategoryLabel}</dt>
            <dd>{ar.expense.categories[transaction.expense_category]}</dd>
          </div>
        ) : null}
        {transaction.note ? (
          <div className="transaction-receipt__note">
            <dt>{ar.receipt.noteLabel}</dt>
            <dd>{transaction.note}</dd>
          </div>
        ) : null}
      </dl>

      {transaction.lines.length > 0 ? (
        <section aria-labelledby="receipt-lines-title" className="transaction-receipt__lines-section">
          <h2 id="receipt-lines-title">{ar.receipt.linesTitle}</h2>
          <ol className="transaction-receipt__lines">
            {transaction.lines.map((line, index) => (
              <li className="transaction-receipt__line" key={`${line.material_id}-${index}`}>
                <h3>{line.material_name}</h3>
                <dl className="transaction-receipt__line-facts">
                  <div><dt>{ar.receipt.grossWeightLabel}</dt><dd><Weight value={line.gross_kg} /></dd></div>
                  <div><dt>{ar.receipt.deductionLabel}</dt><dd><bdi dir="ltr">{deductionLabel(line)}</bdi></dd></div>
                  <div><dt>{ar.receipt.netWeightLabel}</dt><dd><Weight emphasis value={line.net_kg} /></dd></div>
                  <div><dt>{ar.receipt.unitPriceLabel}</dt><dd><PriceWithUnit unit={line.price_unit} value={line.price_per_kg} /></dd></div>
                  <div><dt>{ar.receipt.lineTotalLabel}</dt><dd><Amount value={line.line_total} /></dd></div>
                </dl>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </article>
  );
}
