'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ar, type AppRole } from '../copy/ar';
import { apiErrorMessage, ensureCsrfToken } from '../clientSecurity';
import { Button } from './Button';
import { FormActions } from './FormActions';
import { FormField } from './FormField';
import { NumericInput } from './NumericInput';
import { PageContainer } from './PageContainer';
import { PageHeader } from './PageHeader';
import { Section } from './Section';
import { StatePanel } from './StatePanel';
import { TextInput } from './TextInput';

interface SetupStatus {
  readonly complete: boolean;
  readonly yard_name: string;
  readonly materials_count: number;
  readonly opening_cash_posted: boolean;
}

interface MaterialDraft {
  readonly key: string;
  displayName: string;
  defaultPricingUnit: 'kg' | 'ton';
  refBuyPrice: string;
  refSellPrice: string;
}

interface SetupResult {
  readonly yard_name: string;
  readonly materials_created: number;
  readonly opening_cash_posted: boolean;
  readonly opening_cash_amount: string;
  readonly idempotent_replay: boolean;
}



let draftCounter = 0;
function nextDraftKey(): string {
  draftCounter += 1;
  return `material-${draftCounter}`;
}

function starterMaterials(): MaterialDraft[] {
  return ar.setup.starterMaterials.map((name) => ({
    key: nextDraftKey(),
    displayName: name,
    defaultPricingUnit: 'kg',
    refBuyPrice: '',
    refSellPrice: '',
  }));
}

const moneyPattern = /^\d+(?:\.\d{1,2})?$/;
const pricePattern = /^\d+(?:\.\d{1,4})?$/;

/**
 * First-run yard setup (FR-15): a focused, mobile-first wizard. It is honest
 * about scope: it configures name, starter materials and opening cash only,
 * and points the owner to the inventory screen for optional opening stock.
 */
