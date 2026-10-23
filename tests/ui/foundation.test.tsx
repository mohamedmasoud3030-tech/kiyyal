import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it } from 'vitest';

import { Alert } from '../../src/ui/components/Alert.js';
import { Amount } from '../../src/ui/components/Amount.js';
import { AppShell } from '../../src/ui/components/AppShell.js';
import { Button } from '../../src/ui/components/Button.js';
import { CashContent } from '../../src/ui/components/CashContent.js';
import { CostAdjustmentContent } from '../../src/ui/components/CostAdjustmentContent.js';
import { ExpenseContent } from '../../src/ui/components/ExpenseContent.js';
import { PaymentContent } from '../../src/ui/components/PaymentContent.js';
import { PartyLedgerContent } from '../../src/ui/components/PartyLedgerContent.js';
import { FormActions } from '../../src/ui/components/FormActions.js';
import { FormField } from '../../src/ui/components/FormField.js';
import { NumericInput } from '../../src/ui/components/NumericInput.js';
import { HistoryContent } from '../../src/ui/components/HistoryContent.js';
import { InventoryDetailContent, OpeningBalanceForm, StockAdjustmentForm } from '../../src/ui/components/InventoryDetailContent.js';
import { MaterialsContent } from '../../src/ui/components/MaterialsContent.js';
import { OperatorLoginForm } from '../../src/ui/components/OperatorLoginForm.js';
import { OwnerLoginForm } from '../../src/ui/components/OwnerLoginForm.js';
import { TransactionDetailContent } from '../../src/ui/components/TransactionDetailContent.js';
import { TransactionReceiptDocument, canIssueTransactionReceipt } from '../../src/ui/components/TransactionReceiptDocument.js';
import { isReceiptTransaction } from '../../src/ui/components/TransactionReceiptContent.js';
import { TransactionEntryContent, materialSelectionPatch } from '../../src/ui/components/TransactionEntryContent.js';
import { PageContainer } from '../../src/ui/components/PageContainer.js';
import { PublicShell } from '../../src/ui/components/PublicShell.js';
import { Section } from '../../src/ui/components/Section.js';
import { StatePanel } from '../../src/ui/components/StatePanel.js';
import { StatusBadge } from '../../src/ui/components/StatusBadge.js';
import { TextInput } from '../../src/ui/components/TextInput.js';
import { ValidationSummary } from '../../src/ui/components/ValidationSummary.js';
import { PriceWithUnit, Weight } from '../../src/ui/components/Weight.js';
import { ar } from '../../src/ui/copy/ar.js';
import { formatCanonicalDecimal } from '../../src/ui/format.js';
import { dateSchema } from '../../src/server/schemas.js';
import { navigationFor } from '../../src/ui/navigation.js';