export function SetupContent({ role }: { readonly role?: AppRole }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'error'>('loading');
  const [step, setStep] = useState(0);
  const [yardName, setYardName] = useState('');
  const [materials, setMaterials] = useState<MaterialDraft[]>(starterMaterials);
  const [openingCash, setOpeningCash] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SetupResult | null>(null);

  useEffect(() => {
    if (role !== 'owner') return;
    const controller = new AbortController();
    void fetch('/api/setup/status', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { data?: SetupStatus } | null;
        if (!response.ok || !payload?.data) throw new Error('setup-status');
        setStatus(payload.data);
        if (!payload.data.complete && payload.data.yard_name) {
          setYardName(payload.data.yard_name);
        }
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        setLoadState('error');
      });
    return () => controller.abort();
  }, [role]);

  if (role !== 'owner') {
    return (
      <PageContainer width="form">
        <StatePanel title={ar.setup.title} description={ar.setup.forbiddenDescription} tone="warning" />
      </PageContainer>
    );
  }
  if (loadState === 'error') {
    return (
      <PageContainer width="form">
        <StatePanel title={ar.setup.unavailableTitle} description={ar.setup.unavailableDescription} tone="danger" />
      </PageContainer>
    );
  }
  if (!status) {
    return (
      <PageContainer width="form">
        <StatePanel title={ar.setup.loadingTitle} description={ar.setup.description} />
      </PageContainer>
    );
  }
  if (status.complete && !result) {
    return (
      <PageContainer width="form">
        <StatePanel
          title={ar.setup.alreadyCompleteTitle}
          description={ar.setup.alreadyCompleteDescription}
          action={<Link href="/today" className="ui-button ui-button--primary ui-button--md">{ar.setup.goTodayAction}</Link>}
        />
      </PageContainer>
    );
  }
  if (result) {
    return (
      <PageContainer width="form">
        <StatePanel
          title={ar.setup.doneTitle}
          description={ar.setup.doneDescription}
          action={<Link href="/today" className="ui-button ui-button--primary ui-button--lg">{ar.setup.goTodayAction}</Link>}
        />
      </PageContainer>
    );
  }

  function updateMaterial(key: string, patch: Partial<Omit<MaterialDraft, 'key'>>) {
    setMaterials((current) => current.map((material) => (material.key === key ? { ...material, ...patch } : material)));
  }

  function validateStep(currentStep: number): string | null {
    if (currentStep === 0 && !yardName.trim()) return ar.form.required;
    if (currentStep === 1) {
      const names = materials.map((material) => material.displayName.trim()).filter(Boolean);
      if (names.length !== materials.length) return ar.form.required;
      if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) return ar.setup.duplicateMaterialError;
      for (const material of materials) {
        if (material.refBuyPrice && !pricePattern.test(material.refBuyPrice)) return ar.setup.priceHint;
        if (material.refSellPrice && !pricePattern.test(material.refSellPrice)) return ar.setup.priceHint;
      }
    }
    if (currentStep === 2 && openingCash && !moneyPattern.test(openingCash)) return ar.setup.openingCashHint;
    return null;
  }

  function goNext() {
    const problem = validateStep(step);
    if (problem) { setError(problem); return; }
    setError(null);
    setStep((current) => Math.min(current + 1, 3));
  }

  function goBack() {
    setError(null);
    setStep((current) => Math.max(current - 1, 0));
  }

  async function submit() {
    if (submitting) return;
    const csrf = await ensureCsrfToken();
    const idempotency = globalThis.crypto?.randomUUID();
    if (!csrf || !idempotency) { setError(ar.auth.csrfUnavailable); return; }
    setSubmitting(true);
    setError(null);
    const response = await fetch('/api/setup', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotency, 'x-kayyal-csrf': csrf },
      body: JSON.stringify({
        yard_name: yardName.trim(),
        materials: materials.map((material) => ({
          display_name: material.displayName.trim(),
          default_pricing_unit: material.defaultPricingUnit,
          ref_buy_price: material.refBuyPrice || null,
          ref_sell_price: material.refSellPrice || null,
        })),
        opening_cash: openingCash || '0',
      }),
    });
    const payload = await response.json().catch(() => null) as (SetupResult & { error?: unknown }) | null;
    setSubmitting(false);
    if (!response.ok || !payload || typeof payload.yard_name !== 'string') {
      setError(apiErrorMessage(payload) ?? ar.setup.unavailableDescription);
      return;
    }
    setResult(payload);
  }

  return (
    <PageContainer width="form">
      <PageHeader title={ar.setup.title} description={ar.setup.description} />

      {step === 0 ? (
        <Section title={ar.setup.yardStepTitle} description={ar.setup.yardStepDescription}>
          <FormField id="setup-yard-name" label={ar.setup.yardNameLabel} required>
            <TextInput
              value={yardName}
              onChange={(event) => setYardName(event.currentTarget.value)}
              placeholder={ar.setup.yardNamePlaceholder}
              maxLength={120}
            />
          </FormField>
        </Section>
      ) : null}

      {step === 1 ? (
        <Section
          title={ar.setup.materialsStepTitle}
          description={ar.setup.materialsStepDescription}
          action={<Button variant="secondary" size="sm" onClick={() => setMaterials((current) => [...current, { key: nextDraftKey(), displayName: '', defaultPricingUnit: 'kg', refBuyPrice: '', refSellPrice: '' }])}>{ar.setup.addMaterialAction}</Button>}
        >
          {materials.map((material) => (
            <Section key={material.key} tone="plain" headingLevel={3} title={material.displayName.trim() || ar.setup.materialNameLabel}
              action={<Button variant="tertiary" size="sm" onClick={() => setMaterials((current) => current.filter((item) => item.key !== material.key))}>{ar.setup.removeMaterialAction}</Button>}>
              <FormField id={`${material.key}-name`} label={ar.setup.materialNameLabel} required>
                <TextInput value={material.displayName} onChange={(event) => updateMaterial(material.key, { displayName: event.currentTarget.value })} maxLength={120} />
              </FormField>
              <FormField id={`${material.key}-unit`} label={ar.setup.materialUnitLabel}>
                <select
                  className="text-input"
                  value={material.defaultPricingUnit}
                  onChange={(event) => updateMaterial(material.key, { defaultPricingUnit: event.currentTarget.value === 'ton' ? 'ton' : 'kg' })}
                >
                  <option value="kg">{ar.setup.unitKg}</option>
                  <option value="ton">{ar.setup.unitTon}</option>
                </select>
              </FormField>
              <FormField id={`${material.key}-buy`} label={ar.setup.buyPriceLabel} hint={ar.setup.priceHint}>
                <NumericInput unit={ar.units.currencyShort} value={material.refBuyPrice} onChange={(event) => updateMaterial(material.key, { refBuyPrice: event.currentTarget.value.trim() })} placeholder={ar.setup.amountPlaceholder} />
              </FormField>
              <FormField id={`${material.key}-sell`} label={ar.setup.sellPriceLabel}>
                <NumericInput unit={ar.units.currencyShort} value={material.refSellPrice} onChange={(event) => updateMaterial(material.key, { refSellPrice: event.currentTarget.value.trim() })} placeholder={ar.setup.amountPlaceholder} />
              </FormField>
            </Section>
          ))}
        </Section>
      ) : null}

      {step === 2 ? (
        <Section title={ar.setup.cashStepTitle} description={ar.setup.cashStepDescription}>
          <FormField id="setup-opening-cash" label={ar.setup.openingCashLabel} hint={ar.setup.openingCashHint} required>
            <NumericInput unit={ar.units.currencyShort} value={openingCash} onChange={(event) => setOpeningCash(event.currentTarget.value.trim())} placeholder={ar.setup.amountPlaceholder} />
          </FormField>
        </Section>
      ) : null}

      {step === 3 ? (
        <Section title={ar.setup.reviewStepTitle}>
          <dl className="fact-list">
            <div className="fact-list__row"><dt>{ar.setup.yardNameLabel}</dt><dd>{yardName.trim()}</dd></div>
            <div className="fact-list__row"><dt>{ar.setup.materialsStepTitle}</dt><dd>{materials.length} {ar.setup.reviewMaterials}</dd></div>
            <div className="fact-list__row"><dt>{ar.setup.reviewOpeningCash}</dt><dd dir="ltr">{openingCash || '0'} {ar.units.currencyShort}</dd></div>
          </dl>
        </Section>
      ) : null}

      <FormActions stickyOnMobile status={error ? <span role="alert">{error}</span> : undefined}>
        {step > 0 ? <Button variant="secondary" size="lg" onClick={goBack} disabled={submitting}>{ar.setup.backAction}</Button> : null}
        {step < 3 ? <Button size="lg" onClick={goNext}>{ar.setup.nextAction}</Button> : null}
        {step === 3 ? <Button size="lg" loading={submitting} onClick={() => void submit()}>{submitting ? ar.setup.startingAction : ar.setup.startAction}</Button> : null}
      </FormActions>
    </PageContainer>
  );
}