describe('UI foundation', () => {
  it('formats canonical decimal strings without coercing or rounding them in the display layer', () => {
    expect(formatCanonicalDecimal('12345.60', 2)).toBe('12,345.60');
    expect(formatCanonicalDecimal('-20', 2)).toBe('-20.00');
    expect(formatCanonicalDecimal('12.3456', 2)).toBe('12.3456');
    expect(formatCanonicalDecimal('not-a-number', 2)).toBe('not-a-number');
  });

  it('rejects impossible calendar dates before an API route can cast them in PostgreSQL', () => {
    expect(dateSchema.safeParse('2028-02-29').success).toBe(true);
    expect(dateSchema.safeParse('2026-02-30').success).toBe(false);
    expect(dateSchema.safeParse('2026-13-01').success).toBe(false);
  });

  it('clears a stale line price when a newly selected material has no reference price', () => {
    const noReferenceMaterial = {
      id: 'material-b',
      display_name: 'Material B',
      default_pricing_unit: 'ton' as const,
      ref_buy_price: null,
      ref_sell_price: null,
    };
    expect(materialSelectionPatch('sale', noReferenceMaterial.id, noReferenceMaterial)).toEqual({
      material_id: 'material-b',
      price_unit: 'ton',
      unit_price: '',
    });
    expect(materialSelectionPatch('purchase', 'unknown-material', undefined)).toEqual({
      material_id: 'unknown-material',
      unit_price: '',
    });
  });

  it('keeps currency, weight and unit information readable within RTL content', () => {
    const html = renderToStaticMarkup(
      <div dir="rtl">
        <Amount approximate emphasis value="12345.60" />
        <Weight emphasis value="1250.00" />
        <PriceWithUnit overridden unit="ton" value="8000.0000" />
      </div>,
    );

    expect(html).toContain('dir="ltr"');
    expect(html).toContain('12,345.60');
    expect(html).toContain(ar.units.currencyShort);
    expect(html).toContain('1,250.00');
    expect(html).toContain(ar.units.kilogram);
    expect(html).toContain(ar.units.ton);
    expect(html).toContain('8,000.0000');
    expect(html).toContain('price-with-unit--overridden');
    expect(html).toContain(ar.common.approximate);
  });

  it('keeps role navigation intentionally different and marks the active page', () => {
    expect(navigationFor('owner').map((item) => item.href)).toEqual(['/today', '/inventory', '/materials', '/parties', '/cash', '/history']);
    expect(navigationFor('operator').map((item) => item.href)).toEqual(['/today', '/purchase', '/sale', '/history']);

    const operatorHtml = renderToStaticMarkup(
      <AppShell activePath="/sale" connection={{ label: ar.status.safeOnDevice, tone: 'neutral' }} role="operator">
        <p>safe content</p>
      </AppShell>,
    );

    expect(operatorHtml).toContain(`aria-label="${ar.navigation.main}"`);
    expect(operatorHtml).toContain('aria-current="page"');
    expect(operatorHtml).toContain(ar.navigation.sale);
    expect(operatorHtml).toContain('app-shell__mobile-header');
    expect(operatorHtml).toContain(ar.status.safeOnDevice);
    expect(operatorHtml).not.toContain(ar.navigation.inventory);
    expect(operatorHtml).not.toContain(ar.navigation.cash);
    expect(operatorHtml).toContain(ar.auth.signOutAction);
  });

  it('uses labelled state and safety primitives rather than a generic decorative card', () => {
    const html = renderToStaticMarkup(
      <PublicShell>
        <PageContainer width="form">
          <Alert title={ar.preview.unavailableDataTitle} tone="warning">{ar.preview.unavailableDataDescription}</Alert>
          <Section title={ar.preview.ownerContentTitle} tone="critical">
            <StatusBadge label={ar.status.pending} tone="pending" />
          </Section>
          <StatePanel
            description={ar.state.forbiddenDescription}
            headingLevel={1}
            title={ar.state.forbiddenTitle}
            tone="danger"
          />
          <Button loading>{ar.common.tryAgain}</Button>
        </PageContainer>
      </PublicShell>,
    );

    expect(html).toContain('id="main-content"');
    expect(html).toContain(ar.navigation.skipToContent);
    expect(html).toContain('role="status"');
    expect(html).toContain('role="alert"');
    expect(html).toContain(ar.status.pending);
    expect(html).toContain('disabled=""');
    expect(html).toContain(ar.common.loading);
  });

  it('renders a protected operator login form without embedding PIN data or a local owner substitute', () => {
    const html = renderToStaticMarkup(<OperatorLoginForm />);
    expect(html).toContain('name="operator_login_code"');
    expect(html).toContain('name="display_name"');
    expect(html).toContain('name="pin"');
    expect(html).toMatch(/<input(?=[^>]*name="pin")(?=[^>]*type="password")(?=[^>]*autocomplete="off")[^>]*>/i);
    expect(html).not.toContain('value="pin"');
    expect(html).toContain(ar.auth.signInAction);

    const entry = renderToStaticMarkup(<TransactionEntryContent type="purchase" />);
    expect(entry).toContain(ar.transactionEntry.loadingMaterialsTitle);
    expect(entry).not.toContain('0.00 ج.م');

    const detail = renderToStaticMarkup(
      <TransactionDetailContent role="operator" transactionId="00000000-0000-4000-8000-000000000000" />,
    );
    expect(detail).toContain(ar.state.sessionCheckingDescription);
    expect(detail).not.toContain(ar.transactionDetail.costLabel);
  });

  it('renders an owner form that delegates credentials to the provider without a local role or yard field', () => {
    const html = renderToStaticMarkup(<OwnerLoginForm />);
    expect(html).toMatch(/<input(?=[^>]*name="phone")(?=[^>]*type="tel")(?=[^>]*autocomplete="tel")[^>]*>/i);
    expect(html).toMatch(/<input(?=[^>]*name="password")(?=[^>]*type="password")(?=[^>]*autocomplete="current-password")[^>]*>/i);
    expect(html).toContain(ar.auth.ownerSignInAction);
    expect(html).not.toContain('name="yard_id"');
    expect(html).not.toContain('name="role"');
  });

  it('keeps catalogue management out of an operator surface and starts owner data loading without fake rows', () => {
    const operatorHtml = renderToStaticMarkup(<MaterialsContent role="operator" />);
    expect(operatorHtml).toContain(ar.materials.forbiddenTitle);
    expect(operatorHtml).not.toContain(ar.materials.addAction);

    const ownerHtml = renderToStaticMarkup(<MaterialsContent role="owner" />);
    expect(ownerHtml).toContain(ar.state.sessionCheckingDescription);
    expect(ownerHtml).not.toContain('0.00');
  });

  it('keeps cash totals out of an operator route and avoids fake opening balances while owner data loads', () => {
    const operatorHtml = renderToStaticMarkup(<CashContent role="operator" />);
    const ownerHtml = renderToStaticMarkup(<CashContent role="owner" />);

    expect(operatorHtml).toContain(ar.cash.forbiddenTitle);
    expect(operatorHtml).not.toContain(ar.cash.totalExpectedLabel);
    expect(ownerHtml).toContain(ar.state.sessionCheckingDescription);
    expect(ownerHtml).not.toContain('0.00');
  });

  it('renders a focused expense form without embedding an owner drawer total', () => {
    const html = renderToStaticMarkup(<ExpenseContent />);
    expect(html).toContain(ar.expense.title);
    expect(html).toContain(`for="expense-category"`);
    expect(html).toContain(`id="expense-amount"`);
    expect(html).toContain(ar.expense.categories.other);
    expect(html).toContain(ar.expense.saveAction);
    expect(html).not.toContain(ar.cash.totalExpectedLabel);
    expect(html).toContain('dir="ltr"');
  });

  it('renders a scoped payment form without exposing an operator cash or party balance', () => {
    const operatorHtml = renderToStaticMarkup(<PaymentContent role="operator" />);
    const ownerHtml = renderToStaticMarkup(<PaymentContent initialPartyId="00000000-0000-4000-8000-000000000000" role="owner" />);
    const operatorLedger = renderToStaticMarkup(
      <PartyLedgerContent partyId="00000000-0000-4000-8000-000000000000" role="operator" />,
    );

    expect(operatorHtml).toContain(ar.payment.title);
    expect(operatorHtml).toContain(ar.payment.operatorPrivacyNotice);
    expect(operatorHtml).not.toContain(ar.cash.totalExpectedLabel);
    expect(operatorHtml).not.toContain(ar.partyLedger.balanceTitle);
    expect(ownerHtml).toContain(ar.payment.loadingPartiesTitle);
    expect(operatorLedger).toContain(ar.state.forbiddenTitle);
    expect(operatorLedger).not.toContain(ar.partyLedger.balanceTitle);
  });

  it('keeps physical stock correction owner-only and labels the immutable numeric inputs', () => {
    const onSaved = () => undefined;
    const operatorHtml = renderToStaticMarkup(
      <InventoryDetailContent materialId="00000000-0000-4000-8000-000000000000" role="operator" />,
    );
    const openingHtml = renderToStaticMarkup(
      <OpeningBalanceForm materialId="00000000-0000-4000-8000-000000000000" onSaved={onSaved} />,
    );
    const adjustmentHtml = renderToStaticMarkup(
      <StockAdjustmentForm averageCostPerKg="12.000000" materialId="00000000-0000-4000-8000-000000000000" onSaved={onSaved} />,
    );

    expect(operatorHtml).toContain(ar.state.forbiddenTitle);
    expect(operatorHtml).not.toContain(ar.stockMovement.currentStockTitle);
    expect(openingHtml).toContain(`for="opening-quantity"`);
    expect(openingHtml).toContain(`id="opening-cost"`);
    expect(openingHtml).toContain(ar.stockMovement.openingCostHint);
    expect(openingHtml).toContain('dir="ltr"');
    expect(adjustmentHtml).toContain(`for="stock-adjustment-direction"`);
    expect(adjustmentHtml).toContain(ar.stockMovement.reasonLabels.physical_count);
    expect(adjustmentHtml).toContain(ar.stockMovement.adjustmentAction);
  });

  it('keeps the closed-day cost-correction journey owner-only and free of fabricated facts while loading', () => {
    const transactionId = '00000000-0000-4000-8000-000000000000';
    const operatorHtml = renderToStaticMarkup(<CostAdjustmentContent role="operator" transactionId={transactionId} />);
    const ownerHtml = renderToStaticMarkup(<CostAdjustmentContent role="owner" transactionId={transactionId} />);

    expect(operatorHtml).toContain(ar.state.forbiddenTitle);
    expect(operatorHtml).not.toContain(ar.costAdjustment.correctedValueLabel);
    expect(ownerHtml).toContain(ar.costAdjustment.title);
    expect(ownerHtml).toContain(ar.state.sessionCheckingDescription);
    expect(ownerHtml).not.toContain(ar.costAdjustment.savedTitle);
    expect(ownerHtml).not.toContain('0.00');
  });

  it('renders a scoped printable receipt only for a posted numbered record without financial-owner fields', () => {
    const paymentReceipt = {
      id: '00000000-0000-4000-8000-000000000000',
      number: '42',
      type: 'payment' as const,
      status: 'posted' as const,
      business_date: '2026-09-10',
      party: { id: '10000000-0000-4000-8000-000000000000', name: 'مورد الاختبار', phone: null },
      total_amount: '125.50',
      amount_cash: '125.50',
      balance_amount: '0.00',
      expense_category: null,
      payment_direction: 'in' as const,
      note: 'سداد مستقل',
      lines: [],
    };
    const html = renderToStaticMarkup(<TransactionReceiptDocument transaction={paymentReceipt} />);

    expect(isReceiptTransaction(paymentReceipt)).toBe(true);
    expect(isReceiptTransaction({ ...paymentReceipt, lines: [{ material_id: 'missing-facts' }] })).toBe(false);
    expect(canIssueTransactionReceipt(paymentReceipt)).toBe(true);
    expect(canIssueTransactionReceipt({ ...paymentReceipt, status: 'pending_stock_resolution' })).toBe(false);
    expect(canIssueTransactionReceipt({ ...paymentReceipt, payment_direction: null })).toBe(false);
    expect(html).toContain(ar.receipt.nonTaxNotice);
    expect(html).toContain(ar.payment.directionIn);
    expect(html).toContain('125.50');
    expect(html).toContain('dir="ltr"');
    expect(html).not.toContain(ar.transactionDetail.costLabel);
    expect(html).not.toContain(ar.cash.totalExpectedLabel);
  });

  it('renders owner-only history filters with labelled controls and avoids an operator-wide-history affordance', () => {
    const ownerHtml = renderToStaticMarkup(<HistoryContent role="owner" />);
    const operatorHtml = renderToStaticMarkup(<HistoryContent role="operator" />);

    expect(ownerHtml).toContain(ar.history.filtersTitle);
    expect(ownerHtml).toContain(`for="history-search"`);
    expect(ownerHtml).toContain(ar.history.applyFiltersAction);
    expect(ownerHtml).toContain(ar.history.typeLabel);
    expect(operatorHtml).not.toContain(ar.history.filtersTitle);
    expect(operatorHtml).not.toContain(ar.history.searchPlaceholder);
  });

  it('connects labels, hints, units and errors without parsing numeric form input', () => {
    const html = renderToStaticMarkup(
      <form noValidate>
        <ValidationSummary issues={[{ fieldId: 'purchase-weight', message: 'Weight is required' }]} />
        <FormField
          error="Enter a weight greater than zero"
          hint="Use the value shown by the scale"
          id="purchase-weight"
          label="Weight"
          required
        >
          <NumericInput name="weight" unit={ar.units.kilogram} />
        </FormField>
        <FormField id="party-phone" label="Phone">
          <TextInput name="phone" type="tel" />
        </FormField>
        <FormActions stickyOnMobile status="Not submitted yet">
          <Button type="submit">{ar.preview.purchaseAction}</Button>
        </FormActions>
      </form>,
    );

    expect(html).toContain('for="purchase-weight"');
    expect(html).toContain('id="purchase-weight"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('required=""');
    expect(html).toContain('purchase-weight-hint');
    expect(html).toContain('purchase-weight-error');
    expect(html).toContain('aria-describedby="purchase-weight-hint purchase-weight-error purchase-weight-unit"');
    expect(html).toContain(ar.units.kilogram);
    expect(html).toMatch(/input[Mm]ode="decimal"/);
    expect(html).toContain('dir="ltr"');
    expect(html).toMatch(/<input(?=[^>]*name="phone")(?=[^>]*dir="ltr")(?=[^>]*type="tel")[^>]*>/);
    expect(html).toContain('href="#purchase-weight"');
    expect(html).toContain('form-actions--sticky-mobile');
  });
});
